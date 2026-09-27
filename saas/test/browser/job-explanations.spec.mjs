import { test, expect } from '@playwright/test';
/* global renderJobsTable, renderJobRelevance, renderIngestionHealthPanel, renderJobCoverageHealth */

test('role explanations retain all saved reasons and distinguish focus exclusions', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.locator('#app')).toBeVisible();
  await app.getByRole('link', { name: 'Hiring activity', exact: true }).click();
  await expect(app.locator('#jobs-filter-form')).toBeVisible();
  const frame = page.frames().find(frame => frame.url().includes('/app/'));
  await frame.evaluate(() => {
    document.querySelector('#app').innerHTML = renderJobsTable([{ id: 'explanation-fixture', title: 'Recruiter', companyName: 'Example', relevanceScore: 35, relevanceBand: 'low', matchesSearchFocus: false, relevanceReasons: ['Outside target roles', 'Industry match: technology', 'onsite role'], active: true }]);
  });
  const explanation = app.locator('.job-row-context').filter({ has: app.getByText('Why this score?', { exact: true }) });
  await expect(app.locator('.job-match-preview')).toHaveText('Outside target roles');
  await expect(explanation.locator('summary')).toHaveAccessibleName('Why this score for Recruiter at Example?');
  await explanation.locator('summary').press('Enter');
  await expect(explanation).toContainText('Lowering the score cutoff alone will not include this role.');
  await expect(explanation).toContainText('onsite role');
  await expect(explanation.getByRole('link', { name: 'Review saved focus' })).toHaveAttribute('href', '#/admin/search-focus');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath(`explanations-${width}.png`) });
  }
  const health = await frame.evaluate(() => ({
    empty: renderIngestionHealthPanel({}),
    failed: renderIngestionHealthPanel({ recentJobs: [{ id: 'failed-import', type: 'live-job-import', status: 'failed', finishedAt: '2026-09-27T01:00:00Z', errorMessage: 'Source unavailable' }] }),
    coverage: renderJobCoverageHealth({}),
    completed: renderIngestionHealthPanel({ recentJobs: [{ id: 'completed-import', type: 'live-job-import', status: 'completed', finishedAt: '2026-09-27T01:00:00Z', result: { stats: { fetched: 100, configs: 4, kept: 60, filteredOutNonCanada: 40, partialBoards: 1 } } }] }),
    below: renderJobRelevance({ relevanceScore: 0, matchesSearchFocus: true }),
    meets: renderJobRelevance({ relevanceScore: 100, matchesSearchFocus: true }),
    unscored: renderJobRelevance({ relevanceScore: null }),
  }));
  expect(health.empty).toContain('No completed import yet');
  expect(health.coverage).toContain('No companies tracked yet');
  expect(health.failed).toContain('Latest refresh needs attention');
  expect(health.completed).toContain('100 source listings fetched from 4 boards; 60 retained');
  expect(health.completed).toContain('1 boards reported incomplete coverage');
  expect(health.below).toContain('Below your saved');
  expect(health.meets).toContain('Other list filters still apply');
  expect(health.unscored).toContain('Set or refresh search focus');
  expect(health.unscored).toContain('href="#/admin/search-focus"');
});
