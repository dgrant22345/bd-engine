import { test, expect } from '@playwright/test';

test('job-seeker campaign link replaces a mismatched staffing demo session', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try live demo' }).click();
  await expect(page.getByText('Read-only demo workspace')).toBeVisible();

  await page.goto('/?persona=jobseeker&utm_source=campaign');

  await expect(page.getByRole('heading', { name: /A focused job search/ })).toBeVisible();
  await expect(page.getByText(/role, location, and keyword focus/)).toBeVisible();
  await expect(page.locator('#hero-signup')).toHaveText('Start job search');
  await expect(page.getByRole('button', { name: 'See how it works' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try live demo' })).toHaveCount(0);
  await expect(page.getByText('Read-only demo workspace')).toHaveCount(0);
});

test('job-seeker landing stays within a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?persona=jobseeker&utm_source=campaign');

  await expect(page.getByRole('heading', { name: /A focused job search/ })).toBeVisible();
  await expect(page.locator('#hero-signup')).toBeVisible();
  const viewport = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth);
});

test('clean job-search route publishes focused metadata and campaign attribution', async ({ page }) => {
  await page.goto('/job-search?utm_source=linkedin&utm_campaign=role_focus');

  await expect(page).toHaveTitle('BD Engine for Job Seekers | Focus Relevant Roles');
  await expect(page.getByRole('heading', { name: /A focused job search/ })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://bd-engine-production.up.railway.app/job-search');

  const source = await page.evaluate(() => JSON.parse(localStorage.getItem('bd_acquisition') || '{}'));
  expect(source).toMatchObject({ source: 'linkedin', campaign: 'role_focus' });
});

test('ATS checker audits a target list with an explicit denominator', async ({ page }) => {
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
