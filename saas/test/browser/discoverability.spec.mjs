import { test, expect } from '@playwright/test';

async function collectAnalyticsEvents(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: undefined });
  });
  const trackedEvents = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/analytics/visit')) return;
    const eventType = request.postDataJSON()?.eventType;
    if (eventType) trackedEvents.push(eventType);
  });
  return trackedEvents;
}

test('job-seeker campaign link replaces a mismatched staffing demo session', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore live demo' }).click();
  await expect(page.getByText('Read-only demo workspace')).toBeVisible();

  await page.goto('/?persona=jobseeker&utm_source=campaign');

  await expect(page.getByRole('heading', { name: /Know which employers are worth your next move/ })).toBeVisible();
  await expect(page.getByText(/role, location, and keyword focus/)).toBeVisible();
  await expect(page.locator('#hero-signup')).toHaveText('Find my next role');
  await expect(page.getByRole('link', { name: 'Audit career sites' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore live demo' })).toHaveCount(0);
  await expect(page.getByText('Read-only demo workspace')).toHaveCount(0);
});

for (const viewport of [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide desktop', width: 1440, height: 900 },
]) {
  test(`job-seeker landing stays within the ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?persona=jobseeker&utm_source=campaign');

    await expect(page.getByRole('heading', { name: /Know which employers are worth your next move/ })).toBeVisible();
    await expect(page.locator('#hero-signup')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Choose a BD Engine workflow' })).toBeVisible();
    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainCount: document.querySelectorAll('main').length,
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.mainCount).toBe(1);
  });
}

test('clean job-search route publishes focused metadata and campaign attribution', async ({ page }) => {
  await page.goto('/job-search?utm_source=linkedin&utm_campaign=role_focus');

  await expect(page).toHaveTitle('BD Engine for Job Seekers | Focus Relevant Roles');
  await expect(page.getByRole('heading', { name: /Know which employers are worth your next move/ })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://bd-engine-production.up.railway.app/job-search');

  const attribution = await page.evaluate(() => JSON.parse(localStorage.getItem('bd_acquisition') || '{}'));
  expect(attribution).toMatchObject({
    version: 2,
    firstTouch: {
      source: 'linkedin',
      campaign: 'role_focus',
      landingPath: '/job-search',
      persona: 'jobseeker',
    },
    lastNonDirectTouch: {
      source: 'linkedin',
      campaign: 'role_focus',
      landingPath: '/job-search',
      persona: 'jobseeker',
    },
  });
});

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`guide library stays crawlable and within the ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const paths = [
      '/guides',
      '/guides/ats-job-board-coverage',
      '/guides/workday-job-search',
      '/guides/linkedin-connections-job-search',
    ];

    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://bd-engine-production.up.railway.app${path}`);
      const layout = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainCount: document.querySelectorAll('main').length,
      }));
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.mainCount).toBe(1);
    }
  });
}

test('connections guide hands tracked organic discovery into the job-search route', async ({ page }) => {
  await page.goto('/guides/linkedin-connections-job-search');
  await page.getByRole('link', { name: 'Explore the job-search workflow' }).click();

  await expect(page).toHaveURL((url) => (
    url.pathname === '/job-search'
    && url.searchParams.get('utm_source') === 'organic_search'
    && url.searchParams.get('utm_medium') === 'guide'
    && url.searchParams.get('utm_campaign') === 'linkedin_connections_guide'
  ));
  const attribution = await page.evaluate(() => JSON.parse(localStorage.getItem('bd_acquisition') || '{}'));
  expect(attribution.lastNonDirectTouch).toMatchObject({
    source: 'organic_search',
    medium: 'guide',
    campaign: 'linkedin_connections_guide',
    landingPath: '/job-search',
    persona: 'jobseeker',
  });
});

