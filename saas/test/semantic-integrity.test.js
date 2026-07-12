/**
 * CG-006: fixture checks for the semantic-integrity module. Each violation
 * class must be detected, and a coherent workspace must report zero.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTenantIntegrity } from '../src/semantic-integrity.js';

const cleanWorkspace = () => ({
  accounts: [
    { id: 'a1', displayName: 'Acme', normalizedName: 'acme', openRoleCount: 2, jobCount: 2, connectionCount: 1 },
    { id: 'a2', displayName: 'Beta', normalizedName: 'beta', openRoleCount: 0, jobCount: 0, connectionCount: 0 },
  ],
  contacts: [
    { id: 'c1', accountId: 'a1', fullName: 'Alice Ng' },
  ],
  jobs: [
    { id: 'j1', accountId: 'a1', title: 'Engineer', companyName: 'Acme', active: true, naturalKey: 'acme|eng|1', configId: 'cfg1' },
    { id: 'j2', accountId: 'a1', title: 'Designer', companyName: 'Acme', active: true, naturalKey: 'acme|des|1', configId: 'cfg1' },
    { id: 'j3', accountId: 'a1', title: 'Old role', companyName: 'Acme', active: false, closedAt: '2026-01-01', naturalKey: 'acme|old|1' },
  ],
  configs: [
    { id: 'cfg1', accountId: 'a1', normalizedCompanyName: 'acme', atsType: 'greenhouse', boardId: 'acme', discoveryStatus: 'resolved', reviewStatus: 'approved', active: true },
  ],
});

test('a coherent workspace reports zero violations', () => {
  const result = checkTenantIntegrity(cleanWorkspace());
  assert.equal(result.totalViolations, 0, JSON.stringify(result.checks, null, 1));
});

test('role-count mismatch against active jobs is detected (P0.3)', () => {
  const data = cleanWorkspace();
  data.accounts[0].openRoleCount = 14; // demo-style hard-coded count; 2 active jobs exist
  const result = checkTenantIntegrity(data);
  assert.equal(result.checks.role_count_mismatch.violations, 1);
  assert.equal(result.checks.role_count_mismatch.sample[0].activeJobs, 2);
  assert.equal(result.checks.role_count_mismatch.sample[0].openRoleCount, 14);
});

test('closed jobs never count toward role totals', () => {
  const data = cleanWorkspace();
  data.jobs[0].active = false; // now only 1 active job, stored counts say 2
  const result = checkTenantIntegrity(data);
  assert.equal(result.checks.role_count_mismatch.violations, 1);
  assert.equal(result.checks.role_count_mismatch.sample[0].activeJobs, 1);
});

test('connection-count mismatch is detected', () => {
  const data = cleanWorkspace();
  data.accounts[0].connectionCount = 9;
  const result = checkTenantIntegrity(data);
  assert.equal(result.checks.connection_count_mismatch.violations, 1);
  assert.equal(result.checks.connection_count_mismatch.sample[0].linkedContacts, 1);
});

test('orphan contact and orphan job rows are detected', () => {
  const data = cleanWorkspace();
  data.contacts.push({ id: 'c2', accountId: 'a-gone', fullName: 'Ghost' });
  data.jobs.push({ id: 'j4', accountId: 'a-gone', title: 'Ghost role', active: false, naturalKey: 'g|1' });
  const result = checkTenantIntegrity(data);
  assert.equal(result.checks.orphan_contact.violations, 1);
  assert.equal(result.checks.orphan_job.violations, 1);
});

test('lifecycle contradiction (active job with closedAt) is detected', () => {
  const data = cleanWorkspace();
  data.jobs[0].closedAt = '2026-06-01';
  const result = checkTenantIntegrity(data);
  assert.equal(result.checks.job_lifecycle_contradiction.violations, 1);
});

test('active job on a missing, inactive, or unresolved board is detected', () => {
  const data = cleanWorkspace();
  data.jobs[0].configId = 'cfg-missing';
  data.configs.push({ id: 'cfg2', normalizedCompanyName: 'beta', atsType: 'lever', boardId: 'beta', discoveryStatus: 'unknown', reviewStatus: 'needs_review', active: true });
  data.jobs[1].configId = 'cfg2';
  const result = checkTenantIntegrity(data);
  assert.equal(result.checks.active_job_unresolved_board.violations, 2);
  const reasons = result.checks.active_job_unresolved_board.sample.map((s) => s.reason).sort();
  assert.deepEqual(reasons, ['missing_config', 'unresolved_config']);
});

test('duplicate job, account, and board identities are detected', () => {
  const data = cleanWorkspace();
  data.jobs.push({ id: 'j5', accountId: 'a1', title: 'Engineer', companyName: 'Acme', active: true, naturalKey: 'acme|eng|1' });
  data.accounts.push({ id: 'a3', displayName: 'ACME', normalizedName: 'acme', openRoleCount: 0, jobCount: 0, connectionCount: 0 });
  data.configs.push({ id: 'cfg3', normalizedCompanyName: 'acme', atsType: 'greenhouse', boardId: 'acme', discoveryStatus: 'resolved', reviewStatus: 'approved', active: true });
  const result = checkTenantIntegrity(data);
  assert.equal(result.checks.duplicate_job_identity.violations, 1);
  assert.equal(result.checks.duplicate_account_identity.violations, 1);
  assert.equal(result.checks.duplicate_board_identity.violations, 1);
});

test('board config missing its account link is detected when a match exists', () => {
  const data = cleanWorkspace();
  data.configs[0].accountId = '';
  const result = checkTenantIntegrity(data);
  assert.equal(result.checks.unlinked_board_config.violations, 1);
  assert.equal(result.checks.unlinked_board_config.sample[0].matchingAccountId, 'a1');
});
