import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const persona of ['bd', 'jobseeker']) {
  test(`${persona} daily queue explains priority and completes the next follow-up on desktop and mobile`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const email = `priorities-${persona}-${Date.now()}@example.com`;
    expect((await page.request.post('/api/auth/signup', { data: {
      email, password: 'Priorities-fixture-2026', name: 'Priority QA', workspaceName: 'Priority QA', persona,
      legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' },
    } })).ok()).toBeTruthy();
    expect((await page.request.post('/api/setup/complete', { data: { workspaceName: 'Priority QA', userName: 'Priority QA', userEmail: email, owners: [] } })).ok()).toBeTruthy();
    const companies = [];
    for (const data of [{ displayName: 'Research company' }, { displayName: 'Urgent company' }, { displayName: 'Paused company', status: 'paused' }, { displayName: 'Network company', tracked: false }]) {
      const response = await page.request.post('/api/accounts', { data });
      expect(response.ok()).toBeTruthy(); companies.push(await response.json());
    }
    const response = await page.request.post('/api/tasks', { data: { accountId: companies[1].id, summary: 'Call <Dana> & review hiring', dueDate: '2020-01-01' } });
    expect(response.ok()).toBeTruthy(); const task = await response.json();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/app/#/dashboard');
    const queue = page.locator('[data-tour="today-queue"]');
    await expect(queue.locator('tbody tr')).toHaveCount(2);
    await expect(queue.locator('tbody tr').first()).toContainText('Urgent company');
    await expect(queue.getByRole('columnheader', { name: 'Why today' })).toBeVisible();
    await expect(queue).toContainText('1 follow-up due today or overdue');
    await expect(queue).toContainText('Call <Dana> & review hiring');
    await queue.getByText("How today's list is ranked", { exact: true }).click();
    await expect(queue).toContainText('an import date alone does not count as recent hiring');
    await page.screenshot({ path: `test-results/daily-priorities-${persona}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(queue.getByRole('link', { name: 'Review follow-ups' })).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).include('[data-tour="today-queue"]').analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: `test-results/daily-priorities-${persona}-mobile.png`, fullPage: true });
    await queue.getByRole('link', { name: 'Review follow-ups' }).click();
    await expect(page.locator(`[data-action="complete-task"][data-id="${task.id}"]`)).toBeVisible();
    await page.locator(`[data-action="complete-task"][data-id="${task.id}"]`).click();
    await expect(page.locator(`[data-action="complete-task"][data-id="${task.id}"]`)).toHaveCount(0);
    await page.goto('/app/#/dashboard');
    await expect(queue.locator('tbody tr')).toHaveCount(2);
    await expect(queue).not.toContainText('follow-up due today or overdue');
    await expect(queue.getByRole('link', { name: 'Review lead' })).toHaveCount(2);
    expect(errors).toEqual([]);
  });
}
