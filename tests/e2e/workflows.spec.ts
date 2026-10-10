import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const corpus = '00000000-0000-4000-8000-000000000100';
const pilot = '00000000-0000-4000-8000-000000000301';
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;
async function createTask(page: Page, title: string) {
  const { data: session } = await (await page.request.get('/api/me')).json();
  const result = await page.request.post('/api/tasks', {
    headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
    data: { projectId: corpus, title, assigneeId: session.member.id },
  });
  expect(result.ok()).toBeTruthy();
  return (await result.json()).data;
}
test('keyboard creation, comments, direct URLs and reload persistence', async ({ page }) => {
  const title = unique('Keyboard task');
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog
    .getByRole('combobox', { name: 'Assignee', exact: true })
    .selectOption('00000000-0000-4000-8000-000000000010');
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const directUrl = page.url();
  await page
    .getByLabel('Write a comment', { exact: true })
    .fill('A shared update from the keyboard workflow.');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(
    page.getByText('A shared update from the keyboard workflow.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search tasks and projects').fill(title);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(directUrl);
});
test('independent accounts preserve a stale editor draft and see changes within ten seconds', async ({
  page,
  browser,
}) => {
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  const original = unique('Concurrent edit');
  const record = await createTask(page, original);
  const context = await browser.newContext({ baseURL: 'http://localhost:5180' });
  const other = await context.newPage();
  try {
    await page.goto(`/tasks/${record.id}`);
    await other.goto(`/tasks/${record.id}`);
    await expect(other.getByRole('heading', { name: original, exact: true })).toBeVisible();
    await other.request.post('/api/dev/session', {
      data: { userId: '00000000-0000-4000-8000-000000000021' },
    });
    await other.reload();
    await expect(other.locator('.account-menu strong')).toHaveText('Sam Rivera');
    await page.getByRole('button', { name: 'Edit task text', exact: true }).click();
    await other.getByRole('button', { name: 'Edit task text', exact: true }).click();
    const aTitle = unique('Saved by account A'),
      bTitle = unique('Preserved account B draft');
    await page.getByLabel('Task title', { exact: true }).fill(aTitle);
    await other.getByLabel('Task title', { exact: true }).fill(bTitle);
    await page.locator('.task-panel').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: aTitle, exact: true })).toBeVisible();
    await other.locator('.task-panel').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      other.getByRole('button', { name: 'Reload current version', exact: true }),
    ).toBeVisible();
    await expect(other.getByLabel('Task title', { exact: true })).toHaveValue(bTitle);
    await other.getByRole('button', { name: 'Reapply my draft', exact: true }).click();
    await expect(other.getByRole('heading', { name: bTitle, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: bTitle, exact: true })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    await context.close();
  }
});
test('board dragging updates status, with an accessible status control', async ({ page }) => {
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  const title = unique('Board status');
  await createTask(page, title);
  await page.goto(`/projects/${corpus}`);
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  const card = page
    .locator('.board-card')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
  const inProgress = page
    .locator('.board-column')
    .filter({ has: page.getByRole('heading', { name: 'In progress', exact: true }) });
  await card.locator('.board-drag-handle').dragTo(inProgress.locator('.board-heading'));
  await expect(inProgress.getByRole('button', { name: title, exact: true })).toBeVisible();
  await page.getByLabel(`Change status of ${title}`).selectOption('done');
  await expect(
    page
      .locator('.board-column')
      .filter({ has: page.getByRole('heading', { name: 'Done', exact: true }) })
      .getByRole('button', { name: title, exact: true }),
  ).toBeVisible();
});
test('offline editing retains text and disables writes until reconnect', async ({
  page,
  context,
}) => {
  await page.goto(`/tasks/${pilot}`);
  await expect(
    page.getByRole('heading', { name: 'Prepare the pilot batch', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit task text', exact: true }).click();
  const draft = unique('Offline draft');
  await page.getByLabel('Task title', { exact: true }).fill(draft);
  await context.setOffline(true);
  await expect(
    page.getByText('You’re offline. Reconnect to save changes. Your open drafts are preserved.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator('.task-panel').getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue(draft);
  await context.setOffline(false);
  await expect(
    page.locator('.task-panel').getByRole('button', { name: 'Save', exact: true }),
  ).toBeEnabled();
  await page.locator('.task-panel').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Prepare the pilot batch', exact: true }),
  ).toBeVisible();
});
test('390px navigation and task creation work without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.locator('.project-row').filter({ hasText: 'Corpus' }).click();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const title = unique('Mobile task');
  const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  const panel = await page.locator('.task-panel').boundingBox();
  expect(panel!.width).toBe(390);
  const violations = (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  ).violations;
  expect(violations).toEqual([]);
});
test('keyboard creation from an archived project selects an editable project', async ({ page }) => {
  await page.goto('/my-tasks');
  await expect(page.getByRole('heading', { name: 'My Tasks', exact: true })).toBeVisible();
  const { data: session } = await (await page.request.get('/api/me')).json();
  const headers = { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() };
  const created = await page.request.post('/api/projects', {
    headers,
    data: { name: unique('Archived capture') },
  });
  const project = (await created.json()).data;
  await page.request.post(`/api/projects/${project.id}/archive`, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: { expected_version: project.version },
  });
  await page.goto(`/projects/${project.id}`);
  await expect(
    page.getByText('This project is archived. Restore it to make changes.', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Project', exact: true })).toHaveValue(corpus);
});
test('desktop project view passes automated accessibility checks', async ({ page }) => {
  await page.goto(`/projects/${corpus}`);
  await expect(page.getByRole('heading', { name: 'Corpus', exact: true })).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations).toEqual([]);
});
