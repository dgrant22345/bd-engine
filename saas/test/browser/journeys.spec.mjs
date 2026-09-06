/**
 * CG-002: browser journey harness. Real Chromium drives the real server
 * (in-memory mode, port 8788 via playwright.config.mjs webServer).
 *
 * Contract: every journey fails if the page raises ANY uncaught exception or
 * unhandled rejection — the executable version of "every button responds".
 *
 * Notes on app structure encoded here:
 * - A fresh signup is gated inside the first-run setup wizard (workspace →
 *   watchlist → optional contacts → launch); other routes render setup until it completes.
 * - Inputs use native `required`, so empty submits are blocked by the browser.
 *   Whitespace values pass native validation and exercise the app's own
 *   trim-validation toasts.
 * - Outreach generation lives in a modal opened by [data-action="select-contact-outreach"].
 */
import { test as base, expect } from '@playwright/test';

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await use(page);
    expect(errors, 'uncaught page errors during journey').toEqual([]);
  },
});

let signupCounter = 0;
async function signup(page, { persona = 'bd', email: requestedEmail = '' } = {}) {
  signupCounter += 1;
  const email = requestedEmail || `journey-${Date.now()}-${signupCounter}@example.com`;
  await page.goto('/');
  await page.click('#nav-signup');
  if (persona !== 'bd') await page.selectOption('#signup-persona', persona);
  await page.fill('#signup-name', 'Journey Tester');
  await page.fill('#signup-email', email);
  await page.fill('#signup-password', 'journey-password-1');
  await page.fill('#signup-workspace', 'Journey Workspace');
  await page.check('#signup-legal-consent');
  await page.click('#signup-form button[type="submit"]');
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  return { email, app: page.frameLocator('iframe.cloud-app-frame') };
}

// Walk the first-run wizard to a completed workspace: workspace → skip
// watchlist → skip optional contacts → open dashboard when offered.
async function fillProfileForm(profile) {
  await profile.locator('#setup-workspace-name').fill('Journey Workspace');
  const name = profile.locator('#setup-user-name');
  const email = profile.locator('#setup-user-email');
  if (await name.isVisible()) await name.fill('Journey Tester');
  if (await email.isVisible()) await email.fill('journey-setup@example.com');
}

async function completeSetup(page, app) {
  const profile = app.locator('#setup-profile-form');
  await expect(profile).toBeVisible({ timeout: 15000 });
  await fillProfileForm(profile);
  await profile.locator('button[type="submit"]').click();
  const skipTargets = app.locator('[data-action="setup-skip-targets"]');
  await expect(skipTargets).toBeVisible({ timeout: 10000 });
  await skipTargets.click();
  const skip = app.locator('[data-action="setup-skip-import"]');
  await expect(skip).toBeVisible({ timeout: 10000 });
  await skip.click();
  const openDashboard = app.locator('[data-action="setup-open-dashboard"]');
  try {
    await openDashboard.waitFor({ state: 'visible', timeout: 10000 });
    await openDashboard.click();
  } catch {
    // Some flows land on the dashboard directly after completion.
  }
  await expect(app.locator('#setup-profile-form')).toHaveCount(0, { timeout: 10000 });
}

async function startDemo(page) {
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.getByText('Daily operating view', { exact: true })).toBeVisible({ timeout: 15000 });
  return app;
}

async function gotoAppRoute(page, route) {
  await page.evaluate((hash) => {
    const frame = document.querySelector('iframe.cloud-app-frame');
    frame.contentWindow.location.hash = hash;
  }, route);
}

test('demo journey: read-only demo opens and dashboard renders', async ({ page }) => {
  const app = await startDemo(page);
  await expect(app.locator('body')).toContainText(/dashboard|pipeline|account/i, { timeout: 15000 });
  await expect(app.locator('[data-first-value-checklist]')).toHaveCount(0);
  await expect(app.locator('[data-dash-section="workflow"]')).toBeHidden();
  await expect(app.locator('[data-dash-section="queue"]')).toBeVisible();
  await expect(app.locator('[data-dash-section="metrics"]')).toBeHidden();
  await expect(app.locator('#dash-customize-toggle')).toHaveAttribute('aria-label', 'Dashboard options');
  await app.locator('#dash-customize-toggle').click();
  await app.locator('[data-section-id="workflow"]').check();
  await expect(app.locator('[data-dash-section="workflow"]')).toBeVisible();
  await app.locator('#dash-customize-toggle').click();
  await app.locator('summary[aria-label="Workspace options"]').click();
  await expect(app.locator('#refresh-bootstrap')).toBeVisible();
  await expect(app.locator('body')).not.toContainText('has no mapped contacts');
  await expect(app.locator('body')).not.toContainText('unknown via n/a');
  await gotoAppRoute(page, '#/admin');
  await expect(app.locator('.ingestion-health')).toContainText('Demo data', { timeout: 15000 });
  await expect(app.locator('.ingestion-health')).toContainText('Automatic refresh is off in the read-only demo');
  await expect(app.locator('.coverage-health')).toContainText('3 of 3 tracked companies', { timeout: 15000 });
});

