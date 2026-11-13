import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
/* global renderJobsTable */

test('Hiring activity shows one filter bar and compact rows with one next step', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await app.getByRole('link', { name: 'Hiring activity', exact: true }).click();

  // Search fields, quick filters and applied filters share one bar.
  const bar = app.locator('.jobs-filter-bar');
  await expect(bar.locator('#jobs-filter-form')).toBeVisible();
  await expect(bar.locator('[data-preset="all"]')).toBeVisible();
  await expect(app.locator('.jobs-board__summary strong')).toHaveText('4 results');
  await expect(app.locator('.jobs-table thead th')).toHaveText(['', 'Role', 'Fit', 'Network', 'Next step']);

  // The first role is visible without scrolling on a laptop screen.
  const firstRow = app.locator('.jobs-table tbody > tr').first();
  expect((await firstRow.boundingBox()).y).toBeLessThan(560);
  expect((await firstRow.boundingBox()).height).toBeLessThan(200);
  await expect(firstRow.locator('.job-meta .company-link')).toHaveText('Northstar Robotics');
  await expect(firstRow.locator('.job-next-action')).toHaveCount(1);
  await expect(firstRow.locator('.job-next-action')).toHaveText(/^Draft intro to /);
  // A feedback "Clear" button only appears once there is a vote.
  await expect(firstRow.locator('[data-job-vote=""]')).toBeHidden();

  // Scored roles draw their fit; the row edge marks strong and possible fits.
  const frame = page.frames().find(candidate => candidate.url().includes('/app/'));
  await frame.evaluate(() => {
    document.querySelector('.jobs-table').closest('.table-scroll').outerHTML = renderJobsTable([
      { id: 'strong', title: 'Technical Recruiter', companyName: 'Northstar', accountId: 'acc-1', relevanceScore: 86, relevanceBand: 'strong', matchesSearchFocus: true, relevanceReasons: ['Exact target title'], connectionCount: 0, contacts: [] },
      { id: 'possible', title: 'Talent Partner', companyName: 'Luma', relevanceScore: 58, relevanceBand: 'possible', matchesSearchFocus: true, jobUrl: 'https://example.com/jobs/2', connectionCount: 0, contacts: [] },
    ]);
  });
  await expect(app.getByRole('img', { name: 'Role fit 86 of 100' })).toBeVisible();
  await expect(app.locator('tr.job-row--fit-strong')).toHaveCount(1);
  await expect(app.locator('tr.job-row--fit-possible')).toHaveCount(1);
  await expect(app.locator('tr.job-row--fit-strong .job-next-action')).toHaveText('Open company');
  await expect(app.locator('tr.job-row--fit-possible .job-next-action')).toHaveText('Open posting');
  await expect(app.locator('tr.job-row--fit-possible .job-next-action')).toHaveAttribute('href', 'https://example.com/jobs/2');

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await app.locator('html').evaluate(el => el.scrollWidth <= el.ownerDocument.defaultView.innerWidth + 1), `overflow at ${width}px`).toBeTruthy();
  }
  const a11y = await new AxeBuilder({ page }).include(['iframe.cloud-app-frame', '.jobs-board']).analyze();
  expect(a11y.violations.map(violation => violation.id)).toEqual([]);
  expect(errors).toEqual([]);
});
