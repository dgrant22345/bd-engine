/**
 * CG-009: demo/sample counts must be derived from the demo records — the
 * sample workspace has to pass the same semantic-integrity checks production
 * data is held to. Regression for the hard-coded 14/8/5 role counts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { checkTenantIntegrity } from '../src/semantic-integrity.js';

async function tenantSnapshot(store, tenantId) {
  const [accounts, contacts, jobs, configs] = await Promise.all([
    store.findAccounts(tenantId, { page: 1, pageSize: 1000 }),
    store.findContacts(tenantId, { page: 1, pageSize: 1000 }),
    store.findJobs(tenantId, { page: 1, pageSize: 1000 }),
    store.findConfigs(tenantId, { page: 1, pageSize: 1000 }),
  ]);
  return { accounts: accounts.items, contacts: contacts.items, jobs: jobs.items, configs: configs.items };
}

test('sample workspace passes every semantic-integrity check', async () => {
  const store = createStore();
  const tenantId = 'tenant-sample-integrity';
  store.ensureTenant({ id: tenantId, name: 'Sample' }, { id: 'u1', name: 'Owner' });
  await store.loadSampleWorkspace(tenantId);

  const data = await tenantSnapshot(store, tenantId);
  assert.ok(data.accounts.length >= 3, 'sample accounts loaded');
  const result = checkTenantIntegrity(data);
  assert.equal(result.totalViolations, 0, JSON.stringify(result.checks, null, 1));
});

test('sample role counts equal their visible active jobs (no 14-vs-2 claims)', async () => {
  const store = createStore();
  const tenantId = 'tenant-sample-counts';
  store.ensureTenant({ id: tenantId, name: 'Sample' }, { id: 'u1', name: 'Owner' });
  await store.loadSampleWorkspace(tenantId);

  const { accounts, jobs } = await tenantSnapshot(store, tenantId);
  for (const account of accounts) {
    const activeJobs = jobs.filter((job) => job.accountId === account.id && job.active !== false).length;
    assert.equal(account.openRoleCount, activeJobs, `${account.displayName} openRoleCount`);
    assert.equal(account.jobCount, activeJobs, `${account.displayName} jobCount`);
    assert.ok(account.openRoleCount <= 3, `${account.displayName} has a plausible sample count, not a marketing number`);
  }
});

test('sample dashboard adapters agree on contacts, stages, and discovered boards', async () => {
  const store = createStore();
  const tenantId = 'tenant-sample-dashboard';
  store.ensureTenant({ id: tenantId, name: 'Sample dashboard' }, { id: 'u1', name: 'Owner' });
  await store.loadSampleWorkspace(tenantId);

  const dashboard = await store.getDashboard(tenantId);
  assert.ok(dashboard.todayQueue.every((item) => Number(item.contactCount || item.connectionCount || 0) > 0));
  assert.ok(dashboard.todayQueue.every((item) => ['new', 'researching', 'contacted', 'in_conversation', 'client', 'paused'].includes(item.status)));
  assert.ok(dashboard.recentlyDiscoveredBoards.every((item) => item.atsType && item.atsType !== 'unknown'));
  assert.ok(dashboard.recentlyDiscoveredBoards.every((item) => item.discoveryStatus === 'resolved'));
  assert.ok(dashboard.recentlyDiscoveredBoards.every((item) => item.discoveryMethod));
});

test('sample setup status includes current readiness when explicitly requested', async () => {
  const store = createStore();
  const tenantId = 'tenant-sample-readiness';
  store.ensureTenant({ id: tenantId, name: 'Sample readiness' }, { id: 'u1', name: 'Owner' });
  await store.loadSampleWorkspace(tenantId);

  const normalStatus = await store.getSetupStatus(tenantId);
  const launchStatus = await store.getSetupStatus(tenantId, { includeReadiness: true });
  assert.equal(normalStatus.setupComplete, true);
  assert.equal(normalStatus.readiness, undefined, 'routine status remains lightweight after setup');
  assert.ok(launchStatus.readiness.score > 0, 'launch screen receives the loaded workspace readiness');
  assert.ok(launchStatus.readiness.checks.some((check) => check.value > 0));
});

test('the dev seed workspace is coherent too', async () => {
  const store = createStore();
  const tenantId = 'tenant-demo';
  store.ensureTenant({ id: tenantId, name: 'Demo' }, { id: 'u1', name: 'Owner' });
  const { accounts, jobs, contacts } = await tenantSnapshot(store, tenantId);
  for (const account of accounts) {
    const activeJobs = jobs.filter((job) => job.accountId === account.id && job.active !== false).length;
    const linked = contacts.filter((contact) => contact.accountId === account.id).length;
    assert.equal(account.openRoleCount, activeJobs, `${account.displayName} openRoleCount`);
    assert.equal(account.connectionCount, linked, `${account.displayName} connectionCount`);
  }
});