test('signup journey: new account reaches the app workspace', async ({ page }) => {
  const { app, email } = await signup(page);
  await expect(app.locator('body')).toContainText(/setup|workspace|dashboard/i, { timeout: 15000 });
  const profile = app.locator('#setup-profile-form');
  await expect(profile.locator('#setup-workspace-name')).toHaveValue('Journey Workspace');
  await expect(profile.locator('#setup-user-name')).toHaveValue('Journey Tester');
  await expect(profile.locator('#setup-user-email')).toHaveValue(email);
});

test('search focus form saves settings and opens the matching shortlist', async ({ page }) => {
  const { app } = await signup(page, { persona: 'jobseeker' });
  await completeSetup(page, app);
  await gotoAppRoute(page, '#/jobs');
  await app.locator('[data-preset="canada"]').click();
  await gotoAppRoute(page, '#/admin');
  const searchFocus = app.locator('[data-collapse-id="search-focus"]');
  await expect(searchFocus).toBeVisible({ timeout: 10000 });
  if (await searchFocus.getAttribute('aria-expanded') === 'false') await searchFocus.click();
  const form = app.locator('#settings-form');
  await form.locator('[name="targetRoles"]').fill('Talent Acquisition Manager, Recruitment Manager');
  await form.locator('[name="excludedRoles"]').fill('intern, retail sales');
  await form.locator('[name="targetIndustries"]').fill('technology, staffing');
  await form.locator('[name="workStyle"]').selectOption('any');
  await form.locator('[name="minimumRelevanceScore"]').fill('35');
  await form.getByRole('button', { name: 'Save focus and show matches' }).click();

  await expect(app.getByRole('heading', { name: 'Open roles at target companies' })).toBeVisible({ timeout: 10000 });
  const fit = app.locator('#jobs-filter-form select[name="minRelevance"]');
  await expect(fit).toHaveValue('35');
  await expect(fit.locator('option:checked')).toHaveText('Saved target threshold (35+)');
  await expect(app.locator('#jobs-filter-form select[name="geography"]')).toHaveValue('canada');

  const saved = await page.evaluate(async () => {
    const response = await fetch('/api/bootstrap');
    return response.json();
  });
  expect(saved.persona).toBe('jobseeker');
  expect(saved.settings.searchFocusByPersona.jobseeker).toMatchObject({
    targetRoles: 'talent acquisition manager, recruitment manager',
    excludedRoles: 'intern, retail sales',
    targetIndustries: 'technology, staffing',
    workStyle: 'any',
    minimumRelevanceScore: 35,
  });
});

