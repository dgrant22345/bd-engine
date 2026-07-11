import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const csv = `First Name,Last Name,Company,Position,Email Address,URL
Alice,Ng,Acme Systems,VP Talent,alice@acme.example,https://linkedin.com/in/alice-ng
Alice,Ng,Acme Systems,VP Talent,alice@acme.example,https://linkedin.com/in/alice-ng
Bob,Diaz,Beta Labs,Director Engineering,bob@beta.example,https://linkedin.com/in/bob-diaz`;

function addTenant(store, tenantId) {
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner`, name: 'Owner' });
}

test('LinkedIn import deduplicates repeated rows and repeated imports', async () => {
  const store = createStore();
  const tenantId = 'tenant-import-dedupe';
  const otherTenantId = 'tenant-import-other';
  addTenant(store, tenantId);
  addTenant(store, otherTenantId);

  const first = await store.importLinkedInCSV(tenantId, csv, { plan: { limits: {} } });
  assert.equal(first.ok, true);
  assert.equal(first.stats.accountsCreated, 2);
  assert.equal(first.stats.contactsCreated, 2);
  assert.equal(first.stats.duplicatesSkipped, 1);

  const second = await store.importLinkedInCSV(tenantId, csv, { plan: { limits: {} } });
  assert.equal(second.stats.accountsCreated, 0);
  assert.equal(second.stats.contactsCreated, 0);
  assert.equal(second.stats.duplicatesSkipped, 3);

  assert.equal((await store.findAccounts(tenantId, { page: 1, pageSize: 20 })).total, 2);
  assert.equal((await store.findContacts(tenantId, { page: 1, pageSize: 20 })).total, 2);
  const acme = (await store.findAccounts(tenantId, { q: 'Acme', page: 1, pageSize: 20 })).items[0];
  assert.equal(acme.domain, 'acme.example');
  assert.equal(acme.connectionCount, 1);
  assert.equal(acme.targetScore, 43);
  assert.equal((await store.findAccounts(otherTenantId, { page: 1, pageSize: 20 })).total, 0);
  assert.equal((await store.findContacts(otherTenantId, { page: 1, pageSize: 20 })).total, 0);
});

test('LinkedIn dry run and plan limits do not over-create records', async () => {
  const store = createStore();
  const dryTenantId = 'tenant-import-dry-run';
  const limitedTenantId = 'tenant-import-limited';
  addTenant(store, dryTenantId);
  addTenant(store, limitedTenantId);

  const preview = await store.importLinkedInCSV(dryTenantId, csv, { dryRun: true, plan: { limits: {} } });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.stats.accountsCreated, 2);
  assert.equal((await store.findAccounts(dryTenantId, { page: 1, pageSize: 20 })).total, 0);
  assert.equal((await store.findContacts(dryTenantId, { page: 1, pageSize: 20 })).total, 0);

  const limited = await store.importLinkedInCSV(limitedTenantId, csv, {
    plan: { displayName: 'Limited', limits: { accounts: 1, contacts: 1 } },
  });
  assert.equal(limited.stats.accountsCreated, 1);
  assert.equal(limited.stats.contactsCreated, 1);
  assert.ok(limited.stats.planLimitedSkipped >= 1);
  assert.equal((await store.findAccounts(limitedTenantId, { page: 1, pageSize: 20 })).total, 1);
  assert.equal((await store.findContacts(limitedTenantId, { page: 1, pageSize: 20 })).total, 1);
});

test('manual job-board configurations remain tenant scoped', async () => {
  const store = createStore();
  const tenantId = 'tenant-config-owner';
  const otherTenantId = 'tenant-config-other';
  addTenant(store, tenantId);
  addTenant(store, otherTenantId);

  const created = store.addConfig(tenantId, {
    companyName: 'Acme Systems',
    atsType: 'greenhouse',
    boardId: 'acme',
    active: true,
  });
  assert.equal(created.ats, 'greenhouse');
  assert.equal((await store.findConfigs(tenantId, { page: 1, pageSize: 20 })).total, 1);
  assert.equal((await store.findConfigs(otherTenantId, { page: 1, pageSize: 20 })).total, 0);
});
