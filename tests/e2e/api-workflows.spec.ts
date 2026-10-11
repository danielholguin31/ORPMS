import { expect, test, type Page } from '@playwright/test';

const corpus = '00000000-0000-4000-8000-000000000100';
const adminId = '00000000-0000-4000-8000-000000000010';
const samId = '00000000-0000-4000-8000-000000000020';
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;
const responseFor = (
  page: Page,
  path: string,
  method = 'GET',
  query: Record<string, string> = {},
) =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === `/api${path}` &&
      response.request().method() === method &&
      response.status() === 200 &&
      Object.entries(query).every(([key, value]) => url.searchParams.get(key) === value)
    );
  });
async function newTask(page: Page, title: string) {
  const { data: session } = await (await page.request.get('/api/me')).json();
  const result = await page.request.post('/api/tasks', {
    headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
    data: { projectId: corpus, title, assigneeId: adminId },
  });
  expect(result.ok()).toBeTruthy();
  return (await result.json()).data;
}

test('personal tabs and project filters use server routes and survive reload', async ({ page }) => {
  const assigned = responseFor(page, '/tasks', 'GET', { view: 'assigned' });
  await page.goto('/my-tasks');
  await assigned;
  const collaborating = responseFor(page, '/tasks', 'GET', { view: 'collaborating' });
  await page.getByRole('button', { name: 'Collaborating', exact: true }).click();
  await collaborating;
  const completed = responseFor(page, '/tasks', 'GET', { view: 'completed' });
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  const rows = (await (await completed).json()).data;
  expect(rows.every((row: any) => row.status === 'done' && row.assigneeId === adminId)).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Completed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto(`/projects/${corpus}`);
  await expect(page.getByLabel('Filter by owner')).toBeVisible();
  const owner = responseFor(page, '/tasks', 'GET', {
    project: corpus,
    assignee: 'unassigned',
    top_level: 'true',
  });
  await page.getByLabel('Filter by owner').selectOption('unassigned');
  const unassigned = (await (await owner).json()).data;
  expect(unassigned.every((row: any) => !row.assigneeId && !row.parentId)).toBe(true);
  const milestone = responseFor(page, '/tasks', 'GET', { milestone: 'none' });
  await page.getByLabel('Filter by milestone').selectOption('none');
  await milestone;
  await page.reload();
  await expect(page.getByLabel('Filter by owner')).toHaveValue('unassigned');
  await expect(page.getByLabel('Filter by milestone')).toHaveValue('none');
  const clear = responseFor(page, '/tasks', 'GET', { status: 'not_canceled' });
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  const cleared = await clear;
  expect(new URL(cleared.url()).searchParams.has('assignee')).toBe(false);
  await expect(page.getByLabel('Filter by owner')).toHaveValue('all');
});

