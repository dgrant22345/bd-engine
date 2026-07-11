import test from 'node:test';
import assert from 'node:assert/strict';
import { dbClaimStripeWebhook, dbCompleteStripeWebhook, dbFailStripeWebhook } from '../src/db.js';

test('completed Stripe webhook events are ignored when delivered again', async () => {
  const eventId = `evt-complete-${Date.now()}`;
  const first = await dbClaimStripeWebhook(eventId, 'checkout.session.completed');
  assert.equal(first.acquired, true);
  await dbCompleteStripeWebhook(eventId);

  const duplicate = await dbClaimStripeWebhook(eventId, 'checkout.session.completed');
  assert.equal(duplicate.acquired, false);
  assert.equal(duplicate.duplicate, true);
});

test('failed Stripe webhook events can be retried', async () => {
  const eventId = `evt-retry-${Date.now()}`;
  assert.equal((await dbClaimStripeWebhook(eventId, 'invoice.payment_failed')).acquired, true);
  await dbFailStripeWebhook(eventId, new Error('temporary failure'));

  const retry = await dbClaimStripeWebhook(eventId, 'invoice.payment_failed');
  assert.equal(retry.acquired, true);
  assert.equal(retry.attempts, 2);
});