test('first touch and last non-direct touch survive direct revisits through signup', async ({ page }) => {
  await page.goto('/job-search?utm_source=linkedin&utm_medium=organic&utm_campaign=founder_workflow&utm_content=workflow_video');
  await page.goto('/');

  let attribution = await page.evaluate(() => JSON.parse(localStorage.getItem('bd_acquisition') || '{}'));
  expect(attribution).toMatchObject({
    version: 2,
    firstTouch: {
      source: 'linkedin',
      medium: 'organic',
      campaign: 'founder_workflow',
      content: 'workflow_video',
      landingPath: '/job-search',
      persona: 'jobseeker',
    },
    lastNonDirectTouch: {
      source: 'linkedin',
      campaign: 'founder_workflow',
    },
  });

  await page.goto('/ats-checker?utm_source=discord&utm_medium=community&utm_campaign=signal_clinic&utm_content=office_hours');
  await page.goto('/?signup=1&persona=bd');
  attribution = await page.evaluate(() => JSON.parse(localStorage.getItem('bd_acquisition') || '{}'));
  expect(attribution.firstTouch.source).toBe('linkedin');
  expect(attribution.lastNonDirectTouch).toMatchObject({
    source: 'discord',
    medium: 'community',
    campaign: 'signal_clinic',
    content: 'office_hours',
    landingPath: '/ats-checker',
    persona: 'bd',
  });

  let signupPayload = null;
  await page.route('**/api/auth/signup', async (route) => {
    signupPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Attribution test intercepted signup.' }),
    });
  });
  await page.locator('#signup-name').fill('Attribution "Tester"');
  await page.locator('#signup-email').fill('attribution-browser@example.com');
  await page.locator('#signup-password').fill('attribution-password-1');
  await page.locator('#signup-workspace').fill('Attribution & "Workspace"');
  await page.locator('#signup-legal-consent').check();
  await page.locator('#signup-form button[type="submit"]').click();
  await expect(page.locator('.auth-error')).toContainText('Attribution test intercepted signup.');

  await expect(page.locator('#signup-name')).toHaveValue('Attribution "Tester"');
  await expect(page.locator('#signup-email')).toHaveValue('attribution-browser@example.com');
  await expect(page.locator('#signup-workspace')).toHaveValue('Attribution & "Workspace"');
  await expect(page.locator('#signup-password')).toHaveValue('');
  await expect(page.locator('#signup-legal-consent')).toBeChecked();
  await expect(page.locator('#workspace-label')).toContainText('(optional)');

  const passwordToggle = page.locator('[data-password-toggle="signup-password"]');
  await expect(passwordToggle).toHaveAccessibleName('Show password');
  await page.locator('#signup-password').fill('retry-password-2');
  await passwordToggle.click();
  await expect(page.locator('#signup-password')).toHaveAttribute('type', 'text');
  await expect(passwordToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(passwordToggle).toHaveAccessibleName('Hide password');
  await passwordToggle.click();
  await expect(page.locator('#signup-password')).toHaveAttribute('type', 'password');

  expect(signupPayload.persona).toBe('bd');
  expect(signupPayload.acquisition).toEqual(attribution);
  expect(JSON.stringify(signupPayload.acquisition)).not.toMatch(/[?@]|https?:\/\//);
  const browserStorage = await page.evaluate(() => [
    ...Object.values(localStorage),
    ...Object.values(sessionStorage),
  ].join('\n'));
  expect(browserStorage).not.toContain('attribution-password-1');
  expect(browserStorage).not.toContain('retry-password-2');
});

test('failed login preserves the email but never stores or restores the password', async ({ page }) => {
  await page.route('**/api/auth/login', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Email or password is incorrect.' }),
    });
  });
  await page.goto('/?login=1');
  await page.locator('#login-email').fill('returning-recruiter@example.com');
  await page.locator('#login-password').fill('never-store-this-password');
  await page.locator('#login-form button[type="submit"]').click();

  await expect(page.locator('.auth-error')).toContainText('Email or password is incorrect.');
  await expect(page.locator('#login-email')).toHaveValue('returning-recruiter@example.com');
  await expect(page.locator('#login-password')).toHaveValue('');
  await page.locator('#login-password').fill('temporary-retry');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');

  const browserStorage = await page.evaluate(() => [
    ...Object.values(localStorage),
    ...Object.values(sessionStorage),
  ].join('\n'));
  expect(browserStorage).not.toContain('never-store-this-password');
  expect(browserStorage).not.toContain('temporary-retry');
});

test('coverage-denominator campaign routes to the ATS audit and preserves attribution', async ({ page }) => {
  await page.goto('/?utm_source=linkedin&utm_medium=organic&utm_campaign=coverage_denominator');

  await expect(page).toHaveURL((url) => (
    url.pathname === '/ats-checker'
    && url.searchParams.get('utm_source') === 'linkedin'
    && url.searchParams.get('utm_medium') === 'organic'
    && url.searchParams.get('utm_campaign') === 'coverage_denominator'
  ));
  await expect(page).toHaveTitle('Free Bulk ATS Coverage Checker | BD Engine');
  await expect(page.getByRole('heading', { name: 'Audit ATS coverage for a target list' })).toBeVisible();
});

