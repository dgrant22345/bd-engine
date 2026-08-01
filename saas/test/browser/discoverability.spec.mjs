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

test('ATS checker recognizes supported hosts and explains uncertain pages', async ({ page }) => {
  await page.goto('/ats-checker');
  const input = page.getByLabel('Career site or job-board URL');

  await input.fill('https://boards.greenhouse.io/example');
  await page.getByRole('button', { name: 'Check URL' }).click();
  await expect(page.getByRole('heading', { name: 'Greenhouse provider detected' })).toBeVisible();
  await expect(page.getByText(/not a coverage guarantee/i)).toBeVisible();

  await input.fill('https://example.com/careers');
  await page.getByRole('button', { name: 'Check URL' }).click();
  await expect(page.getByRole('heading', { name: 'Discovery and review are still needed' })).toBeVisible();
});

test('ATS checker remains usable on mobile without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ats-checker');

  await expect(page.getByRole('heading', { name: 'Check a public career-site URL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check URL' })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth);
});
