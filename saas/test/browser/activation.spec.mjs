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

async function readAuthenticatedIdentity(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    return response.json();
  });
}

async function readFrameIntentScope(page) {
  const frameSrc = await page.locator('iframe.cloud-app-frame').getAttribute('src');
  const parsed = new URL(frameSrc, 'http://127.0.0.1:8788');
  return { frameSrc, scope: parsed.searchParams.get('intentScope') || '' };
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
  const identity = await readAuthenticatedIdentity(page);
  const initialFrame = await readFrameIntentScope(page);
  expect(migratedIntent.anonymousLocal).toBeNull();
  expect(migratedIntent.anonymousSession).toBeNull();
  expect(migratedIntent.scoped).toHaveLength(1);
  expect(initialFrame.scope).toMatch(/^[a-zA-Z0-9_-]{20,86}$/);
  expect(initialFrame.frameSrc).not.toContain(identity.user.id);
  expect(initialFrame.frameSrc).not.toContain(identity.tenant.id);
  expect(migratedIntent.scoped[0].key).toBe(`bd_onboarding_intent:v2:${initialFrame.scope}`);
  expect(migratedIntent.scoped[0].value).toMatchObject({
    source: 'ats-checker',
    careerUrls: targets,
  });
  await page.reload();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  expect((await readFrameIntentScope(page)).scope).toBe(initialFrame.scope);
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
  const firstScope = (await readFrameIntentScope(page)).scope;

  await page.evaluate(() => {
    localStorage.setItem('bd_onboarding_intent:v2:malformed_logout_scope', '{');
    localStorage.setItem('bd_onboarding_intent:v2:expired_logout_scope', JSON.stringify({
      version: 1,
      source: 'pricing',
      updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    }));
  });

  await page.locator('#cloud-avatar-btn').click();
  await page.locator('#cloud-logout-btn').click();
  await expect(page.locator('#nav-signup')).toBeVisible({ timeout: 10000 });
  const sweptAtLogout = await page.evaluate(() => ({
    malformed: localStorage.getItem('bd_onboarding_intent:v2:malformed_logout_scope'),
    expired: localStorage.getItem('bd_onboarding_intent:v2:expired_logout_scope'),
  }));
  expect(sweptAtLogout).toEqual({ malformed: null, expired: null });
  await page.locator('#nav-signup').click();

  const secondSignup = await submitSignup(page, 'isolated-intent-next-user');
  expect((await readFrameIntentScope(page)).scope).not.toBe(firstScope);
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

test('authenticated startup discards unowned legacy and deferred anonymous intent', async ({ page }) => {
  const leakedLocalTarget = 'https://boards.greenhouse.io/legacy-other-account';
  const leakedSessionTarget = 'https://jobs.lever.co/deferred-other-account';
  await page.goto('/');
  await page.locator('#nav-signup').click();
  const { app } = await submitSignup(page, 'legacy-intent-rejection');

  await page.evaluate(({ leakedLocalTarget, leakedSessionTarget }) => {
    const updatedAt = new Date().toISOString();
    localStorage.setItem('bd_onboarding_intent', JSON.stringify({
      version: 1,
      source: 'pricing',
      intent: 'monitor-career-sites',
      careerUrls: [leakedLocalTarget],
      updatedAt,
    }));
    sessionStorage.setItem('bd_onboarding_intent', JSON.stringify({
      version: 1,
      source: 'setup-deferred',
      intent: 'monitor-career-sites',
      pendingTargetSites: [leakedSessionTarget],
      updatedAt,
    }));
  }, { leakedLocalTarget, leakedSessionTarget });

  await page.reload();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  const storage = await readOnboardingIntentStorage(page);
  expect(storage.anonymousLocal).toBeNull();
  expect(storage.anonymousSession).toBeNull();
  expect(JSON.stringify(storage.scoped)).not.toContain('other-account');

  await continueProfile(app);
  const targetForm = app.locator('#setup-target-form');
  await expect(targetForm).toBeVisible({ timeout: 10000 });
  await expect(targetForm.locator('#setup-target-sites')).toHaveValue('');
  await expect(targetForm.locator('.setup-intent-banner')).toHaveCount(0);
});

test('startup removes malformed, expired, and implausibly future scoped intents', async ({ page }) => {
  await page.goto('/');
  const keys = await page.evaluate(() => {
    const prefix = 'bd_onboarding_intent:v2:';
    const keys = {
      fresh: `${prefix}fresh_scope_1234567890`,
      malformed: `${prefix}malformed_scope_12345`,
      expired: `${prefix}expired_scope_1234567`,
      future: `${prefix}future_scope_123456789`,
      missingDate: `${prefix}missing_date_scope_1234`,
    };
    const base = { version: 1, source: 'pricing', intent: 'start-trial' };
    localStorage.setItem(keys.fresh, JSON.stringify({ ...base, updatedAt: new Date().toISOString() }));
    localStorage.setItem(keys.malformed, '{');
    localStorage.setItem(keys.expired, JSON.stringify({
      ...base,
      updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    }));
    localStorage.setItem(keys.future, JSON.stringify({
      ...base,
      updatedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }));
    localStorage.setItem(keys.missingDate, JSON.stringify(base));
    return keys;
  });

  await page.reload();
  const stored = await page.evaluate((intentKeys) => Object.fromEntries(
    Object.entries(intentKeys).map(([name, key]) => [name, localStorage.getItem(key)]),
  ), keys);
  expect(stored.fresh).not.toBeNull();
  expect(stored.malformed).toBeNull();
  expect(stored.expired).toBeNull();
  expect(stored.future).toBeNull();
  expect(stored.missingDate).toBeNull();
});

test('support context strips identity scope and billing fallback preserves it', async ({ page }) => {
  await page.goto('/');
  await page.locator('#nav-signup').click();
  await submitSignup(page, 'support-scope-privacy');
  const identity = await readAuthenticatedIdentity(page);
  const initialFrame = await readFrameIntentScope(page);

  await page.locator('#cloud-avatar-btn').click();
  await page.locator('#cloud-support-btn').click();
  const supportDialog = page.getByRole('dialog', { name: 'Support center' });
  const supportForm = supportDialog.locator('[data-support-create]');
  await expect(supportForm).toBeVisible({ timeout: 10000 });
  await supportForm.locator('[name="subject"]').fill('Scope privacy regression');
  await supportForm.locator('[name="body"]').fill('Confirm the support context omits private workspace identity.');
  const supportRequestPromise = page.waitForRequest((request) => (
    request.url().endsWith('/api/support/tickets') && request.method() === 'POST'
  ));
  await supportForm.getByRole('button', { name: 'Send request' }).click();
  const supportPayload = (await supportRequestPromise).postDataJSON();
  expect(supportPayload.pageUrl).not.toContain('?');
  expect(supportPayload.pageUrl).not.toContain('intentScope');
  expect(supportPayload.pageUrl).not.toContain(initialFrame.scope);
  expect(supportPayload.pageUrl).not.toContain(identity.user.id);
  expect(supportPayload.pageUrl).not.toContain(identity.tenant.id);
  await supportDialog.locator('[data-support-close]').click();

  await page.locator('iframe.cloud-app-frame').evaluate((frame) => { frame.src = 'about:blank'; });
  await expect(page.locator('iframe.cloud-app-frame')).toHaveAttribute('src', 'about:blank');
  await page.locator('#cloud-avatar-btn').click();
  await page.locator('#cloud-billing-btn').click();
  const billingFrame = await readFrameIntentScope(page);
  expect(billingFrame.scope).toBe(initialFrame.scope);
  expect(billingFrame.frameSrc).toContain('#/admin/billing');
});

test('account closure removes current opaque, legacy, and fallback scope data', async ({ page }) => {
  await page.goto('/');
  await page.locator('#nav-signup').click();
  const { email } = await submitSignup(page, 'closed-scope-cleanup');
  const identity = await readAuthenticatedIdentity(page);
  const { scope } = await readFrameIntentScope(page);
  const seededKeys = await page.evaluate(({ identity, scope }) => {
    const current = `bd_onboarding_intent:v2:${scope}`;
    const legacy = `bd_onboarding_intent:${identity.tenant.id}:${identity.user.id}`;
    const fallbackIdentity = `${identity.tenant.id}\n${identity.user.id}`;
    const intent = JSON.stringify({
      version: 1,
      source: 'setup-deferred',
      intent: 'monitor-career-sites',
      pendingTargetSites: ['Private deferred target'],
      updatedAt: new Date().toISOString(),
    });
    localStorage.setItem(current, intent);
    localStorage.setItem(legacy, intent);
    localStorage.setItem('bd_onboarding_scope_map_v2', JSON.stringify({ [fallbackIdentity]: scope }));
    return { current, legacy, fallbackIdentity };
  }, { identity, scope });

  await page.locator('#cloud-avatar-btn').click();
  await page.locator('#cloud-export-btn').click();
  const privacyDialog = page.getByRole('dialog', { name: 'Privacy and data' });
  const closureForm = privacyDialog.locator('[data-account-closure-form]');
  await expect(closureForm).toBeVisible({ timeout: 10000 });
  await closureForm.locator('[name="password"]').fill('activation-password-1');
  await closureForm.locator('[name="confirm"]').fill(`DELETE ACCOUNT ${email}`);
  await closureForm.locator('[name="exportAcknowledged"]').check();
  await closureForm.getByRole('button', { name: 'Close account permanently' }).click();
  await expect(page.locator('#nav-signup')).toBeVisible({ timeout: 15000 });

  const retained = await page.evaluate(({ seededKeys }) => ({
    current: localStorage.getItem(seededKeys.current),
    legacy: localStorage.getItem(seededKeys.legacy),
    fallback: JSON.parse(localStorage.getItem('bd_onboarding_scope_map_v2') || '{}')[seededKeys.fallbackIdentity] || null,
  }), { seededKeys });
  expect(retained).toEqual({ current: null, legacy: null, fallback: null });
});
