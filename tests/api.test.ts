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
