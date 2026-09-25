import { test, expect } from '@playwright/test';

test('role searches persist filters, save privately, reopen and delete without touching People views', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const email = `role-search-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  expect((await page.request.post('/api/auth/signup', { data: { email, password: 'Role-search-fixture-2026', name: 'Role QA', workspaceName: 'Role QA', persona: 'bd', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } } })).ok()).toBeTruthy();
  expect((await page.request.post('/api/setup/complete', { data: { workspaceName: 'Role QA', userName: 'Role QA', userEmail: email, owners: [] } })).ok()).toBeTruthy();
  await page.goto('/app/#/jobs');
  const form = page.locator('#jobs-filter-form');
  await page.locator('[data-preset="canada"]').click();
  await form.locator('[name="q"]').fill('Recruiter');
  await form.locator('[name="workStyle"]').selectOption('remote');
  await form.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Search: Recruiter', exact: true })).toBeVisible();
  await page.reload();
  await expect(form.locator('[name="q"]')).toHaveValue('Recruiter');
  await expect(form.locator('[name="geography"]')).toHaveValue('canada');
  await page.getByRole('button', { name: 'Save search', exact: true }).click();
  const save = page.getByRole('dialog', { name: 'Save role search' });
  await save.getByRole('textbox').fill('Canada remote recruiting');
  await save.getByRole('button', { name: 'Save search', exact: true }).click();
  await expect(save).toHaveCount(0);
  expect((await (await page.request.get('/api/saved-work/view')).json()).total).toBe(0);
  expect((await (await page.request.get('/api/saved-work/view?viewType=jobs')).json()).total).toBe(1);
  await page.locator('[data-preset="all"]').click();
  await page.getByRole('button', { name: 'Saved searches', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Saved role searches' });
  await library.getByRole('button', { name: 'Apply view', exact: true }).click();
  await expect(form.locator('[name="q"]')).toHaveValue('Recruiter');
  await expect(form.locator('[name="workStyle"]')).toHaveValue('remote');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.locator('html').evaluate(el => el.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`role-search-${width}.png`) });
  }
  await page.getByRole('button', { name: 'Saved searches', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await library.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(library).toContainText('Nothing saved here yet.');
  expect(errors).toEqual([]);
});
