import { beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../server/app';
import { demoId } from '../server/seed';
import type { Config } from '../server/config';
import { MemoryStore } from './helpers';

const provider = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithOtp: vi.fn(),
  admin: { signOut: vi.fn() },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: provider }) }));
const config: Config = {
  mode: 'supabase',
  port: 3001,
  origin: 'https://app.example.test',
  inviteSecret: 'test-only-secret-at-least-thirty-two-characters',
  dataPath: '',
  serveStatic: false,
  supabaseUrl: 'https://project.example.test',
  supabasePublishableKey: 'test-publishable-key',
};
let app: ReturnType<typeof createApp>, store: MemoryStore;
beforeEach(() => {
  provider.getUser.mockReset();
  provider.signInWithOtp.mockReset();
  provider.admin.signOut.mockReset();
  store = new MemoryStore();
  app = createApp(store, config);
});
describe('Supabase authentication boundary (mocked provider; no live project)', () => {
  it('requires a bearer token rather than browser-supplied identity fields', async () => {
    await supertest(app).get('/api/me').set('X-User-ID', demoId(11)).expect(401);
    expect(provider.getUser).not.toHaveBeenCalled();
  });
  it('verifies the token remotely and ignores user metadata roles', async () => {
    provider.getUser.mockResolvedValue({
      data: {
        user: {
          id: demoId(21),
          email: 'SAM@EXAMPLE.TEST',
          email_confirmed_at: '2026-10-10',
          user_metadata: { role: 'admin', full_name: 'Sam Rivera' },
        },
      },
      error: null,
    });
    const response = await supertest(app)
      .get('/api/me')
      .set('Authorization', 'Bearer example-member-token')
      .expect(200);
    expect(provider.getUser).toHaveBeenCalledWith('example-member-token');
    expect(response.body.data.member.role).toBe('member');
    await supertest(app)
      .get('/api/admin/export')
      .set('Authorization', 'Bearer example-member-token')
      .expect(403);
  });
  it('rejects provider-denied and unverified accounts', async () => {
    provider.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    await supertest(app).get('/api/me').set('Authorization', 'Bearer rejected-token').expect(401);
    provider.getUser.mockResolvedValue({
      data: { user: { id: demoId(11), email: 'alex@example.test', email_confirmed_at: null } },
      error: null,
    });
    await supertest(app).get('/api/me').set('Authorization', 'Bearer unverified-token').expect(403);
  });
  it('checks current membership after a verified authentication response', async () => {
    provider.getUser.mockResolvedValue({
      data: {
        user: { id: demoId(21), email: 'sam@example.test', email_confirmed_at: '2026-10-10' },
      },
      error: null,
    });
    store.state.members.find((m) => m.id === demoId(20))!.active = false;
    await supertest(app)
      .get('/api/workspace')
      .set('Authorization', 'Bearer deactivated-token')
      .expect(403);
  });
  it('reports provider outages as unavailable without pretending the user signed out', async () => {
    provider.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 0, message: 'Private provider failure details' },
    });
    const response = await supertest(app)
      .get('/api/me')
      .set('Authorization', 'Bearer valid-during-outage')
      .expect(503);
    expect(response.body.error.code).toBe('AUTH_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('Private provider');
  });
  it('routes sign-in through the API with a fixed origin and signup disabled', async () => {
    provider.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    await supertest(app).post('/api/session/login').send({ email: 'SAM@EXAMPLE.TEST' }).expect(200);
    expect(provider.signInWithOtp).toHaveBeenCalledWith({
      email: 'sam@example.test',
      options: { shouldCreateUser: false, emailRedirectTo: `${config.origin}/my-tasks` },
    });
    await supertest(app)
      .post('/api/session/login')
      .send({ email: 'sam@example.test', redirectPath: 'https://foreign.example' })
      .expect(422);
    await supertest(app)
      .post('/api/session/login')
      .send({ email: 'sam@example.test', role: 'admin' })
      .expect(422);
    expect(provider.signInWithOtp).toHaveBeenCalledTimes(1);
  });
  it('does not claim to send a link when the managed provider fails', async () => {
    provider.signInWithOtp.mockResolvedValue({
      error: { status: 500, message: 'Private SMTP detail' },
    });
    const result = await supertest(app)
      .post('/api/session/login')
      .send({ email: 'sam@example.test' })
      .expect(503);
    expect(result.body.data).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain('Private SMTP');
    provider.signInWithOtp.mockResolvedValue({ error: { status: 429 } });
    await supertest(app).post('/api/session/login').send({ email: 'sam@example.test' }).expect(429);
  });
  it('revokes the verified session through the logout route without affecting other sessions', async () => {
    provider.getUser.mockResolvedValue({
      data: {
        user: { id: demoId(21), email: 'sam@example.test', email_confirmed_at: '2026-10-10' },
      },
      error: null,
    });
    provider.admin.signOut.mockResolvedValue({ error: null });
    await supertest(app)
      .post('/api/session/logout')
      .set('Authorization', 'Bearer current-session-token')
      .expect(200);
    expect(provider.admin.signOut).toHaveBeenCalledWith('current-session-token', 'local');
    provider.admin.signOut.mockResolvedValue({ error: { status: 503 } });
    await supertest(app)
      .post('/api/session/logout')
      .set('Authorization', 'Bearer current-session-token')
      .expect(503);
  });
});
