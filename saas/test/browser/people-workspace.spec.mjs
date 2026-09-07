import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function workspace(page, { count = 24, setup = true } = {}) {
  const email = `people-ux-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await page.request.post('/api/auth/signup', { data: { email, password: 'People-fixture-2026', name: 'Recruiter Fixture', workspaceName: 'People QA', persona: 'bd', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } } });
  expect(response.ok()).toBeTruthy();
  if (setup) expect((await page.request.post('/api/setup/complete', { data: { workspaceName: 'People QA', userName: 'Recruiter Fixture', userEmail: email, owners: [] } })).ok()).toBeTruthy();
  for (let i = 0; i < count; i++) {
    const created = await page.request.post('/api/contacts', { data: { fullName: `Person ${String(i).padStart(2, '0')}`, title: i % 2 ? 'Talent Partner' : 'Software Engineer', companyName: `Company ${i % 3}`, linkedinUrl: `https://www.linkedin.com/in/synthetic-${i}`, notes: i === 0 ? 'Imported notes' : '' } });
    expect(created.ok()).toBeTruthy();
  }
  await page.goto('/');
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect.poll(() => page.frames().some(f => f.url().includes('/app/'))).toBeTruthy();
  const frame = page.frames().find(f => f.url().includes('/app/'));
  return { app, frame };
}

test('person review preserves list context and saves one record without reloading bootstrap', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const { app, frame } = await workspace(page);
  await expect(app.locator('.people-table tbody tr')).toHaveCount(20);
  await app.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(app.locator('.people-pagination')).toContainText('21–24 of 24');
  await app.getByRole('link', { name: 'Person 20', exact: true }).click();
  await expect(app.locator('#person-heading')).toHaveText('Person 20');
  const contextHash = await frame.evaluate(() => location.hash);
  const requests = []; page.on('request', req => requests.push(req.url()));
  await app.getByLabel('Notes', { exact: true }).fill('Evidence reviewed\nAsk about interests.');
  await app.getByRole('button', { name: 'Save changes' }).click();
  await expect(app.locator('[data-person-feedback]')).toHaveText('Saved.');
  expect(requests.filter(url => url.includes('/api/bootstrap'))).toEqual([]);
  await app.getByRole('button', { name: 'Next person' }).click();
  await expect(app.locator('#person-heading')).toHaveText('Person 21');
  await app.getByRole('button', { name: '← Back to people' }).click();
  await expect(app.locator('.people-pagination')).toContainText('21–24 of 24');
  await frame.goto(`/app/${contextHash}`);
  await expect(app.getByLabel('Notes', { exact: true })).toHaveValue('Evidence reviewed\nAsk about interests.');
  await expect.poll(() => new URL(page.url()).hash).toBe(contextHash);
  await page.reload();
  await expect(app.locator('#person-heading')).toHaveText('Person 20');
  await expect(app.locator('.people-pagination')).toContainText('21–24 of 24');
  expect(errors).toEqual([]);
});

test('filtering, sorting, empty recovery and real-record comparison', async ({ page }) => {
  const { app } = await workspace(page, { count: 5 });
  await expect(app.locator('.person-name').first()).toHaveText('Person 00');
  await app.getByLabel('Sort people', { exact: true }).selectOption('name_desc');
  await expect(app.locator('.person-name').first()).toHaveText('Person 04');
  await app.locator('[data-people="select-person"]').nth(0).check();
  await app.locator('[data-people="select-person"]').nth(1).check();
  await app.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(app.getByRole('dialog', { name: 'Compare people' })).toContainText('Person 04');
  await expect(app.getByRole('dialog', { name: 'Compare people' })).toContainText('Not provided');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await app.getByRole('button', { name: 'Close dialog' }).press('Escape');
  await app.locator('#contacts-filter-form input[name="q"]').fill('no-such-person');
  await app.locator('#contacts-filter-form').getByRole('button', { name: 'Search people' }).click();
  await expect(app.getByRole('heading', { name: 'No people match these filters' })).toBeVisible();
  await app.locator('.people-empty').getByRole('button', { name: 'Clear filters' }).click();
  await expect(app.locator('.people-table tbody tr')).toHaveCount(5);
  await expect(app.locator('[data-people-selection]')).toBeHidden();
});

