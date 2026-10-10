import { beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../server/app';
import { demoId } from '../server/seed';
import type { Config } from '../server/config';
import { MemoryStore } from './helpers';

const provider = vi.hoisted(() => ({ getUser: vi.fn() }));
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
});