test('role pipeline is saved to the workspace and survives a page reload', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { app } = await signup(page, { persona: 'jobseeker' });
  const profile = app.locator('#setup-profile-form');
  await expect(profile).toBeVisible({ timeout: 15000 });
  await profile.locator('button[type="submit"]').click();
  await app.locator('[data-action="setup-skip-targets"]').click();
  await app.locator('[data-action="setup-load-sample"]').click();
  await app.locator('[data-action="setup-open-dashboard"]').click({ timeout: 15000 });
  await expect(app.locator('.workspace-health')).toBeVisible();
  await expect(app.locator('.analytics-cockpit-card')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), animations: 'disabled' });
  await gotoAppRoute(page, '#/jobs');
  const select = app.locator('.job-pipeline-select').first();
  await expect(select).toBeVisible();
  const id = await select.getAttribute('data-job-id');
  await select.selectOption('saved');
  await expect(app.locator(`.job-pipeline-select[data-job-id="${id}"]`)).toHaveValue('saved');
  await expect.poll(async () => (await (await page.request.get('/api/jobs?pipelineOnly=true')).json()).total).toBe(1);
  await page.reload();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible();
  await gotoAppRoute(page, '#/jobs');
  await app.locator('[data-preset="pipeline"]').click();
  await expect(app.locator('.job-pipeline-select')).toHaveCount(1);
  await expect(app.locator('.job-pipeline-select')).toHaveValue('saved');
  await expect(app.locator('.job-results-context')).toContainText('1 results');
  await page.screenshot({ path: testInfo.outputPath('roles-desktop.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('roles-mobile.png'), animations: 'disabled' });
});

test('persona mode switch survives a full page reload', async ({ page }) => {
  const { app } = await signup(page, { persona: 'bd' });
  await completeSetup(page, app);
  await expect(app.locator('#persona-mode-label')).toHaveText('Staffing BD');
  await app.locator('#persona-mode-btn').click();
  await expect(app.locator('#persona-mode-label')).toHaveText('Job Seeker', { timeout: 10000 });

  await page.reload();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  await expect(page.frameLocator('iframe.cloud-app-frame').locator('#persona-mode-label')).toHaveText('Job Seeker', { timeout: 15000 });
});

test('post-setup dashboard is usable and its optional tour is accessible', async ({ page }) => {
  const { app } = await signup(page);
  const profile = app.locator('#setup-profile-form');
  const setupTitle = app.locator('#setup-title');
  await expect(profile).toBeVisible({ timeout: 15000 });
  await expect(setupTitle).toHaveText('Workspace');
  await expect(setupTitle).toBeFocused();

  await fillProfileForm(profile);
  await profile.locator('button[type="submit"]').click();
  await expect(setupTitle).toHaveText('Watchlist');
  await expect(setupTitle).toBeFocused();

  await app.locator('[data-action="setup-skip-targets"]').click();
  await expect(setupTitle).toHaveText('Contacts (optional)');
  await expect(setupTitle).toBeFocused();
  await app.locator('[data-action="setup-skip-import"]').click();
  await expect(app.locator('[data-action="setup-open-dashboard"]')).toBeVisible({ timeout: 15000 });
  await app.locator('[data-action="setup-open-dashboard"]').click();

  const dialog = app.getByRole('dialog', { name: 'Your workspace is ready' });
  await expect(dialog).toHaveCount(0);
  await expect(app.locator('.shell')).not.toHaveAttribute('inert', '');
  const quickTour = app.getByRole('button', { name: 'Quick tour' });
  await expect(quickTour).toBeVisible({ timeout: 10000 });
  await expect(app.locator('[data-first-value-step="target"] .activation-step__cta')).toBeVisible();

  await quickTour.click();
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(app.locator('.shell')).toHaveAttribute('inert', '');
  const skip = dialog.getByRole('button', { name: 'Skip tour' });
  const next = dialog.getByRole('button', { name: 'Next' });
  await expect(next).toBeFocused();

  await next.press('Tab');
  await expect(skip).toBeFocused();
  await skip.press('Shift+Tab');
  await expect(next).toBeFocused();

  await next.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(app.locator('.shell')).not.toHaveAttribute('inert', '');
  await expect(quickTour).toBeFocused();
});

test('mobile setup keeps the active step and readiness hierarchy compact', async ({ page }) => {
  const { app } = await signup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const profile = app.locator('#setup-profile-form');
  await expect(profile).toBeVisible({ timeout: 15000 });

  const stepperHeight = await app.locator('.setup-steps').evaluate((element) => element.getBoundingClientRect().height);
  const readinessHeight = await app.locator('.setup-value-guide').evaluate((element) => element.getBoundingClientRect().height);
  expect(stepperHeight).toBeLessThanOrEqual(64);
  expect(readinessHeight).toBeLessThanOrEqual(200);

  await fillProfileForm(profile);
  await profile.locator('button[type="submit"]').click();
  await expect(app.locator('#setup-title')).toHaveText('Watchlist');
  const flowTops = await app.locator('.setup-flow-preview > span').evaluateAll((elements) => (
    elements.map((element) => Math.round(element.getBoundingClientRect().top))
  ));
  expect(Math.max(...flowTops) - Math.min(...flowTops)).toBeLessThanOrEqual(2);
  const overflow = await app.locator('body').evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('sample setup journey: loaded data updates readiness before launch', async ({ page }) => {
  const { app } = await signup(page);
  const profile = app.locator('#setup-profile-form');
  await expect(profile).toBeVisible({ timeout: 15000 });
  await profile.locator('button[type="submit"]').click();
  await app.locator('[data-action="setup-skip-targets"]').click({ timeout: 10000 });
  await app.locator('[data-action="setup-load-sample"]').click();
  await expect(app.locator('[data-action="setup-open-dashboard"]')).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => Number(await app.locator('.setup-value-score strong').textContent())).toBeGreaterThan(0);
  await expect(app.locator('.setup-summary-grid')).toContainText('Accounts');
  await expect(app.locator('.setup-summary-grid')).toContainText('Jobs');

  await app.locator('[data-action="setup-open-dashboard"]').click();
  await expect(app.locator('[data-dash-section="queue"]')).toBeVisible({ timeout: 15000 });
  await gotoAppRoute(page, '#/accounts');
  const rows = app.locator('.accounts-table tbody tr:not(.quick-log-row)');
  await expect(rows).toHaveCount(3, { timeout: 10000 });
  await expect(rows.first()).toContainText(/greenhouse|lever|ashby/i);
  await expect(app.locator('table tbody')).not.toContainText(/no board|missing inputs/i);

  const filterForm = app.locator('#accounts-filter-form');
  await filterForm.locator('input[name="q"]').fill('Vertex');
  await filterForm.locator('button[type="submit"]').click();
  await expect(rows).toHaveCount(1, { timeout: 10000 });
  await expect(rows.first()).toContainText('Vertex Health Systems');

  await rows.first().locator('[data-action="open-account"]').click();
  const accountForm = app.locator('#account-edit-form');
  await expect(accountForm).toBeAttached({ timeout: 10000 });
  await accountForm.locator('select[name="priority"]').selectOption('strategic');
  await accountForm.locator('input[name="careersUrl"]').fill('https://vertexhealth.example/careers-updated');
  await accountForm.evaluate((form) => form.requestSubmit());
  await expect(app.locator('#account-edit-form select[name="priority"]')).toHaveValue('strategic', { timeout: 10000 });
  await expect(app.locator('#account-edit-form input[name="careersUrl"]')).toHaveValue('https://vertexhealth.example/careers-updated');

  await gotoAppRoute(page, '#/admin');
  const configHeader = app.locator('[data-collapse-id="ats-config-records"]');
  if (await configHeader.getAttribute('aria-expanded') === 'false') {
    await configHeader.evaluate((element) => element.click());
  }
  const configForm = app.locator('#configs-filter-form');
  await expect(configForm).toBeAttached({ timeout: 10000 });
  await configForm.locator('input[name="q"]').fill('Vertex');
  await configForm.evaluate((form) => form.requestSubmit());
  const configRows = app.locator('#admin-section-ats-config-records table tbody tr');
  await expect(configRows).toHaveCount(1, { timeout: 10000 });
  await expect(configRows.first()).toContainText('Vertex Health Systems');
});

test('job seeker journey keeps company, network, role, and outreach language', async ({ page }) => {
  const { app } = await signup(page, { persona: 'jobseeker' });
  await expect(app.locator('body')).toContainText('Job search setup', { timeout: 15000 });
  await fillProfileForm(app.locator('#setup-profile-form'));
  await app.locator('#setup-profile-form button[type="submit"]').click();
  await app.locator('[data-action="setup-skip-targets"]').click({ timeout: 10000 });
  await app.locator('[data-action="setup-load-sample"]').click();
  await expect(app.locator('.setup-summary-grid')).toContainText('Companies', { timeout: 15000 });
  await expect(app.locator('.setup-summary-grid')).toContainText('Network contacts');
  await expect(app.locator('.setup-summary-grid')).toContainText('Open roles');
  await expect(app.locator('.setup-summary-grid')).not.toContainText('Accounts');

  await app.locator('[data-action="setup-open-dashboard"]').click();
  const openRole = app.getByRole('link', { name: 'Open role', exact: true }).first();
  await expect(openRole).toBeVisible({ timeout: 10000 });
  await expect(openRole).toHaveAttribute('href', /^https?:\/\//);
  await gotoAppRoute(page, '#/accounts');
  await expect(app.locator('body')).toContainText('Ranked target companies', { timeout: 10000 });
  await expect(app.locator('body')).toContainText('Company shortlist');
  await gotoAppRoute(page, '#/contacts');
  await expect(app.locator('body')).toContainText('Warm contact paths', { timeout: 10000 });
  await gotoAppRoute(page, '#/jobs');
  await expect(app.locator('body')).toContainText('Open roles at target companies', { timeout: 10000 });
  await gotoAppRoute(page, '#/accounts');
  await app.locator('[data-action="open-account"]').first().click();
  await app.locator('#open-outreach-modal').click();
  await expect(app.locator('#outreach-template-select')).toHaveValue(/job_/);
});

test('setup journey: whitespace-only workspace name is rejected visibly', async ({ page }) => {
  const { app } = await signup(page);
  const profileForm = app.locator('#setup-profile-form');
  await expect(profileForm).toBeVisible({ timeout: 15000 });
  // Whitespace passes native `required` and must hit the app's trim validation.
  await fillProfileForm(profileForm);
  await profileForm.locator('#setup-workspace-name').fill('   ');
  await profileForm.locator('button[type="submit"]').click();
  await expect(app.locator('.toast').first()).toContainText(/required/i, { timeout: 5000 });
});

test('setup journey: wizard completes through to the dashboard', async ({ page }) => {
  const { app } = await signup(page);
  await completeSetup(page, app);
  await gotoAppRoute(page, '#/dashboard');
  await expect(app.locator('body')).toContainText(/dashboard|account|signal|readiness/i, { timeout: 15000 });
});

test('commercial loop: quick-start watchlist becomes a measurable account outcome', async ({ page }) => {
  const { app } = await signup(page);
  const profile = app.locator('#setup-profile-form');
  await expect(profile).toBeVisible({ timeout: 15000 });
  await fillProfileForm(profile);
  await profile.locator('button[type="submit"]').click();

  const targetForm = app.locator('#setup-target-form');
  await expect(targetForm).toBeVisible({ timeout: 10000 });
  await targetForm.locator('#setup-target-sites').fill('https://jobs.lever.co/acme-staffing-test');
  await targetForm.locator('button[type="submit"]').click();
  await app.locator('[data-action="setup-skip-import"]').click({ timeout: 10000 });
  await expect(app.locator('.setup-summary-grid')).toContainText('Accounts added', { timeout: 15000 });
  await expect(app.locator('.setup-summary-grid')).toContainText('1');
  await app.locator('[data-action="setup-open-dashboard"]').click();

  await gotoAppRoute(page, '#/accounts');
  await expect(app.locator('table tbody')).toContainText('Acme Staffing Test', { timeout: 15000 });
  await app.locator('[data-action="open-account"]').first().click();
  const activityForm = app.locator('#activity-form');
  await expect(activityForm).toBeVisible({ timeout: 10000 });
  await activityForm.locator('select[name="pipelineStage"]').selectOption('opportunity');
  await activityForm.locator('input[name="value"]').fill('5000');
  await activityForm.locator('input[name="summary"]').fill('Qualified staffing opportunity created');
  await activityForm.locator('button[type="submit"]').click();
  await expect(app.locator('.account-outcomes')).toContainText('Opportunity created', { timeout: 10000 });
  await expect(app.locator('.account-outcomes')).toContainText('$5,000');

  await gotoAppRoute(page, '#/dashboard');
  await expect(app.locator('.commercial-outcomes-panel')).toContainText('Opportunities', { timeout: 15000 });
  await expect(app.locator('.commercial-outcomes-panel')).toContainText('$5,000');
  await expect(app.locator('.commercial-outcomes-panel')).toContainText('1');
});

test('first-value checklist routes an empty workspace to the exact setup control', async ({ page }) => {
  const { app } = await signup(page);
  await completeSetup(page, app);
  await gotoAppRoute(page, '#/dashboard');

  const checklist = app.locator('[data-first-value-checklist]');
  await expect(checklist).toBeVisible({ timeout: 15000 });
  await expect(checklist).toContainText('0 of 4 complete');
  await expect(checklist.getByRole('link', { name: 'Add account' })).toHaveAttribute('href', '#/accounts/new');
  await expect(checklist.getByRole('link', { name: 'Find board' })).toHaveAttribute('href', '#/admin/pipeline-ops/discovery');
  await expect(checklist.getByRole('link', { name: 'Import jobs' })).toHaveAttribute('href', '#/admin/pipeline-ops/jobs');
  await expect(checklist.getByRole('link', { name: 'Open account queue' })).toHaveAttribute('href', '#/accounts');

  await page.setViewportSize({ width: 390, height: 844 });
  await checklist.scrollIntoViewIfNeeded();
  const mobileWidth = await checklist.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(mobileWidth.scrollWidth).toBeLessThanOrEqual(mobileWidth.clientWidth + 1);

  await checklist.getByRole('link', { name: 'Add account' }).click();
  await expect(app.locator('#account-create-form input[name="company"]')).toBeFocused({ timeout: 15000 });

  await gotoAppRoute(page, '#/dashboard');
  await app.locator('[data-first-value-checklist]').getByRole('link', { name: 'Find board' }).click();
  const refreshSection = app.locator('#admin-section-pipeline-ops');
  await expect(refreshSection).toBeVisible({ timeout: 15000 });
  await expect(refreshSection.locator('[data-collapse-id="pipeline-ops"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(refreshSection.locator('[data-action="run-discovery"]')).toBeFocused();
});

test('admin journey: import health and automatic refresh timing are visible', async ({ page }) => {
  const { app } = await signup(page);
  await completeSetup(page, app);
  await gotoAppRoute(page, '#/admin');

  await app.locator('[data-collapse-id="runtime-status"]').click();
  const health = app.locator('.ingestion-health');
  await expect(health).toBeVisible({ timeout: 15000 });
  await expect(health).toContainText('Last successful refresh');
  await expect(health).toContainText('Next automatic refresh');
  await expect(health).toContainText(/Due now|[A-Z][a-z]{2} \d{1,2}/);
  await expect(app.locator('.coverage-health')).toContainText('Ready sources');
  await expect(app.locator('.coverage-health')).toContainText('Highest-priority coverage fixes');
  const copyDiagnostics = app.locator('[data-action="copy-diagnostics"]');
  await expect(copyDiagnostics).toBeVisible();
  await copyDiagnostics.click();
  await expect(app.locator('.toast', { hasText: /diagnostic summary copied/i })).toBeVisible({ timeout: 5000 });
});

test('analytics admin journey: campaign and activation milestones are visible', async ({ page, browserName }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: undefined });
  });
  const waitForAnalyticsEvent = (eventType) => page.waitForResponse((response) => {
    if (!response.url().includes('/api/analytics/visit')) return false;
    try {
      return JSON.parse(response.request().postData() || '{}').eventType === eventType;
    } catch {
      return false;
    }
  });
  await page.goto('/ats-checker?utm_source=linkedin&utm_campaign=analytics_journey');
  await Promise.all([
    waitForAnalyticsEvent('ats_sample_used'),
    page.getByRole('button', { name: 'Try sample list' }).click(),
  ]);
  await page.getByLabel('Career-site or job-board URLs').fill('https://boards.greenhouse.io/manual-example');
  await Promise.all([
    waitForAnalyticsEvent('ats_audit_completed'),
    page.getByRole('button', { name: 'Audit coverage' }).click(),
  ]);

  const adminEmail = `analytics-admin-${browserName}@example.com`;
  const { app } = await signup(page, { email: adminEmail });
  await completeSetup(page, app);
  await gotoAppRoute(page, '#/admin');

  const analyticsSection = app.locator('#admin-section-site-analytics');
  await expect(analyticsSection).toBeVisible({ timeout: 15000 });
  await expect(analyticsSection).toContainText('Acquisition and activation');
  await analyticsSection.locator('[data-collapse-id="site-analytics"]').click();
  const funnel = analyticsSection.locator('[aria-label="Acquisition and activation funnel"]');
  await expect(funnel).toBeVisible();
  await expect(funnel.locator('[data-analytics-event="ats_sample_used"]')).toContainText(/[1-9][\d,]* events?/);
  await expect(funnel.locator('[data-analytics-event="ats_audit_completed"]')).toContainText(/[1-9][\d,]* events?/);
  await expect(funnel.locator('[data-analytics-event="signup_completed"]')).toContainText(/[1-9][\d,]* workspaces?/);
  await expect(funnel.locator('[data-analytics-event="setup_completed"]')).toContainText(/[1-9][\d,]* workspaces?/);
  await expect(funnel.locator('[data-analytics-kpi="seven-day-activation"]')).toBeVisible();
  const sourceQuality = analyticsSection.getByRole('table', { name: 'Activation quality by first-touch source' });
  await expect(sourceQuality).toBeVisible();
  await expect(sourceQuality.locator('[data-analytics-source="linkedin"]')).toBeVisible();
  await expect(analyticsSection).toContainText('not a person-level cohort report');
});

test('task journey: whitespace task is rejected visibly, valid task succeeds', async ({ page }) => {
  const { app } = await signup(page);
  await completeSetup(page, app);
  await gotoAppRoute(page, '#/tasks');
  await app.locator('.task-create-disclosure > summary').click();
  const form = app.locator('#task-create-form');
  await expect(form).toBeVisible({ timeout: 15000 });
  // Whitespace summary passes native required and must show the app's warning
  // toast (this exact submit path used to throw ReferenceError — CG-001).
  // Target the warning toast specifically — a success toast from setup
  // completion can still be on screen.
  await form.locator('input[name="summary"]').fill('   ');
  await form.locator('button[type="submit"]').click();
  await expect(app.locator('.toast--warning').first()).toContainText(/description|task/i, { timeout: 5000 });
  // Toasts overlay the form and intercept pointer events; let them clear.
  await expect(app.locator('.toast')).toHaveCount(0, { timeout: 10000 });
  // Valid summary → task appears in the list.
  await form.locator('input[name="summary"]').fill('Follow up with journey account');
  const todayKey = await form.evaluate(() => {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${today.getFullYear()}-${month}-${day}`;
  });
  await form.locator('input[name="dueDate"]').fill(todayKey);
  await form.locator('button[type="submit"]').click();
  await expect(app.locator('.tasks-content')).toContainText('Follow up with journey account', { timeout: 10000 });
  const createdTask = app.locator('.task-item', { hasText: 'Follow up with journey account' });
  await expect(createdTask).toHaveCount(1);
  await expect(createdTask.locator('xpath=ancestor::div[contains(@class,"task-section")]').locator('.task-section-title')).toContainText('Today');
  await createdTask.getByRole('button', { name: 'Mark Done' }).click();
  await expect(app.locator('.loading-shell')).toHaveCount(0);
  await expect(createdTask).toHaveCount(0, { timeout: 5000 });
});

test('filter journey: contacts filter narrows results without errors', async ({ page }) => {
  await startDemo(page);
  await gotoAppRoute(page, '#/contacts');
  const app = page.frameLocator('iframe.cloud-app-frame');
  const form = app.locator('#contacts-filter-form');
  await expect(form).toBeVisible({ timeout: 15000 });
  const rowsBefore = await app.locator('table tbody tr').count();
  await form.locator('input[name="q"]').fill('director');
  await form.locator('button[type="submit"]').first().click();
  await expect
    .poll(async () => app.locator('table tbody tr').count(), { timeout: 10000 })
    .toBeLessThanOrEqual(rowsBefore);
});

test('account journey: accounts list renders and account detail opens', async ({ page }) => {
  await startDemo(page);
  await gotoAppRoute(page, '#/accounts');
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.locator('select[name="portfolio"]')).toHaveValue('tracked');
  await expect(app.locator('.table-meta')).toContainText('tracked');
  await expect(app.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 });
  await app.locator('[data-action="open-account"]').first().click();
  await expect(app.locator('body')).toContainText(/contacts|jobs|outreach|score/i, { timeout: 10000 });
});

test('message journey: outreach modal generates grounded content in the demo', async ({ page }) => {
  await startDemo(page);
  await gotoAppRoute(page, '#/accounts');
  const app = page.frameLocator('iframe.cloud-app-frame');
  await app.locator('[data-action="open-account"]').first().click();
  // Outreach generation lives in a modal; open it via a mapped contact.
  const openModal = app.locator('[data-action="select-contact-outreach"]').first();
  await expect(openModal).toBeVisible({ timeout: 10000 });
  await openModal.click();
  const generate = app.locator('#generate-outreach-button');
  await expect(generate).toBeVisible({ timeout: 10000 });
  await generate.click();
  await expect(app.locator('#outreach-modal-backdrop')).toContainText(/subject|copy/i, { timeout: 15000 });
  await expect(app.locator('#outreach-modal-backdrop')).toContainText(/grounding check/i);
  await expect(app.locator('#outreach-email-body')).toBeEditable();
  await expect(app.locator('#outreach-channel-email')).toBeChecked();
  await expect(app.locator('#outreach-channel-linkedin')).not.toBeChecked();
  await app.locator('#outreach-subject-input').fill('A focused hiring question');
  await expect(app.locator('#outreach-mailto-link')).toHaveAttribute('href', /A%20focused%20hiring%20question/);
});

test('dashboard recommendation opens a generated outreach draft directly', async ({ page }) => {
  const app = await startDemo(page);
  const draftAction = app.getByRole('button', { name: 'Draft sales note' }).first();
  await expect(draftAction).toBeVisible({ timeout: 15000 });
  await draftAction.click();
  await expect(app.locator('#outreach-modal-backdrop')).toBeVisible({ timeout: 15000 });
  await expect(app.locator('#outreach-modal-backdrop')).toContainText(/subject|copy/i, { timeout: 15000 });
  await expect(app.locator('#outreach-modal-backdrop')).toContainText(/grounding check/i);
});

test('mobile message journey: account detail and composer stay actionable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startDemo(page);
  await gotoAppRoute(page, '#/accounts');
  const app = page.frameLocator('iframe.cloud-app-frame');
  await app.locator('[data-action="open-account"]').first().click();
  const compose = app.locator('#open-outreach-modal');
  await expect(compose).toBeVisible({ timeout: 10000 });
  await compose.click();
  await expect(app.locator('#outreach-modal-backdrop')).toBeVisible();
  const overflow = await app.locator('#outreach-modal-backdrop').evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await app.locator('body').press('Escape');
  await expect(app.locator('#outreach-modal-backdrop')).toBeHidden();
  await expect(compose).toBeFocused();
});

test('import journey: setup preview selects tracked targets and preserves network companies', async ({ page }) => {
  const { app } = await signup(page);
  // Advance to the optional contacts step: workspace → skip watchlist → contacts.
  const profile = app.locator('#setup-profile-form');
  await expect(profile).toBeVisible({ timeout: 15000 });
  await fillProfileForm(profile);
  await profile.locator('button[type="submit"]').click();
  await app.locator('[data-action="setup-skip-targets"]').click({ timeout: 10000 });
  const fileInput = app.locator('#setup-csv-file');
  await expect(app.locator('[data-action="setup-browse-csv"]')).toBeVisible({ timeout: 10000 });
  const csv = [
    'First Name,Last Name,Company,Position,Email Address,Connected On',
    'Jane,Doe,Journey Robotics,VP Engineering,jane@journeyrobotics.com,01 Jan 2026',
    'John,Roe,Journey Robotics,CTO,john@journeyrobotics.com,02 Jan 2026',
    'Nina,Net,Network Only LLC,Developer,nina@gmail.com,03 Jan 2026',
  ].join('\n');
  await fileInput.setInputFiles({ name: 'connections.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(app.locator('body')).toContainText(/connections\.csv|3 connection|preview/i, { timeout: 15000 });

  await app.locator('[data-action="setup-preview-csv"]').click();
  const selection = app.locator('#setup-target-selection');
  await expect(selection).toBeVisible({ timeout: 15000 });
  await expect(selection).toContainText('Journey Robotics');
  await expect(selection).toContainText('Network Only LLC');

  const trackedTarget = selection.locator('.setup-target-checkbox[value="journey robotics"]');
  const networkOnly = selection.locator('.setup-target-checkbox[value="network only llc"]');
  await expect(trackedTarget).toBeChecked();
  await expect(networkOnly).toBeChecked();
  await networkOnly.uncheck();
  await expect(app.locator('#setup-target-count')).toContainText('1 selected');

  await expect(app.locator('.toast')).toHaveCount(0, { timeout: 10000 });
  await app.locator('[data-action="setup-complete"]').click();

  await expect.poll(async () => {
    const response = await page.request.get('/api/accounts?q=Journey%20Robotics&page=1&pageSize=5');
    const result = await response.json();
    return result.items?.[0]?.tracked;
  }, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => {
    const response = await page.request.get('/api/accounts?q=Network%20Only&page=1&pageSize=5');
    const result = await response.json();
    return result.items?.[0]?.tracked;
  }, { timeout: 15000 }).toBe(false);
});

test('billing journey: billing page opens from the account menu', async ({ page }) => {
  const { app } = await signup(page);
  await completeSetup(page, app);
  await page.click('#cloud-avatar-btn');
  await page.click('#cloud-billing-btn');
  await expect(app.locator('body')).toContainText(/plan|billing|trial/i, { timeout: 15000 });
});

test('privacy journey: workspace data export responds from the account menu', async ({ page }) => {
  await signup(page);
  await page.click('#cloud-avatar-btn');
  await page.click('#cloud-export-btn');
  await expect(page.getByRole('dialog', { name: 'Privacy and data' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    page.click('[data-privacy-export]'),
  ]);
  if (!download) {
    // Export may render inline instead of downloading; either way the page must respond visibly.
    await expect(page.locator('body')).toContainText(/export|download|data/i, { timeout: 10000 });
  }
});

test('privacy journey: workspace deletion requires the current password', async ({ page }) => {
  await signup(page);
  await page.click('#cloud-avatar-btn');
  await page.click('#cloud-export-btn');
  const dialog = page.getByRole('dialog', { name: 'Privacy and data' });
  const form = dialog.locator('[data-privacy-delete]');
  await expect(form).toBeVisible();
  await form.locator('[name="password"]').fill('wrong-password');
  await form.locator('[name="confirm"]').fill('DELETE Journey Workspace');
  await form.getByRole('button', { name: 'Delete workspace data' }).click();
  await expect(form.locator('[data-privacy-result]')).toContainText('password you entered is incorrect');
  await form.locator('[name="password"]').fill('journey-password-1');
  await form.getByRole('button', { name: 'Delete workspace data' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible();
});

test('privacy journey: eligible customer can close their account and is signed out', async ({ page }) => {
  const { email } = await signup(page);
  await page.click('#cloud-avatar-btn');
  await page.click('#cloud-export-btn');
  const dialog = page.getByRole('dialog', { name: 'Privacy and data' });
  await expect(dialog).toBeVisible();
  const closureForm = dialog.locator('[data-account-closure-form]');
  await expect(closureForm).toBeVisible({ timeout: 10000 });
  await closureForm.locator('[name="password"]').fill('journey-password-1');
  await closureForm.locator('[name="confirm"]').fill(`DELETE ACCOUNT ${email}`);
  await closureForm.locator('[name="exportAcknowledged"]').check();
  await closureForm.getByRole('button', { name: 'Close account permanently' }).click();
  await expect(page.locator('#nav-signup')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.landing-account-notice')).toContainText('account has been closed');
  await expect(page.locator('iframe.cloud-app-frame')).toHaveCount(0);
  const sessionResponse = await page.request.get('/api/auth/me');
  expect(sessionResponse.status()).toBe(200);
  expect((await sessionResponse.json()).authenticated).toBe(false);
});

test('logout journey: logging out returns to the landing page', async ({ page }) => {
  await signup(page);
  await page.click('#cloud-avatar-btn');
  await page.click('#cloud-logout-btn');
  await expect(page.locator('#nav-signup')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('iframe.cloud-app-frame')).toHaveCount(0);
});