test('note saves preserve unrelated edits made elsewhere and reconcile returned fields', async ({ page }) => {
  const { app, frame } = await workspace(page, { count: 1 });
  await app.locator('.person-name').first().click();
  const id = await frame.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('person'));
  const changed = await page.request.patch(`/api/contacts/${id}`, { data: { title: 'Updated elsewhere', email: 'updated@example.com' } });
  expect(changed.ok()).toBeTruthy();
  const writes = [];
  page.on('request', request => { if (request.method() === 'PATCH' && request.url().includes(`/api/contacts/${id}`)) writes.push(request.postDataJSON()); });
  await app.getByLabel('Notes', { exact: true }).fill('My independent note');
  await app.getByRole('button', { name: 'Save changes' }).click();
  await expect(app.locator('[data-person-feedback]')).toHaveText('Saved.');
  expect(writes).toEqual([{ notes: 'My independent note' }]);
  await expect(app.locator('.person-current-role')).toHaveText('Updated elsewhere');
  await app.locator('.person-edit-fields summary').click();
  await expect(app.getByLabel('Email', { exact: true })).toHaveValue('updated@example.com');
  await app.getByRole('button', { name: 'Save changes' }).click();
  await expect(app.locator('[data-person-feedback]')).toHaveText('No changes to save.');
  expect(writes).toHaveLength(1);
  await app.getByLabel('Email', { exact: true }).fill('');
  await app.getByRole('button', { name: 'Save changes' }).click();
  await expect(app.locator('[data-person-feedback]')).toHaveText('Saved.');
  expect(writes[1]).toEqual({ email: '' });
});

test('a saved person cannot be replaced in the cache by a delayed pre-save response', async ({ page }) => {
  const { app, frame } = await workspace(page, { count: 1 });
  await expect(app.locator('.person-name')).toHaveCount(1);
  const path = '/api/contacts?pageSize=1&q=Person';
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const received = new Promise(resolve => { started = resolve; });
  await page.route(`**${path}`, async route => {
    const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
  });
  try {
    await frame.evaluate(path => { window.oldPeopleRead = window.bdLocalApi.api({}, path); }, path);
    await received;
    await app.locator('.person-name').click();
    await app.getByLabel('Notes', { exact: true }).fill('Saved after the old read started');
    await app.getByRole('button', { name: 'Save changes' }).click();
    await expect(app.locator('[data-person-feedback]')).toHaveText('Saved.');
    release();
    await frame.evaluate(() => window.oldPeopleRead);
    await page.unroute(`**${path}`);
    const notes = await frame.evaluate(async path => (await window.bdLocalApi.api({}, path)).items[0].notes, path);
    expect(notes).toBe('Saved after the old read started');
  } finally { release(); await page.unroute(`**${path}`); }
});

test('quick start and manual add work without companies; drafts do not send or change stage', async ({ page }) => {
  const { app, frame } = await workspace(page, { count: 0, setup: false });
  await app.getByRole('button', { name: 'Start with people' }).click();
  await expect(app.getByRole('heading', { name: 'Your people workspace starts here' })).toBeVisible();
  await app.getByRole('button', { name: 'Add your first person' }).click();
  await expect(app.getByLabel('Full name', { exact: true })).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await app.getByLabel('Full name', { exact: true }).fill('Alex Morgan');
  await app.getByLabel('Current role', { exact: true }).fill('Sourcing Specialist');
  await app.getByRole('dialog').getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(app.locator('#person-heading')).toHaveText('Alex Morgan');
  await app.locator('.person-edit-fields summary').click();
  await app.getByLabel('Full name', { exact: true }).fill('Jordan Morgan');
  await app.getByLabel('Email', { exact: true }).fill('jordan@example.com');
  await app.getByLabel('Profile URL', { exact: true }).fill('https://www.linkedin.com/in/synthetic-jordan');
  await app.getByRole('button', { name: 'Save changes' }).click();
  await expect(app.locator('[data-person-feedback]')).toHaveText('Saved.');
  await expect(app.locator('#person-heading')).toHaveText('Jordan Morgan');
  await expect(app.locator('[data-person-email]')).toHaveText('jordan@example.com');
  await expect(app.getByRole('link', { name: 'Open profile' })).toHaveAttribute('href', 'https://www.linkedin.com/in/synthetic-jordan');
  await app.getByRole('button', { name: 'Prepare outreach' }).click();
  await expect(app.getByLabel('Message', { exact: true })).toHaveValue(/^Hi Jordan,/);
  await app.getByRole('button', { name: 'Copy message' }).click();
  await expect(app.locator('[data-draft-feedback]')).toContainText('Replace the placeholders');
  await expect(app.getByLabel('Outreach stage', { exact: true }).last()).toHaveValue('not_started');
  const requests = []; page.on('request', request => { if (request.method() !== 'GET') requests.push(request.url()); });
  await app.getByLabel('Message', { exact: true }).fill('Hi Alex, would you be open to hearing about a sourcing role in Toronto?');
  await app.getByRole('button', { name: 'Copy message' }).click();
  expect(requests.filter(url => /outreach|contacts\//.test(url))).toEqual([]);
  page.once('dialog', dialog => dialog.dismiss());
  await app.getByRole('button', { name: '← Back to people' }).click();
  await expect(app.getByLabel('Message', { exact: true })).toHaveValue(/Hi Alex/);
  page.once('dialog', dialog => dialog.accept());
  await app.getByRole('button', { name: '← Back to people' }).click();
  expect(await frame.evaluate(() => location.hash)).not.toContain('person=');
});

test('load/save errors preserve work and can be retried', async ({ page }) => {
  const { app, frame } = await workspace(page, { count: 2 });
  await app.locator('.person-name').first().click();
  await app.getByLabel('Notes', { exact: true }).fill('Keep this unsaved note');
  await page.route('**/api/contacts/*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary fixture failure' }) }));
  await app.getByRole('button', { name: 'Save changes' }).click();
  await expect(app.locator('[data-person-feedback]')).toContainText('Your changes are still here');
  await expect(app.getByLabel('Notes', { exact: true })).toHaveValue('Keep this unsaved note');
  await page.unroute('**/api/contacts/*');
  await app.getByRole('button', { name: 'Save changes' }).click();
  await expect(app.locator('[data-person-feedback]')).toHaveText('Saved.');
  await page.route('**/api/contacts?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary fixture failure' }) }));
  await frame.goto('/app/#/contacts');
  await expect(app.getByRole('heading', { name: 'People couldn’t be loaded' })).toBeVisible();
  await expect(app.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.unroute('**/api/contacts?*');
  await app.getByRole('button', { name: 'Try again' }).click();
  await expect(app.locator('.people-table tbody tr')).toHaveCount(2);
});

