import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleCheck,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { Comment, Task, TaskDetail } from '../../shared/types';
import {
  childProgress,
  effectiveMilestone,
  isBlocked,
  isClosed,
  isOpen,
  TASK_LABELS,
} from '../../shared/rules';
import { useApp } from '../context';
import { ApiFault, get } from '../api';
import { useApiQuery } from '../queries';
import { Avatar, Confirm, ErrorNote, QueryNotice, SafeText, StatusIcon, taskCode } from './ui';
import { CreateTask } from './create';

type Draft = { title: string; description: string; version: number };
// Unsent text is kept in memory while navigating; it is never queued for a write.
const unsentDrafts = new Map<string, Draft>();
export const clearTaskDrafts = () => unsentDrafts.clear();
export function TaskPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, session, change, online, busy: saving, notify } = useApp();
  const navigate = useNavigate();
  const query = useApiQuery<TaskDetail>(`/tasks/${id}`);
  const busy = saving || query.loading;
  const task = query.result?.task;
  const draftKey = `${session.member.id}:${id}`;
  const [draft, setDraft] = useState<Draft | null>(unsentDrafts.get(draftKey) || null),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState<Task | null>(null);
  const [trash, setTrash] = useState(false),
    [subtask, setSubtask] = useState(false),
    [tab, setTab] = useState('comments');
  const [comment, setComment] = useState(''),
    [mentions, setMentions] = useState<string[]>([]),
    [commentError, setCommentError] = useState('');
  useEffect(() => {
    if (draft) unsentDrafts.set(draftKey, draft);
    else unsentDrafts.delete(draftKey);
  }, [draft, draftKey]);
  if (!task)
    return (
      <aside className="task-panel">
        <div className="panel-toolbar">
          <button className="icon-button" aria-label="Close task" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="panel-content">
          <QueryNotice query={query} />
          {!query.loading && <Link to="/trash">Open trash</Link>}
        </div>
      </aside>
    );
  const {
    project,
    parent,
    children,
    milestones,
    blockerCandidates: candidates,
    comments: taskComments,
    activities,
  } = query.result!;
  const childStats = childProgress(children);
  const readonly = !online || !!project.archivedAt || isClosed(project.status);
  const milestone = milestones.find(
    (m) => m.id === (parent ? parent.milestoneId : task.milestoneId),
  );
  const stamp = (date: string) =>
    new Intl.DateTimeFormat('en', {
      timeZone: data.workspace.timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(date));
  const property = async (patch: Partial<Task>) => {
    setError('');
    try {
      await change(`/tasks/${task.id}`, { expected_version: task.version, ...patch }, 'PATCH');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const beginEdit = () => {
    setDraft({ title: task.title, description: task.description, version: task.version });
    setError('');
    setConflict(null);
  };
  async function saveText(e?: FormEvent, reapply = false) {
    e?.preventDefault();
    if (!draft) return;
    setError('');
    try {
      await change(
        `/tasks/${id}`,
        {
          expected_version: reapply && conflict ? conflict.version : draft.version,
          title: draft.title,
          description: draft.description,
        },
        'PATCH',
      );
      setDraft(null);
      unsentDrafts.delete(draftKey);
      setConflict(null);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiFault && e.detail.code === 'VERSION_CONFLICT')
        setConflict(e.detail.current as Task);
    }
  }
  async function postComment(e: FormEvent) {
    e.preventDefault();
    setCommentError('');
    try {
      await change(`/tasks/${id}/comments`, { body: comment, mentionIds: mentions });
      setComment('');
      setMentions([]);
    } catch (e) {
      setCommentError((e as Error).message);
    }
  }
  const activityLabel = (event: (typeof activities)[number]) => {
    const delta = event.changedFields;
    if (delta.status)
      return `changed status to ${TASK_LABELS[delta.status.to as keyof typeof TASK_LABELS] || String(delta.status.to)}`;
    if (delta.assigneeId)
      return delta.assigneeId.to
        ? `assigned this task to ${data.members.find((m) => m.id === delta.assigneeId.to)?.displayName || 'a member'}`
        : 'removed the assignee';
    if (delta.dueDate)
      return delta.dueDate.to
        ? `changed the due date to ${delta.dueDate.to}`
        : 'removed the due date';
    const labels: Record<string, string> = {
      task_created: 'created this task',
      task_updated: 'updated this task',
      task_trashed: 'moved this task to trash',
      task_restored: 'restored this task',
      blocker_removed: 'cleared the blocker',
      milestone_removed: 'removed the milestone',
      comment_added: 'added a comment',
      comment_edited: 'edited a comment',
      comment_deleted: 'deleted a comment',
      membership_cleanup: 'updated task ownership after a membership change',
    };
    return labels[event.eventType] || event.eventType.replaceAll('_', ' ');
  };
  return (
    <aside className="task-panel" aria-label="Task detail">
      <div className="panel-toolbar">
        <div>
          <Link to={`/projects/${project.id}`} onClick={onClose}>
            {project.name}
          </Link>
          <ChevronRight size={12} />
          <span>{taskCode(task.id)}</span>
        </div>
        <div>
          <button
            className="icon-button"
            title="Copy task link"
            aria-label="Copy task link"
            disabled={!online}
            onClick={async () => {
              try {
                const { url } = await get<{ url: string }>(`/tasks/${id}/link`);
                await navigator.clipboard.writeText(url);
                notify('Link copied');
              } catch (error) {
                notify((error as Error).message);
              }
            }}
          >
            <Link2 size={15} />
          </button>
          <details className="action-menu">
            <summary className="icon-button" aria-label="Task actions">
              <MoreHorizontal size={18} />
            </summary>
            <div className="menu-items">
              <button disabled={readonly} onClick={() => setTrash(true)}>
                <Trash2 size={14} />
                Move to trash
              </button>
            </div>
          </details>
          <button className="icon-button close-task" aria-label="Close task" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="panel-content">
        <QueryNotice query={query} />
        {parent && (
          <Link className="parent-task-link" to={`/tasks/${parent.id}`}>
            <ArrowLeft size={13} />
            {parent.title}
          </Link>
        )}
        {draft ? (
          <form className="text-editor" onSubmit={(e) => saveText(e)}>
            <label className="sr-only" htmlFor="edit-title">
              Task title
            </label>
            <input
              id="edit-title"
              autoFocus
              required
              maxLength={160}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <label className="sr-only" htmlFor="edit-description">
              Description
            </label>
            <textarea
              id="edit-description"
              rows={6}
              maxLength={20000}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Description"
            />
            <div className="editor-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  setDraft(null);
                  setError('');
                  setConflict(null);
                }}
              >
                Cancel
              </button>
              <button className="button primary" disabled={readonly || busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="task-detail-title">
              <h1>{task.title}</h1>
              <button
                className="icon-button"
                aria-label="Edit task text"
                disabled={readonly}
                onClick={beginEdit}
              >
                <Pencil size={15} />
              </button>
            </div>
            <div className="task-description">
              {task.description ? (
                <SafeText text={task.description} />
              ) : (
                <button className="text-button muted" disabled={readonly} onClick={beginEdit}>
                  Add description
                </button>
              )}
            </div>
          </>
        )}
        <ErrorNote error={error} />
        {conflict && draft && (
          <div className="conflict-actions">
            <button
              className="button"
              onClick={() => {
                setDraft({
                  title: conflict.title,
                  description: conflict.description,
                  version: conflict.version,
                });
                setConflict(null);
                setError('');
              }}
            >
              Reload current version
            </button>
            <button
              className="button primary"
              disabled={readonly || busy}
              onClick={() => saveText(undefined, true)}
            >
              Reapply my draft
            </button>
          </div>
        )}
        {(project.archivedAt || isClosed(project.status)) && (
          <p className="read-only-note">
            {project.archivedAt ? 'Archived project' : 'Closed project'} · Read only
          </p>
        )}
        <div className="task-properties">
          <label>
            <span>Status</span>
            <div className="property-control">
              <StatusIcon status={task.status} />
              <select
                aria-label="Task status"
                value={task.status}
                disabled={readonly || busy}
                onChange={(e) => property({ status: e.target.value as Task['status'] })}
              >
                {Object.entries(TASK_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label>
            <span>Assignee</span>
            <div className="property-control">
              <Avatar member={data.members.find((m) => m.id === task.assigneeId)} small />
              <select
                aria-label="Task assignee"
                value={task.assigneeId || ''}
                disabled={readonly || busy}
                onChange={(e) => property({ assigneeId: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {data.members
                  .filter((m) => m.active || m.id === task.assigneeId)
                  .map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.active}>
                      {m.displayName}
                      {!m.active ? ' (inactive)' : ''}
                    </option>
                  ))}
              </select>
            </div>
          </label>
          {!task.assigneeId && isOpen(task.status) && (
            <div className="property-helper">Needs owner</div>
          )}
          <div className="property-row">
            <span>Collaborators</span>
            <details className="collaborator-picker">
              <summary>
                {task.collaboratorIds.length ? (
                  <span className="avatar-stack">
                    {task.collaboratorIds.map((id) => (
                      <Avatar key={id} member={data.members.find((m) => m.id === id)} small />
                    ))}
                    <span>{task.collaboratorIds.length}</span>
                  </span>
                ) : (
                  'Add'
                )}
              </summary>
              <div className="collaborator-options">
                {data.members
                  .filter((m) => m.active)
                  .map((m) => (
                    <label key={m.id}>
                      <input
                        type="checkbox"
                        checked={task.collaboratorIds.includes(m.id)}
                        disabled={readonly || busy}
                        onChange={(e) =>
                          property({
                            collaboratorIds: e.target.checked
                              ? [...task.collaboratorIds, m.id]
                              : task.collaboratorIds.filter((id) => id !== m.id),
                          })
                        }
                      />
                      {m.displayName}
                    </label>
                  ))}
              </div>
            </details>
          </div>
          <label>
            <span>Milestone</span>
            {task.parentId ? (
              <span className="inherited-value">
                {milestone?.name || 'No milestone'}
                <small>From parent</small>
              </span>
            ) : (
              <select
                aria-label="Task milestone"
                value={task.milestoneId || ''}
                disabled={readonly || busy}
                onChange={(e) => property({ milestoneId: e.target.value || null })}
              >
                <option value="">No milestone</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label>
            <span>Start date</span>
            <input
              aria-label="Task start date"
              type="date"
              value={task.startDate || ''}
              disabled={readonly || busy}
              onChange={(e) => property({ startDate: e.target.value || null })}
            />
          </label>
          <label>
            <span>Due date</span>
            <input
              aria-label="Task due date"
              type="date"
              min={task.startDate || undefined}
              value={task.dueDate || ''}
              disabled={readonly || busy}
              onChange={(e) => property({ dueDate: e.target.value || null })}
            />
          </label>
          <label>
            <span>Blocked by</span>
            <select
              aria-label="Task blocker"
              value={task.blockedById || ''}
              disabled={readonly || busy}
              onChange={(e) => property({ blockedById: e.target.value || null })}
            >
              <option value="">No blocker</option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          {isBlocked(task, data.tasks) && (
            <div className="property-helper blocked-helper">
              Blocked · {data.tasks.find((t) => t.id === task.blockedById)?.title}
            </div>
          )}
        </div>
        {!task.parentId && (
          <section className="subtasks-section">
            <div className="section-heading">
              <h2>Subtasks</h2>
              <span>
                {childStats.done}/{childStats.total}
              </span>
              <button
                className="icon-button"
                disabled={readonly || busy || !isOpen(task.status)}
                aria-label="Add subtask"
                title={isClosed(task.status) ? 'Reopen this task to add a subtask' : 'Add subtask'}
                onClick={() => setSubtask(true)}
              >
                <Plus size={16} />
              </button>
            </div>
            {children.map((child) => (
              <button
                className="subtask-row"
                key={child.id}
                onClick={() => navigate(`/tasks/${child.id}`)}
              >
                <StatusIcon status={child.status} />
                <span>{child.title}</span>
                <Avatar member={data.members.find((m) => m.id === child.assigneeId)} small />
              </button>
            ))}
            {!children.length && <p className="quiet-empty">No subtasks</p>}
          </section>
        )}
        <section className="comments-section">
          <div className="tabs">
            <button
              aria-pressed={tab === 'comments'}
              className={tab === 'comments' ? 'active' : ''}
              onClick={() => setTab('comments')}
            >
              Comments <span className="tab-count">{taskComments.length}</span>
            </button>
            <button
              aria-pressed={tab === 'activity'}
              className={tab === 'activity' ? 'active' : ''}
              onClick={() => setTab('activity')}
            >
              Activity
            </button>
          </div>
          {tab === 'comments' ? (
            <>
              <div className="comments-list">
                {taskComments.map((c) => (
                  <CommentRow key={c.id} comment={c} readonly={readonly} stamp={stamp} />
                ))}
                {!taskComments.length && <p className="quiet-empty">No comments</p>}
              </div>
              <form className="comment-form" onSubmit={postComment}>
                <label htmlFor="new-comment" className="sr-only">
                  Write a comment
                </label>
                <textarea
                  id="new-comment"
                  rows={3}
                  maxLength={20000}
                  disabled={!!project.archivedAt || isClosed(project.status)}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Comment"
                />
                <div className="comment-compose-actions">
                  <select
                    aria-label="Mention a teammate"
                    disabled={readonly || busy}
                    value=""
                    onChange={(e) => {
                      const person = data.members.find((m) => m.id === e.target.value);
                      if (person) {
                        setMentions([...new Set([...mentions, person.id])]);
                        setComment(
                          comment +
                            (comment && !comment.endsWith(' ') ? ' ' : '') +
                            `@${person.displayName} `,
                        );
                      }
                    }}
                  >
                    <option value="">@ Mention</option>
                    {data.members
                      .filter((m) => m.active)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName}
                        </option>
                      ))}
                  </select>
                  <button className="button primary" disabled={readonly || busy || !comment.trim()}>
                    {busy ? 'Sending…' : 'Comment'}
                  </button>
                </div>
                <ErrorNote error={commentError} />
              </form>
            </>
          ) : (
            <div className="activity-list">
              {activities.map((event) => (
                <div className="activity-row" key={event.id}>
                  <span className="activity-dot" />
                  <div>
                    <p>
                      <strong>
                        {data.members.find((m) => m.id === event.actorId)?.displayName ||
                          'Team member'}
                      </strong>{' '}
                      {activityLabel(event)}
                    </p>
                    <small>{stamp(event.occurredAt)}</small>
                  </div>
                </div>
              ))}
              {!activities.length && <p className="quiet-empty">No activity</p>}
            </div>
          )}
        </section>
      </div>
      {trash && (
        <Confirm
          title="Move task to trash?"
          label="Move to trash"
          destructive
          onClose={() => setTrash(false)}
          onConfirm={async () => {
            await change(`/tasks/${id}/trash`, {
              expected_version: task.version,
              scope: 'task_and_subtasks',
            });
            onClose();
          }}
        >
          Move “{task.title}”{children.length ? ' and its subtasks' : ''} to trash and clear blocker
          links?
        </Confirm>
      )}
      {subtask && (
        <CreateTask
          projectId={task.projectId}
          parentId={task.id}
          onClose={() => setSubtask(false)}
        />
      )}
    </aside>
  );
}
function CommentRow({
  comment,
  readonly,
  stamp,
}: {
  comment: Comment;
  readonly: boolean;
  stamp: (time: string) => string;
}) {
  const { data, session, change, busy, online } = useApp();
  const [editing, setEditing] = useState(false),
    [body, setBody] = useState(comment.body),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState(false),
    [baseVersion, setBaseVersion] = useState(comment.version);
  const author = data.members.find((m) => m.id === comment.authorId);
  return (
    <div className="comment-row">
      <Avatar member={author} small />
      <div className="comment-content">
        <div className="comment-heading">
          <strong>{author?.displayName}</strong>
          <small>
            {stamp(comment.createdAt)}
            {comment.editedAt ? ' · Edited' : ''}
          </small>
          {session.member.id === comment.authorId && !comment.deletedAt && !readonly && (
            <details className="action-menu">
              <summary className="icon-button" aria-label="Comment actions">
                <MoreHorizontal size={14} />
              </summary>
              <div className="menu-items">
                <button
                  onClick={() => {
                    setEditing(true);
                    setBody(comment.body);
                    setBaseVersion(comment.version);
                  }}
                >
                  Edit comment
                </button>
                <button onClick={() => setDeleting(true)}>Delete comment</button>
              </div>
            </details>
          )}
        </div>
        {comment.deletedAt ? (
          <p className="deleted-comment">Comment deleted</p>
        ) : editing ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await change(
                  `/comments/${comment.id}`,
                  {
                    expected_version: baseVersion,
                    body,
                    mentionIds: comment.mentionIds.filter((id) =>
                      data.members.some((m) => m.id === id && m.active),
                    ),
                  },
                  'PATCH',
                );
                setEditing(false);
                setError('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <textarea
              autoFocus
              required
              maxLength={20000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <ErrorNote error={error} />
            {error && comment.version !== baseVersion && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setBaseVersion(comment.version);
                  setError('Draft preserved. Save to reapply.');
                }}
              >
                Reapply my draft
              </button>
            )}
            <div className="editor-actions">
              <button className="button" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="button primary" disabled={busy || readonly}>
                Save comment
              </button>
            </div>
          </form>
        ) : (
          <p>
            <SafeText text={comment.body} />
          </p>
        )}
      </div>
      {deleting && (
        <Confirm
          title="Delete comment?"
          label="Delete comment"
          destructive
          onClose={() => setDeleting(false)}
          onConfirm={() =>
            change(`/comments/${comment.id}`, { expected_version: comment.version }, 'DELETE')
          }
        >
          A deleted-comment marker will remain in the conversation.
        </Confirm>
      )}
    </div>
  );
}
