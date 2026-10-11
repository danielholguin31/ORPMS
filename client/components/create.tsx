import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Member, Project, ProjectSummary, Milestone } from '../../shared/types';
import { useApp } from '../context';
import { useApiCollection } from '../queries';
import { Dialog, ErrorNote, QueryNotice } from './ui';

export function CreateTask({
  onClose,
  projectId,
  parentId,
  milestoneId,
}: {
  onClose: () => void;
  projectId?: string;
  parentId?: string;
  milestoneId?: string | null;
}) {
  const { data, change, online, busy } = useApp();
  const navigate = useNavigate();
  const initialProjects = data.projects.filter(
    (p) => !p.archivedAt && ['active', 'planned'].includes(p.status),
  );
  const projectQuery = useApiCollection<ProjectSummary>('/projects?view=active');
  const memberQuery = useApiCollection<Member>('/members?active=true');
  const projects = projectQuery.result || initialProjects;
  const members = memberQuery.result || [];
  const [project, setProject] = useState(
    projects.some((p) => p.id === projectId) ? projectId! : projects[0]?.id || '',
  );
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [assignee, setAssignee] = useState('');
  const [due, setDue] = useState(''),
    [start, setStart] = useState(''),
    [milestone, setMilestone] = useState(milestoneId || '');
  const [error, setError] = useState('');
  const milestoneQuery = useApiCollection<Milestone>(
    project ? `/milestones?project=${project}` : null,
  );
  const parent = data.tasks.find((t) => t.id === parentId);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const task = await change('/tasks', {
        title,
        description,
        projectId: project,
        parentId: parentId || null,
        assigneeId: assignee || null,
        dueDate: due || null,
        startDate: start || null,
        milestoneId: parentId ? null : milestone || null,
      });
      onClose();
      navigate(`/tasks/${task.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog title={parentId ? 'New subtask' : 'New task'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="dialog-body form-stack">
          <QueryNotice query={projectQuery} />
          {memberQuery.error && <QueryNotice query={memberQuery} />}
          {milestoneQuery.error && <QueryNotice query={milestoneQuery} />}
          {parent && (
            <p className="parent-context">
              Subtask of <strong>{parent.title}</strong>
            </p>
          )}
          <label>
            Title
            <input
              autoFocus
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              rows={3}
              maxLength={20000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="form-columns">
            <label>
              Project
              <select
                required
                disabled={!!parentId}
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  setMilestone('');
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assignee
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-columns">
            <label>
              Start date
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label>
              Due date
              <input
                type="date"
                value={due}
                min={start || undefined}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
          </div>
          {!parentId && (
            <label>
              Milestone
              <select value={milestone} onChange={(e) => setMilestone(e.target.value)}>
                <option value="">No milestone</option>
                {(milestoneQuery.result || []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!projects.length && <ErrorNote error="Create an active project before adding tasks." />}
          <ErrorNote error={error} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={
              !online ||
              busy ||
              !project ||
              !projectQuery.result ||
              !memberQuery.result ||
              (!!project && !milestoneQuery.result)
            }
          >
            {busy ? 'Creating…' : parentId ? 'Create subtask' : 'Create task'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const { data, change, online, busy } = useApp();
  const navigate = useNavigate();
  const memberQuery = useApiCollection<Member>('/members?active=true');
  const [name, setName] = useState(project?.name || ''),
    [description, setDescription] = useState(project?.description || '');
  const [owner, setOwner] = useState(project?.ownerId || ''),
    [start, setStart] = useState(project?.startDate || ''),
    [target, setTarget] = useState(project?.targetDate || '');
  const [status, setStatus] = useState(project?.status || 'planned');
  const [error, setError] = useState('');
  const [baseVersion, setBaseVersion] = useState(project?.version);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await change(
        project ? `/projects/${project.id}` : '/projects',
        {
          name,
          description,
          ownerId: owner || null,
          startDate: start || null,
          targetDate: target || null,
          status,
          ...(project ? { expected_version: baseVersion } : {}),
        },
        project ? 'PATCH' : 'POST',
      );
      onClose();
      navigate(`/projects/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const current = data.projects.find((p) => p.id === project?.id);
  return (
    <Dialog title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="dialog-body form-stack">
          <QueryNotice query={memberQuery} />
          <label>
            Name
            <input
              autoFocus
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Outcome
            <textarea
              rows={3}
              maxLength={20000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="form-columns">
            <label>
              Owner
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Unassigned</option>
                {(memberQuery.result || []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Project['status'])}
              >
                {['planned', 'active', 'done', 'canceled'].map((s) => (
                  <option key={s} value={s}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-columns">
            <label>
              Start date
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label>
              Target date
              <input
                type="date"
                min={start || undefined}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
          </div>
          <ErrorNote error={error} />
          {error && current && current.version !== baseVersion && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setBaseVersion(current.version);
                setError('Draft ready to reapply.');
              }}
            >
              Reapply draft
            </button>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!online || busy || !memberQuery.result}>
            {busy ? 'Saving…' : project ? 'Save project' : 'Create project'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function MilestoneForm({
  projectId,
  milestone,
  onClose,
}: {
  projectId: string;
  milestone?: Milestone;
  onClose: () => void;
}) {
  const { change, online, busy, data } = useApp();
  const [name, setName] = useState(milestone?.name || ''),
    [description, setDescription] = useState(milestone?.description || ''),
    [target, setTarget] = useState(milestone?.targetDate || ''),
    [error, setError] = useState('');
  const [baseVersion, setBaseVersion] = useState(milestone?.version);
  const current = data.milestones.find((m) => m.id === milestone?.id);
  return (
    <Dialog title={milestone ? 'Edit milestone' : 'New milestone'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await change(
              milestone ? `/milestones/${milestone.id}` : '/milestones',
              {
                name,
                description,
                targetDate: target || null,
                ...(milestone ? { expected_version: baseVersion } : { projectId }),
              },
              milestone ? 'PATCH' : 'POST',
            );
            onClose();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <div className="dialog-body form-stack">
          <label>
            Name
            <input
              autoFocus
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={20000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Target date
            <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <ErrorNote error={error} />
          {error && current && current.version !== baseVersion && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setBaseVersion(current.version);
                setError('Draft ready to reapply.');
              }}
            >
              Reapply draft
            </button>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!online || busy}>
            {milestone ? 'Save milestone' : 'Create milestone'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
