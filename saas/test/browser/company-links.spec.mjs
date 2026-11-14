import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function workspace(page) {
  const email = `company-links-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  expect((await page.request.post('/api/auth/signup', { data: { email, password: 'Company-links-fixture-2026', name: 'Company QA', workspaceName: 'Company QA', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } } })).ok()).toBe(true);
  expect((await page.request.post('/api/setup/complete', { data: { workspaceName: 'Company QA', userName: 'Company QA', userEmail: email, owners: [] } })).ok()).toBe(true);
  const company = await (await page.request.post('/api/accounts', { data: { displayName: 'Example Co', domain: 'example.com' } })).json();
  return company;
}

async function reloadSavedPerson(page) {
  // Check that saving cleared the leave-page guard and that a new document
  // really finished loading before inspecting the persisted person.
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  const previousDocument = await page.evaluate(() => performance.timeOrigin);
  await page.reload({ waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(previous => {
    const navigation = performance.getEntriesByType('navigation')[0];
    return document.readyState === 'complete' && performance.timeOrigin > previous && navigation?.domContentLoadedEventEnd > 0;
  }, previousDocument)).toBe(true);
}

test('onboarding opens the person form directly and a unique company name links on save', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  const company = await workspace(page);
  await page.goto('/app/#/dashboard');
  const checklist = page.locator('[data-first-value-checklist]');
  await expect(checklist.locator('[aria-current="step"]')).toHaveAttribute('data-first-value-step', 'board');
  await checklist.getByRole('link', { name: 'Add a person' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add person', exact: true });
  await dialog.getByLabel('Full name', { exact: true }).fill('Jamie Linked');
  await dialog.getByLabel('Company', { exact: true }).fill(' example co ');
  await expect(dialog.getByLabel('Company link', { exact: true })).toHaveValue('@match');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/company-link-add-${width}.png` });
  }
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-person-company] a')).toHaveAttribute('href', `#/accounts/${company.id}`);
  const person = (await (await page.request.get('/api/contacts?q=Jamie')).json()).items[0];
  expect(person.accountId).toBe(company.id); expect(person.companyName).toBe('Example Co');
  await reloadSavedPerson(page);
  await expect(page.locator('#person-heading')).toHaveText('Jamie Linked');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('company correction preserves the draft, reloads roles, and survives lookup failures without guessing', async ({ page }) => {
  const company = await workspace(page);
  const person = await (await page.request.post('/api/contacts', { data: { fullName: 'Jamie Unlinked', companyName: 'An older employer', accountId: '' } })).json();
  await page.goto(`/app/#/contacts?person=${person.id}`);
  await page.getByRole('button', { name: 'Prepare outreach', exact: true }).click();
  await page.locator('#person-draft').fill('A draft I am still editing');
  await page.getByText('Correct contact details', { exact: true }).click();
  await page.getByLabel('Company', { exact: true }).fill('Example');
  await page.route('**/api/accounts?**', route => route.fulfill({ status: 503, json: { error: 'Test lookup interruption' } }));
  await page.getByRole('button', { name: 'Find saved company' }).click();
  await expect(page.locator('[data-company-feedback]')).toContainText('Your details are unchanged');
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('Example');
  await page.unroute('**/api/accounts?**');
  await page.getByRole('button', { name: 'Find saved company' }).click();
  await expect(page.locator('[data-company-feedback]')).toContainText('1 saved company found');
  await page.getByLabel('Company link').selectOption(company.id);
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('Example Co');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('[data-person-feedback]')).toHaveText('Saved.');
  await expect(page.locator('[data-person-company] a')).toHaveAttribute('href', `#/accounts/${company.id}`);
  await expect(page.locator('#person-draft')).toHaveValue('A draft I am still editing');
  await expect(page.locator('[data-role-feedback]')).toContainText('review it before using it');
  await page.route(`**/api/accounts/${company.id}`, route => route.fulfill({ json: { account: company, jobs: [{ id: 'current-role', title: 'Talent Lead', active: true }] } }));
  await page.getByRole('button', { name: 'Load company openings' }).click();
  await expect(page.getByLabel('Role to discuss')).toContainText('Talent Lead');
  await expect(page.locator('#person-draft')).toHaveValue('A draft I am still editing');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('[data-company-fields]').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/company-link-edit-${width}.png` });
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCSS('background-color', 'rgb(128, 212, 197)');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/company-link-edit-dark.png' });
});

test('ambiguous company names require an explicit choice and can be kept unlinked', async ({ page }) => {
  const first = await workspace(page);
  const second = await (await page.request.post('/api/accounts', { data: { displayName: first.displayName, domain: 'another-example.com' } })).json();
  expect(second.id).not.toBe(first.id);
  await page.goto('/app/#/contacts?add=1');
  const dialog = page.getByRole('dialog', { name: 'Add person', exact: true });
  await dialog.getByLabel('Full name', { exact: true }).fill('Ambiguous Employer');
  await dialog.getByLabel('Company', { exact: true }).fill(first.displayName);
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(dialog.locator('[data-add-feedback]')).toContainText('More than one saved company');
  await expect(dialog.getByLabel('Full name', { exact: true })).toHaveValue('Ambiguous Employer');
  expect((await (await page.request.get('/api/contacts')).json()).total).toBe(0);
  await dialog.getByRole('button', { name: 'Find saved company' }).click();
  await expect(dialog.locator('[data-company-feedback]')).toContainText('2 saved companies found');
  await dialog.getByLabel('Company link').selectOption(second.id);
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(page.locator('[data-person-company] a')).toHaveAttribute('href', `#/accounts/${second.id}`);
  await page.getByText('Correct contact details', { exact: true }).click();
  await page.getByLabel('Company link').selectOption('');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('[data-person-company]')).toHaveText(first.displayName);
  await expect(page.locator('[data-person-company] a')).toHaveCount(0);
  await reloadSavedPerson(page);
  await expect(page.locator('#person-heading')).toHaveText('Ambiguous Employer');
  await expect(page.locator('[data-person-company] a')).toHaveCount(0);
  const person = (await (await page.request.get('/api/contacts')).json()).items[0];
  expect(person.accountId).toBe(''); expect(person.companyName).toBe(first.displayName);
});
