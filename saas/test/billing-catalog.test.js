import test from 'node:test';
import assert from 'node:assert/strict';

import { assessStripeCatalog, REQUIRED_STRIPE_WEBHOOK_EVENTS } from '../src/billing-catalog.js';

const plans = [
  { id: 'jobseeker', price: 5 },
  { id: 'sales', price: 10 },
];
const expectedWebhookUrl = 'https://app.example.test/api/billing/webhook';

function price(planId, amount) {
  return {
    planId,
    price: {
      active: true,
      livemode: true,
      unit_amount: amount,
      currency: 'usd',
      type: 'recurring',
      recurring: { interval: 'month', interval_count: 1 },
      product: { active: true },
    },
  };
}

function endpoint(events = REQUIRED_STRIPE_WEBHOOK_EVENTS.flatMap((item) => item.anyOf.slice(0, 1))) {
  return { url: expectedWebhookUrl, status: 'enabled', enabled_events: events };
}

test('live Stripe catalog matches commercial prices and webhook lifecycle', () => {
  const result = assessStripeCatalog({
    plans,
    prices: [price('jobseeker', 500), price('sales', 1000)],
    webhookEndpoints: [endpoint()],
    expectedWebhookUrl,
  });
  assert.deepEqual(result, { ready: true, errors: [], warnings: [] });
});

test('catalog verification catches price, product, mode, and recurrence drift', () => {
  const badJobSeeker = price('jobseeker', 900);
  badJobSeeker.price.active = false;
  badJobSeeker.price.livemode = false;
  badJobSeeker.price.currency = 'cad';
  badJobSeeker.price.recurring.interval = 'year';
  badJobSeeker.price.product.active = false;
  const result = assessStripeCatalog({
    plans,
    prices: [badJobSeeker, price('sales', 1000)],
    webhookEndpoints: [endpoint()],
    expectedWebhookUrl,
  });
  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes('inactive')));
  assert.ok(result.errors.some((error) => error.includes('not live-mode')));
  assert.ok(result.errors.some((error) => error.includes('amount')));
  assert.ok(result.errors.some((error) => error.includes('currency')));
  assert.ok(result.errors.some((error) => error.includes('monthly')));
  assert.ok(result.errors.some((error) => error.includes('product')));
});

test('payment success accepts invoice.paid but failed-payment events remain mandatory', () => {
  const events = REQUIRED_STRIPE_WEBHOOK_EVENTS
    .flatMap((item) => item.label === 'successful payments' ? ['invoice.paid'] : item.anyOf.slice(0, 1))
    .filter((event) => event !== 'invoice.payment_failed');
  const result = assessStripeCatalog({
    plans,
    prices: [price('jobseeker', 500), price('sales', 1000)],
    webhookEndpoints: [endpoint(events)],
    expectedWebhookUrl,
  });
  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes('failed payments')));
  assert.ok(!result.errors.some((error) => error.includes('successful payments')));
});

test('webhook verification rejects wrong, disabled, and duplicate endpoints', () => {
  const base = {
    plans,
    prices: [price('jobseeker', 500), price('sales', 1000)],
    expectedWebhookUrl,
  };
  assert.equal(assessStripeCatalog({ ...base, webhookEndpoints: [{ ...endpoint(), url: 'https://wrong.example.test/hook' }] }).ready, false);
  assert.equal(assessStripeCatalog({ ...base, webhookEndpoints: [{ ...endpoint(), status: 'disabled' }] }).ready, false);
  const duplicate = assessStripeCatalog({ ...base, webhookEndpoints: [endpoint(), endpoint()] });
  assert.equal(duplicate.ready, true);
  assert.equal(duplicate.warnings.length, 1);
});