test('all task properties, links, and comment edits persist through the API', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  const record = await newTask(page, unique('Properties'));
  const detail = responseFor(page, `/tasks/${record.id}`);
  await page.goto(`/tasks/${record.id}`);
  await detail;
  const panel = page.locator('.task-panel');
  async function patch(action: () => Promise<unknown>, field: string, value: unknown) {
    const saved = responseFor(page, `/tasks/${record.id}`, 'PATCH');
    await action();
    expect((await (await saved).json()).data[field]).toEqual(value);
    await expect(page.locator('.save-indicator')).toHaveText('Saved');
  }
  await patch(
    () => page.getByLabel('Task assignee', { exact: true }).selectOption(samId),
    'assigneeId',
    samId,
  );
  await expect(page.getByLabel('Task assignee', { exact: true })).toHaveValue(samId);
  await panel.locator('.collaborator-picker summary').click();
  const jordan = '00000000-0000-4000-8000-000000000030';
  await patch(
    () => panel.getByRole('checkbox', { name: 'Jordan Lee', exact: true }).click(),
    'collaboratorIds',
    [jordan],
  );
  await expect(panel.getByRole('checkbox', { name: 'Jordan Lee', exact: true })).toBeChecked();
  await panel.locator('.collaborator-picker summary').click();
  const milestone = '00000000-0000-4000-8000-000000000201';
  await patch(
    () => page.getByLabel('Task milestone', { exact: true }).selectOption(milestone),
    'milestoneId',
    milestone,
  );
  await expect(page.getByLabel('Task milestone', { exact: true })).toHaveValue(milestone);
  await patch(
    () => page.getByLabel('Task start date', { exact: true }).fill('2026-10-10'),
    'startDate',
    '2026-10-10',
  );
  await expect(page.getByLabel('Task start date', { exact: true })).toHaveValue('2026-10-10');
  await patch(
    () => page.getByLabel('Task due date', { exact: true }).fill('2026-10-18'),
    'dueDate',
    '2026-10-18',
  );
  await expect(page.getByLabel('Task due date', { exact: true })).toHaveValue('2026-10-18');
  const blocker = '00000000-0000-4000-8000-000000000301';
  await patch(
    () => page.getByLabel('Task blocker', { exact: true }).selectOption(blocker),
    'blockedById',
    blocker,
  );
  await expect(page.getByLabel('Task blocker', { exact: true })).toHaveValue(blocker);
  const link = responseFor(page, `/tasks/${record.id}/link`);
  await page.getByRole('button', { name: 'Copy task link', exact: true }).click();
  expect((await (await link).json()).data.url).toBe(`http://localhost:5180/tasks/${record.id}`);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`http://localhost:5180/tasks/${record.id}`);
  const commentText = unique('Comment');
  const posted = responseFor(page, `/tasks/${record.id}/comments`, 'POST');
  await page.getByLabel('Write a comment', { exact: true }).fill(commentText);
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  const commentId = (await (await posted).json()).data.id;
  const comment = panel.locator('.comment-row').filter({ hasText: commentText });
  await comment.getByLabel('Comment actions', { exact: true }).click();
  await comment.getByRole('button', { name: 'Edit comment', exact: true }).click();
  const updated = unique('Edited comment');
  const commentEditor = panel.locator('.comment-row form');
  await commentEditor.locator('textarea').fill(updated);
  const edited = responseFor(page, `/comments/${commentId}`, 'PATCH');
  await commentEditor.getByRole('button', { name: 'Save comment', exact: true }).click();
  await edited;
  const updatedComment = panel.locator('.comment-row').filter({ hasText: updated });
  await updatedComment.getByLabel('Comment actions', { exact: true }).click();
  await updatedComment.getByRole('button', { name: 'Delete comment', exact: true }).click();
  const deleted = responseFor(page, `/comments/${commentId}`, 'DELETE');
  await page
    .getByRole('dialog', { name: 'Delete comment?', exact: true })
    .getByRole('button', { name: 'Delete comment', exact: true })
    .click();
  await deleted;
  await expect(panel.getByText('Comment deleted', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Task assignee', { exact: true })).toHaveValue(samId);
  await expect(page.getByLabel('Task due date', { exact: true })).toHaveValue('2026-10-18');
  await expect(panel.getByText('Comment deleted', { exact: true })).toBeVisible();
});

