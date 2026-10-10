import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import type { Milestone, Project, Task, TaskStatus } from '../shared/types';
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
import { Avatar, Confirm, Empty, SafeText, Status, StatusIcon, taskCode } from './components/ui';
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
  const [tab, setTab] = useState('assigned');
  const today = workspaceToday(data.workspace.timeZone);
  const tasks = data.tasks.filter(
    (t) =>
      !t.deletedAt &&
      !data.projects.find((p) => p.id === t.projectId)?.archivedAt &&
      (tab === 'collaborating'
        ? t.collaboratorIds.includes(session.member.id)
        : t.assigneeId === session.member.id) &&
      (tab === 'completed' ? t.status === 'done' : isOpen(t.status)),
  );
  const groups = tab === 'completed' ? ['Completed'] : ['Overdue', 'Today', 'Upcoming', 'No date'];
  const overdue = tasks.filter((t) => dueGroup(t, today) === 'Overdue').length;
  return (
    <section className="page my-tasks-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORK</div>
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
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="toolbar-note">
          {dateLabel(today)} · {data.workspace.timeZone.split('/').at(-1)?.replaceAll('_', ' ')}
        </span>
      </div>
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
      {!tasks.length && (
        <Empty
          icon={<CircleCheck size={25} />}
          title={
            tab === 'completed'
              ? 'No completed tasks yet'
              : tab === 'collaborating'
                ? 'Nothing you’re collaborating on'
                : 'You’re all caught up'
          }
        >
          Tasks assigned to you will appear here. You can also create a task or explore your
          projects.
        </Empty>
      )}
    </section>
  );
}
export function Projects() {
  const { data, online } = useApp();
  const [filter, setFilter] = useState('active'),
    [create, setCreate] = useState(false);
  const projects = data.projects.filter((p) =>
    filter === 'archived'
      ? !!p.archivedAt
      : !p.archivedAt && (filter === 'completed' ? isClosed(p.status) : !isClosed(p.status)),
  );
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE</div>
          <h1>Projects</h1>
          <p className="page-subtitle">A shared view of where things stand.</p>
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
              onClick={() => setFilter(id)}
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
            const stats = progress(data.tasks.filter((t) => t.projectId === project.id));
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
                  <span>{stats.total ? `${stats.percent}%` : 'No active tasks'}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={<FolderKanban size={26} />}
          title={filter === 'active' ? 'Start with a project' : `No ${filter} projects`}
        >
          {filter === 'active'
            ? 'Give the work a name, a clear outcome, and an owner.'
            : 'Projects will appear here when their status changes.'}
        </Empty>
      )}
      {create && <ProjectForm onClose={() => setCreate(false)} />}
    </section>
  );
}

export function ProjectPage({ projectId }: { projectId: string }) {
  const { data, session, change, online, busy, notify } = useApp();
  const [view, setView] = useState('list'),
    [owner, setOwner] = useState('all'),
    [status, setStatus] = useState('open'),
    [milestoneFilter, setMilestoneFilter] = useState('all');
  const [create, setCreate] = useState<{ milestoneId?: string | null } | null>(null),
    [editProject, setEditProject] = useState(false);
  const [milestoneDialog, setMilestoneDialog] = useState<Milestone | 'new' | null>(null),
    [deleteMilestone, setDeleteMilestone] = useState<Milestone | null>(null),
    [archive, setArchive] = useState(false);
  const project = data.projects.find((p) => p.id === projectId);
  if (!project)
    return (
      <section className="page">
        <Empty title="Project unavailable">
          This project may no longer be available. Return to Projects to find your work.
        </Empty>
        <Link className="button" to="/projects">
          Back to projects
        </Link>
      </section>
    );
  const editable = !project.archivedAt && !isClosed(project.status);
  const readonly = !online || !editable;
  const allTasks = data.tasks.filter(
    (t) => t.projectId === project.id && !t.deletedAt && !t.parentId,
  );
  const stats = progress(allTasks);
  const ownerMember = data.members.find((m) => m.id === project.ownerId);
  const milestones = data.milestones
    .filter((m) => m.projectId === project.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const tasks = allTasks.filter(
    (t) =>
      (owner === 'all' || (owner === 'unassigned' ? !t.assigneeId : t.assigneeId === owner)) &&
      (status === 'all' || (status === 'open' ? t.status !== 'canceled' : t.status === status)) &&
      (milestoneFilter === 'all' ||
        (milestoneFilter === 'none' ? !t.milestoneId : t.milestoneId === milestoneFilter)),
  );
  const run = async (fn: () => Promise<any>) => {
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <section className="page project-page">
      <div className="breadcrumb">
        <Link to="/projects">Projects</Link>
        <span>/</span>
        <span>{project.name}</span>
      </div>
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
          <p className="project-brief">
            <SafeText
              text={project.description || 'Add a short outcome to give this project a direction.'}
            />
          </p>
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
          {stats.total ? `${stats.done} of ${stats.total} done` : 'No active tasks'}
          <span className="mini-progress">
            <i style={{ width: `${stats.percent}%` }} />
          </span>
        </span>
      </div>
      {!editable && (
        <div className="read-only-note">
          <Archive size={15} />
          {project.archivedAt
            ? 'This project is archived. Restore it to make changes.'
            : 'This project is closed. Reopen it to make changes.'}
        </div>
      )}
      <div className="milestone-strip">
        <div className="milestone-strip-label">Milestones</div>
        <div className="milestone-items">
          {milestones.map((milestone) => {
            const p = progress(allTasks.filter((t) => t.milestoneId === milestone.id));
            return (
              <div
                className={`milestone-item ${milestoneFilter === milestone.id ? 'selected' : ''}`}
                key={milestone.id}
              >
                <button
                  className="milestone-main"
                  onClick={() =>
                    setMilestoneFilter(milestoneFilter === milestone.id ? 'all' : milestone.id)
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
                    {p.total ? `${p.done} / ${p.total} done` : 'No active tasks'}
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
        {!milestones.length && <span className="muted">No milestones yet</span>}
      </div>
      <div className="project-task-toolbar">
        <div className="segmented" aria-label="Project view">
          <button
            className={view === 'list' ? 'active' : ''}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <LayoutList size={14} />
            List
          </button>
          <button
            className={`board-toggle ${view === 'board' ? 'active' : ''}`}
            aria-pressed={view === 'board'}
            onClick={() => setView('board')}
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
            onChange={(e) => setOwner(e.target.value)}
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
            onChange={(e) => setStatus(e.target.value)}
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
            onChange={(e) => setMilestoneFilter(e.target.value)}
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
                setOwner('all');
                setStatus('open');
                setMilestoneFilter('all');
              }}
            >
              Clear
            </button>
          )}
        </div>
        <span className="toolbar-note">{tasks.length} tasks</span>
      </div>
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
      {!tasks.length && (
        <Empty
          icon={<LayoutList size={23} />}
          title={allTasks.length ? 'No tasks match these filters' : 'A clear place to start'}
        >
          {allTasks.length
            ? 'Adjust the filters to find the work you’re looking for.'
            : 'Add the first task, then break it into subtasks when it needs more detail.'}
        </Empty>
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
          Tasks in “{deleteMilestone.name}” will remain in the project without a milestone.
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
            ? 'The project will return to its previous status.'
            : 'The project stays readable. Its tasks will be hidden from active views until it is restored.'}
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
