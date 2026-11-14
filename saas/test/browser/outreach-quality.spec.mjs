import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function workspace(page) {
  const email = `outreach-quality-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  expect((await page.request.post('/api/auth/signup', { data: { email, password: 'Outreach-quality-fixture-2026', name: 'Derek', workspaceName: 'Outreach QA', persona: 'bd', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } } })).ok()).toBe(true);
  expect((await page.request.post('/api/setup/complete', { data: { workspaceName: 'Outreach QA', userName: 'Derek', userEmail: email, owners: [] } })).ok()).toBe(true);
  const company = await (await page.request.post('/api/accounts', { data: { displayName: 'Example Co' } })).json();
  const person = await (await page.request.post('/api/contacts', { data: { fullName: 'Jamie Chen', title: 'Talent Lead', companyName: company.displayName, accountId: company.id } })).json();
  await page.route(`**/api/accounts/${company.id}`, route => route.fulfill({ json: { account: company, jobs: [{ id: 'finance-lead', title: 'Finance Director', companyName: company.displayName, location: 'Toronto', active: true }] } }));
  await page.goto(`/app/#/contacts?person=${person.id}`);
  await expect(page.locator('#person-heading')).toHaveText(person.fullName);
  await expect(page.locator('[data-last-outreach]')).toContainText('No outreach recorded');
  return person;
}

test('People drafts retain the personal brief and one natural question across reloads', async ({ page }) => {
  const errors = []; const writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && /outreach|activity|ai-rewrite/.test(request.url())) writes.push(request.url()); });
  const person = await workspace(page);
  await page.evaluate(() => { window.outreachTimings = []; window.addEventListener('bd:people-timing', event => { if (event.detail.path.endsWith('generatePersonDraft')) window.outreachTimings.push(event.detail.elapsedMs); }); });
  await page.getByRole('button', { name: 'Prepare outreach', exact: true }).click();
  await page.getByLabel('Role to discuss').selectOption('finance-lead');
  await page.getByText('Add your context', { exact: true }).click();
  await page.getByLabel('Your relevant experience or offer').fill('I recruit finance leaders across Ontario.');
  await page.getByLabel('How you know them (optional)').fill('We met at the Toronto finance meetup.');
  await page.getByLabel('Question to end with (optional)').fill('Are you open to a specialist agency on this role?');
  await page.getByRole('button', { name: 'Generate draft', exact: true }).click();
  const draft = page.locator('#person-draft');
  await expect(draft).toHaveValue(/I saw the Finance Director opening at Example Co in Toronto/);
  await expect(draft).toHaveValue(/I recruit finance leaders across Ontario/);
  await expect(draft).toHaveValue(/We met at the Toronto finance meetup/);
  await expect(draft).not.toHaveValue(/caught my attention|especially the|If appropriate|market map/);
  expect(((await draft.inputValue()).match(/\?/g) || []).length).toBe(1);
  console.log('app/people-workspace.js::generatePersonDraft live timing:', await page.evaluate(() => window.outreachTimings));
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('[data-draft-feedback]')).toContainText('Saved to your account');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#person-heading')).toHaveText(person.fullName);
  await page.getByRole('button', { name: 'Prepare outreach', exact: true }).click();
  await page.getByText('Add your context', { exact: true }).click();
  await expect(page.getByLabel('How you know them (optional)')).toHaveValue('We met at the Toronto finance meetup.');
  await expect(page.getByLabel('Question to end with (optional)')).toHaveValue('Are you open to a specialist agency on this role?');
  const savedText = await draft.inputValue();
  await page.getByLabel('Question to end with (optional)').fill('Who would be best to speak with?');
  await expect(draft).toHaveValue(savedText);
  await page.getByRole('button', { name: 'Generate draft', exact: true }).click();
  await page.getByRole('dialog', { name: 'Replace this draft?', exact: true }).getByRole('button', { name: 'Close dialog' }).click();
  await expect(draft).toHaveValue(savedText);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('outreach-person-mobile.png'), fullPage: true });
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('account outreach uses the personal offer and question without a canned sales paragraph', async ({ page }) => {
  expect((await page.request.post('/api/demo/start', { data: {} })).ok()).toBe(true);
  const accounts = await (await page.request.get('/api/accounts')).json();
  const account = accounts.items[0];
  await page.goto(`/app/#/accounts/${account.id}`);
  await page.getByRole('button', { name: 'Compose outreach', exact: true }).click();
  await page.getByText('Make it sound like you', { exact: true }).click();
  await page.locator('#outreach-background').fill('I recruit finance leaders across Ontario.');
  await page.locator('#outreach-relationship').fill('We met at the Toronto meetup.');
  await page.locator('#outreach-ask').fill('Are you open to a specialist agency on this role?');
  await page.locator('#generate-outreach-button').click();
  const draft = page.locator('#outreach-email-body');
  await expect(draft).toHaveValue(/I recruit finance leaders across Ontario/);
  await expect(draft).toHaveValue(/We met at the Toronto meetup/);
  await expect(draft).toHaveValue(/Are you open to a specialist agency on this role\?/);
  await expect(draft).not.toHaveValue(/Given your role|I help teams|market map|competing for attention/);
  expect(((await draft.inputValue()).match(/\?/g) || []).length).toBe(1);
});

test('Warm Studio uses posting evidence and keeps the user question natural in professional tone', async ({ page }) => {
  const person = await workspace(page);
  await page.route('**/api/jobs?ids=quality-role', route => route.fulfill({ json: { items: [{ id: 'quality-role', title: 'Senior Data Engineer', companyName: 'Example Co', location: 'Toronto', description: 'Requirements: experience with Python and Spark.', contacts: [person] }] } }));
  await page.evaluate(id => window.openWarmStudioModal('quality-role', id), person.id);
  await page.locator('#warm-studio-background').fill('I recruit data engineers across Ontario.');
  await page.locator('#warm-studio-background').press('Tab');
  await page.locator('#warm-studio-ask').fill('Is your team open to a specialist agency on this role?');
  await page.locator('#warm-studio-ask').press('Tab');
  await page.locator('[data-tone="professional"]').click();
  const draft = page.locator('#warm-studio-textarea');
  await expect(draft).toHaveValue(/The posting mentions Python and Spark/);
  await expect(draft).toHaveValue(/Is your team open to a specialist agency on this role\?/);
  await expect(draft).not.toHaveValue(/If appropriate|caught my attention|hardest to find/);
  await page.locator('[data-format="linkedin_note"]').click();
  expect((await draft.inputValue()).length).toBeLessThanOrEqual(300);
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('outreach-warm-mobile.png'), fullPage: true });
});
