import { test, expect } from '@playwright/test';

test('task list exposes pagination, searching and undated work', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.locator('#app')).toBeVisible();
  await page.route('**/api/tasks?**', route => {
    const params = new URL(route.request().url()).searchParams;
    const pageNumber = Number(params.get('page') || 1);
    const filtered = Boolean(params.get('q'));
    const items = filtered ? [] : pageNumber === 1 ? [{ id: 'task-early', summary: 'Earliest task', status: 'pending', dueDate: '2020-01-01' }] : [{ id: 'task-undated', summary: 'No date follow-up', status: 'pending', dueDate: '' }];
    return route.fulfill({ json: { items, page: pageNumber, pageSize: 50, total: filtered ? 0 : 51 } });
  });
  const frame = page.frames().find(item => item.url().includes('/app/'));
  await frame.evaluate(() => { window.location.hash = '#/tasks'; });
  await expect(app.locator('.tasks-content')).toContainText('Earliest task');
  await app.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(app.locator('.tasks-content')).toContainText('No date follow-up');
  await expect(app.locator('.tasks-content')).toContainText('No due date');
  await app.locator('#task-search-form input').fill('not found');
  await app.getByRole('button', { name: 'Search tasks', exact: true }).click();
  await expect(app.locator('.tasks-content')).toContainText('No tasks match your search');
  await app.locator('#task-search-clear').click();
  await expect(app.locator('.tasks-content')).toContainText('Earliest task');
  for (const width of [1440, 1024, 900]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal overflow at ${width}px`).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/task-queue-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await app.locator('#activity-history summary').evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(120);
  await page.screenshot({ path: 'test-results/task-queue-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
