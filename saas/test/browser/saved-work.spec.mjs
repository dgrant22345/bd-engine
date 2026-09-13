import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function workspace(page) {
  const email = `saved-work-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await page.request.post('/api/auth/signup', { data: { email, password: 'Saved-work-fixture-2026', name: 'Saved Work QA', workspaceName: 'Saved Work QA', persona: 'bd', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } } });
  expect(response.ok()).toBeTruthy();
  expect((await page.request.post('/api/setup/complete', { data: { workspaceName: 'Saved Work QA', userName: 'Saved Work QA', userEmail: email, owners: [] } })).ok()).toBeTruthy();
  const person = await (await page.request.post('/api/contacts', { data: { fullName: 'Jamie Recruiter', title: 'Talent Lead', companyName: 'Example Co' } })).json();
  await page.goto(`/app/#/contacts?person=${person.id}`);
  await expect(page.locator('#person-heading')).toHaveText(person.fullName);
  return person;
}

test('unfinished person follow-ups survive canceled navigation, note saves and failed submission', async ({ page }) => {
  await workspace(page);
  await page.request.post('/api/contacts', { data: { fullName: 'Robin Second', companyName: 'Example Co' } });
  await page.reload();
  await page.getByText('Follow-ups and activity', { exact: true }).click();
  await page.getByLabel('Next step', { exact: true }).fill('Ask about timing next week');
  await page.getByLabel('Due date', { exact: true }).fill('2027-05-01');
  await page.getByLabel('Notes', { exact: true }).fill('A saved note must not discard the task');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('[data-person-feedback]')).toHaveText('Saved.');
  page.once('dialog', dialog => { expect(dialog.message()).toContain('unfinished follow-up'); dialog.dismiss(); });
  await page.getByRole('button', { name: 'Next person', exact: true }).click();
  await expect(page.locator('#person-heading')).toHaveText('Jamie Recruiter');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: 'Follow-ups', exact: true }).click();
  await expect(page.getByLabel('Next step', { exact: true })).toHaveValue('Ask about timing next week');
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/tasks', async route => { await gate; await route.fulfill({ status: 503, json: { error: 'Temporary save failure' } }); });
  try {
    await page.getByRole('button', { name: 'Add follow-up', exact: true }).click();
    await expect(page.getByLabel('Next step', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Due date', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Next person', exact: true }).click();
    await expect(page.locator('#person-heading')).toHaveText('Jamie Recruiter');
    release();
    await expect(page.locator('[data-task-feedback]')).toContainText('Temporary save failure');
    await expect(page.getByLabel('Next step', { exact: true })).toHaveValue('Ask about timing next week');
  } finally { release(); await page.unroute('**/api/tasks'); }
  await page.getByRole('button', { name: 'Add follow-up', exact: true }).click();
  await expect(page.locator('[data-task-feedback]')).toContainText('Follow-up saved');
  await page.getByRole('button', { name: 'Next person', exact: true }).click();
  await expect(page.locator('#person-heading')).toHaveText('Robin Second');
  await page.getByText('Follow-ups and activity', { exact: true }).click();
  await page.getByLabel('Due date', { exact: true }).fill('2027-05-02');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Previous person', exact: true }).click();
  await expect(page.locator('#person-heading')).toHaveText('Jamie Recruiter');
  await page.getByText('Follow-ups and activity', { exact: true }).click();
  await expect(page.getByLabel('Due date', { exact: true })).toHaveValue('');
});