test('ATS checker audits a target list with an explicit denominator', async ({ page }) => {
  const trackedEvents = await collectAnalyticsEvents(page);
  await page.goto('/ats-checker');
  const input = page.getByLabel('Career-site or job-board URLs');

  await input.fill([
    'https://boards.greenhouse.io/example',
    'https://jobs.lever.co/example',
    'https://example.com/careers',
    'http://localhost:8787',
  ].join('\n'));
  await page.getByRole('button', { name: 'Audit coverage' }).click();
  await expect(page.getByRole('heading', { name: '2 of 3 valid public URLs match a recognized ATS host' })).toBeVisible();
  await expect(page.getByText('67%', { exact: true })).toBeVisible();
  await expect(page.locator('td[data-label="Provider"]', { hasText: 'Greenhouse' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Unknown host' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('bd-engine-ats-coverage-audit.csv');
  await expect(page.getByText(/compatibility signal, not a coverage guarantee/i)).toBeVisible();
  await expect.poll(() => trackedEvents).toContain('ats_audit_completed');
  expect(trackedEvents).not.toContain('ats_sample_used');
});

test('ATS audit hands the audited list and workflow intent into signup', async ({ page }) => {
  await page.goto('/ats-checker');
  await page.getByLabel('Career-site or job-board URLs').fill([
    'https://boards.greenhouse.io/handoff-example',
    'https://handoff.example.com/careers',
    'http://localhost:8787',
  ].join('\n'));
  await page.getByRole('button', { name: 'Audit coverage' }).click();

  const savedAudit = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bd_onboarding_intent') || 'null'));
  expect(savedAudit).toMatchObject({
    version: 1,
    source: 'ats-checker',
    persona: 'bd',
    intent: 'monitor-audited-career-sites',
    planIntent: 'trial',
    careerUrls: [
      'https://boards.greenhouse.io/handoff-example',
      'https://handoff.example.com/careers',
    ],
  });

  await page.getByRole('link', { name: 'Monitor these companies' }).click();
  await expect(page).toHaveURL((url) => (
    url.searchParams.get('signup') === '1'
    && url.searchParams.get('persona') === 'bd'
    && url.searchParams.get('intent') === 'monitor-audited-career-sites'
    && url.searchParams.get('plan') === 'trial'
  ));
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page.locator('[role="status"]', { hasText: 'Your audit is ready.' })).toContainText('2 career sites');
  await expect(page.locator('#signup-persona')).toHaveValue('bd');

  const signupIntent = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bd_onboarding_intent') || 'null'));
  expect(signupIntent).toMatchObject({
    source: 'ats-checker',
    persona: 'bd',
    intent: 'monitor-audited-career-sites',
    planIntent: 'trial',
  });
  expect(signupIntent.careerUrls).toHaveLength(2);
});

test('pricing selection persists the intended paid plan through signup', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pricing-card')).toHaveCount(1);
  const salesPlan = page.locator('.pricing-card', { hasText: 'Sales Professional' });
  await expect(salesPlan).toContainText('$10');
  await expect(salesPlan).not.toContainText('Job Seeker');
  await expect(page.locator('#referrals')).toHaveCount(0);
  await salesPlan.getByRole('button', { name: 'Start 14-day trial' }).click();

  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeFocused();
  await expect(page.locator('[role="status"]', { hasText: 'Sales Professional selected.' })).toBeVisible();
  const planIntent = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bd_onboarding_intent') || 'null'));
  expect(planIntent).toMatchObject({
    version: 1,
    source: 'pricing',
    persona: 'bd',
    intent: 'start-trial',
    planIntent: 'sales',
    careerUrls: [],
  });
});

test('job-seeker route shows only its relevant paid offer and preserves plan intent', async ({ page }) => {
  await page.goto('/job-search');

  await expect(page.locator('.pricing-card')).toHaveCount(1);
  const jobSeekerPlan = page.locator('.pricing-card', { hasText: 'Job Seeker' });
  await expect(jobSeekerPlan).toContainText('$5');
  await expect(jobSeekerPlan).not.toContainText('Sales Professional');
  await jobSeekerPlan.getByRole('button', { name: 'Start 14-day trial' }).click();

  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page.locator('[role="status"]', { hasText: 'Job Seeker selected.' })).toBeVisible();
  const planIntent = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bd_onboarding_intent') || 'null'));
  expect(planIntent).toMatchObject({
    persona: 'jobseeker',
    intent: 'start-trial',
    planIntent: 'jobseeker',
  });
});

