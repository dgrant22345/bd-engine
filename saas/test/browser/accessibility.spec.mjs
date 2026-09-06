import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

function blockingViolations(results) {
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
    failures: violation.nodes.map((node) => node.failureSummary || ''),
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

test('signup consent is a labelled main workflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?signup=1');

  const signupMain = page.getByRole('main');
  await expect(signupMain).toHaveAttribute('aria-labelledby', 'signup-title');
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /I agree to the Terms/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Terms' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Privacy notice' })).toBeVisible();
  await expect(page.locator('.auth-consent label a')).toHaveCount(0);
  const consentLayout = await page.locator('.auth-consent').evaluate((element) => ({
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    documentWidth: element.ownerDocument.documentElement.scrollWidth,
    viewportWidth: element.ownerDocument.defaultView.innerWidth,
  }));
  expect(consentLayout.fontSize).toBeGreaterThanOrEqual(13);
  expect(consentLayout.documentWidth).toBeLessThanOrEqual(consentLayout.viewportWidth);
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

test('dark workspace surfaces retain accessible contrast', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  const app = page.frameLocator('iframe.cloud-app-frame');
  for (let attempt = 0; attempt < 3 && await app.locator('html').getAttribute('data-theme') !== 'dark'; attempt += 1) {
    await app.locator('summary[aria-label="Workspace options"]').click();
    await app.locator('#theme-toggle').click();
  }
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoBlockingViolations(page);

  await app.getByRole('link', { name: 'Admin', exact: true }).click();
  const runtimeHeader = app.locator('[data-collapse-id="runtime-status"]');
  if (await runtimeHeader.getAttribute('aria-expanded') === 'false') await runtimeHeader.click();
  await expect(app.locator('.status-matrix--premium .status-item').first()).toBeVisible();
  await expectNoBlockingViolations(page);
});

test('workspace keyboard controls expose state and contain focus', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible({ timeout: 15000 });
  const app = page.frameLocator('iframe.cloud-app-frame');

  await app.getByRole('link', { name: 'Accounts', exact: true }).click();
  const filterToggle = app.locator('#toggle-advanced-filters');
  await filterToggle.locator('.filter-toggle-label').click();
  await expect(filterToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(app.locator('#advanced-filter-fields')).not.toHaveAttribute('hidden', '');
  await expect(app.locator('#advanced-filter-fields')).not.toHaveAttribute('inert', '');

  const editOwner = app.getByRole('button', { name: /edit owner for/i }).first();
  await editOwner.focus();
  await editOwner.press('Space');
  const ownerEditor = app.getByRole('textbox', { name: /edit owner/i });
  await expect(ownerEditor).toBeVisible();
  await ownerEditor.press('Escape');
  await expect(editOwner).toBeFocused();

  const invoker = app.locator('#global-search-input');
  await invoker.focus();
  await invoker.press('Control+k');
  const palette = app.getByRole('dialog', { name: 'Command palette' });
  const commandInput = app.getByRole('combobox', { name: 'Search commands' });
  await expect(palette).toBeVisible();
  await expect(app.locator('.shell')).toHaveAttribute('inert', '');
  await commandInput.press('ArrowDown');
  const activeOptionId = await commandInput.getAttribute('aria-activedescendant');
  expect(activeOptionId).toBeTruthy();
  await expect(app.locator(`#${activeOptionId}`)).toHaveAttribute('aria-selected', 'true');
  await commandInput.press('Tab');
  await expect(commandInput).toBeFocused();
  await expectNoBlockingViolations(page);
  await commandInput.press('Escape');
  await expect(palette).toHaveCount(0);
  await expect(invoker).toBeFocused();
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

test('primary workspace routes stay within phone, tablet, and desktop viewports', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  const frame = page.locator('iframe.cloud-app-frame');
  await expect(frame).toBeVisible({ timeout: 15000 });
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.locator('#app')).toBeVisible({ timeout: 15000 });
  const appFrame = page.frames().find((candidate) => candidate !== page.mainFrame() && candidate.url().includes('/app/'));
  const routes = ['dashboard', 'accounts', 'jobs', 'contacts', 'tasks', 'admin'];

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await appFrame.evaluate((nextRoute) => { location.hash = `#/${nextRoute}`; }, route);
      await expect(appFrame.locator('.nav a[aria-current="page"]')).toHaveAttribute('data-route', route);
      expect(await appFrame.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${route} overflowed at ${viewport.width}px`).toBe(true);
    }
  }
});