test('failed searches never expose stale rows or editable details and recover in the same query', async ({ page }, testInfo) => {
  const { app, frame } = await workspace(page, { count: 2 });
  await app.locator('.person-name').first().click();
  await expect(app.getByLabel('Notes', { exact: true })).toBeVisible();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/contacts?*', async route => {
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary search failure' }) });
  });
  try {
    await app.locator('#people-search').fill('Person 01');
    await app.locator('#contacts-filter-form').getByRole('button', { name: 'Search people' }).click();
    await expect(app.getByRole('status')).toContainText('Loading people');
    await expect(app.locator('.person-edit-form')).toHaveCount(0);
    await expect(app.locator('.people-table')).toHaveCount(0);
    release();
    await expect(app.getByRole('heading', { name: 'People couldn’t be loaded' })).toBeVisible();
    await expect(app.locator('.people-pagination')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 900 });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('people-search-error-mobile.png') });
    expect(await frame.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('q'))).toBe('Person 01');
    await app.getByRole('button', { name: 'Try again' }).click();
    await expect(app.getByRole('heading', { name: 'People couldn’t be loaded' })).toBeVisible();
  } finally { release(); await page.unroute('**/api/contacts?*'); }
  await app.getByRole('button', { name: 'Try again' }).click();
  await expect(app.locator('.person-name')).toHaveText('Person 01');
  await expect(app.locator('#people-search')).toHaveValue('Person 01');
  await page.route('**/api/contacts?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Offline"}' }));
  await app.locator('#people-search').fill('missing');
  await app.locator('#contacts-filter-form').getByRole('button', { name: 'Search people' }).click();
  await expect(app.getByRole('heading', { name: 'People couldn’t be loaded' })).toBeVisible();
  await page.unroute('**/api/contacts?*');
  await app.getByRole('button', { name: 'Show all people' }).click();
  await expect(app.locator('.person-name')).toHaveCount(2);
  await expect(app.locator('#people-search')).toHaveValue('');
});

test('empty stale pagination returns to page one without losing the search', async ({ page }) => {
  const { app, frame } = await workspace(page, { count: 1 });
  await frame.evaluate(() => { location.hash = '#/contacts?q=missing&page=99'; });
  await expect(app.getByRole('heading', { name: 'No people match these filters' })).toBeVisible();
  await expect(app.locator('.people-pagination')).toContainText('Page 1 of 1');
  await expect(app.locator('#people-search')).toHaveValue('missing');
  expect(await frame.evaluate(() => location.hash)).not.toContain('page=');
});

