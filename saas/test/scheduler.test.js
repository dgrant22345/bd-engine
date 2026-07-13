import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, getScheduledPipelineDecision } from '../src/store.js';

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const baseline = Date.parse('2026-07-12T12:00:00Z');

test('scheduled pipeline decisions require setup, freshness, and retry backoff', () => {
  assert.equal(getScheduledPipelineDecision({ settings: {}, nowMs: baseline }).reason, 'setup_incomplete');
  assert.equal(getScheduledPipelineDecision({
    settings: { setupComplete: true, lastPipelineRun: new Date(baseline - hour).toISOString() },
    nowMs: baseline,
  }).reason, 'fresh');
  assert.equal(getScheduledPipelineDecision({
    settings: {
      setupComplete: true,
      lastPipelineRun: new Date(baseline - 2 * day).toISOString(),
      lastPipelineAttemptAt: new Date(baseline - 30 * 60 * 1000).toISOString(),
    },
    nowMs: baseline,
  }).reason, 'recent_attempt');
  assert.deepEqual(getScheduledPipelineDecision({
    settings: { setupComplete: true, lastPipelineRun: new Date(baseline - 2 * day).toISOString() },
    nowMs: baseline,
  }), { due: true, reason: 'overdue' });
  assert.equal(getScheduledPipelineDecision({
    settings: { setupComplete: true },
    hasActiveJob: true,
    nowMs: baseline,
  }).reason, 'already_running');
});

test('claiming an overdue workspace records an attempt and prevents an immediate duplicate', async () => {
  const store = createStore();
  const tenantId = 'tenant-scheduler-claim';
  store.ensureTenant({ id: tenantId, name: 'Scheduled workspace', plan: 'sales', status: 'active' }, { id: tenantId + '-owner' });
  const scheduledTenant = store.getAllTenants().find((tenant) => tenant.id === tenantId);
  assert.deepEqual(scheduledTenant, { id: tenantId, plan: 'sales', status: 'active', slug: '' });
  store.completeSetup(tenantId, {
    workspaceName: 'Scheduled workspace',
    userName: 'Owner',
    userEmail: 'owner@example.com',
  }, { runPipeline: false });

  const claimTime = Date.now() + 2 * day;
  const claimed = await store.claimScheduledPipeline(tenantId, { nowMs: claimTime });
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.reason, 'overdue');
  assert.ok(claimed.attemptedAt);

  const duplicate = await store.claimScheduledPipeline(tenantId, { nowMs: claimTime + 10_000 });
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.reason, 'recent_attempt');
});
