import { test, expect } from '@playwright/test';

test('outreach uses the exact role, preserves edits and offers distinct goals', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.locator('#app')).toBeVisible();
  const frame = page.frames().find(item => item.url().includes('/app/'));
  await page.route('**/api/jobs?ids=studio-test', route => route.fulfill({ json: {
    items: [{ id: 'studio-test', title: 'Talent Manager', companyName: 'Example Co', contacts: [{ id: 'c1', fullName: 'Jamie Test', title: 'Talent Lead', email: 'jamie@example.test' }] }],
  } }));
  await frame.evaluate(() => window.openWarmStudioModal('studio-test', 'c1'));
  const draft = app.locator('#warm-studio-textarea');
  await expect(draft).toContainText('Talent Manager');
  await draft.fill('My carefully edited message');
  await app.locator('[data-format="email_pitch"]').click();
  await app.locator('[data-format="referral_dm"]').click();
  await expect(draft).toHaveValue('My carefully edited message');
  await expect(app.locator('.mailto-draft-btn')).toHaveAttribute('href', /My%20carefully%20edited%20message/);
  await app.locator('#warm-studio-goal').selectOption('job_search');
  await expect(draft).toHaveValue(/I'm interested in/);
  await app.locator('#warm-studio-background').fill('I have five years of recruiting experience.');
  await app.locator('#warm-studio-background').press('Tab');
  await expect(draft).toHaveValue(/five years/);
  await app.locator('#warm-studio-relationship').fill('We discussed Toronto hiring last week.');
  await app.locator('#warm-studio-relationship').press('Tab');
  await app.locator('#warm-studio-ask').fill('Would a short background summary be useful?');
  await app.locator('#warm-studio-ask').press('Tab');
  await expect(draft).toHaveValue(/We discussed Toronto hiring last week/);
  await expect(draft).toHaveValue(/Would a short background summary be useful/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/warm-studio-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/warm-studio-desktop.png', fullPage: true });
  await app.locator('[data-action="close-warm-studio"]').first().click();
  await expect(draft).toHaveCount(0);
  expect(errors).toEqual([]);
});