for (const kind of ['draft', 'view']) test(`failed ${kind} searches retire old actions and retry the same query`, async ({ page }) => {
  await workspace(page);
  for (const title of ['Alpha', 'Beta']) {
    expect((await page.request.put(`/api/saved-work/${kind}/${title}`, { data: { title, body: kind === 'draft' ? { text: `${title} message` } : { q: title }, version: 0 } })).ok()).toBe(true);
  }
  await page.getByRole('button', { name: kind === 'draft' ? 'My drafts' : 'My views', exact: true }).click();
  const library = page.getByRole('dialog', { name: kind === 'draft' ? 'My saved drafts' : 'My saved People views', exact: true });
  await expect(library.locator('[data-items]')).toContainText('Alpha');
  await page.route(`**/api/saved-work/${kind}?**`, route => route.fulfill({ status: 503, json: { error: 'Search temporarily unavailable' } }));
  await library.locator('[name="q"]').fill('Beta');
  await library.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(library.getByRole('alert')).toContainText('Your saved items are unchanged');
  await expect(library.locator('[data-items] button')).toHaveCount(0);
  await expect(library.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await expect(library.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
  await page.unroute(`**/api/saved-work/${kind}?**`);
  await library.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(library.locator('[data-items]')).toContainText('Beta');
  await expect(library.locator('[data-items]')).not.toContainText('Alpha');
  await expect(library.locator('[name="q"]')).toHaveValue('Beta');
  await expect(library.getByRole('button', { name: 'Try again', exact: true })).toBeHidden();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/saved-work/${kind}?**`, async route => {
    if (new URL(route.request().url()).searchParams.get('q') !== 'Alpha') return route.continue();
    await gate;
    await route.fulfill({ status: 503, json: { error: 'Late failure from an older search' } });
  });
  try {
    await library.locator('[name="q"]').fill('Alpha');
    await library.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(library.locator('[data-items] button')).toHaveCount(0);
    await library.locator('[name="q"]').fill('Beta');
    await library.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(library.locator('[data-items]')).toContainText('Beta');
    const response = page.waitForResponse(r => r.url().includes(`/api/saved-work/${kind}?`) && new URL(r.url()).searchParams.get('q') === 'Alpha');
    release(); await response;
    await expect(library.locator('[data-items]')).toContainText('Beta');
    await expect(library.getByRole('alert')).toHaveCount(0);
  } finally { release(); await page.unroute(`**/api/saved-work/${kind}?**`); }
});

test('activity filters, pagination and disclosure survive task changes without crossing person scopes', async ({ page }) => {
  const person = await workspace(page);
  for (let index = 0; index < 26; index++) await page.request.post('/api/activity', { data: { type: 'note', contactId: person.id, summary: `Preserve note ${index}` } });
  for (const summary of ['First follow-up', 'Second follow-up']) await page.request.post('/api/tasks', { data: { contactId: person.id, summary } });
  await page.evaluate(id => { location.hash = `#/tasks?contactId=${id}`; }, person.id);
  await page.locator('#activity-history summary').first().click();
  const form = page.locator('#activity-history-form');
  await form.locator('[name="q"]').fill('Preserve');
  await form.locator('[name="type"]').selectOption('note');
  await form.locator('[name="sort"]').selectOption('oldest');
  await form.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.locator('#activity-history-results')).toContainText('26 activities');
  await page.locator('#activity-history-results').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('#activity-history-results')).toContainText('Page 2');
  const preserved = async () => {
    await expect(page.locator('#activity-history')).toHaveAttribute('open', '');
    await expect(form.locator('[name="q"]')).toHaveValue('Preserve');
    await expect(form.locator('[name="type"]')).toHaveValue('note');
    await expect(form.locator('[name="sort"]')).toHaveValue('oldest');
    await expect(page.locator('#activity-history-results')).toContainText('Page 2');
  };
  await page.getByRole('button', { name: 'Mark Done', exact: true }).first().click();
  await preserved();
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await page.getByLabel('New due date').fill('2027-05-01');
  await page.getByRole('button', { name: 'Save date', exact: true }).click();
  await preserved();
  await page.getByRole('tab', { name: 'Completed', exact: true }).click();
  await page.getByRole('button', { name: 'Undo completion', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen task', exact: true }).click();
  await preserved();
  // Preserve in-progress filter text without applying it implicitly on a task refresh.
  await form.locator('[name="q"]').fill('Not applied yet');
  await page.getByRole('tab', { name: 'Pending', exact: true }).click();
  await expect(form.locator('[name="q"]')).toHaveValue('Not applied yet');
  await expect(page.locator('#activity-history-results')).toContainText('Page 2');
  await page.getByRole('link', { name: 'Show everyone', exact: true }).click();
  await expect(page.locator('#activity-history')).not.toHaveAttribute('open', '');
  await expect(form.locator('[name="q"]')).toHaveValue('');
});

test('person activity expands the exact sent message safely at each viewport', async ({ page }) => {
  const person = await workspace(page);
  const text = `Hello Jamie,\n\nThe details are below.\n<img src=x onerror="alert('unsafe')">\n${'long-word-'.repeat(40)}`;
  expect((await page.request.post(`/api/contacts/${person.id}/outreach`, { data: { text, confirmed: true, requestId: 'inline-history-browser-test' } })).ok()).toBe(true);
  await page.reload();
  await page.getByText('Follow-ups and activity', { exact: true }).click();
  await page.getByText('Read sent message', { exact: true }).click();
  await expect(page.locator('.person-activity-text')).toHaveText(text);
  await expect(page.locator('.person-activity-text img')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator('.person-activity').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/person-history-${width}.png` });
  }
  await expect(page.locator('#person-heading')).toHaveText('Jamie Recruiter');
});

test('person queue clears unrelated filters, links new tasks, reschedules and undoes completion', async ({ page }) => {
  const person = await workspace(page);
  await page.evaluate(() => { location.hash = '#/tasks'; });
  await page.locator('#task-search-form input').fill('Unrelated search');
  await page.getByRole('button', { name: 'Search tasks', exact: true }).click();
  await page.getByRole('tab', { name: 'Completed', exact: true }).click();
  await page.evaluate(id => { location.hash = `#/tasks?contactId=${id}`; }, person.id);
  await expect(page.locator('#task-search-form input')).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'Pending', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.locator('.task-create-disclosure summary').click();
  await page.getByLabel('What needs to happen?').fill('New task inside person queue');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.locator('.task-item')).toContainText('Jamie Recruiter');
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const schedule = page.getByRole('dialog', { name: 'Reschedule follow-up', exact: true });
  await schedule.getByLabel('New due date').fill('2027-04-10');
  await schedule.getByRole('button', { name: 'Save date', exact: true }).click();
  await expect(schedule).toHaveCount(0);
  expect((await (await page.request.get(`/api/tasks?contactId=${person.id}`)).json()).items[0].dueDate).toBe('2027-04-10T00:00:00.000Z');
  await page.getByRole('button', { name: 'Mark Done', exact: true }).click();
  await expect(page.locator('.tasks-content')).toContainText('No pending tasks');
  await page.getByRole('tab', { name: 'Completed', exact: true }).click();
  await page.getByRole('button', { name: 'Undo completion', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen task', exact: true }).click();
  await page.getByRole('tab', { name: 'Pending', exact: true }).click();
  await expect(page.locator('.task-item')).toContainText('New task inside person queue');
  await page.locator('#activity-history summary').click();
  await page.getByRole('combobox', { name: 'Activity type', exact: true }).selectOption('task_reopened');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.locator('#activity-history-results')).toContainText('Reopened task');
});

test('confirmed People outreach records the sent message and optional person follow-up', async ({ page }) => {
  const person = await workspace(page);
  await page.getByRole('button', { name: 'Prepare outreach', exact: true }).click();
  await page.locator('#person-draft').fill('Jamie, I sent this relevant message on LinkedIn.');
  await page.getByRole('button', { name: 'Mark as contacted', exact: true }).click();
  const log = page.getByRole('dialog', { name: 'Log sent outreach', exact: true });
  await log.getByLabel('Schedule follow-up').selectOption('3');
  await log.getByLabel('I already sent this message outside the app').check();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/log-outreach-${width}.png` });
  }
  await log.getByRole('button', { name: 'Record outreach', exact: true }).click();
  await expect(log).toHaveCount(0);
  await expect(page.locator('#person-outreachStatus')).toHaveValue('contacted');
  const activity = await (await page.request.get(`/api/activity?contactId=${person.id}`)).json();
  expect(activity.total).toBe(1); expect(activity.items[0].notes).toContain('sent this relevant message');
  const tasks = await (await page.request.get(`/api/tasks?contactId=${person.id}`)).json();
  expect(tasks.total).toBe(1); expect(tasks.items[0].contactId).toBe(person.id);
});

test('People drafts persist on another device and appear in the draft library', async ({ page, browser }) => {
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  const person = await workspace(page);
  await page.getByRole('button', { name: 'Prepare outreach', exact: true }).click();
  await page.locator('#person-draft').fill('Hi Jamie, would a discussion about the Talent Lead opening be useful?');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('[data-draft-feedback]')).toContainText('Saved to your account');
  await expect(page.getByLabel('Outreach stage', { exact: true }).last()).toHaveValue('not_started');
  const device = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const second = await device.newPage();
    await second.goto(new URL(`/app/#/contacts?person=${person.id}`, page.url()).href);
    await second.getByRole('button', { name: 'Prepare outreach', exact: true }).click();
    await expect(second.locator('#person-draft')).toHaveValue('Hi Jamie, would a discussion about the Talent Lead opening be useful?');
  } finally { await device.close(); }
  await page.getByRole('button', { name: 'My drafts', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'My saved drafts', exact: true });
  await expect(library).toContainText('Outreach to Jamie Recruiter');
  await library.getByRole('button', { name: 'Open draft' }).click();
  const editor = page.getByRole('dialog', { name: 'Outreach to Jamie Recruiter', exact: true });
  await expect(editor.getByLabel('Message')).toHaveValue(/Hi Jamie/);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/saved-draft-${width}.png` });
  }
  expect(errors).toEqual([]);
});

test('person follow-up links back to the profile and records completed activity', async ({ page }) => {
  const person = await workspace(page);
  await page.getByText('Follow-ups and activity', { exact: true }).click();
  await page.getByLabel('Next step', { exact: true }).fill('Ask Jamie about hiring timing');
  await page.getByLabel('Due date', { exact: true }).fill('2027-01-01');
  await page.getByRole('button', { name: 'Add follow-up', exact: true }).click();
  await expect(page.locator('[data-task-feedback]')).toContainText('Follow-up saved');
  await page.getByRole('link', { name: 'Open this person’s follow-ups' }).click();
  await expect(page.locator('.tasks-content')).toContainText('Ask Jamie');
  await expect(page.getByRole('link', { name: 'Open person', exact: true })).toHaveAttribute('href', `#/contacts?person=${person.id}`);
  await page.getByRole('button', { name: 'Mark Done', exact: true }).click();
  await expect(page.locator('.tasks-content')).toContainText('No pending tasks');
  await page.goto(`/app/#/contacts?person=${person.id}`);
  await page.getByText('Follow-ups and activity', { exact: true }).click();
  await expect(page.locator('[data-person-work]')).toContainText('Completed task: Ask Jamie');
});

test('named People views survive reload and reapply filters', async ({ page }) => {
  await workspace(page);
  await page.locator('#people-search').fill('Jamie');
  await page.getByRole('button', { name: 'Search people', exact: true }).click();
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  const save = page.getByRole('dialog', { name: 'Save People view', exact: true });
  await save.getByLabel('View name').fill('Hiring leads');
  await save.getByRole('button', { name: 'Save view', exact: true }).click();
  await expect(save).toHaveCount(0);
  await page.goto('/app/#/contacts');
  await page.getByRole('button', { name: 'My views', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'My saved People views', exact: true });
  await expect(library).toContainText('Hiring leads');
  await library.getByRole('button', { name: 'Apply view', exact: true }).click();
  await expect(page.locator('#people-search')).toHaveValue('Jamie');
});

test('stale library edits show a conflict without losing the current text', async ({ page }) => {
  const person = await workspace(page);
  const url = `/api/saved-work/draft/person-${person.id}`;
  const first = await (await page.request.put(url, { data: { title: 'Conflict test', body: { text: 'Original text', contactId: person.id }, version: 0 } })).json();
  await page.getByRole('button', { name: 'My drafts', exact: true }).click();
  await page.getByRole('button', { name: 'Open draft', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Conflict test', exact: true });
  await editor.getByLabel('Message').fill('My unsaved edits');
  expect((await page.request.put(url, { data: { ...first, body: { text: 'Other device saved' } } })).ok()).toBe(true);
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toContainText('changed on another device');
  await expect(editor.getByLabel('Message')).toHaveValue('My unsaved edits');
  const conflict = page.getByRole('dialog', { name: 'Resolve draft conflict', exact: true });
  await conflict.getByRole('button', { name: 'Save as a separate draft' }).click();
  await expect(conflict).toContainText('Separate draft saved');
  const copies = await (await page.request.get('/api/saved-work/draft')).json();
  expect(copies.items.find(item => item.title === 'Conflict test (copy)').body.text).toBe('My unsaved edits');
  page.once('dialog', dialog => dialog.accept());
  await conflict.getByRole('button', { name: 'Load latest', exact: true }).click();
  await expect(editor.getByLabel('Message')).toHaveValue('Other device saved');
});

test('Warm Studio saves to the shared private draft library and the quick start reflects it', async ({ page }) => {
  const person = await workspace(page);
  await page.route('**/api/jobs?ids=saved-work-role', route => route.fulfill({ json: { items: [{ id: 'saved-work-role', title: 'Talent Manager', companyName: 'Example Co', contacts: [person] }] } }));
  await page.evaluate(id => window.openWarmStudioModal('saved-work-role', id), person.id);
  await page.locator('#warm-studio-textarea').fill('Jamie, could we discuss your Talent Manager search?');
  await page.getByRole('button', { name: 'Save to my account', exact: true }).click();
  await expect(page.locator('#warm-account-draft-status')).toContainText('Saved to your account');
  await page.locator('#warm-studio-textarea').fill('Temporary unsaved replacement');
  await page.getByRole('button', { name: 'Resume saved draft', exact: true }).click();
  await page.getByRole('button', { name: 'Load saved draft', exact: true }).click();
  await expect(page.locator('#warm-studio-textarea')).toHaveValue('Jamie, could we discuss your Talent Manager search?');
  await page.getByRole('button', { name: 'My saved drafts', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'My saved drafts', exact: true })).toContainText('Jamie Recruiter · Talent Manager');
  const exported = await (await page.request.get('/api/privacy/export')).json();
  expect(exported.savedWork).toHaveLength(1);
  expect(exported.savedWork[0].body.text).toContain('Talent Manager search');
  await page.goto('/app/#/dashboard');
  await expect(page.locator('[data-first-value-checklist]')).toContainText('Draft saved to your account');
  await expect(page.locator('[data-first-value-checklist]')).toContainText('Saving is not sending');
});
