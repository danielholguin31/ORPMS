import { beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { configuration, type Config } from '../server/config';
import { demoId } from '../server/seed';
import { MemoryStore } from './helpers';

let store: MemoryStore, app: ReturnType<typeof createApp>;
const config: Config = {
  mode: 'demo',
  port: 3001,
  origin: 'http://localhost:5173',
  inviteSecret: 'test-secret-with-at-least-thirty-two-characters',
  dataPath: '',
  serveStatic: false,
};
async function login(userId = demoId(11)) {
  const agent = supertest.agent(app);
  await agent.post('/api/dev/session').send({ userId }).expect(200);
  const result = await agent.get('/api/me').expect(200);
  return { agent, csrf: result.body.data.csrfToken as string };
}
beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store, config);
});
describe('authenticated API contracts', () => {
  it('denies unauthenticated direct task access and exposes no credentials through config', async () => {
    await supertest(app)
      .get(`/api/tasks/${demoId(301)}`)
      .expect(401);
    const result = await supertest(app).get('/api/config').expect(200);
    expect(result.body.data).toEqual({ mode: 'demo' });
  });
  it('supports two independent accounts on server-backed records with version conflicts', async () => {
    const a = await login(),
      b = await login(demoId(21));
    const key = randomUUID();
    const response = await a.agent
      .post('/api/tasks')
      .set('X-CSRF-Token', a.csrf)
      .set('Idempotency-Key', key)
      .send({ projectId: demoId(100), title: 'Shared record' })
      .expect(200);
    const id = response.body.data.id;
    const second = await b.agent.get(`/api/tasks/${id}`).expect(200);
    expect(second.body.data.task.title).toBe('Shared record');
    await a.agent
      .patch(`/api/tasks/${id}`)
      .set('X-CSRF-Token', a.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ expected_version: 1, title: 'A saved version' })
      .expect(200);
    const conflict = await b.agent
      .patch(`/api/tasks/${id}`)
      .set('X-CSRF-Token', b.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ expected_version: 1, title: 'B draft' })
      .expect(409);
    expect(conflict.body.error.current.title).toBe('A saved version');
  });
  it('requires CSRF protection for demo mutations and rejects foreign origins', async () => {
    const { agent } = await login();
    await agent
      .post('/api/projects')
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Denied' })
      .expect(403);
    await agent
      .post('/api/dev/session')
      .set('Origin', 'https://foreign.example')
      .send({ userId: demoId(11) })
      .expect(403);
  });
  it('enforces admin permissions through endpoints, not just controls', async () => {
    const { agent, csrf } = await login(demoId(21));
    await agent.get('/api/admin/export').expect(403);
    await agent
      .post('/api/invites')
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ email: 'new@example.test' })
      .expect(403);
    await agent
      .post(`/api/projects/${demoId(100)}/archive`)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ expected_version: 1 })
      .expect(403);
  });
  it('keeps notifications recipient-only and receipts/invite hashes out of snapshots and export', async () => {
    const a = await login(),
      b = await login(demoId(21));
    expect((await a.agent.get('/api/notifications').expect(200)).body.data).toHaveLength(1);
    expect((await b.agent.get('/api/notifications').expect(200)).body.data).toHaveLength(0);
    await a.agent
      .post('/api/invites')
      .set('X-CSRF-Token', a.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ email: 'new@example.test' })
      .expect(200);
    const snapshot = (await a.agent.get('/api/workspace')).body.data;
    const exported = (await a.agent.get('/api/admin/export')).body;
    expect(snapshot.receipts).toBeUndefined();
    expect(exported.receipts).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('tokenHash');
    expect(JSON.stringify(exported)).not.toContain('tokenHash');
    expect((await b.agent.get('/api/workspace')).body.data.invites).toEqual([]);
  });
  it('immediately removes deactivated-account read access', async () => {
    const a = await login(),
      b = await login(demoId(21));
    await a.agent
      .patch(`/api/members/${demoId(20)}`)
      .set('X-CSRF-Token', a.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ expected_version: 1, active: false })
      .expect(200);
    await b.agent.get('/api/workspace').expect(403);
    await b.agent.get(`/api/tasks/${demoId(301)}`).expect(403);
  });
  it('paginates without overlap and validates limits', async () => {
    const { agent } = await login();
    const first = (await agent.get('/api/tasks?limit=2')).body;
    const second = (await agent.get(`/api/tasks?limit=2&cursor=${first.next_cursor}`)).body;
    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(2);
    expect(second.data.some((r: any) => first.data.some((a: any) => a.id === r.id))).toBe(false);
    await agent.get('/api/tasks?limit=101').expect(422);
  });
  it('reports failed persistence as a failure without committing state', async () => {
    const { agent, csrf } = await login();
    store.transaction = async () => {
      throw new Error('Sensitive provider information');
    };
    const result = await agent
      .post('/api/tasks')
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ projectId: demoId(100), title: 'Not saved' })
      .expect(503);
    expect(result.body.error.message).not.toContain('Sensitive');
    expect(store.state.tasks.some((t) => t.title === 'Not saved')).toBe(false);
  });
  it('protects every resource read and task-link route', async () => {
    for (const path of [
      '/search?q=pilot',
      '/members',
      '/milestones',
      '/trash',
      '/invites',
      '/workspace/settings',
      `/tasks/${demoId(301)}/link`,
    ]) {
      await supertest(app).get(`/api${path}`).expect(401);
    }
  });
  it('filters personal work, owner, inherited milestones, and statuses on the server', async () => {
    const { agent } = await login();
    const assigned = (await agent.get('/api/tasks?view=assigned').expect(200)).body.data;
    expect(assigned.length).toBeGreaterThan(0);
    expect(
      assigned.every(
        (t: any) => t.assigneeId === demoId(10) && ['todo', 'in_progress'].includes(t.status),
      ),
    ).toBe(true);
    expect((await agent.get('/api/tasks?view=collaborating').expect(200)).body.data).toEqual([]);
    const completed = (await agent.get('/api/tasks?view=completed').expect(200)).body.data;
    expect(completed.map((t: any) => t.id)).toEqual([demoId(306)]);
    const unassigned = (
      await agent
        .get(`/api/tasks?project=${demoId(100)}&assignee=unassigned&top_level=true`)
        .expect(200)
    ).body.data;
    expect(unassigned.map((t: any) => t.id)).toEqual([demoId(302)]);
    const milestone = (await agent.get(`/api/tasks?milestone=${demoId(200)}`).expect(200)).body
      .data;
    expect(milestone.map((t: any) => t.id)).toContain(demoId(311));
    const open = (await agent.get('/api/tasks?status=open').expect(200)).body.data;
    expect(open.every((t: any) => ['todo', 'in_progress'].includes(t.status))).toBe(true);
    const noMilestone = (
      await agent.get(`/api/tasks?project=${demoId(100)}&milestone=none`).expect(200)
    ).body.data;
    expect(noMilestone.map((t: any) => t.id)).toEqual([demoId(306)]);
  });
  it('returns project and milestone progress without counting subtasks', async () => {
    const { agent } = await login();
    const detail = (await agent.get(`/api/projects/${demoId(100)}`).expect(200)).body.data;
    expect(detail.progress).toEqual({ done: 2, total: 7, percent: 29 });
    expect(detail.milestones.find((m: any) => m.id === demoId(200)).progress).toEqual({
      done: 1,
      total: 3,
      percent: 33,
    });
    const task = (await agent.get(`/api/tasks/${demoId(301)}`).expect(200)).body.data;
    expect(task.children.map((t: any) => t.id)).toEqual([demoId(310), demoId(311)]);
    expect(task.comments).toHaveLength(1);
    expect(task.project.id).toBe(demoId(100));
    expect(
      task.blockerCandidates.some((t: any) => t.id === demoId(301) || t.parentId === demoId(301)),
    ).toBe(false);
  });
  it('searches task codes and archived work while omitting trashed work', async () => {
    const { agent, csrf } = await login();
    const headers = { 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID() };
    await agent
      .post(`/api/tasks/${demoId(306)}/trash`)
      .set(headers)
      .send({ expected_version: 1, scope: 'task_and_subtasks' })
      .expect(200);
    await agent
      .post(`/api/projects/${demoId(100)}/archive`)
      .set({ ...headers, 'Idempotency-Key': randomUUID() })
      .send({ expected_version: 1 })
      .expect(200);
    const search = (await agent.get('/api/search?q=OR-000301').expect(200)).body.data;
    expect(search).toHaveLength(1);
    expect(search[0]).toMatchObject({
      id: demoId(301),
      kind: 'task',
      path: `/tasks/${demoId(301)}`,
    });
    expect(
      (await agent.get('/api/search?q=Share%20the%20pilot%20notes').expect(200)).body.data,
    ).toEqual([]);
    const projects = (await agent.get('/api/projects?view=archived').expect(200)).body.data;
    expect(projects.map((p: any) => p.id)).toEqual([demoId(100)]);
    expect((await agent.get('/api/projects?view=all').expect(200)).body.data).toHaveLength(6);
    expect((await agent.get(`/api/tasks/${demoId(306)}/link`).expect(404)).body.error.code).toBe(
      'NOT_FOUND',
    );
  });
  it('returns deletion batches, recipient-filtered notifications, and sanitized admin invitations', async () => {
    const a = await login(),
      b = await login(demoId(21));
    await a.agent
      .post(`/api/tasks/${demoId(301)}/trash`)
      .set('X-CSRF-Token', a.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ expected_version: 1, scope: 'task_and_subtasks' })
      .expect(200);
    const trash = (await a.agent.get('/api/trash').expect(200)).body.data;
    expect(trash.map((t: any) => t.id)).toEqual([demoId(301)]);
    await a.agent
      .post('/api/notifications/read')
      .set('X-CSRF-Token', a.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ all: true })
      .expect(200);
    expect((await a.agent.get('/api/notifications?read=unread').expect(200)).body.data).toEqual([]);
    expect((await a.agent.get('/api/notifications?read=read').expect(200)).body.data).toHaveLength(
      1,
    );
    await a.agent
      .post('/api/invites')
      .set('X-CSRF-Token', a.csrf)
      .set('Idempotency-Key', randomUUID())
      .send({ email: 'new@example.test' })
      .expect(200);
    const invites = (await a.agent.get('/api/invites?pending=true').expect(200)).body.data;
    expect(invites).toHaveLength(1);
    expect(JSON.stringify(invites)).not.toContain('tokenHash');
    await b.agent.get('/api/invites').expect(403);
    await b.agent.get('/api/members?active=true').expect(200);
    const link = (await a.agent.get(`/api/tasks/${demoId(300)}/link`).expect(200)).body.data;
    expect(link.url).toBe(`${config.origin}/tasks/${demoId(300)}`);
  });
  it('rejects invalid filters instead of silently showing the wrong work', async () => {
    const { agent } = await login();
    for (const path of [
      '/tasks?status=finished',
      '/tasks?project=not-a-uuid',
      '/tasks?assignee=someone',
      '/projects?view=unknown',
      '/notifications?read=other',
      '/search?limit=999',
      '/milestones?project=wrong',
      '/members?active=maybe',
      '/tasks?unknown=field',
    ]) {
      await agent.get(`/api${path}`).expect(422);
    }
  });
  it('allows a shared-team read burst while retaining the separate sign-in limit', async () => {
    for (let i = 0; i < 350; i++) await supertest(app).get('/api/config').expect(200);
    for (let i = 0; i < 30; i++)
      await supertest(app)
        .post('/api/session/login')
        .send({ email: 'sam@example.test' })
        .expect(422);
    await supertest(app).post('/api/session/login').send({ email: 'sam@example.test' }).expect(429);
  });
});
describe('production startup protection', () => {
  it('refuses development authentication in production and refuses missing Supabase setup', () => {
    expect(() => configuration({ APP_MODE: 'demo', NODE_ENV: 'production' })).toThrow(
      /disabled in production/,
    );
    expect(() => configuration({ APP_MODE: 'supabase', NODE_ENV: 'production' })).toThrow(
      /Missing/,
    );
    expect(() => configuration({})).toThrow(/APP_MODE/);
  });
  it('never publishes an accidentally configured Supabase service key', () => {
    const env = {
      APP_MODE: 'supabase',
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://example.test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never_public',
      DATABASE_URL: 'postgres://runtime@example.test/database',
      WORKSPACE_ID: demoId(1),
      INVITE_SIGNING_SECRET: 'long-enough-server-only-test-secret-123456789',
    };
    expect(() => configuration(env)).toThrow(/must not be a service/);
  });
});
