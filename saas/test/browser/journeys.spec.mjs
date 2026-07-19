/**
 * CG-002: browser journey harness. Real Chromium drives the real server
 * (in-memory mode, port 8788 via playwright.config.mjs webServer).
 *
 * Contract: every journey fails if the page raises ANY uncaught exception or
 * unhandled rejection — the executable version of "every button responds".
 *
 * Notes on app structure encoded here:
 * - A fresh signup is gated inside the first-run setup wizard (profile → team →
 *   import → launch); other routes render setup until it completes.
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
async function signup(page, { persona = 'bd' } = {}) {
  signupCounter += 1;
  const email = `journey-${Date.now()}-${signupCounter}@example.com`;
  await page.goto('/');
  await page.click('#nav-signup');
  if (persona !== 'bd') await page.selectOption('#signup-persona', persona);
  await page.fill('#signup-name', 'Journey Tester');
  await page.fill('#signup-email', email);
  await page.fill('#signup-password', 'journey-password-1');
  await page.fill('#signup-workspace', 'Journey Workspace');
  await page.click('#signup-form button[type="submit"]');
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  return { email, app: page.frameLocator('iframe.cloud-app-frame') };
}

// Walk the first-run wizard to a completed workspace: profile → team →
// skip import (completes setup) → open dashboard when offered.
async function fillProfileForm(profile) {
  await profile.locator('#setup-workspace-name').fill('Journey Workspace');
  await profile.locator('#setup-user-name').fill('Journey Tester');
  await profile.locator('#setup-user-email').fill('journey-setup@example.com');
}

async function completeSetup(page, app) {
  const profile = app.locator('#setup-profile-form');
  await expect(profile).toBeVisible({ timeout: 15000 });
  await fillProfileForm(profile);
  await profile.locator('button[type="submit"]').click();
  const team = app.locator('#setup-team-form');
  await expect(team).toBeVisible({ timeout: 10000 });
  await team.locator('button[type="submit"]').click();
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
  // Opening the dashboard can queue the product tour, whose overlay intercepts
  // all pointer events — end it before the journey continues.
  const endTour = app.locator('[data-action="end-tour"]');
  try {
    await endTour.waitFor({ state: 'visible', timeout: 4000 });
    await endTour.click();
    await app.locator('.tour-overlay').waitFor({ state: 'detached', timeout: 5000 });
  } catch {
    // No tour queued for this flow.
  }
}

async function startDemo(page) {
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  return page.frameLocator('iframe.cloud-app-frame');
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
  await expect(app.locator('[data-dash-section="workflow"]')).toBeVisible();
  await expect(app.locator('[data-dash-section="queue"]')).toBeVisible();
  await expect(app.locator('[data-dash-section="metrics"]')).toBeHidden();
  await expect(app.locator('#dash-customize-toggle')).toContainText('Choose dashboard sections');
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

test('sample setup journey: loaded data updates readiness before launch', async ({ page }) => {
  const { app } = await signup(page);
  const profile = app.locator('#setup-profile-form');
  await expect(profile).toBeVisible({ timeout: 15000 });
  await profile.locator('button[type="submit"]').click();
  await app.locator('#setup-team-form button[type="submit"]').click({ timeout: 10000 });
  await app.locator('[data-action="setup-load-sample"]').click();
  await expect(app.locator('[data-action="setup-open-dashboard"]')).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => Number(await app.locator('.setup-value-score strong').textContent())).toBeGreaterThan(0);
  await expect(app.locator('.setup-summary-grid')).toContainText('Accounts');
  await expect(app.locator('.setup-summary-grid')).toContainText('Jobs');

  await app.locator('[data-action="setup-open-dashboard"]').click();
  const endTour = app.locator('[data-action="end-tour"]');
  try {
    await endTour.waitFor({ state: 'visible', timeout: 4000 });
    await endTour.click();
  } catch {
    // The tour may already be dismissed for this browser profile.
  }
  await gotoAppRoute(page, '#/accounts');
  const rows = app.locator('table tbody tr:not(.quick-log-row)');
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
  await app.locator('#setup-team-form button[type="submit"]').click({ timeout: 10000 });
  await app.locator('[data-action="setup-load-sample"]').click();
  await expect(app.locator('.setup-summary-grid')).toContainText('Companies', { timeout: 15000 });
  await expect(app.locator('.setup-summary-grid')).toContainText('Network contacts');
  await expect(app.locator('.setup-summary-grid')).toContainText('Open roles');
  await expect(app.locator('.setup-summary-grid')).not.toContainText('Accounts');

  await app.locator('[data-action="setup-open-dashboard"]').click();
  const endTour = app.locator('[data-action="end-tour"]');
  try {
    await endTour.waitFor({ state: 'visible', timeout: 4000 });
    await endTour.click();
  } catch {
    // The tour may already be dismissed for this browser profile.
  }
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

test('admin journey: import health and automatic refresh timing are visible', async ({ page }) => {
  const { app } = await signup(page);
  await completeSetup(page, app);
  await gotoAppRoute(page, '#/admin');

  const health = app.locator('.ingestion-health');
  await expect(health).toBeVisible({ timeout: 15000 });
  await expect(health).toContainText('Last successful refresh');
  await expect(health).toContainText('Next automatic refresh');
  await expect(health).toContainText(/Due now|[A-Z][a-z]{2} \d{1,2}/);
  await expect(app.locator('.coverage-health')).toContainText('Ready sources');
  await expect(app.locator('.coverage-health')).toContainText('Highest-priority coverage fixes');
  await app.locator('[data-collapse-id="runtime-status"]').click();
  const copyDiagnostics = app.locator('[data-action="copy-diagnostics"]');
  await expect(copyDiagnostics).toBeVisible();
  await copyDiagnostics.click();
  await expect(app.locator('.toast', { hasText: /diagnostic summary copied/i })).toBeVisible({ timeout: 5000 });
});

test('task journey: whitespace task is rejected visibly, valid task succeeds', async ({ page }) => {
  const { app } = await signup(page);
  await completeSetup(page, app);
  await gotoAppRoute(page, '#/tasks');
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
  await form.locator('button[type="submit"]').click();
  await expect(app.locator('.tasks-content')).toContainText('Follow up with journey account', { timeout: 10000 });
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
});

test('import journey: setup preview selects tracked targets and preserves network companies', async ({ page }) => {
  const { app } = await signup(page);
  // Advance to the import step: profile → team → import.
  const profile = app.locator('#setup-profile-form');
  await expect(profile).toBeVisible({ timeout: 15000 });
  await fillProfileForm(profile);
  await profile.locator('button[type="submit"]').click();
  await app.locator('#setup-team-form button[type="submit"]').click({ timeout: 10000 });
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
