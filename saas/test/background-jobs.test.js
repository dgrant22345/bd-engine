import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, getBackgroundJobRecoveryDecision } from '../src/store.js';

async function waitForFinishedJob(store, tenantId, jobId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = await store.getBackgroundJob(tenantId, jobId);
    if (['completed', 'failed'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Background job ${jobId} did not finish`);
}

test('background job status is scoped to its workspace', async () => {
  const store = createStore();
  const ownerTenantId = 'tenant-job-owner';
  const otherTenantId = 'tenant-job-other';
  store.ensureTenant({ id: ownerTenantId, name: 'Owner workspace' }, { id: 'owner-user' });
  store.ensureTenant({ id: otherTenantId, name: 'Other workspace' }, { id: 'other-user' });

  const created = store.createCompletedJob(ownerTenantId, 'job-private', { count: 1 });
  assert.equal((await store.getBackgroundJob(ownerTenantId, created.jobId)).status, 'completed');

  const hidden = await store.getBackgroundJob(otherTenantId, created.jobId);
  assert.equal(hidden.status, 'failed');
  assert.equal(hidden.type, 'unknown');
});

test('only idempotent imports with complete descriptors resume after a restart', () => {
  assert.deepEqual(getBackgroundJobRecoveryDecision({
    type: 'live-job-import',
    recovery: { kind: 'live-job-import', attempts: 1, options: {} },
  }), { recoverable: true, reason: 'resumable', attempts: 1 });

  assert.equal(getBackgroundJobRecoveryDecision({
    type: 'linkedin-csv-import',
    recovery: { kind: 'linkedin-csv-import', attempts: 0, csvText: '' },
  }).reason, 'missing_csv_payload');

  assert.equal(getBackgroundJobRecoveryDecision({
    type: 'live-job-import',
    recovery: { kind: 'live-job-import', attempts: 3, options: {} },
  }).reason, 'attempt_limit');

  assert.equal(getBackgroundJobRecoveryDecision({
    type: 'revenue-pipeline',
    recovery: { kind: 'revenue-pipeline', attempts: 0 },
  }).recoverable, false);
});

test('durable LinkedIn jobs clear their raw recovery payload after completion', async () => {
  const store = createStore();
  const tenantId = 'tenant-durable-linkedin';
  store.ensureTenant({ id: tenantId, name: 'Durable import' }, { id: tenantId + '-owner' });
  const csv = [
    'First Name,Last Name,Company,Position,Email Address,URL',
    'Ada,Lane,Durable Labs,VP Talent,ada@durable.example,https://linkedin.com/in/ada-lane',
  ].join('\n');

  const accepted = await store.startLinkedInCsvImport(tenantId, csv, {
    plan: { displayName: 'Unlimited', limits: { accounts: -1, contacts: -1 } },
    trackedCompanies: ['durable labs'],
  });
  assert.equal(accepted.job.status, 'queued');
  assert.equal(Object.hasOwn(accepted.job, 'recovery'), false);

  const completed = await waitForFinishedJob(store, tenantId, accepted.jobId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.recordsAffected, 1);
  assert.equal(Object.hasOwn(completed, 'recovery'), false);
});
