import { test, expect } from '@playwright/test';

test('Follow-ups exposes searchable activity history', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.locator('#app')).toBeVisible();
  await page.route('**/api/activity?**', route => route.fulfill({ json: { items: [{ id: 'history-test', type: 'task_completed', summary: 'Completed task: Toronto hiring', occurredAt: '2026-09-01T12:00:00Z' }], total: 1 } }));
  const frame = page.frames().find(item => item.url().includes('/app/'));
  await frame.evaluate(() => { window.location.hash = '#/tasks'; });
  await app.locator('#activity-history summary').first().click();
  await expect(app.locator('#activity-history-results')).toContainText('Toronto hiring');
  await app.locator('#activity-history-form [name="q"]').fill('Toronto');
  await app.locator('#activity-history-form [name="type"]').selectOption('task_completed');
  const request = page.waitForRequest(r => r.url().includes('/api/activity?') && r.url().includes('q=Toronto'));
  await app.getByRole('button', { name: 'Apply filters' }).click();
  expect((await request).url()).toContain('type=task_completed');
  await expect(app.locator('#activity-history-results')).toContainText('Toronto hiring');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/activity-history-mobile.png', fullPage: true });
  await frame.evaluate(() => { window.location.hash = '#/jobs'; });
  await app.locator('#job-filter-explanation summary').click();
  await expect(app.locator('#job-filter-explanation')).toContainText('Import coverage and shortlist filters are different');
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
