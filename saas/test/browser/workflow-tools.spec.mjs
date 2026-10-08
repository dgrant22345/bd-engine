import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function workspace(page) {
  const email = `workflow-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  expect((await page.request.post('/api/auth/signup', { data: { email, password: 'Workflow-fixture-2026', name: 'Workflow QA', workspaceName: 'Workflow QA', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } } })).ok()).toBeTruthy();
  expect((await page.request.post('/api/setup/complete', { data: { workspaceName: 'Workflow QA', userName: 'Workflow QA', userEmail: email, owners: [] } })).ok()).toBeTruthy();
}

test('workspace feedback saves without replacing the role view, exposes conflicts, and preserves the filter across reloads', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await workspace(page); let feedback = {}; let conflict = false;
  await page.route('**/api/jobs?**', route => route.fulfill({ json: { items: [{ id: 'role-one', title: 'Recruiter', companyName: 'Fixture Co', active: true, location: 'Toronto, ON', relevanceScore: 75, relevanceBand: 'strong', relevanceFeedback: feedback }], total: 1, page: 1, pageSize: 20, summary: { activeTotal: 1 } } }));
  await page.route('**/api/jobs/role-one/feedback', route => {
    const data = route.request().postDataJSON();
    if (conflict) return route.fulfill({ status: 409, json: { error: 'Feedback changed on another tab or device. Reload the role before saving again.' } });
    feedback = { vote: data.vote, updatedAt: new Date().toISOString() };
    return route.fulfill({ json: { id: 'role-one', relevanceFeedback: feedback } });
  });
  await page.goto('/app/#/jobs');
  const group = page.getByRole('group', { name: 'Workspace feedback for Recruiter', exact: true });
  await group.getByRole('button', { name: 'Not relevant', exact: true }).click();
  await expect(group.getByRole('button', { name: 'Not relevant', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(group).toContainText('Workspace feedback saved');
  await expect(group.getByRole('link', { name: /Refine excluded/ })).toBeVisible();
  conflict = true; await group.getByRole('button', { name: 'Relevant', exact: true }).click();
  await expect(group).toContainText('Feedback changed');
  await expect(group.getByRole('button', { name: 'Not relevant', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(group.getByRole('button', { name: 'Relevant', exact: true })).toBeEnabled();
  await page.locator('#jobs-filter-form summary').click();
  await page.locator('select[name="feedback"]').selectOption('not_relevant');
  await page.locator('#jobs-filter-form').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Workspace feedback: Not relevant', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('select[name="feedback"]')).toHaveValue('not_relevant');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  const a11y = await new AxeBuilder({ page }).include('[data-job-feedback]').analyze(); expect(a11y.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('follow-ups export a real calendar and show truthful delivery setup status', async ({ page }) => {
  await workspace(page);
  const task = await page.request.post('/api/tasks', { data: { summary: 'Recruiter follow-up', dueDate: '2026-12-31' } }); expect(task.ok()).toBeTruthy();
  await page.goto('/app/#/tasks');
  await page.getByText('Calendar & email reminders', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download calendar (.ics)' }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe('bd-engine-followups.ics');
  const calendar = await page.request.get('/api/tasks/calendar'); expect(calendar.headers()['content-type']).toContain('text/calendar');
  expect(await calendar.text()).toContain('SUMMARY:Recruiter follow-up');
  await page.getByRole('button', { name: 'Email reminder settings' }).click();
  await expect(page.locator('[data-reminder-settings]')).toContainText('Email delivery needs setup');
  await expect(page.getByRole('checkbox', { name: /Email me daily/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Save reminder settings' }).click();
  await expect(page.locator('[data-reminder-status]')).toContainText('Email reminders are off');
  await page.reload(); await page.getByText('Calendar & email reminders', { exact: true }).click(); await page.getByRole('button', { name: 'Email reminder settings' }).click();
  await expect(page.getByRole('checkbox', { name: /Email me daily/ })).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/followup-reminders-mobile.png', fullPage: true });
  const a11y = await new AxeBuilder({ page }).include('[data-followup-tools]').analyze(); expect(a11y.violations).toEqual([]);
});

test('recruiter walkthrough loads its actual 30-second video and has a usable mobile audit CTA', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/recruiter-walkthrough');
  await expect(page.getByRole('heading', { name: 'From hiring signals to your next action' })).toBeVisible();
  const duration = await page.locator('video').evaluate(async video => { video.load(); await new Promise((resolve, reject) => { video.addEventListener('loadedmetadata', resolve, { once: true }); video.addEventListener('error', reject, { once: true }); }); return video.duration; });
  expect(Math.round(duration)).toBe(30);
  await expect(page.locator('track')).toHaveAttribute('src', '/media/recruiter-walkthrough.vtt');
  await expect(page.getByRole('heading', { name: 'Walkthrough transcript' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole('link', { name: 'Run free ATS audit →' })).toHaveAttribute('href', /\/ats-checker\?utm_source=walkthrough/);
  const a11y = await new AxeBuilder({ page }).analyze(); expect(a11y.violations).toEqual([]); expect(errors).toEqual([]);
});