test('recruiter hero keeps the trial, demo, and attributed ATS utility discoverable', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.hero-cta #hero-signup')).toHaveText('Start free trial');
  await expect(page.getByRole('button', { name: 'Explore live demo' })).toBeVisible();
  const audit = page.getByRole('link', { name: 'Free ATS audit', exact: true });
  await expect(audit).toBeVisible();
  await expect(audit).toHaveAttribute('href', /utm_source=homepage/);
  await expect(audit).toHaveAttribute('href', /utm_medium=navigation/);
  await expect(audit).toHaveAttribute('href', /utm_campaign=coverage_audit/);
});

test('Terms review returns to the pricing decision instead of opening signup', async ({ page }) => {
  await page.goto('/?legal=terms');
  await page.getByRole('button', { name: 'Review pricing' }).click();

  await expect(page).toHaveURL((url) => !url.searchParams.has('legal') && url.hash === '#pricing');
  await expect(page.getByRole('heading', { name: 'One focused plan, 14 days free' })).toBeFocused();
  await expect(page.locator('#signup-form')).toHaveCount(0);
});

test('signup rejects unowned setup targets and treats referral codes as pending validation', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('bd_onboarding_intent', JSON.stringify({
      version: 1,
      source: 'setup-skipped',
      persona: 'bd',
      intent: 'monitor-career-sites',
      planIntent: 'trial',
      careerUrls: ['https://example.com/careers'],
      pendingTargetSites: ['Saved Target One', 'https://example.com/careers'],
      pendingTargetReason: 'skipped',
      updatedAt: new Date().toISOString(),
    }));
  });
  await page.goto('/?signup=1&ref=not-yet-validated');

  await expect(page.locator('[role="status"]', { hasText: 'saved targets found' })).toHaveCount(0);
  await expect(page.getByText('Saved Target One')).toHaveCount(0);
  await expect(page.locator('[role="status"]', { hasText: 'Referral code NOTYETVALIDATED detected.' })).toContainText('validated when you create the workspace');
  await expect(page.getByText(/Referral from .* recorded/)).toHaveCount(0);
  const safeIntent = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bd_onboarding_intent') || 'null'));
  expect(safeIntent).toMatchObject({
    source: 'pricing',
    careerUrls: [],
    pendingTargetSites: [],
  });
});

test('ATS checker offers a useful sample path without signup', async ({ page }) => {
  const trackedEvents = await collectAnalyticsEvents(page);
  await page.goto('/ats-checker');
  await page.getByRole('button', { name: 'Try sample list' }).click();

  await expect(page.locator('#checker-result')).toBeFocused();
  await expect(page.getByText('67%', { exact: true })).toBeVisible();
  await expect.poll(() => trackedEvents).toContain('ats_sample_used');
  expect(trackedEvents).not.toContain('ats_audit_completed');
});

test('ATS checker remains usable on mobile without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ats-checker');

  await expect(page.getByRole('heading', { name: 'Audit ATS coverage for a target list' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Audit coverage' })).toBeVisible();
  await page.getByLabel('Career-site or job-board URLs').fill([
    'https://boards.greenhouse.io/example',
    'https://example.com/careers',
  ].join('\n'));
  await page.getByRole('button', { name: 'Audit coverage' }).click();
  await expect(page.getByRole('heading', { name: '1 of 2 valid public URLs match a recognized ATS host' })).toBeVisible();
  await expect(page.locator('td[data-label="Provider"]', { hasText: 'Greenhouse' })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth);
});

test('live demo keeps the priority account readable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore live demo' }).click();

  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.getByText('Daily operating view', { exact: true })).toBeVisible();
  const layout = await app.locator('.hero-card--dashboard').evaluate((card) => {
    const copy = card.querySelector('.hero-copy').getBoundingClientRect();
    const metrics = card.querySelector('.headline-metrics').getBoundingClientRect();
    return {
      copyBottom: copy.bottom,
      metricsTop: metrics.top,
      documentWidth: card.ownerDocument.documentElement.scrollWidth,
      viewportWidth: card.ownerDocument.defaultView.innerWidth,
    };
  });

  expect(layout.metricsTop).toBeGreaterThanOrEqual(layout.copyBottom);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
});
