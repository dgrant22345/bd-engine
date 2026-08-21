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
  await expect(page.locator('#hero-signup')).toHaveText('Start job search');
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

  const source = await page.evaluate(() => JSON.parse(localStorage.getItem('bd_acquisition') || '{}'));
  expect(source).toMatchObject({ source: 'linkedin', campaign: 'role_focus' });
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
