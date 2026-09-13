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
});

test('Warm Studio saves to the shared private draft library and the quick start reflects it', async ({ page }) => {
  const person = await workspace(page);
  await page.route('**/api/jobs?ids=saved-work-role', route => route.fulfill({ json: { items: [{ id: 'saved-work-role', title: 'Talent Manager', companyName: 'Example Co', contacts: [person] }] } }));
  await page.evaluate(id => window.openWarmStudioModal('saved-work-role', id), person.id);
  await page.locator('#warm-studio-textarea').fill('Jamie, could we discuss your Talent Manager search?');
  await page.getByRole('button', { name: 'Save to my account', exact: true }).click();
  await expect(page.locator('#warm-account-draft-status')).toContainText('Saved to your account');
  await page.getByRole('button', { name: 'My saved drafts', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'My saved drafts', exact: true })).toContainText('Jamie Recruiter · Talent Manager');
  const exported = await (await page.request.get('/api/privacy/export')).json();
  expect(exported.savedWork).toHaveLength(1);
  expect(exported.savedWork[0].body.text).toContain('Talent Manager search');
  await page.goto('/app/#/dashboard');
  await expect(page.locator('[data-first-value-checklist]')).toContainText('Draft saved to your account');
  await expect(page.locator('[data-first-value-checklist]')).toContainText('Saving is not sending');
});
