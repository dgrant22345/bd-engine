import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
/* global renderDashboardToday */

test('dashboard opens on who to call today, in the People order, with one action each', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await app.getByRole('link', { name: 'Dashboard', exact: true }).click();

  const board = app.locator('.today-board');
  await expect(board.getByRole('heading', { level: 2 })).toHaveText('3 calls worth making today');
  await expect(board.locator('.today-board__summary')).toContainText('4 open roles across 3 hiring companies');
  // It is the top of the dashboard.
  expect((await board.boundingBox()).y).toBeLessThan(200);

  // Same people, same order as the first page of People ("worth contacting first").
  const ranked = await page.evaluate(async () => (await (await fetch('/api/contacts?sortBy=call&pageSize=3')).json()).items.map(person => ({ id: person.id, name: person.fullName })));
  await expect(board.locator('.today-card h3')).toHaveText(ranked.map(person => person.name));
  const cards = board.locator('.today-card');
  await expect(cards).toHaveCount(3);
  for (const [index, person] of ranked.entries()) {
    await expect(cards.nth(index).locator('a.today-card__action')).toHaveAttribute('href', `#/contacts?person=${encodeURIComponent(person.id)}`);
  }
  await expect(cards.first().locator('.today-card__why')).toContainText('open role');

  // The action opens that person in People.
  await cards.nth(2).locator('a.today-card__action').click();
  await expect(app.locator('#view-title')).toHaveText('People');
  await expect(app.locator('.person-panel')).toContainText(ranked[2].name);

  await app.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(board).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await app.locator('html').evaluate(el => el.scrollWidth <= el.ownerDocument.defaultView.innerWidth + 1), `overflow at ${width}px`).toBeTruthy();
  }
  expect((await new AxeBuilder({ page }).include(['iframe.cloud-app-frame', '.today-board']).analyze()).violations).toEqual([]);

  // Honest copy when no one at the top of the list is at a hiring company, and nothing without people.
  const frame = page.frames().find(candidate => candidate.url().includes('/app/'));
  const quiet = await frame.evaluate(() => renderDashboardToday({ items: [{ id: 'p1', fullName: 'Sam Ortiz', title: 'Talent Lead', companyName: 'Quiet Co', priorityScore: 70, outreachStatus: 'replied', listContext: { linked: true, openRoles: 0, newRoles7d: 0, lastOutreachAt: '2026-11-02T12:00:00Z' } }] }, { summary: {} }));
  expect(quiet).toContain('Your highest-priority people');
  expect(quiet).not.toContain('today-board__count');
  expect(quiet).toContain('no open role on record');
  expect(quiet).toContain('>Reply<');
  expect(await frame.evaluate(() => renderDashboardToday({ items: [] }, {}))).toBe('');
  expect(await frame.evaluate(() => renderDashboardToday(null, {}))).toBe('');
  expect(errors).toEqual([]);
});
