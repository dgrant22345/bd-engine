import { test, expect } from '@playwright/test';

test('public entry and read-only demo work in supported browser engines', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await expect(page.locator('#nav-signup')).toBeVisible();
  await page.locator('#nav-login').click();
  await expect(page.locator('#login-form')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  await page.locator('[data-demo-start]').first().click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.locator('#app')).toBeVisible({ timeout: 15000 });
  await expect(app.locator('body')).toContainText(/dashboard|workspace|job/i);
});
