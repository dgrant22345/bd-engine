import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

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
