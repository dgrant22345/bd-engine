import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`job filter help stays compact and usable in ${theme} mode`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await page.locator('[data-demo-start]').first().click();
    const app = page.frameLocator('iframe.cloud-app-frame');
    await expect(app.locator('#app')).toBeVisible();
    if (await app.locator('html').getAttribute('data-theme') !== theme) {
      await app.locator('summary[aria-label="Workspace options"]').click();
      await app.locator('#theme-toggle').click();
    }
    await expect(app.locator('html')).toHaveAttribute('data-theme', theme);
    await app.getByRole('link', { name: 'Hiring activity', exact: true }).click();
    const help = app.locator('#job-filter-explanation');
    const summary = help.locator('summary');
    await expect(summary).toHaveText('Why am I seeing these jobs?');

    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(help).not.toHaveAttribute('open', '');
      const collapsed = await help.boundingBox();
      // Allow one pixel for native disclosure-marker rounding in Firefox.
      expect(collapsed.height, `collapsed help height at ${width}px`).toBeLessThanOrEqual(width <= 760 ? 45 : 33);
      await expect(app.locator('.job-results-context #job-filter-explanation')).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath(`jobs-${width}-collapsed.png`) });

      // Native disclosure semantics must work without a pointer or custom JS.
      await summary.press('Enter');
      await expect(help).toHaveAttribute('open', '');
      await expect(help.getByText('Import coverage and shortlist filters are different')).toBeVisible();
      await expect(help.getByRole('link', { name: 'saved focus', exact: true })).toHaveAttribute('href', '#/admin/search-focus');
      await expect(help.getByRole('link', { name: 'check source coverage and refresh errors' })).toHaveAttribute('href', '#/admin/jobs');
      const layout = await help.evaluate(el => ({
        width: el.clientWidth,
        scrollWidth: el.scrollWidth,
        paragraphWidth: el.querySelector('p').getBoundingClientRect().width,
        documentWidth: el.ownerDocument.documentElement.scrollWidth,
        viewportWidth: el.ownerDocument.defaultView.innerWidth,
      }));
      expect(layout.paragraphWidth).toBeGreaterThan(200);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
      await help.screenshot({ path: testInfo.outputPath(`jobs-help-${width}-expanded.png`) });
      await summary.press('Space');
      await expect(help).not.toHaveAttribute('open', '');
      await expect(help.getByRole('link', { name: 'saved focus', exact: true })).toBeHidden();
    }

    // Opening the explanation does not replace or reset the real role filters.
    await app.locator('[data-preset="canada"]').click();
    await expect(app.locator('#jobs-filter-form [name="geography"]')).toHaveValue('canada');
    await summary.click();
    await expect(help).toContainText('Country/region filter: canada.');
    await app.getByRole('button', { name: 'All Roles', exact: true }).click();
    await expect(app.locator('#jobs-filter-form [name="geography"]')).toHaveValue('');
    await summary.click();
    await expect(help).toContainText('No country/region filter is selected.');
    await expect(help).toContainText('No minimum relevance score is applied to this list.');
    expect(errors).toEqual([]);
  });
}

test('job filters show accurate selection without expanding unrelated controls', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await app.getByRole('link', { name: 'Hiring activity', exact: true }).click();
  const form = app.locator('#jobs-filter-form');
  const more = form.locator('.filter-disclosure');
  const all = app.locator('[data-preset="all"]');
  const apply = form.getByRole('button', { name: 'Apply', exact: true });

  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(more).not.toHaveAttribute('open', '');
  await form.locator('[name="sortBy"]').selectOption('retrieved');
  await apply.click();
  await expect(all).toHaveAttribute('aria-pressed', 'true');

  await form.locator('[name="q"]').fill('Toronto');
  await apply.click();
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(all).not.toHaveClass(/is-active/);
  await expect(more).not.toHaveAttribute('open', '');

  await app.locator('[data-preset="network"]').click();
  await expect(app.locator('[data-preset="network"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(form.locator('[name="q"]')).toHaveValue('Toronto');
  await expect(more).not.toHaveAttribute('open', '');
  await form.locator('[name="workStyle"]').selectOption('remote');
  await apply.click();
  await expect(more).not.toHaveAttribute('open', '');
  await expect(form.locator('[name="workStyle"]')).toHaveValue('remote');
  await expect(app.locator('.compact-page-intro strong')).toHaveText('1 result');
  await expect(app.locator('.job-results-context [role="status"]')).toContainText('1 result ·');

  // Non-default posting status must not silently hide behind a collapsed panel.
  await all.click();
  await more.locator('summary').click();
  await form.locator('[name="active"]').selectOption('false');
  await apply.click();
  await expect(more).toHaveAttribute('open', '');
  await expect(more.locator('summary')).toHaveText('More filters · 1 active');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(app.locator('.compact-page-intro strong')).toHaveText('0 results');
  await app.locator('#job-filter-explanation summary').click();
  await expect(app.locator('#job-filter-explanation')).toContainText('Posting status: inactive jobs only.');
  await all.click();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(form.locator('[name="active"]')).toHaveValue('true');
  await expect(app.locator('.compact-page-intro strong')).toHaveText('4 results');
  await expect(more).not.toHaveAttribute('open', '');
  expect(errors).toEqual([]);
});
