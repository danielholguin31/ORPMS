import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  FolderKanban,
  Inbox,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings2,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import type { PublicConfig, Session, Snapshot } from '../shared/types';
import { AppContext } from './context';
import { ApiFault, authProvider, configureAuth, get, mutate, request, setCsrf } from './api';
import { Avatar, Dialog, Empty, ErrorNote } from './components/ui';
import { CreateTask } from './components/create';
import { SearchDialog } from './components/search';
import { TaskPanel } from './components/task-panel';
import { MyTasks, ProjectPage, Projects } from './views';
import { Notifications, Settings, Trash } from './workspace-views';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [config, setConfig] = useState<PublicConfig | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [data, setData] = useState<Snapshot | null>(null),
    [loadError, setLoadError] = useState<ApiFault | Error | null>(null);
  const [online, setOnline] = useState(navigator.onLine),
    [refreshError, setRefreshError] = useState(''),
    [busy, setBusy] = useState(false),
    [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed' | ''>('');
  const [searchOpen, setSearchOpen] = useState(false),
    [newTask, setNewTask] = useState(false),
    [shortcuts, setShortcuts] = useState(false),
    [drawer, setDrawer] = useState(false),
    [toast, setToast] = useState('');
  const [mobile, setMobile] = useState(matchMedia('(max-width: 760px)').matches);
  const sequence = useRef(0),
    inFlight = useRef(false),
    toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(''), 6000);
  }, []);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const nextSession = await get<Session>('/me');
      setCsrf(nextSession.csrfToken);
      const next = await get<Snapshot>('/workspace');
      if (sequence.current !== current) return;
      setSession(nextSession);
      setData(next);
      setLoadError(null);
      setRefreshError('');
    } catch (error) {
      if (sequence.current === current) {
        if (error instanceof ApiFault && [401, 403].includes(error.status)) {
          setData(null);
          setSession(null);
          setLoadError(error);
        } else setRefreshError('Couldn’t refresh. Showing the last saved view.');
      }
      throw error;
    }
  }, []);
  const switchAccount = useCallback(
    async (userId: string) => {
      await request('/dev/session', { method: 'POST', body: JSON.stringify({ userId }) });
      await refresh();
    },
    [refresh],
  );
  const boot = useCallback(async () => {
    setLoadError(null);
    try {
      const cfg = await get<PublicConfig>('/config');
      await configureAuth(cfg);
      setConfig(cfg);
      try {
        await refresh();
      } catch (error) {
        if (cfg.mode === 'demo' && error instanceof ApiFault && error.status === 401) {
          const accounts = await get<{ userId: string }[]>('/dev/accounts');
          if (accounts[0]) await switchAccount(accounts[0].userId);
        } else throw error;
      }
    } catch (error) {
      setLoadError(error as Error);
    }
  }, [refresh, switchAccount]);
  useEffect(() => {
    void boot();
    return () => {
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    };
  }, [boot]);
  useEffect(() => {
    if (config?.mode !== 'supabase') return;
    const subscription = authProvider()?.auth.onAuthStateChange((_event, authSession) => {
      if (authSession) setTimeout(() => void refresh().catch(() => {}), 0);
    }).data.subscription;
    return () => subscription?.unsubscribe();
  }, [config, refresh]);
  useEffect(() => {
    const reconnect = () => {
      setOnline(true);
      if (session) void refresh().catch(() => {});
    };
    const offline = () => setOnline(false);
    const focus = () => {
      if (session && navigator.onLine && document.visibilityState === 'visible')
        void refresh().catch(() => {});
    };
    const interval = setInterval(focus, 5000);
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', offline);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', offline);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [session?.member.id, refresh]);
  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);
  useEffect(() => {
    const media = matchMedia('(max-width: 760px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (drawer) document.querySelector<HTMLElement>('.drawer-close')?.focus();
  }, [drawer]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      const element = e.target as HTMLElement;
      const typing = element.matches('input,textarea,select') || element.isContentEditable;
      if (drawer && e.key === 'Escape') {
        setDrawer(false);
        setTimeout(
          () => document.querySelector<HTMLElement>('[aria-label="Open navigation"]')?.focus(),
          0,
        );
        return;
      }
      if (drawer && e.key === 'Tab') {
        const targets = [
          ...document.querySelectorAll<HTMLElement>('.sidebar a,.sidebar button,.sidebar summary'),
        ].filter((el) => el.getClientRects().length && !el.hasAttribute('disabled'));
        if (e.shiftKey && document.activeElement === targets[0]) {
          e.preventDefault();
          targets.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === targets.at(-1)) {
          e.preventDefault();
          targets[0]?.focus();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((open) => !open);
      } else if (
        !typing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'n' &&
        !document.querySelector('dialog[open]')
      ) {
        e.preventDefault();
        if (online) setNewTask(true);
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [online, drawer]);
  async function change<T = any>(path: string, body: unknown, method = 'POST'): Promise<T> {
    if (!online)
      throw new Error('You’re offline. Reconnect to save changes. Your draft is preserved.');
    if (inFlight.current) throw new Error('Another change is being saved. Try again shortly.');
    inFlight.current = true;
    setBusy(true);
    setSaveState('saving');
    try {
      const result = await mutate<T>(path, body, method);
      setSaveState('saved');
      await refresh().catch(() => {});
      return result;
    } catch (error) {
      setSaveState('failed');
      if (error instanceof ApiFault && error.status === 409) await refresh().catch(() => {});
      throw error;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function signOut() {
    try {
      if (config?.mode === 'supabase') await authProvider()?.auth.signOut();
      else await request('/session/logout', { method: 'POST' });
    } finally {
      setData(null);
      setSession(null);
      setCsrf('');
      setLoadError(new ApiFault(401, { code: 'SIGNED_OUT', message: 'Sign in to continue.' }));
    }
  }
  const invitation = location.pathname.match(/^\/invite\/(.+)$/)?.[1];
  if (invitation && config)
    return (
      <InviteLanding
        config={config}
        token={invitation}
        onAccepted={async () => {
          await refresh();
          navigate('/my-tasks');
        }}
      />
    );
  if (
    config &&
    loadError instanceof ApiFault &&
    [401, 403].includes(loadError.status) &&
    (!session || !data)
  )
    return (
      <SignIn
        config={config}
        error={loadError.status === 403 ? loadError.message : ''}
        onSignedIn={refresh}
      />
    );
  if (!session || !data)
    return (
      <div className="loading-page">
        <div className="loading-brand">
          <img src="/openrange-logo.png" alt="" />
          <span>Openrange</span>
        </div>
        {loadError ? (
          <>
            <h1>Couldn’t open the workspace</h1>
            <p>{loadError.message}</p>
            <button className="button" onClick={() => void boot()}>
              Try again
            </button>
          </>
        ) : (
          <>
            <div className="loading-line" />
            <p>Opening your workspace…</p>
          </>
        )}
      </div>
    );
  const taskId = location.pathname.match(/^\/tasks\/([^/]+)$/)?.[1];
  const projectId =
    location.pathname.match(/^\/projects\/([^/]+)$/)?.[1] ||
    (taskId ? data.tasks.find((t) => t.id === taskId)?.projectId : undefined);
  const path = location.pathname;
  const label = projectId
    ? data.projects.find((p) => p.id === projectId)?.name || 'Project'
    : path === '/projects'
      ? 'Projects'
      : path === '/notifications'
        ? 'Notifications'
        : path === '/settings'
          ? 'Settings'
          : path === '/trash'
            ? 'Trash'
            : 'My Tasks';
  const unread = data.notifications.filter((n) => !n.readAt).length;
  return (
    <AppContext.Provider
      value={{ data, session, online, busy, saveState, refresh, change, notify, switchAccount }}
    >
      <div className={`app-shell ${taskId ? 'with-panel' : ''}`}>
        {drawer && (
          <button
            className="drawer-backdrop"
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
          />
        )}
        <aside
          className={`sidebar ${drawer ? 'open' : ''}`}
          inert={mobile && !drawer}
          aria-hidden={mobile && !drawer}
          role={mobile && drawer ? 'dialog' : undefined}
          aria-modal={mobile && drawer ? true : undefined}
          aria-label="Workspace navigation"
        >
          <button
            className="icon-button drawer-close"
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
          >
            <X size={18} />
          </button>
          <Link to="/my-tasks" className="brand">
            <img src="/openrange-logo.png" alt="Openrange mark" />
            <span>Openrange</span>
            <ChevronDown size={13} />
          </Link>
          <button className="sidebar-search" onClick={() => setSearchOpen(true)}>
            <Search size={15} />
            <span>Search anything</span>
            <kbd>⌘ K</kbd>
          </button>
          <nav className="main-nav">
            <NavLink to="/my-tasks" className={path === '/' ? 'active' : ''}>
              <Inbox size={17} />
              My Tasks
            </NavLink>
            <NavLink to="/projects" end>
              <FolderKanban size={17} />
              Projects
            </NavLink>
            <NavLink to="/notifications">
              <Bell size={17} />
              Notifications{!!unread && <span className="nav-count">{unread}</span>}
            </NavLink>
          </nav>
          <div className="sidebar-project-heading">
            <span>PROJECTS</span>
            <Link to="/projects" className="icon-button" aria-label="Manage projects">
              <Plus size={14} />
            </Link>
          </div>
          <nav className="project-nav">
            {data.projects
              .filter((p) => !p.archivedAt && !isClosedProject(p.status))
              .map((p) => (
                <NavLink
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className={projectId === p.id ? 'active' : ''}
                >
                  <span className="project-dot" />
                  {p.name}
                </NavLink>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <nav>
              <NavLink to="/trash">
                <Trash2 size={16} />
                Trash
              </NavLink>
              <NavLink to="/settings">
                <Settings2 size={16} />
                Settings
              </NavLink>
              <button onClick={() => setShortcuts(true)}>
                <CircleHelp size={16} />
                Keyboard shortcuts
              </button>
            </nav>
            {session.mode === 'demo' && (
              <span className="demo-label">
                <span />
                Demo workspace · sample data
              </span>
            )}
            <details className="account-menu">
              <summary>
                <Avatar member={session.member} />
                <div>
                  <strong>{session.member.displayName}</strong>
                  <small>{session.member.role === 'admin' ? 'Workspace admin' : 'Member'}</small>
                </div>
                <ChevronDown size={13} />
              </summary>
              <div className="menu-items">
                <button onClick={() => navigate('/settings')}>Account & workspace</button>
                <button onClick={() => void signOut()}>
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </aside>
        <main className="workspace" inert={mobile && drawer}>
          <header className="workspace-header">
            <div>
              <button
                className="icon-button mobile-menu"
                aria-label="Open navigation"
                onClick={() => setDrawer(true)}
              >
                <Menu size={19} />
              </button>
              <span className="header-workspace">Workspace</span>
              <span className="header-divider">/</span>
              <span>{label}</span>
            </div>
            <div className={`save-indicator ${saveState}`} aria-live="polite">
              {saveState === 'saving' ? (
                <>
                  <span className="spinner" />
                  Saving…
                </>
              ) : saveState === 'saved' ? (
                <>
                  <Check size={13} />
                  Saved
                </>
              ) : saveState === 'failed' ? (
                'Failed to save'
              ) : (
                <span className="header-team">Openrange team</span>
              )}
            </div>
          </header>
          {!online && (
            <div className="connection-banner" role="status">
              <WifiOff size={15} />
              You’re offline. Reconnect to save changes. Your open drafts are preserved.
            </div>
          )}
          {online && refreshError && (
            <div className="connection-banner" role="status">
              {refreshError}
              <button className="text-button" onClick={() => void refresh().catch(() => {})}>
                Retry
              </button>
            </div>
          )}
          <div className="workspace-body">
            <div className="workspace-content">
              {projectId ? (
                <ProjectPage key={projectId} projectId={projectId} />
              ) : path === '/projects' ? (
                <Projects />
              ) : path === '/notifications' ? (
                <Notifications />
              ) : path === '/settings' ? (
                <Settings />
              ) : path === '/trash' ? (
                <Trash />
              ) : path === '/' || path === '/my-tasks' ? (
                <MyTasks onNewTask={() => setNewTask(true)} />
              ) : (
                <section className="page">
                  <Empty title="Page unavailable">Return to your tasks to continue.</Empty>
                  <Link to="/my-tasks" className="button">
                    My Tasks
                  </Link>
                </section>
              )}
            </div>
            {taskId && (
              <TaskPanel
                key={taskId}
                id={taskId}
                onClose={() => navigate(projectId ? `/projects/${projectId}` : '/my-tasks')}
              />
            )}
          </div>
        </main>
        {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
        {newTask && <CreateTask projectId={projectId} onClose={() => setNewTask(false)} />}
        {shortcuts && (
          <Dialog title="Keyboard shortcuts" onClose={() => setShortcuts(false)}>
            <div className="shortcut-list">
              <div>
                <span>Find tasks and projects</span>
                <kbd>⌘ / Ctrl + K</kbd>
              </div>
              <div>
                <span>Create a task</span>
                <kbd>N</kbd>
              </div>
              <div>
                <span>Close a dialog</span>
                <kbd>Esc</kbd>
              </div>
              <div>
                <span>Move through search results</span>
                <kbd>↑ / ↓</kbd>
              </div>
            </div>
          </Dialog>
        )}
        {toast && (
          <div className="toast" role="status">
            {toast}
            <button
              className="icon-button"
              onClick={() => setToast('')}
              aria-label="Dismiss message"
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
const isClosedProject = (status: string) => ['done', 'canceled'].includes(status);

function SignIn({
  config,
  error = '',
  onSignedIn,
}: {
  config: PublicConfig;
  error?: string;
  onSignedIn: () => Promise<void>;
}) {
  const [email, setEmail] = useState(''),
    [message, setMessage] = useState(''),
    [failure, setFailure] = useState(error),
    [pending, setPending] = useState(false),
    [accounts, setAccounts] = useState<{ userId: string; displayName: string; role: string }[]>([]);
  useEffect(() => {
    if (config.mode === 'demo') void get<typeof accounts>('/dev/accounts').then(setAccounts);
  }, [config.mode]);
  return (
    <div className="auth-page">
      <Link className="brand" to="/">
        <img src="/openrange-logo.png" alt="" />
        <span>Openrange</span>
      </Link>
      <div className="auth-content">
        <div className="eyebrow">SHARED WORKSPACE</div>
        <h1>A clear place for the work.</h1>
        <p>Sign in to see your projects, tasks, and team updates.</p>
        {config.mode === 'demo' ? (
          <div className="demo-signin">
            <p>Development workspace · fictional sample data</p>
            {accounts.map((account) => (
              <button
                key={account.userId}
                className="button"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  try {
                    await request('/dev/session', {
                      method: 'POST',
                      body: JSON.stringify({ userId: account.userId }),
                    });
                    await onSignedIn();
                  } catch (e) {
                    setFailure((e as Error).message);
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {account.displayName}
                <span className="muted">{account.role}</span>
              </button>
            ))}
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setFailure('');
              const result = await authProvider()!.auth.signInWithOtp({
                email,
                options: {
                  shouldCreateUser: false,
                  emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
                },
              });
              if (result.error)
                setFailure(
                  'Couldn’t send a sign-in link. Check your email and ask an admin to confirm your account.',
                );
              else setMessage('Check your email for a sign-in link.');
              setPending(false);
            }}
          >
            <label>
              Work email
              <input
                autoFocus
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <button className="button primary" disabled={pending}>
              {pending ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}
        <ErrorNote error={failure} />
        {message && (
          <p className="auth-message" role="status">
            {message}
          </p>
        )}
        <small>Access is by invitation.</small>
      </div>
    </div>
  );
}
function InviteLanding({
  config,
  token,
  onAccepted,
}: {
  config: PublicConfig;
  token: string;
  onAccepted: () => Promise<void>;
}) {
  const [signedIn, setSignedIn] = useState(config.mode === 'demo'),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  useEffect(() => {
    if (config.mode === 'supabase')
      void authProvider()!
        .auth.getSession()
        .then((r) => setSignedIn(!!r.data.session));
  }, [config.mode]);
  if (!signedIn)
    return (
      <SignIn
        config={config}
        onSignedIn={async () => {
          setSignedIn(true);
        }}
      />
    );
  return (
    <div className="auth-page">
      <div className="brand">
        <img src="/openrange-logo.png" alt="" />
        <span>Openrange</span>
      </div>
      <div className="auth-content">
        <div className="eyebrow">TEAM INVITATION</div>
        <h1>Join the workspace.</h1>
        <p>Accept using the verified email address your invitation was sent to.</p>
        <button
          className="button primary"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              await mutate('/invites/accept', { token });
              await onAccepted();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? 'Joining…' : 'Accept invitation'}
        </button>
        <ErrorNote error={error} />
        <button
          className="text-button"
          onClick={async () => {
            await authProvider()?.auth.signOut();
            setSignedIn(false);
          }}
        >
          Use a different account
        </button>
      </div>
    </div>
  );
}
