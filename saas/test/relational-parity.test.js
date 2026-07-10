import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTenantDataCounts } from '../src/relational-reads.js';

const blob = {
  accountCount: 10,
  contactCount: 20,
  jobCount: 3,
  configCount: 10,
  activityCount: 4,
  taskCount: 2,
};

const relational = {
  account_count: 10,
  contact_count: 20,
  job_count: 3,
  config_count: 10,
  activity_count: 4,
  task_count: 2,
};

test('relational reads require complete row-count parity', () => {
  assert.deepEqual(compareTenantDataCounts(blob, relational, true), { matches: true, mismatches: [] });
  const mismatch = compareTenantDataCounts(blob, { ...relational, job_count: 2 }, true);
  assert.equal(mismatch.matches, false);
  assert.deepEqual(mismatch.mismatches, [{ entity: 'jobs', blobCount: 3, relationalCount: 2 }]);
});

test('contact parity is optional for core-only lazy loads', () => {
  assert.equal(compareTenantDataCounts(blob, { ...relational, contact_count: 0 }, false).matches, true);
  assert.equal(compareTenantDataCounts(blob, { ...relational, contact_count: 0 }, true).matches, false);
});
