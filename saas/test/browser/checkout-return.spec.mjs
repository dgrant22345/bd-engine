import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const trial = { plan: { id: 'trial', displayName: 'Trial' }, tenant: { status: 'trialing' }, billingAccess: {} };
const active = { plan: { id: 'sales', displayName: 'Recruiter Pro' }, tenant: { status: 'active' }, billingAccess: {} };

async function openReturn(page, outcome) {
  await page.goto('/');
  await page.locator('[data-demo-start]').first().click();
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible();
  await page.goto(`/app/?checkout=${outcome}#/admin/billing-subscription`);
  return page.getByRole('region', { name: 'Checkout status' });
}

test('checkout return waits for server activation rather than trusting the URL', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  let billingReads = 0;
  let adminReads = 0;
  page.on('request', request => { if (request.url().includes('/api/admin/bootstrap')) adminReads += 1; });
  await page.route('**/api/billing', route => {
    billingReads += 1;
    return route.fulfill({ json: billingReads === 1 ? trial : active });
  });
  const notice = await openReturn(page, 'returned');
  await expect(notice).toContainText('Waiting for subscription confirmation');
  await expect(notice).not.toContainText('Your paid plan is active');
  await expect(notice).toContainText('Your paid plan is active', { timeout: 8000 });
  await expect(notice).toContainText('Recruiter Pro');
  await expect(notice.getByRole('link', { name: 'Reload workspace' })).toHaveAttribute('href', '/app/#/admin/billing-subscription');
  expect(billingReads).toBe(2);
  expect(adminReads).toBeLessThanOrEqual(1);
  await expect(notice).toBeInViewport();
  const accessibility = await new AxeBuilder({ page }).include('.billing-return-notice').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: 'test-results/checkout-return-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(notice).toBeInViewport();
  await page.screenshot({ path: 'test-results/checkout-return-mobile.png' });
  await notice.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(notice).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('checkout')).toBe(false);
  expect(errors).toEqual([]);
});

test('canceled checkout explains current plan without claiming payment success', async ({ page }) => {
  await page.route('**/api/billing', route => route.fulfill({ json: trial }));
  const notice = await openReturn(page, 'canceled');
  await expect(notice).toContainText('Checkout closed');
  await expect(notice).toContainText('currently on the Trial plan');
  await expect(notice.getByRole('link', { name: 'Reload workspace' })).toBeHidden();
  await expect(page.locator('#admin-section-billing-subscription')).toBeVisible();
});

test('billing status failure is recoverable without initiating another checkout', async ({ page }) => {
  let reads = 0;
  let checkoutRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/billing/checkout')) checkoutRequests += 1; });
  await page.route('**/api/billing', route => {
    reads += 1;
    return reads === 1 ? route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }) : route.fulfill({ json: active });
  });
  const notice = await openReturn(page, 'returned');
  await expect(notice).toContainText('Subscription status unavailable');
  await expect(notice).toContainText('does not mean that a payment failed');
  await expect(notice.getByRole('link', { name: 'Email billing support' })).toHaveAttribute('href', /mailto:dgfinance15@gmail.com/);
  await notice.getByRole('button', { name: 'Check subscription status' }).click();
  await expect(notice).toContainText('Your paid plan is active');
  expect(checkoutRequests).toBe(0);
});

test('unconfirmed checkout stops automatic checks and keeps manual recovery available', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/billing', route => {
    reads += 1;
    return route.fulfill({ json: trial });
  });
  const notice = await openReturn(page, 'returned');
  await expect(notice).toContainText('Subscription not confirmed yet', { timeout: 16000 });
  expect(reads).toBe(6);
  await expect(notice.getByRole('button', { name: 'Check subscription status' })).toBeEnabled();
  await page.clock.install();
  await page.clock.fastForward(15000);
  expect(reads).toBe(6);
});

test('dismissing a pending checkout status cancels automatic checks', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/billing', route => {
    reads += 1;
    return route.fulfill({ json: trial });
  });
  await page.clock.install();
  const notice = await openReturn(page, 'returned');
  await expect(notice).toContainText('Waiting for subscription confirmation');
  await notice.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.clock.fastForward(15000);
  expect(reads).toBe(1);
  await expect(notice).toHaveCount(0);
});

test('payment attention is not presented as an active subscription', async ({ page }) => {
  await page.route('**/api/billing', route => route.fulfill({ json: { ...active, tenant: { status: 'past_due' }, billingAccess: { paymentAttentionRequired: true } } }));
  const notice = await openReturn(page, 'returned');
  await expect(notice).toContainText('Payment needs attention');
  await expect(notice).not.toContainText('Your paid plan is active');
  await expect(notice.getByRole('link', { name: 'Email billing support' })).toBeVisible();
});
