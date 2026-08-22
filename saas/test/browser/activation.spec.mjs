import { test as base, expect } from '@playwright/test';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await use(page);
    expect(errors, 'uncaught page errors during activation').toEqual([]);
  },
});

let signupCounter = 0;

async function submitSignup(page, prefix) {
  signupCounter += 1;
  const email = `${prefix}-${Date.now()}-${signupCounter}@example.com`;
  await page.locator('#signup-name').fill('Activation Tester');
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('activation-password-1');
  await page.locator('#signup-workspace').fill('Activation Workspace');
  await page.locator('#signup-legal-consent').check();
  await page.locator('#signup-form button[type="submit"]').click();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  return { email, app: page.frameLocator('iframe.cloud-app-frame') };
}

async function continueProfile(app) {
  const profile = app.locator('#setup-profile-form');
  await expect(profile).toBeVisible({ timeout: 15000 });
  await expect(profile.locator('#setup-workspace-name')).toHaveValue('Activation Workspace');
  await profile.locator('button[type="submit"]').click();
}

async function finishSetup(app) {
  await app.locator('[data-action="setup-skip-import"]').click({ timeout: 10000 });
  await expect(app.locator('[data-action="setup-open-dashboard"]')).toBeVisible({ timeout: 15000 });
}

async function openDashboard(app) {
  await app.locator('[data-action="setup-open-dashboard"]').click();
  const endTour = app.locator('[data-action="end-tour"]');
  const tourAppeared = await endTour.waitFor({ state: 'visible', timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  if (tourAppeared) await endTour.click();
}

async function goToAccounts(page, app) {
  await page.evaluate(() => {
    const frame = document.querySelector('iframe.cloud-app-frame');
    frame.contentWindow.location.hash = '#/accounts';
  });
  await expect(app.locator('table tbody')).toBeVisible({ timeout: 15000 });
}

async function openAccounts(page, app) {
  await openDashboard(app);
  await goToAccounts(page, app);
}

async function readOnboardingIntentStorage(page) {
  return page.evaluate(() => ({
    anonymousLocal: localStorage.getItem('bd_onboarding_intent'),
    anonymousSession: sessionStorage.getItem('bd_onboarding_intent'),
    scoped: Object.keys(localStorage)
      .filter((key) => key.startsWith('bd_onboarding_intent:'))
      .sort()
      .map((key) => ({ key, value: JSON.parse(localStorage.getItem(key) || 'null') })),
  }));
}

test('ATS audit becomes a prefilled, imported watchlist after signup', async ({ page }) => {
  const targets = [
    'https://boards.greenhouse.io/auditactivation',
    'https://jobs.lever.co/activation-partners',
  ];

  await page.goto('/ats-checker');
  await page.getByLabel('Career-site or job-board URLs').fill(targets.join('\n'));
  await page.getByRole('button', { name: 'Audit coverage' }).click();
  await expect(page.getByRole('heading', { name: '2 of 2 valid public URLs match a recognized ATS host' })).toBeVisible();
  await page.getByRole('link', { name: 'Monitor these companies' }).click();

  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page.locator('[role="status"]', { hasText: 'Your audit is ready.' })).toContainText('2 career sites');
  const { email, app } = await submitSignup(page, 'audit-activation');

  const profile = app.locator('#setup-profile-form');
  await expect(profile.locator('#setup-user-name')).toHaveValue('Activation Tester');
  await expect(profile.locator('#setup-user-email')).toHaveValue(email);
  const migratedIntent = await readOnboardingIntentStorage(page);
  expect(migratedIntent.anonymousLocal).toBeNull();
  expect(migratedIntent.anonymousSession).toBeNull();
  expect(migratedIntent.scoped).toHaveLength(1);
  expect(migratedIntent.scoped[0].value).toMatchObject({
    source: 'ats-checker',
    careerUrls: targets,
  });
  await continueProfile(app);

  const targetForm = app.locator('#setup-target-form');
  await expect(targetForm).toBeVisible({ timeout: 10000 });
  await expect(targetForm.locator('.setup-intent-banner')).toContainText('Your ATS audit is ready to become a live watchlist.');
  await expect(targetForm.locator('#setup-target-sites')).toHaveValue(targets.join('\n'));
  await expect(targetForm.locator('#setup-target-feedback')).toContainText('2 target accounts ready');
  await targetForm.locator('button[type="submit"]').click();

  await finishSetup(app);
  const summary = app.locator('.setup-summary-grid');
  await expect(summary.locator('div', { hasText: 'Accounts added' })).toContainText('2');
  await expect(summary.locator('div', { hasText: 'Saved for later' })).toContainText('0');
  await expect(summary.locator('div', { hasText: 'Monitoring queued' })).toContainText('1');
  const consumedIntent = await readOnboardingIntentStorage(page);
  expect(consumedIntent.anonymousLocal).toBeNull();
  expect(consumedIntent.anonymousSession).toBeNull();
  expect(consumedIntent.scoped).toHaveLength(0);

  await openAccounts(page, app);
  const rows = app.locator('table tbody tr:not(.quick-log-row)');
  await expect(rows).toHaveCount(2, { timeout: 15000 });
  await expect(rows.filter({ hasText: 'Auditactivation' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Activation Partners' })).toHaveCount(1);
});

test('trial setup activates 25 targets and preserves the remainder for later', async ({ page }) => {
  await page.goto('/');
  await page.locator('#nav-signup').click();
  const { app } = await submitSignup(page, 'capacity-activation');
  await continueProfile(app);

  const targets = Array.from({ length: 27 }, (_, index) => `Capacity Target ${String(index + 1).padStart(2, '0')}`);
  const targetForm = app.locator('#setup-target-form');
  await expect(targetForm).toBeVisible({ timeout: 10000 });
  await targetForm.locator('#setup-target-sites').fill(targets.join('\n'));
  await expect(targetForm.locator('#setup-target-feedback')).toContainText('27 target accounts ready');
  await targetForm.locator('button[type="submit"]').click();
  await finishSetup(app);

  const summary = app.locator('.setup-summary-grid');
  await expect(summary.locator('div', { hasText: 'Accounts added' })).toContainText('25');
  await expect(summary.locator('div', { hasText: 'Saved for later' })).toContainText('2');
  await expect(app.getByRole('link', { name: 'Review plan' })).toBeVisible();
  const storedIntent = await readOnboardingIntentStorage(page);
  expect(storedIntent.anonymousLocal).toBeNull();
  expect(storedIntent.anonymousSession).toBeNull();
  expect(storedIntent.scoped).toHaveLength(1);
  const savedTargets = storedIntent.scoped[0].value.pendingTargetSites || [];
  expect(savedTargets).toEqual(targets.slice(25));

  await openDashboard(app);
  await expect(app.locator('.deferred-target-notice')).toContainText('2 targets ready to add');
  await expect(app.locator('.deferred-target-notice')).toContainText('Nothing was discarded.');
  await expect(app.locator('[data-action="retry-deferred-targets"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  await expect(app.locator('.deferred-target-notice')).toContainText('2 targets ready to add', { timeout: 15000 });
  await expect(app.locator('.deferred-target-notice')).toContainText('current account limit');
  await goToAccounts(page, app);
  const rows = app.locator('table tbody tr:not(.quick-log-row)');
  await expect(rows).toHaveCount(20, { timeout: 15000 });
  await expect(app.getByRole('navigation', { name: 'Page navigation' })).toContainText('Showing 1-20 of 25 records');
  await app.getByRole('button', { name: 'Next page' }).click();
  await expect(rows).toHaveCount(5, { timeout: 15000 });
  await expect(app.getByRole('navigation', { name: 'Page navigation' })).toContainText('Showing 21-25 of 25 records');
});

test('skipping a prepared watchlist keeps it saved without implying a plan limit', async ({ page }) => {
  await page.goto('/');
  await page.locator('#nav-signup').click();
  const { app } = await submitSignup(page, 'skipped-watchlist');
  await continueProfile(app);

  const targetForm = app.locator('#setup-target-form');
  await expect(targetForm).toBeVisible({ timeout: 10000 });
  await targetForm.locator('#setup-target-sites').fill('Saved Target One\nSaved Target Two');
  await targetForm.locator('[data-action="setup-skip-targets"]').click();
  await finishSetup(app);

  await expect(app.locator('.setup-summary-grid').locator('div', { hasText: 'Saved for later' })).toContainText('2');
  await expect(app.getByRole('link', { name: 'Review plan' })).toHaveCount(0);
  await openDashboard(app);
  const notice = app.locator('.deferred-target-notice');
  await expect(notice).toContainText('2 targets ready to add');
  await expect(notice).toContainText('You chose to finish setup without adding these targets.');
  await expect(notice.getByRole('link', { name: 'Review account limit' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  await expect(notice).toContainText('2 targets ready to add', { timeout: 15000 });
  await expect(notice).toContainText('You chose to finish setup without adding these targets.');
  await notice.locator('[data-action="retry-deferred-targets"]').click();
  await expect(notice).toHaveCount(0, { timeout: 15000 });
  await goToAccounts(page, app);
  await expect(app.locator('table tbody tr:not(.quick-log-row)')).toHaveCount(2, { timeout: 15000 });
  const recoveredIntent = await readOnboardingIntentStorage(page);
  expect(recoveredIntent.anonymousLocal).toBeNull();
  expect(recoveredIntent.anonymousSession).toBeNull();
  expect(recoveredIntent.scoped).toHaveLength(0);
});

test('an authenticated audit intent never appears in the next account in the same browser', async ({ page }) => {
  const target = 'https://boards.greenhouse.io/private-account-target';
  await page.goto('/ats-checker');
  await page.getByLabel('Career-site or job-board URLs').fill(target);
  await page.getByRole('button', { name: 'Audit coverage' }).click();
  await page.getByRole('link', { name: 'Monitor these companies' }).click();

  const firstSignup = await submitSignup(page, 'isolated-intent-owner');
  await expect(firstSignup.app.locator('#setup-profile-form')).toBeVisible({ timeout: 15000 });
  const firstStorage = await readOnboardingIntentStorage(page);
  expect(firstStorage.anonymousLocal).toBeNull();
  expect(firstStorage.anonymousSession).toBeNull();
  expect(firstStorage.scoped).toHaveLength(1);
  expect(firstStorage.scoped[0].value.careerUrls).toEqual([target]);

  await page.locator('#cloud-avatar-btn').click();
  await page.locator('#cloud-logout-btn').click();
  await expect(page.locator('#nav-signup')).toBeVisible({ timeout: 10000 });
  await page.locator('#nav-signup').click();

  const secondSignup = await submitSignup(page, 'isolated-intent-next-user');
  await continueProfile(secondSignup.app);
  const secondTargetForm = secondSignup.app.locator('#setup-target-form');
  await expect(secondTargetForm).toBeVisible({ timeout: 10000 });
  await expect(secondTargetForm.locator('#setup-target-sites')).toHaveValue('');
  await expect(secondTargetForm.locator('.setup-intent-banner')).toHaveCount(0);

  const secondStorage = await readOnboardingIntentStorage(page);
  expect(secondStorage.anonymousLocal).toBeNull();
  expect(secondStorage.anonymousSession).toBeNull();
  expect(secondStorage.scoped).toHaveLength(1);
  expect(secondStorage.scoped[0].value.careerUrls).toEqual([target]);
});