test('adding protects entered details and keeps an in-flight save in its dialog', async ({ page }) => {
  const { app } = await workspace(page, { count: 1 });
  await app.getByRole('button', { name: 'Add person', exact: true }).click();
  const dialog = app.getByRole('dialog', { name: 'Add person' });
  await dialog.getByLabel('Full name').fill('Protected Person');
  page.once('dialog', prompt => prompt.dismiss());
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog.getByLabel('Full name')).toHaveValue('Protected Person');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let posts = 0;
  await page.route('**/api/contacts', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Please retry' }) });
  });
  try {
    await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
    await expect(dialog.getByLabel('Full name')).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.locator('[data-add-feedback]')).toContainText('Could not add person');
    await expect(dialog.getByLabel('Full name')).toHaveValue('Protected Person');
    await expect(dialog.getByLabel('Full name')).toBeEnabled();
    expect(posts).toBe(1);
  } finally { release(); await page.unroute('**/api/contacts'); }
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(app.locator('#person-heading')).toHaveText('Protected Person');
  await expect(app.getByRole('dialog')).toHaveCount(0);
});

test('confirmed discard restores saved notes and new result pages start at the top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const { app } = await workspace(page);
  await app.locator('.person-name').first().click();
  await app.getByLabel('Notes', { exact: true }).fill('Abandoned note');
  page.once('dialog', prompt => prompt.accept());
  await app.getByRole('button', { name: 'Add person', exact: true }).click();
  await app.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(app.getByLabel('Notes', { exact: true })).toHaveValue('Imported notes');
  await app.getByRole('button', { name: '← Back to people' }).click();
  const scroll = app.locator('.people-table-scroll');
  await scroll.evaluate(el => { el.scrollTop = 300; });
  await app.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(app.locator('.people-pagination')).toContainText('21–24 of 24');
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(0);
});

test('updating outreach stage prevents conflicting saves without losing notes', async ({ page }) => {
  const { app } = await workspace(page, { count: 1 });
  await app.locator('.person-name').first().click();
  await app.getByRole('button', { name: 'Prepare outreach' }).click();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/contacts/*', async route => { await gate; await route.continue(); });
  try {
    page.once('dialog', prompt => prompt.accept());
    await app.getByRole('button', { name: 'Mark as contacted' }).click();
    await expect(app.locator('#person-outreachStatus')).toBeDisabled();
    await expect(app.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await app.getByLabel('Notes', { exact: true }).fill('Keep typing while the stage saves');
    release();
    await expect(app.locator('[data-draft-feedback]')).toContainText('Stage updated to Contacted');
    await expect(app.locator('#person-outreachStatus')).toHaveValue('contacted');
    await expect(app.locator('#person-outreachStatus')).toBeEnabled();
    await expect(app.getByLabel('Notes', { exact: true })).toHaveValue('Keep typing while the stage saves');
  } finally { release(); await page.unroute('**/api/contacts/*'); }
  await app.getByRole('button', { name: 'Save changes' }).click();
  await expect(app.locator('[data-person-feedback]')).toHaveText('Saved.');
});

test('late supporting-view responses cannot replace the active follow-up workspace', async ({ page }) => {
  const { app, frame } = await workspace(page, { count: 1 });
  for (const [view, path] of [['dashboard', '/api/dashboard'], ['jobs', '/api/jobs'], ['accounts', '/api/accounts'], ['admin', '/api/admin/bootstrap']]) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let received;
  const started = new Promise(resolve => { received = resolve; });
  const pattern = `**${path}${view === 'dashboard' ? '' : '?*'}`;
  await page.route(pattern, async route => {
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await frame.evaluate(view => { window.bdLocalApi.invalidate(); location.hash = `#/${view}`; }, view);
    await started;
    await frame.evaluate(() => { location.hash = '#/tasks'; });
    await expect(app.locator('.task-create-disclosure')).toBeVisible();
    const painted = page.waitForResponse(response => new URL(response.url()).pathname === path);
    release();
    await painted;
    // Flush the response handler and a paint before checking the retained view.
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(app.locator('#view-title')).toHaveText('Follow-ups');
    await expect(app.locator('.task-create-disclosure')).toBeVisible();
  } finally { release(); await page.unroute(pattern); }
  }
});

test('people review is accessible and usable at desktop, tablet and phone widths', async ({ page }, testInfo) => {
  const { app, frame } = await workspace(page, { count: 3 });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width === 1024) expect((await app.locator('.topbar').boundingBox()).height).toBeLessThan(80);
    await app.locator('.person-name').first().click();
    await expect(app.locator('#person-heading')).toBeVisible();
    await app.locator('.person-edit-fields summary').click();
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`people-${width}.png`) });
    await app.getByRole('button', { name: '← Back to people' }).click();
    expect(await app.locator('.people-table tbody tr').first().evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(600);
  }
});
