import { expect, test } from '@playwright/test';

test('a delayed workspace refresh cannot reopen the workspace after sign-out', async ({ page }) => {
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let release!: () => void, captured!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetched = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route('**/api/workspace', async (route) => {
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await fetched;
    await page.locator('.account-menu summary').click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/workspace');
    release();
    await (await refreshed).finished();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveCount(0);
  } finally {
    release();
  }
});

test('a Supabase sign-out event from another tab clears the open workspace immediately', async ({
  page,
}) => {
  // Exercise the installed browser auth SDK with a local session fixture.
  // App records use the isolated demo API; this does not contact managed Auth.
  await page.request.post('/api/dev/session', {
    data: { userId: '00000000-0000-4000-8000-000000000011' },
  });
  const { data: session } = await (await page.request.get('/api/me')).json();
  const storageKey = 'sb-orpms-auth-auth-token';
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: session.member.userId, exp: expiresAt })).toString(
      'base64url',
    ),
    'local-browser-fixture',
  ].join('.');
  await page.addInitScript(
    ({ storageKey, token, expiresAt, member }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          access_token: token,
          refresh_token: 'local-refresh-fixture',
          expires_at: expiresAt,
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: member.userId, email: member.email, aud: 'authenticated', user_metadata: {} },
        }),
      );
    },
    { storageKey, token, expiresAt, member: session.member },
  );
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        data: {
          mode: 'supabase',
          supabaseUrl: 'https://orpms-auth.example.test',
          supabasePublishableKey: 'sb_publishable_local_fixture',
        },
      },
    }),
  );
  await page.route('https://orpms-auth.example.test/**', (route) => route.abort());
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  await page.evaluate((storageKey) => {
    localStorage.removeItem(storageKey);
    const channel = new BroadcastChannel(storageKey);
    channel.postMessage({ event: 'SIGNED_OUT', session: null });
    channel.close();
  }, storageKey);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
});
