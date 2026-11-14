import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function workspace(page) {
  const email = `follow-up-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const signup = await page.request.post('/api/auth/signup', { data: { email, password: 'Follow-up-fixture-2026', name: 'Follow-up QA', workspaceName: 'Follow-up QA', persona: 'bd', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } } });
  expect(signup.ok()).toBe(true);
  expect((await page.request.post('/api/setup/complete', { data: { workspaceName: 'Follow-up QA', userName: 'Follow-up QA', userEmail: email, owners: [] } })).ok()).toBe(true);
  const response = await page.request.post('/api/tasks', { data: { summary: 'Existing follow-up', dueDate: '2027-01-01' } });
  expect(response.ok()).toBe(true);
  const task = await response.json();
  await page.goto('/app/#/tasks');
  await expect(page.locator('.tasks-content')).toContainText('Existing follow-up');
  return task;
}

test('unfinished new tasks survive searching, status changes and completion', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await workspace(page);
  await page.locator('.task-create-disclosure summary').click();
  const summary = page.locator('#task-create-form [name="summary"]');
  const dueDate = page.locator('#task-create-form [name="dueDate"]');
  await summary.fill('Keep my unfinished follow-up');
  await dueDate.fill('2027-03-14');
  await page.locator('#task-search-form [name="q"]').fill('no matching task');
  await page.getByRole('button', { name: 'Search tasks', exact: true }).click();
  await expect(page.locator('.tasks-content')).toContainText('No tasks match your search');
  await expect(summary).toBeVisible();
  await expect(summary).toHaveValue('Keep my unfinished follow-up');
  await expect(dueDate).toHaveValue('2027-03-14');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('tab', { name: 'Completed', exact: true }).click();
  await expect(summary).toHaveValue('Keep my unfinished follow-up');
  await page.getByRole('tab', { name: 'Pending', exact: true }).click();
  await page.getByRole('button', { name: 'Mark Done', exact: true }).click();
  await expect(page.locator('.tasks-content')).toContainText('No pending tasks');
  await expect(summary).toHaveValue('Keep my unfinished follow-up');
  await expect(dueDate).toHaveValue('2027-03-14');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.locator('.tasks-content')).toContainText('Keep my unfinished follow-up');
  await page.locator('.task-create-disclosure summary').click();
  await expect(summary).toHaveValue('');
  expect(errors).toEqual([]);
});

test('failed task reads offer retry with the same search and unfinished task', async ({ page }) => {
  await workspace(page);
  await page.locator('.task-create-disclosure summary').click();
  await page.locator('#task-create-form [name="summary"]').fill('Recover this input');
  let fail = true;
  const queries = [];
  await page.route('**/api/tasks?**', route => {
    queries.push(new URL(route.request().url()).searchParams.get('q'));
    return fail ? route.fulfill({ status: 503, json: { error: '<img src=x onerror=alert(1)> Try later' } }) : route.continue();
  });
  await page.locator('#task-search-form [name="q"]').fill('Existing');
  await page.getByRole('button', { name: 'Search tasks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Could not load follow-ups', exact: true })).toBeVisible();
  await expect(page.locator('#app [role="alert"]')).toContainText('Try later');
  await expect(page.locator('#app img')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.tasks-content')).toContainText('Existing follow-up');
  await expect(page.locator('#task-search-form [name="q"]')).toHaveValue('Existing');
  await expect(page.locator('#task-create-form [name="summary"]')).toHaveValue('Recover this input');
  expect(queries).toEqual(['Existing', 'Existing']);
});

test('a pending task save cannot be submitted twice or redirect a newer screen', async ({ page }) => {
  await workspace(page);
  await page.locator('.task-create-disclosure summary').click();
  await page.locator('#task-create-form [name="summary"]').fill('One new follow-up');
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  let writes = 0;
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    writes += 1;
    await pending;
    return route.continue();
  });
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await page.getByRole('button', { name: 'Search tasks', exact: true }).click();
  await expect(page.locator('#task-create-form [name="summary"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /Adding task|Add task/, exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'People', exact: true }).click();
  await expect(page.locator('.people-workspace')).toBeVisible();
  finish();
  await expect(page.locator('.toast')).toContainText('Task added');
  await expect(page).toHaveURL(/#\/contacts/);
  await expect(page.locator('.people-workspace')).toBeVisible();
  expect(writes).toBe(1);
});

test('due-date edits require discard confirmation and preserve input after a failed save', async ({ page }) => {
  await workspace(page);
  await page.getByRole('button', { name: 'Edit follow-up', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit follow-up', exact: true });
  await dialog.getByLabel('New due date').fill('2027-06-09');
  const dismissed = page.waitForEvent('dialog').then(async prompt => { expect(prompt.message()).toContain('Discard unsaved'); await prompt.dismiss(); });
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await dismissed;
  await expect(dialog.getByLabel('New due date')).toHaveValue('2027-06-09');
  await page.route('**/api/tasks/*', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { error: 'Storage unavailable. Try again.' } }) : route.continue());
  await dialog.getByRole('button', { name: 'Save date', exact: true }).click();
  await expect(dialog.locator('[data-feedback]')).toContainText('Storage unavailable');
  await expect(dialog.getByLabel('New due date')).toHaveValue('2027-06-09');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  const accepted = page.waitForEvent('dialog').then(prompt => prompt.accept());
  await dialog.press('Escape');
  await accepted;
  await expect(dialog).toHaveCount(0);
});

test('failed creation keeps input through another search and allows a deliberate retry', async ({ page }) => {
  await workspace(page);
  await page.locator('.task-create-disclosure summary').click();
  await page.locator('#task-create-form [name="summary"]').fill('Retry this follow-up');
  await page.locator('#task-create-form [name="dueDate"]').fill('2027-07-17');
  let fail = true;
  await page.route('**/api/tasks', route => fail && route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: 'Storage temporarily unavailable' } }) : route.continue());
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.locator('[data-task-feedback]')).toContainText('Storage temporarily unavailable');
  await page.getByRole('button', { name: 'Search tasks', exact: true }).click();
  await expect(page.locator('#task-create-form [name="summary"]')).toHaveValue('Retry this follow-up');
  await expect(page.locator('#task-create-form [name="dueDate"]')).toHaveValue('2027-07-17');
  await expect(page.locator('[data-task-feedback]')).toContainText('Storage temporarily unavailable');
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toBeEnabled();
  fail = false;
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.locator('.tasks-content')).toContainText('Retry this follow-up');
  expect((await (await page.request.get('/api/tasks?q=Retry')).json()).total).toBe(1);
});

test('person-specific drafts stay separate and a late save cannot reset another person', async ({ page }) => {
  await workspace(page);
  const people = [];
  for (const fullName of ['First person', 'Second person']) {
    const response = await page.request.post('/api/contacts', { data: { fullName } });
    expect(response.ok()).toBe(true);
    people.push(await response.json());
  }
  const openPerson = async person => {
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tasks' && new URL(response.url()).searchParams.get('contactId') === person.id);
    await page.evaluate(id => { location.hash = `#/tasks?contactId=${id}`; }, person.id);
    await loaded;
    await expect(page.locator('.tasks-view')).toContainText('Showing follow-ups for one person');
    await expect(page.locator('.tasks-content')).toBeVisible();
  };
  await openPerson(people[0]);
  await page.locator('.task-create-disclosure summary').click();
  await page.locator('#task-create-form [name="summary"]').fill('First person draft');
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await pending;
    return route.continue();
  });
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.locator('#task-create-form')).toHaveAttribute('aria-busy', 'true');
  await openPerson(people[1]);
  await page.locator('.task-create-disclosure summary').click();
  await expect(page.locator('#task-create-form [name="summary"]')).toHaveValue('');
  await page.locator('#task-create-form [name="summary"]').fill('Second person draft');
  finish();
  await expect(page.locator('.toast')).toContainText('Follow-up added for this person');
  await expect(page).toHaveURL(new RegExp(`contactId=${people[1].id}$`));
  await expect(page.locator('#task-create-form [name="summary"]')).toHaveValue('Second person draft');
  expect((await (await page.request.get(`/api/tasks?contactId=${people[0].id}`)).json()).total).toBe(1);
  expect((await (await page.request.get(`/api/tasks?contactId=${people[1].id}`)).json()).total).toBe(0);
  await page.getByRole('link', { name: 'Show everyone', exact: true }).click();
  await expect(page.locator('.tasks-content')).toContainText('First person draft');
  await openPerson(people[1]);
  await expect(page.locator('#task-create-form [name="summary"]')).toHaveValue('Second person draft');
});

test('follow-up render timing uses the live list path with 50 tasks', async ({ page }) => {
  await workspace(page);
  const tasks = Array.from({ length: 50 }, (_, i) => ({ id: `timing-${i}`, summary: `Timing follow-up ${i}`, status: 'pending', dueDate: '2027-01-01' }));
  await page.route('**/api/tasks?**', route => route.fulfill({ json: { items: tasks, total: 50, page: 1, pageSize: 50 } }));
  const timings = await page.evaluate(async () => {
    performance.clearMeasures('bd:follow-ups:render');
    for (let i = 0; i < 7; i++) {
      window.bdLocalApi.invalidate();
      await window.renderTasksView();
    }
    return performance.getEntriesByName('bd:follow-ups:render').map(entry => entry.duration);
  });
  expect(timings).toHaveLength(7);
  console.log(`Follow-ups render (50 tasks, seven local runs): ${timings.map(ms => ms.toFixed(1)).join(', ')} ms; median ${[...timings].sort((a, b) => a - b)[3].toFixed(1)} ms`);
});
