import { test, expect } from '@playwright/test';

test('an unset role focus has a clear setup path without choosing preferences for the user', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/api/bootstrap*', async route => {
    const response = await route.fetch(); const data = await response.json();
    for (const persona of ['bd', 'jobseeker']) data.settings.searchFocusByPersona[persona] = { targetRoles: '', excludedRoles: '', targetIndustries: '', workStyle: 'any', minimumRelevanceScore: 45 };
    await route.fulfill({ response, json: data });
  });
  await page.goto('/'); await page.locator('[data-demo-start]').first().click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await app.getByRole('link', { name: 'Hiring activity', exact: true }).click();
  const guide = app.getByRole('region', { name: 'Set up role ranking' });
  await expect(guide).toContainText('Add your target titles');
  await guide.getByRole('link', { name: 'Set up role ranking', exact: true }).click();
  await expect(app.locator('#settings-form textarea[name="targetRoles"]')).toBeVisible();
  await expect(app.locator('#settings-form')).toContainText('Save focus and show matches');
  await expect(app.locator('#app')).toContainText('Start with the job titles you recruit for.');
  expect(errors).toEqual([]);
});
