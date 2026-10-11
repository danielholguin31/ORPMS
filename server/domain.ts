import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type {
  Actor,
  Activity,
  ApiResult,
  Comment,
  Invite,
  Member,
  Milestone,
  Project,
  RecordBase,
  State,
  Task,
} from '../shared/types';
import { isClosed, isOpen } from '../shared/rules';
import { AppError, invariant } from './errors';
import type { Store } from './store/types';

const uuid = z.string().uuid();
const nullableId = uuid.nullable();
const title = z.string().trim().min(1).max(160);
const text = z.string().max(20000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      v >= '0001-01-01' &&
      !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
      new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v,
    'Choose a valid calendar date',
  )
  .nullable();
const taskStatus = z.enum(['todo', 'in_progress', 'done', 'canceled']);
const projectStatus = z.enum(['planned', 'active', 'done', 'canceled']);
const version = { expected_version: z.number().int().positive() };
const taskFields = {
  title,
  description: text,
  status: taskStatus,
  assigneeId: nullableId,
  collaboratorIds: z.array(uuid).max(100),
  startDate: date,
  dueDate: date,
  milestoneId: nullableId,
  blockedById: nullableId,
};
const projectFields = {
  name: title,
  description: text,
  ownerId: nullableId,
  status: projectStatus,
  startDate: date,
  targetDate: date,
};
const milestoneFields = {
  name: title,
  description: text,
  targetDate: date,
  sortOrder: z.number().int().min(0),
};
const schemas = {
  'task.create': z
    .object({ projectId: uuid, parentId: nullableId.optional(), ...taskFields })
    .partial()
    .required({ projectId: true, title: true })
    .strict(),
  'task.patch': z.object(taskFields).partial().extend(version).strict(),
  'task.trash': z.object({ ...version, scope: z.literal('task_and_subtasks') }).strict(),
  'task.restore': z.object(version).strict(),
  'project.create': z.object(projectFields).partial().required({ name: true }).strict(),
  'project.patch': z.object(projectFields).partial().extend(version).strict(),
  'project.archive': z.object(version).strict(),
  'project.restore': z.object(version).strict(),
  'milestone.create': z
    .object({ projectId: uuid, ...milestoneFields })
    .partial()
    .required({ projectId: true, name: true })
    .strict(),
  'milestone.patch': z.object(milestoneFields).partial().extend(version).strict(),
  'milestone.delete': z.object(version).strict(),
  'comment.create': z
    .object({ body: text.trim().min(1), mentionIds: z.array(uuid).max(100).default([]) })
    .strict(),
  'comment.patch': z
    .object({
      ...version,
      body: text.trim().min(1),
      mentionIds: z.array(uuid).max(100).default([]),
    })
    .strict(),
  'comment.delete': z.object(version).strict(),
  'invite.create': z
    .object({
      email: z
        .email()
        .max(320)
        .transform((v) => v.trim().toLowerCase()),
      role: z.enum(['admin', 'member']).default('member'),
    })
    .strict(),
  'invite.revoke': z.object(version).strict(),
  'invite.accept': z.object({ token: z.string().min(20).max(256) }).strict(),
  'member.patch': z
    .object({
      ...version,
      role: z.enum(['admin', 'member']).optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  'workspace.patch': z
    .object({
      ...version,
      timeZone: z.string().refine((v) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, 'Use an IANA time zone, e.g. America/Bogota'),
    })
    .strict(),
  'notification.read': z
    .object({ ids: z.array(uuid).max(100).optional(), all: z.boolean().optional() })
    .refine((v) => v.all || v.ids?.length, 'Select notifications or mark all read'),
};
export type Operation = keyof typeof schemas;
type Payload = Record<string, any>;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export const inviteToken = (id: string, secret: string) =>
  `${id}.${createHmac('sha256', secret).update(id).digest('base64url')}`;
const canonical = (value: any): string =>
  value === null || typeof value !== 'object'
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : `{${Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
          .join(',')}}`;

export function requireMember(state: State, actor: Actor): Member {
  const member = state.members.find((m) => m.userId === actor.userId && m.active);
  if (!member)
    throw new AppError(
      403,
      'NOT_A_MEMBER',
      'You do not have access to this workspace. Ask an admin for an invitation.',
    );
  return member;
}
const requireAdmin = (member: Member) =>
  invariant(
    member.role === 'admin',
    'This action is available to workspace admins.',
    'FORBIDDEN',
    403,
  );
function find<T extends { id: string }>(records: T[], id: string): T {
  const record = records.find((r) => r.id === id);
  if (!record) throw new AppError(404, 'NOT_FOUND', 'This record is unavailable.');
  return record;
}
function checkVersion(record: { version: number }, expected: number) {
  if (record.version !== expected)
    throw new AppError(
      409,
      'VERSION_CONFLICT',
      'Someone changed this record. Your draft is preserved. Reload the current version or reapply your draft.',
      { current: record },
    );
}
function dates(start: string | null, end: string | null) {
  invariant(
    !start || !end || start <= end,
    'The start date must be on or before the target or due date.',
    'INVALID_DATES',
    422,
  );
}
function projectEditable(state: State, projectId: string) {
  const project = find(state.projects, projectId);
  invariant(!project.archivedAt, 'Restore this project before making changes.', 'PROJECT_ARCHIVED');
  invariant(
    !isClosed(project.status),
    'Reopen this project before making changes.',
    'PROJECT_CLOSED',
  );
  return project;
}
function taskEditable(state: State, taskId: string) {
  const task = find(state.tasks, taskId);
  invariant(!task.deletedAt, 'Restore this task before making changes.', 'TASK_TRASHED');
  projectEditable(state, task.projectId);
  return task;
}
function eligibleMember(state: State, id: string | null) {
  invariant(
    !id || state.members.some((m) => m.id === id && m.active),
    'Choose an active workspace member.',
    'INACTIVE_MEMBER',
    422,
  );
}
function validateTask(state: State, task: Task) {
  dates(task.startDate, task.dueDate);
  eligibleMember(state, task.assigneeId);
  task.collaboratorIds = [...new Set(task.collaboratorIds)];
  task.collaboratorIds.forEach((id) => eligibleMember(state, id));
  if (task.parentId) {
    const parent = find(state.tasks, task.parentId);
    invariant(
      !parent.parentId && !parent.deletedAt && parent.projectId === task.projectId,
      'Subtasks have one parent in the same project.',
      'INVALID_PARENT',
      422,
    );
    invariant(
      !task.milestoneId,
      'A subtask shares its parent’s milestone.',
      'INHERITED_MILESTONE',
      422,
    );
    invariant(
      !isOpen(task.status) || isOpen(parent.status),
      'Reopen the parent before adding or reopening an open subtask.',
      'PARENT_CLOSED',
    );
  }
  if (isClosed(task.status)) {
    invariant(
      !state.tasks.some((t) => t.parentId === task.id && !t.deletedAt && isOpen(t.status)),
      'Complete or cancel every open subtask before closing the parent.',
      'OPEN_SUBTASKS',
    );
  }
  if (task.milestoneId) {
    invariant(
      find(state.milestones, task.milestoneId).projectId === task.projectId,
      'Choose a milestone in this project.',
      'INVALID_MILESTONE',
      422,
    );
  }
  if (task.blockedById) {
    const blocker = find(state.tasks, task.blockedById);
    invariant(
      !blocker.deletedAt && blocker.projectId === task.projectId && blocker.id !== task.id,
      'A blocker must be another available task in this project.',
      'INVALID_BLOCKER',
      422,
    );
    invariant(
      blocker.parentId !== task.id && task.parentId !== blocker.id,
      'Parent and child tasks cannot block each other.',
      'INVALID_BLOCKER',
      422,
    );
    const visited = new Set([task.id]);
    let cursor: Task | undefined = blocker;
    while (cursor) {
      invariant(
        !visited.has(cursor.id),
        'This blocker would create a cycle.',
        'BLOCKER_CYCLE',
        422,
      );
      visited.add(cursor.id);
      cursor = state.tasks.find((t) => t.id === cursor?.blockedById && !t.deletedAt);
    }
  }
}
function changes(previous: Record<string, any>, next: Record<string, any>) {
  return Object.fromEntries(
    Object.keys(next)
      .filter(
        (k) =>
          !['updatedAt', 'version'].includes(k) && canonical(previous[k]) !== canonical(next[k]),
      )
      .map((k) => [k, { from: previous[k] ?? null, to: next[k] ?? null }]),
  );
}
function sanitizeResult(result: any): any {
  if (result && typeof result === 'object' && 'tokenHash' in result) {
    const { tokenHash: _, ...safe } = result;
    return safe;
  }
  return result;
}

export class Domain {
  constructor(
    public store: Store,
    private secret: string,
    private clock: () => Date = () => new Date(),
  ) {}
  async mutate(
    actor: Actor,
    operation: Operation,
    entityId: string | null,
    input: unknown,
    key: string,
  ): Promise<ApiResult<any>> {
    invariant(
      key.length >= 8 && key.length <= 128,
      'Include an 8–128 character Idempotency-Key header.',
      'INVALID_IDEMPOTENCY_KEY',
      422,
    );
    const parsed = schemas[operation].safeParse(input);
    if (!parsed.success)
      throw new AppError(422, 'INVALID_INPUT', 'Check the highlighted fields.', {
        fields: Object.fromEntries(
          parsed.error.issues.map((i) => [i.path.join('.') || 'form', i.message]),
        ),
      });
    const payload = parsed.data as Payload;
    const requestHash = sha(canonical({ operation, entityId, payload }));
    return this.store.transaction(
      (state) => {
        const member =
          operation === 'invite.accept'
            ? state.members.find((m) => m.userId === actor.userId && m.active)
            : requireMember(state, actor);
        // Recheck current access and route-level permissions BEFORE replaying a receipt.
        if (
          [
            'invite.create',
            'invite.revoke',
            'member.patch',
            'workspace.patch',
            'project.archive',
            'project.restore',
          ].includes(operation)
        )
          requireAdmin(member!);
        const now = this.clock().toISOString();
        state.receipts = state.receipts.filter((r) => r.expiresAt > now);
        const previous = state.receipts.find(
          (r) => r.actorUserId === actor.userId && r.idempotencyKey === key,
        );
        if (previous) {
          invariant(
            previous.requestHash === requestHash,
            'This idempotency key was used for a different request.',
            'KEY_REUSED',
          );
          if (operation.startsWith('comment.') && operation !== 'comment.create') {
            invariant(
              find(state.comments, entityId!).authorId === member!.id,
              'You can edit or delete only your own comments.',
              'FORBIDDEN',
              403,
            );
          }
          return previous.responseJson as ApiResult<any>;
        }
        const context = new Mutation(state, member, actor, now, this.secret);
        const data = sanitizeResult(context.execute(operation, entityId, payload));
        const response = { data, ...('version' in (data || {}) ? { version: data.version } : {}) };
        state.receipts.push({
          id: randomUUID(),
          workspaceId: state.workspace.id,
          actorUserId: actor.userId,
          idempotencyKey: key,
          requestHash,
          responseJson: response,
          statusCode: 200,
          expiresAt: new Date(this.clock().getTime() + 86400000).toISOString(),
        });
        return response;
      },
      { operation, actorUserId: actor.userId },
    );
  }
}

class Mutation {
  constructor(
    private s: State,
    private member: Member | undefined,
    private actor: Actor,
    private now: string,
    private secret: string,
  ) {}
  private base(): RecordBase {
    return {
      id: randomUUID(),
      workspaceId: this.s.workspace.id,
      createdAt: this.now,
      updatedAt: this.now,
      version: 1,
    };
  }
  private activity(
    type: Activity['entityType'],
    id: string,
    event: string,
    changedFields: Activity['changedFields'] = {},
  ) {
    const activity: Activity = {
      id: randomUUID(),
      workspaceId: this.s.workspace.id,
      entityType: type,
      entityId: id,
      actorId: this.member!.id,
      eventType: event,
      changedFields,
      occurredAt: this.now,
    };
    this.s.activities.push(activity);
    return activity;
  }
  private notify(
    activity: Activity,
    task: Task | null,
    recipients: string[],
    kind: State['notifications'][number]['kind'],
  ) {
    for (const recipientId of new Set(recipients)) {
      if (
        recipientId === this.member!.id ||
        !this.s.members.some((m) => m.id === recipientId && m.active)
      )
        continue;
      const existing = this.s.notifications.find(
        (n) => n.activityId === activity.id && n.recipientId === recipientId,
      );
      if (existing) {
        if (kind === 'mention') existing.kind = kind;
        continue;
      }
      this.s.notifications.push({
        id: randomUUID(),
        workspaceId: this.s.workspace.id,
        recipientId,
        activityId: activity.id,
        taskId: task?.id ?? null,
        kind,
        readAt: null,
      });
    }
  }
  private touch<T extends { version: number; updatedAt: string }>(record: T) {
    record.version++;
    record.updatedAt = this.now;
  }
  private updateTask(task: Task, patch: Payload, event = 'task_updated', validate = true) {
    const before = structuredClone(task);
    const next = { ...task, ...patch } as Task;
    if (validate) validateTask(this.s, next);
    const delta = changes(before, next);
    if (!Object.keys(delta).length) return task;
    Object.assign(task, next);
    this.touch(task);
    const activity = this.activity('task', task.id, event, delta);
    if (delta.assigneeId && task.assigneeId)
      this.notify(activity, task, [task.assigneeId], 'assignment');
    if (delta.status || delta.dueDate)
      this.notify(activity, task, [task.assigneeId!, ...task.collaboratorIds], 'change');
    return task;
  }
  private clearBlocker(taskId: string) {
    for (const task of this.s.tasks.filter((t) => t.blockedById === taskId))
      this.updateTask(task, { blockedById: null }, 'blocker_removed', false);
  }
  execute(op: Operation, id: string | null, p: Payload): any {
    switch (op) {
      case 'project.create': {
        const project: Project = {
          ...this.base(),
          name: p.name,
          description: p.description ?? '',
          ownerId: p.ownerId ?? null,
          status: p.status ?? 'planned',
          startDate: p.startDate ?? null,
          targetDate: p.targetDate ?? null,
          archivedAt: null,
        };
        eligibleMember(this.s, project.ownerId);
        dates(project.startDate, project.targetDate);
        this.s.projects.push(project);
        this.activity('project', project.id, 'project_created');
        return project;
      }
      case 'project.patch': {
        const project = find(this.s.projects, id!);
        checkVersion(project, p.expected_version);
        invariant(
          !project.archivedAt,
          'Restore this project before making changes.',
          'PROJECT_ARCHIVED',
        );
        const { expected_version: _, ...patch } = p;
        if (isClosed(project.status))
          invariant(
            Object.keys(patch).length === 1 && ['active', 'planned'].includes(patch.status),
            'Reopen the project before editing its content.',
            'PROJECT_CLOSED',
          );
        const next = { ...project, ...patch };
        if ('ownerId' in patch) eligibleMember(this.s, patch.ownerId);
        if (isClosed(next.status))
          invariant(
            !this.s.tasks.some(
              (t) => t.projectId === project.id && !t.deletedAt && isOpen(t.status),
            ),
            'Complete or cancel all tasks before closing the project.',
            'OPEN_TASKS',
          );
        if (
          ['active', 'planned'].includes(next.status) &&
          next.ownerId &&
          !this.s.members.some((m) => m.id === next.ownerId && m.active)
        )
          next.ownerId = null;
        eligibleMember(this.s, next.ownerId);
        dates(next.startDate, next.targetDate);
        const delta = changes(project, next);
        Object.assign(project, next);
        this.touch(project);
        this.activity('project', project.id, 'project_updated', delta);
        return project;
      }
      case 'project.archive':
      case 'project.restore': {
        const project = find(this.s.projects, id!);
        checkVersion(project, p.expected_version);
        project.archivedAt = op === 'project.archive' ? this.now : null;
        if (
          !project.archivedAt &&
          ['active', 'planned'].includes(project.status) &&
          project.ownerId &&
          !this.s.members.some((m) => m.id === project.ownerId && m.active)
        )
          project.ownerId = null;
        this.touch(project);
        this.activity(
          'project',
          project.id,
          op === 'project.archive' ? 'project_archived' : 'project_restored',
        );
        return project;
      }
      case 'task.create': {
        projectEditable(this.s, p.projectId);
        if (p.parentId)
          invariant(
            isOpen(taskEditable(this.s, p.parentId).status),
            'Reopen the parent before adding a subtask.',
            'PARENT_CLOSED',
          );
        const task: Task = {
          ...this.base(),
          projectId: p.projectId,
          parentId: p.parentId ?? null,
          title: p.title,
          description: p.description ?? '',
          status: p.status ?? 'todo',
          assigneeId: p.assigneeId ?? null,
          collaboratorIds: p.collaboratorIds ?? [],
          startDate: p.startDate ?? null,
          dueDate: p.dueDate ?? null,
          blockedById: p.blockedById ?? null,
          milestoneId: p.milestoneId ?? null,
          deletedAt: null,
          deletionBatchId: null,
        };
        validateTask(this.s, task);
        this.s.tasks.push(task);
        const activity = this.activity('task', task.id, 'task_created');
        if (task.assigneeId) this.notify(activity, task, [task.assigneeId], 'assignment');
        return task;
      }
      case 'task.patch': {
        const task = taskEditable(this.s, id!);
        checkVersion(task, p.expected_version);
        const { expected_version: _, ...patch } = p;
        // Inactive historical attribution may remain on closed work until it reopens.
        if (
          patch.status &&
          isOpen(patch.status) &&
          !('assigneeId' in patch) &&
          task.assigneeId &&
          !this.s.members.some((m) => m.id === task.assigneeId && m.active)
        )
          patch.assigneeId = null;
        const validate = { ...task, ...patch };
        if (
          isClosed(validate.status) &&
          validate.assigneeId &&
          !this.s.members.some((m) => m.id === validate.assigneeId && m.active) &&
          !('assigneeId' in patch)
        )
          validate.assigneeId = null;
        validateTask(this.s, validate);
        return this.updateTask(task, patch, 'task_updated', false);
      }
      case 'task.trash': {
        const task = taskEditable(this.s, id!);
        checkVersion(task, p.expected_version);
        const batch = randomUUID();
        const records = this.s.tasks.filter(
          (t) => !t.deletedAt && (t.id === task.id || t.parentId === task.id),
        );
        for (const record of records)
          this.updateTask(
            record,
            { deletedAt: this.now, deletionBatchId: batch },
            'task_trashed',
            false,
          );
        for (const record of records) this.clearBlocker(record.id);
        return task;
      }
      case 'task.restore': {
        const task = find(this.s.tasks, id!);
        checkVersion(task, p.expected_version);
        projectEditable(this.s, task.projectId);
        invariant(task.deletedAt, 'This task is already available.', 'NOT_TRASHED');
        const records = this.s.tasks.filter(
          (t) =>
            t.deletionBatchId === task.deletionBatchId &&
            (t.id === task.id || t.parentId === task.id),
        );
        // Restore the root first, then validate the entire batch against the resulting state.
        for (const record of records) {
          record.deletedAt = null;
          record.deletionBatchId = null;
          if (
            isOpen(record.status) &&
            record.assigneeId &&
            !this.s.members.some((m) => m.id === record.assigneeId && m.active)
          )
            record.assigneeId = null;
          record.collaboratorIds = record.collaboratorIds.filter((mid) =>
            this.s.members.some((m) => m.id === mid && m.active),
          );
        }
        for (const record of records) {
          const candidate = { ...record };
          if (
            isClosed(candidate.status) &&
            candidate.assigneeId &&
            !this.s.members.some((m) => m.id === candidate.assigneeId && m.active)
          )
            candidate.assigneeId = null;
          validateTask(this.s, candidate);
          this.touch(record);
          this.activity('task', record.id, 'task_restored');
        }
        return task;
      }
      case 'milestone.create': {
        projectEditable(this.s, p.projectId);
        const milestone: Milestone = {
          ...this.base(),
          projectId: p.projectId,
          name: p.name,
          description: p.description ?? '',
          targetDate: p.targetDate ?? null,
          sortOrder:
            p.sortOrder ?? this.s.milestones.filter((m) => m.projectId === p.projectId).length,
        };
        this.s.milestones.push(milestone);
        this.activity('milestone', milestone.id, 'milestone_created');
        return milestone;
      }
      case 'milestone.patch':
      case 'milestone.delete': {
        const milestone = find(this.s.milestones, id!);
        projectEditable(this.s, milestone.projectId);
        checkVersion(milestone, p.expected_version);
        if (op === 'milestone.delete') {
          for (const task of this.s.tasks.filter((t) => t.milestoneId === milestone.id))
            this.updateTask(task, { milestoneId: null }, 'milestone_removed', false);
          this.s.milestones = this.s.milestones.filter((m) => m.id !== milestone.id);
          this.activity('milestone', milestone.id, 'milestone_deleted');
          return { id: milestone.id };
        }
        const { expected_version: _, ...patch } = p;
        const delta = changes(milestone, { ...milestone, ...patch });
        Object.assign(milestone, patch);
        this.touch(milestone);
        this.activity('milestone', milestone.id, 'milestone_updated', delta);
        return milestone;
      }
      case 'comment.create': {
        const task = taskEditable(this.s, id!);
        p.mentionIds.forEach((mid: string) => eligibleMember(this.s, mid));
        const comment: Comment = {
          ...this.base(),
          taskId: task.id,
          authorId: this.member!.id,
          body: p.body,
          mentionIds: [...new Set<string>(p.mentionIds)],
          editedAt: null,
          deletedAt: null,
        };
        this.s.comments.push(comment);
        const activity = this.activity('task', task.id, 'comment_added', {
          commentId: { from: null, to: comment.id },
        });
        this.notify(activity, task, [task.assigneeId!, ...task.collaboratorIds], 'comment');
        this.notify(activity, task, comment.mentionIds, 'mention');
        return comment;
      }
      case 'comment.patch':
      case 'comment.delete': {
        const comment = find(this.s.comments, id!);
        taskEditable(this.s, comment.taskId);
        invariant(
          comment.authorId === this.member!.id,
          'You can edit or delete only your own comments.',
          'FORBIDDEN',
          403,
        );
        checkVersion(comment, p.expected_version);
        invariant(!comment.deletedAt, 'This comment was deleted.', 'COMMENT_DELETED');
        if (op === 'comment.delete') {
          comment.body = '';
          comment.mentionIds = [];
          comment.deletedAt = this.now;
        } else {
          p.mentionIds.forEach((mid: string) => eligibleMember(this.s, mid));
          comment.body = p.body;
          comment.mentionIds = [...new Set<string>(p.mentionIds)];
          comment.editedAt = this.now;
        }
        this.touch(comment);
        this.activity(
          'task',
          comment.taskId,
          op === 'comment.delete' ? 'comment_deleted' : 'comment_edited',
          { commentId: { from: comment.id, to: comment.id } },
        );
        return comment;
      }
      case 'invite.create': {
        invariant(
          !this.s.members.some((m) => m.email.toLowerCase() === p.email && m.active),
          'This person is already an active member.',
          'ALREADY_MEMBER',
        );
        const invite: Invite = {
          ...this.base(),
          email: p.email,
          role: p.role,
          tokenHash: '',
          expiresAt: new Date(Date.parse(this.now) + 7 * 86400000).toISOString(),
          acceptedAt: null,
          revokedAt: null,
          invitedBy: this.member!.id,
        };
        invite.tokenHash = sha(inviteToken(invite.id, this.secret));
        this.s.invites.push(invite);
        this.activity('invite', invite.id, 'invite_created');
        return invite;
      }
      case 'invite.revoke': {
        const invite = find(this.s.invites, id!);
        checkVersion(invite, p.expected_version);
        invariant(!invite.acceptedAt, 'This invitation has already been accepted.', 'INVITE_USED');
        invite.revokedAt = this.now;
        this.touch(invite);
        this.activity('invite', invite.id, 'invite_revoked');
        return invite;
      }
      case 'invite.accept': {
        invariant(
          this.actor.verified,
          'Verify your sign-in email before accepting the invitation.',
          'EMAIL_UNVERIFIED',
          403,
        );
        const invite = this.s.invites.find((i) => i.id === p.token.split('.')[0]);
        invariant(
          invite &&
            timingSafeEqual(Buffer.from(invite.tokenHash, 'hex'), Buffer.from(sha(p.token), 'hex')),
          'This invitation is unavailable.',
          'INVALID_INVITE',
          403,
        );
        invariant(
          !invite.acceptedAt && !invite.revokedAt && invite.expiresAt > this.now,
          'This invitation has expired, was revoked, or has already been used.',
          'INVALID_INVITE',
          403,
        );
        invariant(
          invite.email === this.actor.email.toLowerCase(),
          'Sign in with the email address this invitation was sent to.',
          'WRONG_EMAIL',
          403,
        );
        let member = this.s.members.find((m) => m.userId === this.actor.userId);
        invariant(
          !member?.active,
          'You already belong to this workspace. An admin can change your role from Settings.',
          'ALREADY_MEMBER',
        );
        if (member) {
          member.active = true;
          member.role = invite.role;
          this.touch(member);
        } else {
          member = {
            ...this.base(),
            userId: this.actor.userId,
            email: this.actor.email.toLowerCase(),
            displayName: this.actor.displayName,
            role: invite.role,
            active: true,
          };
          this.s.members.push(member);
        }
        this.member = member;
        invite.acceptedAt = this.now;
        this.touch(invite);
        this.activity('invite', invite.id, 'invite_accepted');
        return member;
      }
      case 'member.patch': {
        const member = find(this.s.members, id!);
        checkVersion(member, p.expected_version);
        const next = { ...member, ...p };
        if (member.active && member.role === 'admin' && (!next.active || next.role !== 'admin'))
          invariant(
            this.s.members.some((m) => m.id !== member.id && m.active && m.role === 'admin'),
            'Keep at least one active workspace admin.',
            'LAST_ADMIN',
          );
        const { expected_version: _, ...patch } = p;
        const delta = changes(member, { ...member, ...patch });
        Object.assign(member, patch);
        this.touch(member);
        this.activity(
          'member',
          member.id,
          member.active ? 'member_updated' : 'member_deactivated',
          delta,
        );
        if (!member.active) {
          for (const project of this.s.projects.filter(
            (pr) => pr.ownerId === member.id && ['active', 'planned'].includes(pr.status),
          )) {
            project.ownerId = null;
            this.touch(project);
            this.activity('project', project.id, 'owner_removed');
          }
          for (const task of this.s.tasks) {
            const unassign = task.assigneeId === member.id && isOpen(task.status);
            if (!unassign && !task.collaboratorIds.includes(member.id)) continue;
            const update = {
              collaboratorIds: task.collaboratorIds.filter((mid) => mid !== member.id),
              ...(unassign ? { assigneeId: null } : {}),
            };
            this.updateTask(task, update, 'membership_cleanup', false);
            if (unassign) {
              const activity = this.s.activities.at(-1)!;
              const owner = find(this.s.projects, task.projectId).ownerId;
              this.notify(
                activity,
                task,
                owner
                  ? [owner]
                  : this.s.members.filter((m) => m.active && m.role === 'admin').map((m) => m.id),
                'needs_owner',
              );
            }
          }
        }
        return member;
      }
      case 'workspace.patch': {
        checkVersion(this.s.workspace, p.expected_version);
        const from = this.s.workspace.timeZone;
        this.s.workspace.timeZone = p.timeZone;
        this.touch(this.s.workspace);
        this.activity('workspace', this.s.workspace.id, 'time_zone_changed', {
          timeZone: { from, to: p.timeZone },
        });
        return this.s.workspace;
      }
      case 'notification.read': {
        for (const notification of this.s.notifications.filter(
          (n) => n.recipientId === this.member!.id && (p.all || p.ids?.includes(n.id)),
        ))
          notification.readAt ??= this.now;
        return { read: true };
      }
    }
  }
}
