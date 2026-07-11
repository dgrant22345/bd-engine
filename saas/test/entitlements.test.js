import test from 'node:test';
import assert from 'node:assert/strict';
import { getEntitlementDecision, getPlan } from '../src/billing.js';

test('resource limits allow the final included record and block the next one', () => {
  assert.equal(getEntitlementDecision('trial', {
    resource: 'accounts',
    currentCount: 24,
  }).allowed, true);

  const blocked = getEntitlementDecision('trial', {
    resource: 'accounts',
    currentCount: 25,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, 'plan_limit_reached');
  assert.equal(blocked.limit, 25);
});

test('feature entitlements keep outreach useful for trial and job seeker personas', () => {
  assert.equal(getEntitlementDecision('trial', { feature: 'outreach_drafts' }).allowed, true);
  assert.equal(getEntitlementDecision('jobseeker', { feature: 'outreach_drafts' }).allowed, true);
  assert.equal(getEntitlementDecision('jobseeker', { feature: 'enrichment' }).allowed, false);
  assert.equal(getEntitlementDecision('sales', { feature: 'enrichment' }).allowed, true);
});

test('owner resources remain unlimited', () => {
  const decision = getEntitlementDecision('owner', {
    resource: 'jobBoards',
    currentCount: 1_000_000,
  });
  assert.equal(decision.allowed, true);
  assert.equal(getPlan('owner').limits.jobBoards, -1);
});

test('multi-record requests account for the full requested increment', () => {
  const decision = getEntitlementDecision('trial', {
    resource: 'contacts',
    currentCount: 99,
    increment: 2,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.requested, 2);
});
