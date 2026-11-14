import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Public pages share the workspace's Refined teal look: a light ground under a
// navy header, teal primary actions, at an accessible contrast. The header's
// actions sit on navy, so they use the light and deep teal variants.
const TEAL = ['rgb(15, 107, 101)', 'rgb(255, 255, 255)'];
const pages = [
  { name: 'landing', path: '/', action: '#nav-signup', colors: ['rgb(161, 234, 219)', 'rgb(16, 44, 44)'] },
  { name: 'sign-in error', path: '/?login=1', action: 'form button[type="submit"]', colors: TEAL, prepare: async (page) => {
    await page.fill('input[type="email"]', 'nobody@example.test');
    await page.fill('input[type="password"]', 'wrong-password-1');
    await page.locator('form button[type="submit"]').first().click();
    await expect(page.locator('.auth-error')).toBeVisible();
  } },
  { name: 'trust', path: '/', action: '.trust-page .btn-primary', colors: TEAL, prepare: async (page) => {
    await page.locator('[data-trust-page="trust"]:visible').first().click();
    await expect(page.locator('.trust-page')).toBeVisible();
  } },
  { name: 'guides', path: '/guides/', action: '.header-cta', colors: ['rgb(35, 68, 73)', 'rgb(197, 213, 230)'] },
  { name: 'guide', path: '/guides/workday-job-search', action: '.header-cta', colors: ['rgb(35, 68, 73)', 'rgb(197, 213, 230)'] },
  { name: 'walkthrough', path: '/recruiter-walkthrough' },
  { name: '404', path: '/no-such-page' },
];

for (const { name, path, action, colors, prepare } of pages) {
  test(`${name} uses the Refined teal look with accessible contrast`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(path);
    if (prepare) await prepare(page);
    const ground = await page.evaluate(() => {
      const surface = document.querySelector('.landing, .auth-page, .trust-page') || document.body;
      return getComputedStyle(surface).backgroundColor;
    });
    expect(ground).toBe('rgb(243, 246, 250)');
    if (action) {
      const button = page.locator(action).first();
      await expect(button).toHaveCSS('background-color', colors[0]);
      await expect(button).toHaveCSS('color', colors[1]);
    }
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
