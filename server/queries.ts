import { z } from 'zod';
import type { Actor, ProjectDetail, SearchResult, State, TaskDetail } from '../shared/types';
import {
  dueGroup,
  effectiveMilestone,
  isClosed,
  isOpen,
  progress,
  workspaceToday,
} from '../shared/rules';
import { requireMember } from './domain';
import { AppError } from './errors';

const paging = {
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(256).optional(),
};
const flag = z.enum(['true', 'false']).optional();
const uuid = z.string().uuid();
const memberFilter = z.union([uuid, z.enum(['me', 'unassigned'])]).optional();
const projectQuery = z
  .object({
    ...paging,
    archived: flag,
    view: z.enum(['active', 'completed', 'archived', 'all']).optional(),
  })
  .strict();
const taskQuery = z
  .object({
    ...paging,
    project: uuid.optional(),
    assignee: memberFilter,
    collaborator: z.union([uuid, z.literal('me')]).optional(),
    status: z
      .enum(['todo', 'in_progress', 'done', 'canceled', 'open', 'not_canceled', 'all'])
      .optional(),
    milestone: z.union([uuid, z.literal('none')]).optional(),
    due_group: z.enum(['overdue', 'today', 'upcoming', 'no_date']).optional(),
    view: z.enum(['assigned', 'collaborating', 'completed']).optional(),
    q: z.string().trim().max(160).optional(),
    archived: flag,
    trash: flag,
    top_level: flag,
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, query: unknown): T {
  const parsed = schema.safeParse(query);
  if (!parsed.success)
    throw new AppError(422, 'INVALID_FILTER', 'Choose a valid filter.', {
      fields: Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
      ),
    });
  return parsed.data;
}
export function projectDetail(state: State, id: string): ProjectDetail {
  const project = state.projects.find((p) => p.id === id);
  if (!project) throw new AppError(404, 'NOT_FOUND', 'Project unavailable.');
  const tasks = state.tasks.filter((t) => t.projectId === id);
  return {
    ...project,
    progress: progress(tasks),
    milestones: state.milestones
      .filter((m) => m.projectId === id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((m) => ({ ...m, progress: progress(tasks.filter((t) => t.milestoneId === m.id)) })),
  };
}
export function taskDetail(state: State, id: string): TaskDetail {
  const task = state.tasks.find((t) => t.id === id && !t.deletedAt);
  if (!task) throw new AppError(404, 'NOT_FOUND', 'Task unavailable.');
  return {
    task,
    project: state.projects.find((p) => p.id === task.projectId)!,
    parent: state.tasks.find((t) => t.id === task.parentId && !t.deletedAt) || null,
    children: state.tasks.filter((t) => t.parentId === id && !t.deletedAt),
    comments: state.comments
      .filter((c) => c.taskId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    activities: state.activities
      .filter((a) => a.entityId === id)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    milestones: state.milestones
      .filter((m) => m.projectId === task.projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    blockerCandidates: state.tasks.filter(
      (t) =>
        t.projectId === task.projectId &&
        t.id !== id &&
        t.id !== task.parentId &&
        t.parentId !== id &&
        !t.deletedAt,
    ),
  };
}
export function listProjects(state: State, query: unknown) {
  const q = parse(projectQuery, query);
  return state.projects
    .filter((p) => {
      if (q.view === 'all') return true;
      if (q.view === 'archived' || q.archived === 'true') return !!p.archivedAt;
      if (p.archivedAt) return false;
      if (q.view === 'active') return !isClosed(p.status);
      if (q.view === 'completed') return isClosed(p.status);
      return true;
    })
    .map((p) => ({ ...p, progress: progress(state.tasks.filter((t) => t.projectId === p.id)) }));
}
export function listTasks(state: State, actor: Actor, query: unknown) {
  const q = parse(taskQuery, query);
  const member = requireMember(state, actor);
  const today = workspaceToday(state.workspace.timeZone);
  return state.tasks.filter((t) => {
    const project = state.projects.find((p) => p.id === t.projectId)!;
    if (q.trash === 'true' ? !t.deletedAt : !!t.deletedAt) return false;
    if (q.archived !== 'true' && project.archivedAt) return false;
    if (q.project && t.projectId !== q.project) return false;
    if (q.top_level === 'true' && t.parentId) return false;
    if (q.view) {
      if (
        q.view === 'collaborating'
          ? !t.collaboratorIds.includes(member.id)
          : t.assigneeId !== member.id
      )
        return false;
      if (q.view === 'completed' ? t.status !== 'done' : !isOpen(t.status)) return false;
    }
    if (q.assignee === 'unassigned' && t.assigneeId) return false;
    if (
      q.assignee &&
      q.assignee !== 'unassigned' &&
      t.assigneeId !== (q.assignee === 'me' ? member.id : q.assignee)
    )
      return false;
    if (
      q.collaborator &&
      !t.collaboratorIds.includes(q.collaborator === 'me' ? member.id : q.collaborator)
    )
      return false;
    if (q.status && q.status !== 'all') {
      if (
        q.status === 'open'
          ? !isOpen(t.status)
          : q.status === 'not_canceled'
            ? t.status === 'canceled'
            : t.status !== q.status
      )
        return false;
    }
    if (
      q.milestone &&
      effectiveMilestone(t, state.tasks) !== (q.milestone === 'none' ? null : q.milestone)
    )
      return false;
    if (q.due_group && dueGroup(t, today).toLowerCase().replace(' ', '_') !== q.due_group)
      return false;
    return (
      !q.q || `${t.title} ${t.id} OR-${t.id.slice(-6)}`.toLowerCase().includes(q.q.toLowerCase())
    );
  });
}
export function listMembers(state: State, query: unknown) {
  const q = parse(z.object({ ...paging, active: flag }).strict(), query);
  return state.members.filter((m) => !q.active || m.active === (q.active === 'true'));
}
export function listMilestones(state: State, query: unknown) {
  const q = parse(z.object({ ...paging, project: uuid.optional() }).strict(), query);
  return state.milestones.filter((m) => !q.project || m.projectId === q.project);
}
export function listNotifications(state: State, actor: Actor, query: unknown) {
  const q = parse(
    z.object({ ...paging, read: z.enum(['unread', 'read', 'all']).optional() }).strict(),
    query,
  );
  const member = requireMember(state, actor);
  return state.notifications.filter(
    (n) =>
      n.recipientId === member.id &&
      (q.read === 'unread' ? !n.readAt : q.read === 'read' ? !!n.readAt : true),
  );
}
export function listTrash(state: State, query: unknown) {
  parse(z.object(paging).strict(), query);
  return state.tasks.filter(
    (t) =>
      t.deletedAt &&
      !(
        t.parentId &&
        state.tasks.some(
          (parent) =>
            parent.id === t.parentId &&
            parent.deletedAt &&
            parent.deletionBatchId === t.deletionBatchId,
        )
      ),
  );
}
export function listInvites(state: State, actor: Actor, query: unknown) {
  const q = parse(z.object({ ...paging, pending: flag }).strict(), query);
  if (requireMember(state, actor).role !== 'admin')
    throw new AppError(403, 'FORBIDDEN', 'Only admins can view invitations.');
  return state.invites
    .filter((i) => q.pending !== 'true' || (!i.acceptedAt && !i.revokedAt))
    .map(({ tokenHash: _, ...invite }) => invite);
}
export function searchWorkspace(state: State, query: unknown): SearchResult[] {
  const q = parse(
    z
      .object({
        q: z.string().trim().max(160).default(''),
        limit: z.coerce.number().int().min(1).max(30).default(15),
      })
      .strict(),
    query,
  );
  const needle = q.q.toLowerCase();
  const projects: SearchResult[] = state.projects
    .filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(needle))
    .map((p) => ({
      id: p.id,
      kind: 'project',
      title: p.name,
      context: p.archivedAt ? 'Archived' : 'Project',
      path: `/projects/${p.id}`,
    }));
  const tasks: SearchResult[] = state.tasks
    .filter(
      (t) =>
        !t.deletedAt && `${t.title} ${t.id} OR-${t.id.slice(-6)}`.toLowerCase().includes(needle),
    )
    .map((t) => ({
      id: t.id,
      kind: 'task',
      title: t.title,
      status: t.status,
      context: state.projects.find((p) => p.id === t.projectId)!.name,
      path: `/tasks/${t.id}`,
    }));
  return [...projects, ...tasks].slice(0, q.limit);
}
