import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Actor, Session, State } from '../shared/types';
import { z } from 'zod';
import {
  listInvites,
  listMembers,
  listMilestones,
  listNotifications,
  listProjects,
  listTasks,
  listTrash,
  projectDetail,
  searchWorkspace,
  taskDetail,
} from './queries';
import { Domain, inviteToken, requireMember, type Operation } from './domain';
import { AppError, invariant } from './errors';
import { publicConfig, type Config } from './config';
import type { Store } from './store/types';

const safeInvites = (state: State) => state.invites.map(({ tokenHash: _, ...invite }) => invite);
export function snapshot(state: State, actor: Actor) {
  const member = requireMember(state, actor);
  const { receipts: _, invites: __, ...safe } = state;
  return {
    ...safe,
    notifications: state.notifications.filter((n) => n.recipientId === member.id),
    invites: member.role === 'admin' ? safeInvites(state) : [],
  };
}
function paginate<T extends { id: string }>(rows: T[], req: Request) {
  const requested = Number(req.query.limit || 50);
  invariant(
    Number.isInteger(requested) && requested > 0 && requested <= 100,
    'Limit must be between 1 and 100.',
    'INVALID_LIMIT',
    422,
  );
  const cursor =
    typeof req.query.cursor === 'string'
      ? Buffer.from(req.query.cursor, 'base64url').toString()
      : '';
  const sorted = rows.filter((r) => r.id > cursor).sort((a, b) => a.id.localeCompare(b.id));
  const data = sorted.slice(0, requested);
  return {
    data,
    next_cursor:
      sorted.length > requested ? Buffer.from(data.at(-1)!.id).toString('base64url') : null,
  };
}
const handler =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export function createApp(store: Store, config: Config) {
  const app = express();
  app.disable('x-powered-by');
  const providerOrigin = config.supabaseUrl ? new URL(config.supabaseUrl).origin : null;
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", ...(providerOrigin ? [providerOrigin] : [])],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: config.mode === 'demo' ? null : [],
        },
      },
    }),
  );
  app.use(
    '/api',
    cors({
      origin: (origin, done) =>
        done(
          origin && origin !== config.origin
            ? new AppError(403, 'ORIGIN_DENIED', 'This origin is unavailable.')
            : null,
          true,
        ),
      credentials: true,
    }),
  );
  app.use('/api', express.json({ limit: '128kb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Request-ID', randomUUID());
    next();
  });
  app.use('/api', (req, _res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== config.origin
    )
      return next(new AppError(403, 'ORIGIN_DENIED', 'This origin is unavailable.'));
    next();
  });
  const buckets = new Map<string, { count: number; until: number }>();
  app.use('/api', (req, _res, next) => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.until < now) buckets.delete(key);
    const sensitive = ['/dev/session', '/session/login', '/invites/accept'].includes(req.path);
    // A shared team network generates several reads per view. Keep those reads
    // separate from write and authentication limits.
    const kind = sensitive
      ? 'auth'
      : ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
        ? 'read'
        : 'write';
    const key = `${req.ip}:${kind}`;
    const bucket = buckets.get(key) || { count: 0, until: now + (sensitive ? 300000 : 60000) };
    bucket.count++;
    buckets.set(key, bucket);
    if (bucket.count > (sensitive ? 30 : kind === 'read' ? 1200 : 300))
      return next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.'));
    next();
  });
  const supabase =
    config.mode === 'supabase'
      ? createClient(config.supabaseUrl!, config.supabasePublishableKey!, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  const sessions = new Map<string, { actor: Actor; csrf: string; expires: number }>();
  const domain = new Domain(store, config.inviteSecret);
  app.get('/api/config', (_req, res) => res.json({ data: publicConfig(config) }));
  app.get(
    '/api/health',
    handler(async (_req, res) => {
      await store.read();
      res.json({ data: { status: 'ok', mode: config.mode } });
    }),
  );
  if (config.mode === 'demo') {
    app.get(
      '/api/dev/accounts',
      handler(async (_req, res) => {
        const state = await store.read();
        res.json({
          data: state.members
            .filter((m) => m.active)
            .map((m) => ({ userId: m.userId, displayName: m.displayName, role: m.role })),
        });
      }),
    );
    app.post(
      '/api/dev/session',
      handler(async (req, res) => {
        const state = await store.read();
        const member = state.members.find((m) => m.userId === req.body?.userId && m.active);
        invariant(member, 'Choose an active demo account.', 'INVALID_ACCOUNT', 422);
        const token = randomBytes(32).toString('base64url');
        const csrf = randomBytes(32).toString('base64url');
        for (const [key, session] of sessions)
          if (session.expires < Date.now()) sessions.delete(key);
        sessions.set(token, {
          actor: {
            userId: member.userId,
            email: member.email,
            displayName: member.displayName,
            verified: true,
          },
          csrf,
          expires: Date.now() + 8 * 3600000,
        });
        res.cookie('orpms_demo', token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
          maxAge: 8 * 3600000,
          path: '/api',
        });
        res.json({ data: { signedIn: true } });
      }),
    );
  }
  app.post(
    '/api/session/login',
    handler(async (req, res) => {
      invariant(supabase, 'Choose a demo account to sign in.', 'DEMO_MODE', 422);
      const input = z
        .object({
          email: z
            .email()
            .max(320)
            .transform((email) => email.toLowerCase()),
          redirectPath: z
            .string()
            .max(300)
            .regex(/^\/(?:my-tasks|invite\/[0-9a-f-]{36}\.[a-zA-Z0-9_-]{43})$/)
            .default('/my-tasks'),
        })
        .strict()
        .safeParse(req.body);
      invariant(input.success, 'Enter a valid email address.', 'INVALID_LOGIN', 422);
      const { error } = await supabase.auth.signInWithOtp({
        email: input.data.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${config.origin}${input.data.redirectPath}`,
        },
      });
      if (error)
        throw new AppError(
          error.status === 429 ? 429 : 503,
          'LOGIN_UNAVAILABLE',
          'Couldn’t send the sign-in link. Try again.',
        );
      res.json({ data: { sent: true } });
    }),
  );
  app.use('/api', (req, res, next) => {
    void (async () => {
      let actor: Actor | undefined;
      if (config.mode === 'demo') {
        const cookie = req.headers.cookie
          ?.split(';')
          .map((c) => c.trim())
          .find((c) => c.startsWith('orpms_demo='))
          ?.slice('orpms_demo='.length);
        const session = cookie ? sessions.get(cookie) : undefined;
        if (session && session.expires > Date.now()) {
          actor = session.actor;
          res.locals.csrf = session.csrf;
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
            invariant(
              req.headers['x-csrf-token'] === session.csrf,
              'Refresh the session and try again.',
              'CSRF_FAILED',
              403,
            );
        }
      } else {
        const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        if (token) {
          const { data, error } = await supabase!.auth.getUser(token);
          if (error && (!error.status || error.status >= 500))
            throw new AppError(503, 'AUTH_UNAVAILABLE', 'Sign-in unavailable. Try again.');
          if (error?.status === 429)
            throw new AppError(
              429,
              'AUTH_RATE_LIMITED',
              'Sign-in verification is busy. Try again shortly.',
            );
          if (!error && data.user?.email)
            actor = {
              userId: data.user.id,
              email: data.user.email.toLowerCase(),
              verified: !!data.user.email_confirmed_at,
              displayName: String(
                data.user.user_metadata?.display_name ||
                  data.user.user_metadata?.full_name ||
                  data.user.email.split('@')[0],
              ).slice(0, 160),
            };
        }
      }
      if (!actor) throw new AppError(401, 'SIGNED_OUT', 'Sign in to continue.');
      if (!actor.verified)
        throw new AppError(403, 'EMAIL_UNVERIFIED', 'Verify your email to continue.');
      res.locals.actor = actor;
      // This middleware intentionally leaves membership checks to the read/mutation transaction.
    })()
      .then(() => next())
      .catch(next);
  });

  const read = (fn: (state: State, actor: Actor, req: Request, res: Response) => any) =>
    handler(async (req, res) => {
      const state = await store.read();
      requireMember(state, res.locals.actor);
      return fn(state, res.locals.actor, req, res);
    });
  app.get(
    '/api/me',
    read((state, actor, _req, res) => {
      const session: Session = {
        member: requireMember(state, actor),
        workspace: state.workspace,
        mode: config.mode,
        ...(config.mode === 'demo'
          ? {
              csrfToken: res.locals.csrf,
              demoAccounts: state.members
                .filter((m) => m.active)
                .map((m) => ({ userId: m.userId, displayName: m.displayName, role: m.role })),
            }
          : {}),
      };
      res.json({ data: session });
    }),
  );
  app.post(
    '/api/session/logout',
    handler(async (req, res) => {
      if (supabase) {
        const bearer = req.headers.authorization!.match(/^Bearer (.+)$/)![1];
        const { error } = await supabase.auth.admin.signOut(bearer, 'local');
        if (error && error.status !== 401 && error.status !== 403)
          throw new AppError(503, 'LOGOUT_UNAVAILABLE', 'Couldn’t sign out. Try again.');
      }
      const token = req.headers.cookie
        ?.split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('orpms_demo='))
        ?.slice('orpms_demo='.length);
      if (token) sessions.delete(token);
      res.clearCookie('orpms_demo', { path: '/api' });
      res.json({ data: { signedOut: true } });
    }),
  );
  app.get(
    '/api/workspace',
    read((state, actor, _req, res) => res.json({ data: snapshot(state, actor) })),
  );
  app.get(
    '/api/workspace/settings',
    read((state, _actor, _req, res) => res.json({ data: state.workspace })),
  );
  app.get(
    '/api/projects',
    read((state, _actor, req, res) => res.json(paginate(listProjects(state, req.query), req))),
  );
  app.get(
    '/api/projects/:id',
    read((state, _actor, req, res) => {
      const project = projectDetail(state, String(req.params.id));
      res.json({ data: project, version: project.version });
    }),
  );
  app.get(
    '/api/tasks',
    read((state, actor, req, res) => res.json(paginate(listTasks(state, actor, req.query), req))),
  );
  app.get(
    '/api/tasks/:id',
    read((state, _actor, req, res) => {
      const detail = taskDetail(state, String(req.params.id));
      res.json({ data: detail, version: detail.task.version });
    }),
  );
  app.get(
    '/api/tasks/:id/link',
    read((state, _actor, req, res) => {
      const { task } = taskDetail(state, String(req.params.id));
      res.json({ data: { url: `${config.origin}/tasks/${task.id}` } });
    }),
  );
  app.get(
    '/api/members',
    read((state, _actor, req, res) => res.json(paginate(listMembers(state, req.query), req))),
  );
  app.get(
    '/api/milestones',
    read((state, _actor, req, res) => res.json(paginate(listMilestones(state, req.query), req))),
  );
  app.get(
    '/api/notifications',
    read((state, actor, req, res) =>
      res.json(paginate(listNotifications(state, actor, req.query), req)),
    ),
  );
  app.get(
    '/api/trash',
    read((state, _actor, req, res) => res.json(paginate(listTrash(state, req.query), req))),
  );
  app.get(
    '/api/invites',
    read((state, actor, req, res) => res.json(paginate(listInvites(state, actor, req.query), req))),
  );
  app.get(
    '/api/search',
    read((state, _actor, req, res) => res.json({ data: searchWorkspace(state, req.query) })),
  );
  app.get(
    '/api/admin/export',
    read((state, actor, _req, res) => {
      invariant(
        requireMember(state, actor).role === 'admin',
        'Only admins can export the workspace.',
        'FORBIDDEN',
        403,
      );
      const { receipts: _, invites: __, ...data } = state;
      res.attachment(`openrange-export-${new Date().toISOString().slice(0, 10)}.json`).json({
        schema_version: 1,
        exported_at: new Date().toISOString(),
        ...data,
        invites: safeInvites(state),
      });
    }),
  );
  app.get(
    '/api/invites/:id/link',
    read((state, actor, req, res) => {
      // SEBASTIAN-03: Manual delivery is explicit. Replace it only after implementing
      // a durable mail outbox + managed account provisioning; do not pretend to send.
      invariant(
        requireMember(state, actor).role === 'admin',
        'Only admins can access invitation links.',
        'FORBIDDEN',
        403,
      );
      const invite = state.invites.find((i) => i.id === req.params.id);
      invariant(
        invite &&
          !invite.acceptedAt &&
          !invite.revokedAt &&
          invite.expiresAt > new Date().toISOString(),
        'This invitation is unavailable.',
        'INVALID_INVITE',
        404,
      );
      const token = inviteToken(invite.id, config.inviteSecret);
      const hashed = createHash('sha256').update(token).digest();
      invariant(
        timingSafeEqual(Buffer.from(invite.tokenHash, 'hex'), hashed),
        'Invitation signing secret changed. Revoke and create a new invitation.',
        'INVALID_INVITE',
        409,
      );
      res.json({ data: { url: `${config.origin}/invite/${token}`, delivery: 'manual' } });
    }),
  );
  const mutation = (
    operation: Operation,
    id: (req: Request) => string | null = (req) => String(req.params.id),
  ) =>
    handler(async (req, res) => {
      const key =
        typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : '';
      res.json(await domain.mutate(res.locals.actor, operation, id(req), req.body ?? {}, key));
    });
  app.post(
    '/api/projects',
    mutation('project.create', () => null),
  );
  app.patch('/api/projects/:id', mutation('project.patch'));
  app.post('/api/projects/:id/archive', mutation('project.archive'));
  app.post('/api/projects/:id/restore', mutation('project.restore'));
  app.post(
    '/api/tasks',
    mutation('task.create', () => null),
  );
  app.patch('/api/tasks/:id', mutation('task.patch'));
  app.post('/api/tasks/:id/trash', mutation('task.trash'));
  app.post('/api/tasks/:id/restore', mutation('task.restore'));
  app.post(
    '/api/milestones',
    mutation('milestone.create', () => null),
  );
  app.patch('/api/milestones/:id', mutation('milestone.patch'));
  app.delete('/api/milestones/:id', mutation('milestone.delete'));
  app.post('/api/tasks/:id/comments', mutation('comment.create'));
  app.patch('/api/comments/:id', mutation('comment.patch'));
  app.delete('/api/comments/:id', mutation('comment.delete'));
  app.post(
    '/api/invites',
    mutation('invite.create', () => null),
  );
  app.post('/api/invites/:id/revoke', mutation('invite.revoke'));
  app.post(
    '/api/invites/accept',
    mutation('invite.accept', () => null),
  );
  app.patch('/api/members/:id', mutation('member.patch'));
  app.patch(
    '/api/workspace',
    mutation('workspace.patch', () => null),
  );
  app.post(
    '/api/notifications/read',
    mutation('notification.read', () => null),
  );
  app.use('/api', (_req, _res, next) =>
    next(new AppError(404, 'NOT_FOUND', 'Endpoint unavailable.')),
  );
  if (config.serveStatic) {
    app.use(express.static(resolve('dist/client')));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) return res.status(error.status).json({ error: error.toJSON() });
    if ((error as { type?: string }).type === 'entity.too.large')
      return res
        .status(413)
        .json({ error: { code: 'TOO_LARGE', message: 'This request is too large.' } });
    if (error instanceof SyntaxError)
      return res
        .status(400)
        .json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
    process.stderr.write(`API failure; request ${res.getHeader('X-Request-ID')}.\n`);
    return res.status(503).json({
      error: {
        code: 'UNAVAILABLE',
        message: 'Server unavailable. Try again.',
      },
    });
  });
  return app;
}
