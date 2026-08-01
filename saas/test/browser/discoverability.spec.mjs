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
