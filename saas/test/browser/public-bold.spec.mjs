import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Public pages share the workspace's Bold dark look: a near-black ground and
// lime primary actions with dark text, at an accessible contrast.
const pages = [
  { name: 'landing', path: '/', action: '#nav-signup' },
  { name: 'sign-in error', path: '/?login=1', action: 'form button[type="submit"]', prepare: async (page) => {
    await page.fill('input[type="email"]', 'nobody@example.test');
    await page.fill('input[type="password"]', 'wrong-password-1');
    await page.locator('form button[type="submit"]').first().click();
    await expect(page.locator('.auth-error')).toBeVisible();
  } },
  { name: 'trust', path: '/', action: '.trust-page .btn-primary', prepare: async (page) => {
    await page.locator('[data-trust-page="trust"]:visible').first().click();
    await expect(page.locator('.trust-page')).toBeVisible();
  } },
  { name: 'guides', path: '/guides/', action: '.header-cta' },
  { name: 'guide', path: '/guides/workday-job-search', action: '.header-cta' },
  { name: 'walkthrough', path: '/recruiter-walkthrough' },
  { name: '404', path: '/no-such-page' },
];

for (const { name, path, action, prepare } of pages) {
  test(`${name} uses the Bold dark look with accessible contrast`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(path);
    if (prepare) await prepare(page);
    const ground = await page.evaluate(() => {
      const surface = document.querySelector('.landing, .auth-page, .trust-page') || document.body;
      return getComputedStyle(surface).backgroundColor;
    });
    expect(ground).toBe('rgb(11, 15, 20)');
    if (action) {
      const button = page.locator(action).first();
      await expect(button).toHaveCSS('background-color', 'rgb(198, 244, 50)');
      await expect(button).toHaveCSS('color', 'rgb(11, 15, 20)');
    }
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