test('projects and milestones create, edit, and delete through real routes', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New project', exact: true });
  const name = unique('Project');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Outcome', { exact: true }).fill('Review the rollout.');
  const created = responseFor(page, '/projects', 'POST');
  await form.getByRole('button', { name: 'Create project', exact: true }).click();
  const project = (await (await created).json()).data;
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add milestone', exact: true }).click();
  const milestoneName = unique('Checkpoint');
  const milestoneForm = page.getByRole('dialog', { name: 'New milestone', exact: true });
  await milestoneForm.getByLabel('Name', { exact: true }).fill(milestoneName);
  const createdMilestone = responseFor(page, '/milestones', 'POST');
  await milestoneForm.getByRole('button', { name: 'Create milestone', exact: true }).click();
  const milestone = (await (await createdMilestone).json()).data;
  await expect(page.locator('.milestone-item').filter({ hasText: milestoneName })).toBeVisible();
  await page.getByLabel(`Manage ${milestoneName}`, { exact: true }).click();
  await page.getByRole('button', { name: 'Edit milestone', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit milestone', exact: true });
  const renamed = unique('Renamed checkpoint');
  await edit.getByLabel('Name', { exact: true }).fill(renamed);
  const saved = responseFor(page, `/milestones/${milestone.id}`, 'PATCH');
  await edit.getByRole('button', { name: 'Save milestone', exact: true }).click();
  await saved;
  await page.getByLabel(`Manage ${renamed}`, { exact: true }).click();
  await page.getByRole('button', { name: 'Delete milestone', exact: true }).click();
  const removed = responseFor(page, `/milestones/${milestone.id}`, 'DELETE');
  await page
    .getByRole('dialog', { name: 'Delete milestone?', exact: true })
    .getByRole('button', { name: 'Delete milestone', exact: true })
    .click();
  await removed;
  await expect(page.locator('.milestone-item')).toHaveCount(0);
  await page.getByLabel('Project actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  const editProject = page.getByRole('dialog', { name: 'Edit project', exact: true });
  const renamedProject = unique('Renamed project');
  await editProject.getByLabel('Name', { exact: true }).fill(renamedProject);
  const patched = responseFor(page, `/projects/${project.id}`, 'PATCH');
  await editProject.getByRole('button', { name: 'Save project', exact: true }).click();
  await patched;
  await expect(page.getByRole('heading', { name: renamedProject, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: renamedProject, exact: true })).toBeVisible();
});

test('trash routes group a parent and its subtasks and restore them together', async ({ page }) => {
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  const name = unique('Restore parent');
  const record = await newTask(page, name);
  await page.goto(`/tasks/${record.id}`);
  await page.getByRole('button', { name: 'Add subtask', exact: true }).click();
  const childName = unique('Restore child');
  const form = page.getByRole('dialog', { name: 'New subtask', exact: true });
  await form.getByLabel('Title', { exact: true }).fill(childName);
  await form.getByRole('button', { name: 'Create subtask', exact: true }).click();
  await expect(page.getByRole('heading', { name: childName, exact: true })).toBeVisible();
  await page.goto(`/tasks/${record.id}`);
  await page.getByLabel('Task actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  const trashed = responseFor(page, `/tasks/${record.id}/trash`, 'POST');
  await page
    .getByRole('dialog', { name: 'Move task to trash?', exact: true })
    .getByRole('button', { name: 'Move to trash', exact: true })
    .click();
  await trashed;
  const trashRead = responseFor(page, '/trash');
  await page.goto('/trash');
  await trashRead;
  const row = page.locator('.trash-row').filter({ hasText: name });
  await expect(row.getByText(/Includes subtasks/)).toBeVisible();
  await expect(page.locator('.trash-row').filter({ hasText: childName })).toHaveCount(0);
  await row.getByRole('button', { name: 'Restore', exact: true }).click();
  const restored = responseFor(page, `/tasks/${record.id}/restore`, 'POST');
  await page
    .getByRole('dialog', { name: 'Restore task?', exact: true })
    .getByRole('button', { name: 'Restore task', exact: true })
    .click();
  await restored;
  await expect(row).toHaveCount(0);
  await page.goto(`/tasks/${record.id}`);
  await expect(page.getByRole('button', { name: childName })).toBeVisible();
});

test('settings invitations, access roles, time zone, export, and logout use backend routes', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const members = responseFor(page, '/members');
  await page.goto('/settings');
  await members;
  const promoted = responseFor(page, `/members/${samId}`, 'PATCH');
  await page.getByLabel('Role for Sam Rivera', { exact: true }).selectOption('admin');
  await promoted;
  await expect(page.getByLabel('Role for Sam Rivera', { exact: true })).toHaveValue('admin');
  const demoted = responseFor(page, `/members/${samId}`, 'PATCH');
  await page.getByLabel('Role for Sam Rivera', { exact: true }).selectOption('member');
  await demoted;
  const invites = responseFor(page, '/invites', 'GET', { pending: 'true' });
  await page.getByRole('button', { name: 'Invitations', exact: true }).click();
  await invites;
  const email = `invite-${crypto.randomUUID().slice(0, 8)}@example.test`;
  await page.getByLabel('Invitation email', { exact: true }).fill(email);
  const created = responseFor(page, '/invites', 'POST');
  await page.getByRole('button', { name: 'Create invite', exact: true }).click();
  const invite = (await (await created).json()).data;
  await expect(page.locator('.invite-row').filter({ hasText: email })).toBeVisible();
  await expect(page.getByText('Invitation link copied', { exact: true })).toBeVisible();
  const invitationLink = await page.evaluate(() => navigator.clipboard.readText());
  expect(invitationLink.startsWith(`http://localhost:5180/invite/${invite.id}.`)).toBe(true);
  const revoked = responseFor(page, `/invites/${invite.id}/revoke`, 'POST');
  await page
    .locator('.invite-row')
    .filter({ hasText: email })
    .getByRole('button', { name: 'Revoke', exact: true })
    .click();
  await revoked;
  await expect(page.locator('.invite-row').filter({ hasText: email })).toHaveCount(0);
  const workspace = responseFor(page, '/workspace/settings');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  const originalZone = (await (await workspace).json()).data.timeZone;
  const nextZone = originalZone === 'UTC' ? 'America/Bogota' : 'UTC';
  await page.getByLabel('Workspace time zone', { exact: true }).selectOption(nextZone);
  const zoneSaved = responseFor(page, '/workspace', 'PATCH');
  await page.locator('.setting-block').getByRole('button', { name: 'Save', exact: true }).click();
  await zoneSaved;
  await page.reload();
  await expect(page.getByLabel('Workspace time zone', { exact: true })).toHaveValue(nextZone);
  await page.getByLabel('Workspace time zone', { exact: true }).selectOption(originalZone);
  const zoneRestored = responseFor(page, '/workspace', 'PATCH');
  await page.locator('.setting-block').getByRole('button', { name: 'Save', exact: true }).click();
  await zoneRestored;
  const exported = responseFor(page, '/admin/export');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const data = await (await exported).json();
  expect(data.schema_version).toBe(1);
  expect(data.receipts).toBeUndefined();
  expect(JSON.stringify(data)).not.toContain('tokenHash');
  expect((await download).suggestedFilename()).toMatch(/^openrange-export-/);
  await page.locator('.account-menu summary').click();
  const loggedOut = responseFor(page, '/session/logout', 'POST');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await loggedOut;
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('notification tabs and mark-read request recipient-scoped routes', async ({
  page,
  request,
}) => {
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  const record = await newTask(page, unique('Notification recipient'));
  await request.post('/api/dev/session', {
    data: { userId: '00000000-0000-4000-8000-000000000021' },
  });
  const { data: session } = await (await request.get('/api/me')).json();
  expect(
    (
      await request.post(`/api/tasks/${record.id}/comments`, {
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
        data: { body: 'An update for the assignee.' },
      })
    ).ok(),
  ).toBeTruthy();
  const unread = responseFor(page, '/notifications', 'GET', { read: 'unread' });
  await page.goto('/notifications');
  await unread;
  const all = responseFor(page, '/notifications', 'GET', { read: 'all' });
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await all;
  const mark = page.getByRole('button', { name: 'Mark all read', exact: true });
  await expect(mark).toBeEnabled();
  const read = responseFor(page, '/notifications/read', 'POST');
  await mark.click();
  await read;
  await expect(mark).toBeDisabled();
  const readAgain = responseFor(page, '/notifications', 'GET', { read: 'unread' });
  await page.getByRole('button', { name: /^Unread/ }).click();
  await readAgain;
  await expect(page.locator('.notification-row')).toHaveCount(0);
});

test('failed resource reads expose retry instead of rendering snapshot data or a fake empty success', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/tasks?view=assigned*', async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Read unavailable' } }),
      });
    else await route.continue();
  });
  await page.goto('/my-tasks');
  await expect(page.getByRole('alert')).toHaveText(/Read unavailable/);
  await expect(page.locator('.task-row')).toHaveCount(0);
  await expect(page.getByText('No tasks', { exact: true })).toHaveCount(0);
  fail = false;
  const retried = responseFor(page, '/tasks', 'GET', { view: 'assigned' });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await retried;
  await expect(page.locator('.task-row').first()).toBeVisible();
});
