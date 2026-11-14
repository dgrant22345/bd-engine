import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
/* global renderDashboardToday, appState */

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
  // With a saved focus, the roles in it lead; a company hiring only outside it
  // is not counted as a call worth making.
  const focused = await frame.evaluate(() => renderDashboardToday({ items: [
    { id: 'p1', fullName: 'Nia North', companyName: 'Northwind', priorityScore: 40, outreachStatus: 'not_started', listContext: { linked: true, openRoles: 276, newRoles7d: 12, focusRoles: 4, newFocusRoles7d: 1, lastOutreachAt: '' } },
    { id: 'p2', fullName: 'Quinn Quill', companyName: 'Quill', priorityScore: 90, outreachStatus: 'not_started', listContext: { linked: true, openRoles: 2, newRoles7d: 2, focusRoles: 0, newFocusRoles7d: 0, lastOutreachAt: '' } },
  ] }, { summary: { focusSet: true, focusJobCount: 38, focusAccountCount: 12, activeJobCount: 1204, hiringAccountCount: 80 } }));
  expect(focused).toContain('One call worth making today');
  expect(focused).toContain('4 roles in your focus at Northwind, 1 new this week (276 open in all).');
  expect(focused).toContain('2 open roles at Quill, none in your focus.');
  expect(focused).toMatch(/38 roles in your focus \([^)]+\) at 12 companies, of 1,204 open roles in your workspace\./);
  expect(focused).toContain('href="#/admin/search-focus"');
  expect(focused.match(/today-card--hiring/g)).toHaveLength(1);
  // During the first refresh after setup, an empty count means "not checked yet".
  const checking = await frame.evaluate(() => {
    appState.setupSignalJobId = 'job-first-refresh';
    try {
      return renderDashboardToday({ items: [
        { id: 'p1', fullName: 'Chloe Tremblay', companyName: 'Clio', priorityScore: 90, outreachStatus: 'not_started', listContext: { linked: true, openRoles: 0, newRoles7d: 0, lastOutreachAt: '' } },
      ] }, { summary: { activeJobCount: 0, hiringAccountCount: 0 } });
    } finally { appState.setupSignalJobId = ''; }
  });
  expect(checking).toContain('Checking your companies for open roles');
  expect(checking).toContain('Checking Clio for open roles.');
  expect(checking).not.toContain('no open role on record');
  // Progress lines are neutral, with a bar; errors keep the alert styling.
  const tones = await frame.evaluate(() => {
    const alert = document.getElementById('app-alert');
    window.bdLocalApi.setAlert('Checking your companies for open roles 40%: Reading boards', alert, { tone: 'progress', progress: 40 });
    const progress = [alert.classList.contains('app-alert--progress'), alert.style.getPropertyValue('--alert-progress'), getComputedStyle(alert).color];
    window.bdLocalApi.setAlert('Added Clio to target accounts.', alert, { tone: 'success' });
    const success = [alert.className, getComputedStyle(alert).backgroundColor];
    window.bdLocalApi.setAlert('Imported 3 target accounts. Skipped 1.', alert, { tone: 'warning' });
    const warning = alert.className;
    window.bdLocalApi.setAlert('Import failed.', alert);
    const error = [alert.classList.contains('app-alert--progress'), alert.style.getPropertyValue('--alert-progress'), alert.className, getComputedStyle(alert).backgroundColor];
    window.bdLocalApi.setAlert('', alert);
    return { progress, success, warning, error };
  });
  expect(tones.progress.slice(0, 2)).toEqual([true, '40%']);
  // Finished work is not styled as a failure, and an error clears the tone.
  expect(tones.success[0]).toBe('app-alert app-alert--success');
  expect(tones.warning).toBe('app-alert app-alert--warning');
  expect(tones.error.slice(0, 3)).toEqual([false, '', 'app-alert']);
  expect(tones.success[1]).not.toBe(tones.error[3]);
  expect(await frame.evaluate(() => renderDashboardToday({ items: [] }, {}))).toBe('');
  expect(await frame.evaluate(() => renderDashboardToday(null, {}))).toBe('');
  expect(errors).toEqual([]);
});
