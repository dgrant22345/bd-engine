import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

function blockingViolations(results) {
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
}

async function expectNoBlockingViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(blockingViolations(results)).toEqual([]);
}

test('public account entry is accessible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#nav-signup')).toBeVisible();
  await expectNoBlockingViolations(page);
});

test('ATS coverage audit is accessible before and after results render', async ({ page }) => {
  await page.goto('/ats-checker');
  await expectNoBlockingViolations(page);

  await page.getByLabel('Career-site or job-board URLs').fill([
    'https://boards.greenhouse.io/example',
    'https://example.com/careers',
  ].join('\n'));
  await page.getByRole('button', { name: 'Audit coverage' }).click();
  await expect(page.getByRole('heading', { name: '1 of 2 valid public URLs match a recognized ATS host' })).toBeVisible();
  await expectNoBlockingViolations(page);
});

test('demo workspace has no blocking structural accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.locator('#app')).toBeVisible({ timeout: 15000 });
  await expectNoBlockingViolations(page);
});

test('account entry and workspace avoid horizontal overflow at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#nav-signup')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  await page.locator('[data-demo-start]').first().click();
  const frame = page.locator('iframe.cloud-app-frame');
  await expect(frame).toBeVisible({ timeout: 15000 });
  const appFrame = page.frames().find((candidate) => candidate !== page.mainFrame() && candidate.url().includes('/app/'));
  await expect.poll(async () => appFrame?.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await expect.poll(async () => appFrame?.locator('.topbar').evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBeLessThanOrEqual(120);
  await expect(appFrame.locator('.nav a[aria-current="page"]')).toHaveAttribute('data-route', 'dashboard');
  await expect(appFrame.locator('#global-search-input')).toBeVisible();
});
