import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillingGraceDeadline, getBillingAccessStatus, getBillingGraceDays } from '../src/billing.js';

test('payment failures receive a bounded grace period', () => {
  const now = Date.parse('2026-07-10T12:00:00.000Z');
  const graceDays = getBillingGraceDays();
  const deadline = createBillingGraceDeadline({}, now);
  assert.equal(deadline, new Date(now + graceDays * 24 * 60 * 60 * 1000).toISOString());

  const duringGrace = getBillingAccessStatus({
    status: 'past_due',
    billingGraceEndsAt: deadline,
  }, now + 12 * 60 * 60 * 1000);
  assert.equal(duringGrace.paymentAttentionRequired, true);
  assert.equal(duringGrace.accessBlocked, false);
  assert.equal(duringGrace.graceDaysRemaining, graceDays);

  const afterGrace = getBillingAccessStatus({
    status: 'past_due',
    billingGraceEndsAt: deadline,
  }, now + (graceDays + 1) * 24 * 60 * 60 * 1000);
  assert.equal(afterGrace.accessBlocked, true);
  assert.equal(afterGrace.graceDaysRemaining, 0);
});

test('Stripe retry timing can extend recovery through the next retry', () => {
  const now = Date.parse('2026-07-10T12:00:00.000Z');
  const retryDays = getBillingGraceDays() + 2;
  const nextRetry = Math.floor((now + retryDays * 24 * 60 * 60 * 1000) / 1000);
  assert.equal(
    createBillingGraceDeadline({ next_payment_attempt: nextRetry }, now),
    new Date(now + (retryDays + 1) * 24 * 60 * 60 * 1000).toISOString()
  );
});

test('healthy subscriptions never show payment recovery state', () => {
  assert.deepEqual(getBillingAccessStatus({ status: 'active' }), {
    paymentAttentionRequired: false,
    accessBlocked: false,
    graceEndsAt: '',
    graceDaysRemaining: null,
  });
});
