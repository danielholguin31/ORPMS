import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  Download,
  Mail,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  Users,
} from 'lucide-react';
import { dateLabel, isClosed } from '../shared/rules';
import { useApp } from './context';
import { exportWorkspace, get } from './api';
import { Avatar, Confirm, Empty, ErrorNote, Status, taskCode } from './components/ui';
import type { Member } from '../shared/types';

export function Notifications() {
  const { data, change, online, busy, notify } = useApp();
  const [tab, setTab] = useState('unread');
  const navigate = useNavigate();
  const unread = data.notifications.filter((n) => !n.readAt).length;
  const notifications = data.notifications
    .filter((n) => tab === 'all' || !n.readAt)
    .sort((a, b) =>
      (data.activities.find((e) => e.id === b.activityId)?.occurredAt || '').localeCompare(
        data.activities.find((e) => e.id === a.activityId)?.occurredAt || '',
      ),
    );
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE</div>
          <h1>Notifications</h1>
          <p className="page-subtitle">Updates that need your attention.</p>
        </div>
        <button
          className="button"
          disabled={!online || busy || !unread}
          onClick={async () => {
            try {
              await change('/notifications/read', { all: true });
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        >
          <CheckCheck size={15} />
          Mark all read
        </button>
      </div>
      <div className="view-toolbar">
        <div className="tabs">
          <button
            className={tab === 'unread' ? 'active' : ''}
            aria-pressed={tab === 'unread'}
            onClick={() => setTab('unread')}
          >
            Unread<span className="tab-count">{unread}</span>
          </button>
          <button
            className={tab === 'all' ? 'active' : ''}
            aria-pressed={tab === 'all'}
            onClick={() => setTab('all')}
          >
            All updates
          </button>
        </div>
      </div>
      {notifications.length ? (
        <div className="notification-list">
          {notifications.map((n) => {
            const event = data.activities.find((a) => a.id === n.activityId);
            const actor = data.members.find((m) => m.id === event?.actorId);
            const task = data.tasks.find((t) => t.id === n.taskId);
            const labels = {
              assignment: 'assigned a task to you',
              comment: 'commented on',
              mention: 'mentioned you in',
              change: 'updated',
              needs_owner: 'flagged a task that needs an owner',
            };
            return (
              <div className={`notification-row ${n.readAt ? 'read' : ''}`} key={n.id}>
                <Avatar member={actor} />
                <button
                  className="notification-body"
                  onClick={async () => {
                    if (online && !n.readAt) {
                      try {
                        await change('/notifications/read', { ids: [n.id] });
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }
                    if (task) navigate(task.deletedAt ? '/trash' : `/tasks/${task.id}`);
                  }}
                >
                  <span>
                    <strong>{actor?.displayName || 'Team member'}</strong> {labels[n.kind]}
                  </span>
                  <strong>{task?.title || 'Workspace update'}</strong>
                  <small>
                    {event &&
                      new Intl.DateTimeFormat('en', {
                        timeZone: data.workspace.timeZone,
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      }).format(new Date(event.occurredAt))}
                  </small>
                </button>
                {!n.readAt && <span className="unread-dot" aria-label="Unread" />}
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon={<Bell size={25} />} title="You’re up to date">
          Assignments, comments, mentions, and changes to your work will appear here.
        </Empty>
      )}
    </section>
  );
}
export function Trash() {
  const { data, change, online, busy, notify } = useApp();
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const tasks = data.tasks.filter(
    (t) =>
      t.deletedAt &&
      !(
        t.parentId &&
        data.tasks.some(
          (p) => p.id === t.parentId && p.deletedAt && p.deletionBatchId === t.deletionBatchId,
        )
      ),
  );
  const restore = data.tasks.find((t) => t.id === restoreId);
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE</div>
          <h1>Trash</h1>
          <p className="page-subtitle">Work stays recoverable until you restore it.</p>
        </div>
      </div>
      {tasks.length ? (
        <div className="trash-list">
          {tasks.map((task) => {
            const project = data.projects.find((p) => p.id === task.projectId)!;
            const disabled = !online || busy || !!project.archivedAt || isClosed(project.status);
            return (
              <div className="trash-row" key={task.id}>
                <Trash2 size={15} />
                <div>
                  <strong>{task.title}</strong>
                  <small>
                    {project.name} · {taskCode(task.id)}
                    {data.tasks.some(
                      (t) => t.parentId === task.id && t.deletionBatchId === task.deletionBatchId,
                    )
                      ? ' · Includes subtasks'
                      : ''}
                  </small>
                  {disabled && (project.archivedAt || isClosed(project.status)) && (
                    <Link to={`/projects/${project.id}`}>Reopen or restore the project first</Link>
                  )}
                </div>
                <button
                  className="button"
                  disabled={disabled}
                  onClick={() => setRestoreId(task.id)}
                >
                  <RotateCcw size={14} />
                  Restore
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon={<Trash2 size={24} />} title="Nothing in the trash">
          Trashed tasks and their subtasks will appear here. Work is never permanently deleted.
        </Empty>
      )}
      {restore && (
        <Confirm
          title="Restore task?"
          label="Restore task"
          onClose={() => setRestoreId(null)}
          onConfirm={() =>
            change(`/tasks/${restore.id}/restore`, { expected_version: restore.version })
          }
        >
          “{restore.title}” and subtasks from the same deletion batch will return to their project.
        </Confirm>
      )}
    </section>
  );
}
export function Settings() {
  const { data, session, change, online, busy, notify, switchAccount } = useApp();
  const [tab, setTab] = useState('members'),
    [email, setEmail] = useState(''),
    [role, setRole] = useState('member'),
    [error, setError] = useState(''),
    [timeZone, setTimeZone] = useState(data.workspace.timeZone),
    [deactivate, setDeactivate] = useState<Member | null>(null);
  const isAdmin = session.member.role === 'admin';
  const invites = data.invites.filter((i) => !i.acceptedAt && !i.revokedAt);
  const timeZones = [
    ...new Set([
      data.workspace.timeZone,
      'UTC',
      ...(typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : [
            'America/Bogota',
            'America/New_York',
            'America/Los_Angeles',
            'Europe/London',
            'Europe/Berlin',
            'Asia/Singapore',
          ]),
    ]),
  ];
  const [zoneDirty, setZoneDirty] = useState(false),
    [zoneVersion, setZoneVersion] = useState(data.workspace.version);
  useEffect(() => {
    if (!zoneDirty) {
      setTimeZone(data.workspace.timeZone);
      setZoneVersion(data.workspace.version);
    }
  }, [data.workspace.timeZone, data.workspace.version, zoneDirty]);
  const run = async (fn: () => Promise<any>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copyInvite = async (id: string) => {
    await run(async () => {
      const result = await get<{ url: string }>(`/invites/${id}/link`);
      await navigator.clipboard.writeText(result.url);
      notify('Invitation link copied. It is bound to the recipient’s email.');
    });
  };
  return (
    <section className="page settings-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">OPENRANGE</div>
          <h1>Settings</h1>
          <p className="page-subtitle">People, access, and workspace preferences.</p>
        </div>
      </div>
      <div className="view-toolbar">
        <div className="tabs">
          {[
            ['members', 'Members'],
            ['invitations', 'Invitations'],
            ['workspace', 'Workspace'],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => {
                setTab(id);
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ErrorNote error={error} />
      {tab === 'members' && (
        <div className="settings-section">
          <div className="section-heading">
            <h2>Team members</h2>
            <span>{data.members.filter((m) => m.active).length} active members</span>
          </div>
          <p className="settings-description">
            Every active member can see and edit all projects and tasks.
          </p>
          <div className="member-list">
            {data.members.map((person) => (
              <div className={`member-row ${!person.active ? 'inactive' : ''}`} key={person.id}>
                <Avatar member={person} />
                <div>
                  <strong>
                    {person.displayName}
                    {person.id === session.member.id ? <small> You</small> : ''}
                  </strong>
                  <small>{person.email}</small>
                </div>
                {isAdmin && person.active ? (
                  <select
                    aria-label={`Role for ${person.displayName}`}
                    value={person.role}
                    disabled={!online || busy}
                    onChange={(e) =>
                      run(() =>
                        change(
                          `/members/${person.id}`,
                          { expected_version: person.version, role: e.target.value },
                          'PATCH',
                        ),
                      )
                    }
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  <span className="member-role">{person.active ? person.role : 'Inactive'}</span>
                )}
                {isAdmin && (
                  <button
                    className="text-button"
                    disabled={!online || busy}
                    onClick={() =>
                      person.active
                        ? setDeactivate(person)
                        : run(() =>
                            change(
                              `/members/${person.id}`,
                              { expected_version: person.version, active: true },
                              'PATCH',
                            ),
                          )
                    }
                  >
                    {person.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
              </div>
            ))}
          </div>
          {session.mode === 'demo' && (
            <div className="demo-settings">
              <strong>Development accounts</strong>
              <p>
                These people and work records are fictional. Switch accounts to try the member and
                admin workflows.
              </p>
              <label>
                View as
                <select
                  aria-label="Demo account"
                  value={session.member.userId}
                  onChange={(e) => switchAccount(e.target.value).catch((e) => setError(e.message))}
                >
                  {session.demoAccounts?.map((a) => (
                    <option key={a.userId} value={a.userId}>
                      {a.displayName} · {a.role}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}
      {tab === 'invitations' && (
        <div className="settings-section">
          <div className="section-heading">
            <h2>Invite a teammate</h2>
          </div>
          {isAdmin ? (
            <>
              <p className="settings-description">
                Invitations are bound to one verified email and expire after seven days.
              </p>
              <form
                className="invite-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const invite = await change('/invites', { email, role });
                    setEmail('');
                    await copyInvite(invite.id);
                  });
                }}
              >
                <label>
                  <span className="sr-only">Invitation email</span>
                  <input
                    type="email"
                    required
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Invitation role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="button primary" disabled={!online || busy}>
                  <Plus size={14} />
                  Create invite
                </button>
              </form>
              <p className="delivery-note">
                <Mail size={14} />
                Email delivery is not configured. Copy the link and share it with its recipient.
              </p>
              {invites.map((invite) => (
                <div className="invite-row" key={invite.id}>
                  <div>
                    <strong>{invite.email}</strong>
                    <small>
                      {invite.role} ·{' '}
                      {invite.expiresAt > new Date().toISOString()
                        ? `Expires ${dateLabel(invite.expiresAt.slice(0, 10))}`
                        : 'Expired'}
                    </small>
                  </div>
                  <button
                    className="button"
                    disabled={!online || invite.expiresAt <= new Date().toISOString()}
                    onClick={() => copyInvite(invite.id)}
                  >
                    Copy link
                  </button>
                  <button
                    className="text-button"
                    disabled={!online || busy}
                    onClick={() =>
                      run(() =>
                        change(`/invites/${invite.id}/revoke`, {
                          expected_version: invite.version,
                        }),
                      )
                    }
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </>
          ) : (
            <Empty icon={<Users size={22} />} title="An admin can invite teammates">
              Contact a workspace admin to add someone to Openrange.
            </Empty>
          )}
        </div>
      )}
      {tab === 'workspace' && (
        <div className="settings-section">
          <h2>Workspace preferences</h2>
          <div className="setting-block">
            <div>
              <strong>Workspace time zone</strong>
              <p>Today and overdue use the same calendar date for everyone.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await change('/workspace', { expected_version: zoneVersion, timeZone }, 'PATCH');
                  setZoneDirty(false);
                });
              }}
            >
              <select
                aria-label="Workspace time zone"
                value={timeZone}
                disabled={!isAdmin}
                onChange={(e) => {
                  if (!zoneDirty) setZoneVersion(data.workspace.version);
                  setZoneDirty(true);
                  setTimeZone(e.target.value);
                }}
              >
                {timeZones.map((t) => (
                  <option value={t} key={t}>
                    {t}
                  </option>
                ))}
              </select>
              {isAdmin && (
                <button
                  className="button"
                  disabled={!online || busy || timeZone === data.workspace.timeZone}
                >
                  Save
                </button>
              )}
            </form>
          </div>
          {zoneDirty && zoneVersion !== data.workspace.version && (
            <div className="zone-conflict">
              <p className="settings-description">
                The workspace time zone changed to {data.workspace.timeZone}. Your selection is
                preserved.
              </p>
              <div className="conflict-actions">
                <button
                  className="button"
                  onClick={() => {
                    setZoneDirty(false);
                    setError('');
                  }}
                >
                  Reload current zone
                </button>
                <button
                  className="button"
                  disabled={!isAdmin || !online || busy}
                  onClick={() =>
                    run(async () => {
                      await change(
                        '/workspace',
                        { expected_version: data.workspace.version, timeZone },
                        'PATCH',
                      );
                      setZoneDirty(false);
                    })
                  }
                >
                  Reapply my selection
                </button>
              </div>
            </div>
          )}
          <div className="setting-block">
            <div>
              <strong>Workspace export</strong>
              <p>Download project, task, comment, and activity records as JSON.</p>
            </div>
            <button
              className="button"
              disabled={!online || !isAdmin}
              onClick={() => run(exportWorkspace)}
            >
              <Download size={15} />
              Export workspace
            </button>
          </div>
          <p className="settings-description">
            {!isAdmin && 'Only workspace admins can change the time zone or export records.'}
          </p>
        </div>
      )}
      {deactivate && (
        <Confirm
          title="Deactivate member?"
          label="Deactivate"
          destructive
          onClose={() => setDeactivate(null)}
          onConfirm={() =>
            change(
              `/members/${deactivate.id}`,
              { expected_version: deactivate.version, active: false },
              'PATCH',
            )
          }
        >
          “{deactivate.displayName}” will lose access. Their open work will become unassigned, and
          completed attribution and comments will remain.
        </Confirm>
      )}
    </section>
  );
}
