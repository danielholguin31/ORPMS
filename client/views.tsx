import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Archive,
  Check,
  ChevronDown,
  CircleCheck,
  FolderKanban,
  GripVertical,
  LayoutList,
  Columns3,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { Milestone, ProjectDetail, ProjectSummary, Task, TaskStatus } from '../shared/types';
import {
  dateLabel,
  dueGroup,
  effectiveMilestone,
  isBlocked,
  isClosed,
  isOpen,
  progress,
  TASK_LABELS,
  workspaceToday,
} from '../shared/rules';
import { useApp } from './context';
import { useApiCollection, useApiQuery } from './queries';
import {
  Avatar,
  Confirm,
  Empty,
  QueryNotice,
  SafeText,
  Status,
  StatusIcon,
  taskCode,
} from './components/ui';
import { CreateTask, MilestoneForm, ProjectForm } from './components/create';

export function TaskRow({ task, showProject = false }: { task: Task; showProject?: boolean }) {
  const { data } = useApp();
  const navigate = useNavigate();
  const owner = data.members.find((m) => m.id === task.assigneeId);
  const project = data.projects.find((p) => p.id === task.projectId)!;
  const parent = data.tasks.find((t) => t.id === task.parentId);
  const children = data.tasks.filter(
    (t) => t.parentId === task.id && !t.deletedAt && t.status !== 'canceled',
  );
  const today = workspaceToday(data.workspace.timeZone);
  return (
    <div className="task-row">
      <button className="task-title-cell" onClick={() => navigate(`/tasks/${task.id}`)}>
        <StatusIcon status={task.status} />
        <div className="task-name">
          <span>{task.title}</span>
          {parent && <small className="parent-label">↳ {parent.title}</small>}
          <small className="mobile-task-meta">
            {TASK_LABELS[task.status]}
            {showProject ? ` · ${project.name}` : ''}
          </small>
        </div>
        {isBlocked(task, data.tasks) && <span className="blocked-tag">Blocked</span>}
        {!!children.length && (
          <span className="subtask-count" title="Completed subtasks">
            {children.filter((t) => t.status === 'done').length}/{children.length}
          </span>
        )}
      </button>
      {showProject && (
        <Link className="row-project" to={`/projects/${project.id}`}>
          <span className="project-dot" />
          {project.name}
        </Link>
      )}
      <div className="row-assignee">
        {owner ? (
          <Avatar member={owner} small />
        ) : isOpen(task.status) ? (
          <span className="needs-owner">Needs owner</span>
        ) : (
          <span className="muted">—</span>
        )}
      </div>
      <span
        className={`row-date ${task.dueDate && task.dueDate < today && isOpen(task.status) ? 'overdue' : ''}`}
      >
        {task.dueDate ? dateLabel(task.dueDate, today) : '—'}
      </span>
      <span className="row-status">
        <Status status={task.status} />
      </span>
    </div>
  );
}
export function MyTasks({ onNewTask }: { onNewTask: () => void }) {
  const { data, session, online } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = ['assigned', 'collaborating', 'completed'].includes(params.get('view') || '')
    ? params.get('view')!
    : 'assigned';
  const query = useApiCollection<Task>(`/tasks?view=${tab}`);
  const tasks = query.result || [];
  const today = workspaceToday(data.workspace.timeZone);
  const groups = tab === 'completed' ? ['Completed'] : ['Overdue', 'Today', 'Upcoming', 'No date'];
  const overdue = tasks.filter((t) => dueGroup(t, today) === 'Overdue').length;
  return (
    <section className="page my-tasks-page">
      <div className="page-heading">
        <div>
          <h1>My Tasks</h1>
          <p className="page-subtitle">
            {tab === 'completed'
              ? `${tasks.length} completed tasks`
              : `${tasks.length} open tasks${overdue ? ` · ${overdue} overdue` : ''}`}
          </p>
        </div>
        <button className="button primary" disabled={!online} onClick={onNewTask}>
          <Plus size={15} />
          New task<span className="key-hint">N</span>
        </button>
      </div>
      <div className="view-toolbar">
        <div className="tabs" aria-label="Task views">
          {[
            ['assigned', 'Assigned to me'],
            ['collaborating', 'Collaborating'],
            ['completed', 'Completed'],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => setParams(id === 'assigned' ? {} : { view: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="toolbar-note">
          {dateLabel(today)} · {data.workspace.timeZone.split('/').at(-1)?.replaceAll('_', ' ')}
        </span>
      </div>
      <QueryNotice query={query} />
      {!!tasks.length && (
        <div className="table-heading my-table-heading">
          <span>Task</span>
          <span>Project</span>
          <span>Assignee</span>
          <span>Due date</span>
          <span>Status</span>
        </div>
      )}
      {groups.map((group) => {
        const rows = tasks
          .filter((t) => group === 'Completed' || dueGroup(t, today) === group)
          .sort(
            (a, b) =>
              (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
              a.title.localeCompare(b.title),
          );
        return rows.length ? (
          <div className={`task-group ${group.toLowerCase().replace(' ', '-')}`} key={group}>
            <div className="group-heading">
              <h2>{group}</h2>
              <span className="count">{rows.length}</span>
            </div>
            {rows.map((t) => (
              <TaskRow key={t.id} task={t} showProject />
            ))}
          </div>
        ) : null;
      })}
      {query.result && !tasks.length && (
        <Empty
          icon={<CircleCheck size={25} />}
          title={tab === 'completed' ? 'No completed tasks' : 'No tasks'}
        />
      )}
    </section>
  );
}
export function Projects() {
  const { data, online } = useApp();
  const [params, setParams] = useSearchParams();
  const filter = ['active', 'completed', 'archived'].includes(params.get('view') || '')
    ? params.get('view')!
    : 'active';
  const [create, setCreate] = useState(false);
  const query = useApiCollection<ProjectSummary>(`/projects?view=${filter}`);
  const projects = query.result || [];

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <h1>Projects</h1>
        </div>
        <button className="button primary" disabled={!online} onClick={() => setCreate(true)}>
          <Plus size={15} />
          New project
        </button>
      </div>
      <div className="view-toolbar">
        <div className="tabs">
          {['active', 'completed', 'archived'].map((id) => (
            <button
              key={id}
              className={filter === id ? 'active' : ''}
              aria-pressed={filter === id}
              onClick={() => setParams(id === 'active' ? {} : { view: id })}
            >
              {id[0].toUpperCase() + id.slice(1)}
              <span className="tab-count">
                {
                  data.projects.filter((p) =>
                    id === 'archived'
                      ? !!p.archivedAt
                      : !p.archivedAt &&
                        (id === 'completed' ? isClosed(p.status) : !isClosed(p.status)),
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
      </div>
      <QueryNotice query={query} />
      {projects.length ? (
        <div className="project-table">
          <div className="table-heading">
            <span>Project</span>
            <span>Owner</span>
            <span>Status</span>
            <span>Target date</span>
            <span>Progress</span>
          </div>
          {projects.map((project) => {
            const owner = data.members.find((m) => m.id === project.ownerId);
            const stats = project.progress;
            return (
              <Link to={`/projects/${project.id}`} className="project-row" key={project.id}>
                <div className="project-name-cell">
                  <span className="project-symbol">
                    <FolderKanban size={17} />
                  </span>
                  <div>
                    <strong>{project.name}</strong>
                    <small>{project.description}</small>
                  </div>
                </div>
                <div className="project-owner">
                  <Avatar member={owner} small />
                  <span>{owner?.displayName.split(' ')[0] || 'Unassigned'}</span>
                </div>
                <span className={`project-status ${project.status}`}>
                  <span />
                  {project.status[0].toUpperCase() + project.status.slice(1)}
                </span>
                <span>{dateLabel(project.targetDate)}</span>
                <div className="progress-cell">
                  <div className="progress-track">
                    <i style={{ width: `${stats.percent}%` }} />
                  </div>
                  <span>{stats.total ? `${stats.percent}%` : '—'}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : query.result ? (
        <Empty icon={<FolderKanban size={26} />} title={`No ${filter} projects`} />
      ) : null}
      {create && <ProjectForm onClose={() => setCreate(false)} />}
    </section>
  );
}

export function ProjectPage({ projectId }: { projectId: string }) {
  const { data, session, change, online, busy, notify } = useApp();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'board' ? 'board' : 'list';
  const owner = params.get('owner') || 'all';
  const status = params.get('status') || 'open';
  const milestoneFilter = params.get('milestone') || 'all';
  const setFilter = (key: string, value: string, fallback: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === fallback) next.delete(key);
      else next.set(key, value);
      return next;
    });
  const projectQuery = useApiQuery<ProjectDetail>(`/projects/${projectId}`);
  const taskParams = new URLSearchParams({
    project: projectId,
    top_level: 'true',
    archived: 'true',
    status: status === 'open' ? 'not_canceled' : status,
  });
  if (owner !== 'all') taskParams.set('assignee', owner);
  if (milestoneFilter !== 'all') taskParams.set('milestone', milestoneFilter);
  const taskQuery = useApiCollection<Task>(`/tasks?${taskParams}`);
  const tasks = taskQuery.result || [];
  const [create, setCreate] = useState<{ milestoneId?: string | null } | null>(null),
    [editProject, setEditProject] = useState(false);
  const [milestoneDialog, setMilestoneDialog] = useState<Milestone | 'new' | null>(null),
    [deleteMilestone, setDeleteMilestone] = useState<Milestone | null>(null),
    [archive, setArchive] = useState(false);
  const project = projectQuery.result;
  if (!project)
    return (
      <section className="page">
        <QueryNotice query={projectQuery} />
        <Link className="button" to="/projects">
          Back to projects
        </Link>
      </section>
    );
  const editable = !project.archivedAt && !isClosed(project.status);
  const readonly = !online || !editable || taskQuery.loading;
  const stats = project.progress;
  const ownerMember = data.members.find((m) => m.id === project.ownerId);
  const milestones = project.milestones;
  const run = async (fn: () => Promise<any>) => {
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <section className="page project-page">
      <div className="page-heading">
        <div>
          <div className="project-title-line">
            <span className="project-symbol large">
              <FolderKanban size={21} />
            </span>
            <h1>{project.name}</h1>
            <span className={`project-status ${project.status}`}>
              <span />
              {project.status[0].toUpperCase() + project.status.slice(1)}
            </span>
            {project.archivedAt && <span className="pill">Archived</span>}
          </div>
          {project.description && (
            <p className="project-brief">
              <SafeText text={project.description} />
            </p>
          )}
        </div>
        <div className="heading-actions">
          {editable && (
            <button className="button primary" disabled={!online} onClick={() => setCreate({})}>
              <Plus size={15} />
              New task
            </button>
          )}
          <details className="action-menu">
            <summary className="icon-button" aria-label="Project actions">
              <MoreHorizontal size={20} />
            </summary>
            <div className="menu-items">
              {editable && <button onClick={() => setEditProject(true)}>Edit project</button>}
              {isClosed(project.status) && !project.archivedAt && (
                <button
                  disabled={!online || busy}
                  onClick={() =>
                    run(() =>
                      change(
                        `/projects/${project.id}`,
                        { expected_version: project.version, status: 'active' },
                        'PATCH',
                      ),
                    )
                  }
                >
                  Reopen project
                </button>
              )}
              {session.member.role === 'admin' && (
                <button disabled={!online} onClick={() => setArchive(true)}>
                  {project.archivedAt ? 'Restore project' : 'Archive project'}
                </button>
              )}
            </div>
          </details>
        </div>
      </div>
      <div className="project-meta">
        <span>
          <Avatar member={ownerMember} small />
          {ownerMember?.displayName || 'Needs owner'}
        </span>
        <span>
          Target <strong>{dateLabel(project.targetDate)}</strong>
        </span>
        <span>
          {stats.total ? `${stats.done}/${stats.total} done` : 'No tasks'}
          <span className="mini-progress">
            <i style={{ width: `${stats.percent}%` }} />
          </span>
        </span>
      </div>
      {!editable && (
        <div className="read-only-note">
          <Archive size={15} />
          {project.archivedAt ? 'Archived · Read only' : 'Closed · Read only'}
        </div>
      )}
      <div className="milestone-strip">
        <div className="milestone-strip-label">Milestones</div>
        <div className="milestone-items">
          {milestones.map((milestone) => {
            const p = milestone.progress;
            return (
              <div
                className={`milestone-item ${milestoneFilter === milestone.id ? 'selected' : ''}`}
                key={milestone.id}
              >
                <button
                  className="milestone-main"
                  onClick={() =>
                    setFilter(
                      'milestone',
                      milestoneFilter === milestone.id ? 'all' : milestone.id,
                      'all',
                    )
                  }
                >
                  <div>
                    <span className="checkpoint-icon">
                      {p.total && p.done === p.total ? <Check size={12} /> : <span />}
                    </span>
                    <strong>{milestone.name}</strong>
                  </div>
                  <small>
                    {dateLabel(milestone.targetDate)}
                    <span>·</span>
                    {p.total ? `${p.done}/${p.total} done` : 'No tasks'}
                  </small>
                  <span className="milestone-progress">
                    <i style={{ width: `${p.percent}%` }} />
                  </span>
                </button>
                {editable && (
                  <details className="action-menu milestone-menu">
                    <summary className="icon-button" aria-label={`Manage ${milestone.name}`}>
                      <MoreHorizontal size={15} />
                    </summary>
                    <div className="menu-items">
                      <button onClick={() => setMilestoneDialog(milestone)}>Edit milestone</button>
                      <button onClick={() => setDeleteMilestone(milestone)}>
                        Delete milestone
                      </button>
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
        {editable && (
          <button
            className="icon-button"
            disabled={!online}
            onClick={() => setMilestoneDialog('new')}
            aria-label="Add milestone"
          >
            <Plus size={16} />
          </button>
        )}
        {!milestones.length && <span className="muted">No milestones</span>}
      </div>
      <div className="project-task-toolbar">
        <div className="segmented" aria-label="Project view">
          <button
            className={view === 'list' ? 'active' : ''}
            aria-pressed={view === 'list'}
            onClick={() => setFilter('view', 'list', 'list')}
          >
            <LayoutList size={14} />
            List
          </button>
          <button
            className={`board-toggle ${view === 'board' ? 'active' : ''}`}
            aria-pressed={view === 'board'}
            onClick={() => setFilter('view', 'board', 'list')}
          >
            <Columns3 size={14} />
            Board
          </button>
        </div>
        <div className="task-filters">
          <SlidersHorizontal size={14} aria-hidden="true" />
          <select
            aria-label="Filter by owner"
            value={owner}
            onChange={(e) => setFilter('owner', e.target.value, 'all')}
          >
            <option value="all">Owner</option>
            <option value="unassigned">Unassigned</option>
            {data.members.map((m) => (
              <option value={m.id} key={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setFilter('status', e.target.value, 'open')}
          >
            <option value="open">Status</option>
            <option value="all">All statuses</option>
            {Object.entries(TASK_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by milestone"
            value={milestoneFilter}
            onChange={(e) => setFilter('milestone', e.target.value, 'all')}
          >
            <option value="all">Milestone</option>
            <option value="none">No milestone</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {(owner !== 'all' || status !== 'open' || milestoneFilter !== 'all') && (
            <button
              className="text-button"
              onClick={() => {
                setParams(view === 'board' ? { view: 'board' } : {});
              }}
            >
              Clear
            </button>
          )}
        </div>
        <span className="toolbar-note">{tasks.length} tasks</span>
      </div>
      <QueryNotice query={taskQuery} />
      <div className={view === 'board' ? 'desktop-list-hidden' : ''}>
        <div className="table-heading project-task-heading">
          <span>Task</span>
          <span>Assignee</span>
          <span>Due date</span>
          <span>Status</span>
        </div>
        {[
          ...milestones.map((m) => ({ id: m.id, name: m.name })),
          { id: 'none', name: 'No milestone' },
        ].map((group) => {
          const rows = tasks.filter((t) => (t.milestoneId || 'none') === group.id);
          if (!rows.length) return null;
          const p = progress(rows);
          return (
            <div className="task-group" key={group.id}>
              <div className="group-heading">
                <ChevronDown size={13} />
                <h2>{group.name}</h2>
                <span className="count">{rows.length}</span>
                <span className="group-progress">
                  {p.done} / {p.total} done
                </span>
                {editable && (
                  <button
                    className="icon-button"
                    disabled={!online}
                    aria-label={`Add task to ${group.name}`}
                    onClick={() =>
                      setCreate({ milestoneId: group.id === 'none' ? null : group.id })
                    }
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
              {rows.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          );
        })}
      </div>
      {view === 'board' && (
        <div className="task-board">
          {(
            [
              'todo',
              'in_progress',
              'done',
              ...(status === 'canceled' || status === 'all' ? ['canceled'] : []),
            ] as TaskStatus[]
          ).map((column) => (
            <div
              className="board-column"
              key={column}
              onDragOver={(e) => {
                if (!readonly) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (readonly || busy) return;
                const task = data.tasks.find((t) => t.id === e.dataTransfer.getData('text/plain'));
                if (task && task.projectId === project.id && task.status !== column)
                  run(() =>
                    change(
                      `/tasks/${task.id}`,
                      { expected_version: task.version, status: column },
                      'PATCH',
                    ),
                  );
              }}
            >
              <div className="board-heading">
                <StatusIcon status={column} />
                <h2>{TASK_LABELS[column]}</h2>
                <span className="count">{tasks.filter((t) => t.status === column).length}</span>
              </div>
              {tasks
                .filter((t) => t.status === column)
                .map((task) => (
                  <BoardCard task={task} readonly={readonly} key={task.id} />
                ))}
            </div>
          ))}
        </div>
      )}
      {taskQuery.result && !tasks.length && (
        <Empty
          icon={<LayoutList size={23} />}
          title={stats.total ? 'No matching tasks' : 'No tasks'}
        />
      )}
      {create && (
        <CreateTask
          projectId={project.id}
          milestoneId={create.milestoneId}
          onClose={() => setCreate(null)}
        />
      )}
      {editProject && <ProjectForm project={project} onClose={() => setEditProject(false)} />}
      {milestoneDialog && (
        <MilestoneForm
          projectId={project.id}
          milestone={milestoneDialog === 'new' ? undefined : milestoneDialog}
          onClose={() => setMilestoneDialog(null)}
        />
      )}
      {deleteMilestone && (
        <Confirm
          title="Delete milestone?"
          label="Delete milestone"
          destructive
          onClose={() => setDeleteMilestone(null)}
          onConfirm={() =>
            change(
              `/milestones/${deleteMilestone.id}`,
              { expected_version: deleteMilestone.version },
              'DELETE',
            )
          }
        >
          Tasks in “{deleteMilestone.name}” will become ungrouped.
        </Confirm>
      )}
      {archive && (
        <Confirm
          title={project.archivedAt ? 'Restore project?' : 'Archive project?'}
          label={project.archivedAt ? 'Restore project' : 'Archive project'}
          onClose={() => setArchive(false)}
          onConfirm={() =>
            change(`/projects/${project.id}/${project.archivedAt ? 'restore' : 'archive'}`, {
              expected_version: project.version,
            })
          }
        >
          {project.archivedAt
            ? 'Return this project to its previous status.'
            : 'Hide this project and its tasks from active views. You can restore it later.'}
        </Confirm>
      )}
    </section>
  );
}
function BoardCard({ task, readonly }: { task: Task; readonly: boolean }) {
  const { data, change, busy, notify } = useApp();
  const navigate = useNavigate();
  const owner = data.members.find((m) => m.id === task.assigneeId);
  return (
    <article
      className="board-card"
      draggable={!readonly && !busy}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
      }}
    >
      <div className="board-card-main">
        <button className="board-card-title" onClick={() => navigate(`/tasks/${task.id}`)}>
          {task.title}
        </button>
        <span
          className="board-drag-handle"
          draggable={!readonly && !busy}
          title="Drag to change status"
          aria-hidden="true"
        >
          <GripVertical size={14} />
        </span>
      </div>
      {isBlocked(task, data.tasks) && <span className="blocked-tag">Blocked</span>}
      <div className="board-card-footer">
        <small>{taskCode(task.id)}</small>
        <span>{task.dueDate && dateLabel(task.dueDate)}</span>
        {owner ? <Avatar member={owner} small /> : <span className="needs-owner">Needs owner</span>}
      </div>
      <select
        className="board-status-select"
        aria-label={`Change status of ${task.title}`}
        value={task.status}
        disabled={readonly || busy}
        onChange={async (e) => {
          try {
            await change(
              `/tasks/${task.id}`,
              { expected_version: task.version, status: e.target.value },
              'PATCH',
            );
          } catch (e) {
            notify((e as Error).message);
          }
        }}
      >
        {Object.entries(TASK_LABELS).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </article>
  );
}
