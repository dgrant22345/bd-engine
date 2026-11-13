import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('scores are drawn with their values available as text on Dashboard and Companies', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.locator('#app')).toBeVisible();
  const frame = page.frames().find(item => item.url().includes('/app/'));

  await frame.evaluate(() => { window.location.hash = '#/dashboard'; });
  const hero = app.locator('.headline-metrics').first();
  await expect(hero.getByRole('img', { name: 'Target score 91 of 100' })).toBeVisible();
  await expect(hero.getByRole('img', { name: 'Hiring velocity 84 of 100' })).toBeVisible();
  await expect(hero.getByRole('img', { name: 'Engagement 0 of 100' })).toBeVisible();
  // The ring arc is proportional to the score.
  await expect(hero.locator('.score-ring-value')).toHaveAttribute('stroke-dasharray', '91 100');
  await expect(hero.locator('.score-ring-text')).toHaveText('91');

  await frame.evaluate(() => { window.location.hash = '#/accounts'; });
  const firstRow = app.locator('.accounts-table tbody tr').first();
  await expect(firstRow).toContainText('Northstar Robotics');
  await expect(firstRow.getByRole('img', { name: 'Target score 91 of 100' })).toBeVisible();
  await expect(firstRow.getByRole('img', { name: 'Hiring velocity 84 of 100' })).toBeVisible();
  await expect(firstRow.getByRole('img', { name: /^Roles posted per week, approximately\. 31 to 90 days ago: [\d.]+\. 8 to 30 days ago: [\d.]+\. Past 7 days: 2\.$/ })).toBeVisible();
  await expect(firstRow).toContainText('84 velocity');
  await expect(firstRow.locator('.role-pace-bar')).toHaveCount(3);

  const results = await new AxeBuilder({ page }).include('iframe.cloud-app-frame').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter(violation => violation.nodes.some(node => /score-|role-pace/.test(JSON.stringify(node.target) + node.html)))).toEqual([]);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(errors).toEqual([]);
});
