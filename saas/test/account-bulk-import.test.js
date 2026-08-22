/**
 * CG-004: account bulk update + pasted target-list import.
 * Acceptance: no visible account control returns 404/501; partial failures
 * identify failed rows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

function addTenant(store, tenantId) {
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner`, name: 'Owner' });
}

test('bulkUpdateAccounts applies status/priority/owner/tags and reports missing ids', async () => {
  const store = createStore();
  const tenantId = 'tenant-bulk';
  addTenant(store, tenantId);
  const a = await store.addAccount(tenantId, { displayName: 'Alpha Corp' });
  const b = await store.addAccount(tenantId, { displayName: 'Beta Corp', tags: ['existing'] });

  const result = await store.bulkUpdateAccounts(tenantId, {
    ids: [a.id, b.id, 'acct-does-not-exist'],
    status: 'outreach',
    priority: 'high',
    owner: 'Dana',
    addTags: ['q3', 'q3', ' '],
  });

  assert.equal(result.updated, 2);
  assert.deepEqual(result.failed, [{ id: 'acct-does-not-exist', reason: 'not_found' }]);
  const detail = await store.getAccountDetail(tenantId, a.id);
  assert.equal(detail.account.status, 'outreach');
  assert.equal(detail.account.priority, 'high');
  assert.equal(detail.account.owner, 'Dana');
  assert.deepEqual(detail.account.tags, ['q3']);
  const bDetail = await store.getAccountDetail(tenantId, b.id);
  assert.deepEqual(bDetail.account.tags, ['existing', 'q3']);
});

test('bulkUpdateAccounts cannot cross tenants', async () => {
  const store = createStore();
  addTenant(store, 'tenant-bulk-a');
  addTenant(store, 'tenant-bulk-b');
  const foreign = await store.addAccount('tenant-bulk-b', { displayName: 'Foreign Co' });

  const result = await store.bulkUpdateAccounts('tenant-bulk-a', { ids: [foreign.id], status: 'client' });
  assert.equal(result.updated, 0);
  assert.equal(result.failed.length, 1);
  const untouched = await store.getAccountDetail('tenant-bulk-b', foreign.id);
  assert.equal(untouched.account.status, 'new');
});

test('importAccountsList imports plain names, skips duplicates with line numbers', async () => {
  const store = createStore();
  const tenantId = 'tenant-paste';
  addTenant(store, tenantId);
  await store.addAccount(tenantId, { displayName: 'Existing Inc' });

  const result = await store.importAccountsList(tenantId, 'Stripe\nDatabricks\nExisting Inc\n\nStripe');
  assert.equal(result.count, 2);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.skipped[0].reason, 'duplicate');
  assert.equal(result.skipped[0].company, 'Existing Inc');
  assert.equal(typeof result.skipped[0].line, 'number');
  assert.equal(result.skipped[1].company, 'Stripe');
  assert.equal((await store.findAccounts(tenantId, { page: 1, pageSize: 20 })).total, 3);
});

test('importAccountsList parses CSV headers with per-row fields', async () => {
  const store = createStore();
  const tenantId = 'tenant-paste-csv';
  addTenant(store, tenantId);

  const csv = [
    'company,domain,careers_url,priority,owner,notes,status',
    'Gamma Robotics,gamma.example,https://gamma.example/careers,high,Dana,From conference,researching',
    ',missing.example,,,,,',
  ].join('\n');
  const result = await store.importAccountsList(tenantId, csv);
  assert.equal(result.count, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'missing_company');

  const item = (await store.findAccounts(tenantId, { q: 'Gamma', page: 1, pageSize: 5 })).items[0];
  assert.equal(item.domain, 'gamma.example');
  assert.equal(item.careersUrl, 'https://gamma.example/careers');
  assert.equal(item.priority, 'high');
  assert.equal(item.owner, 'Dana');
  assert.equal(item.status, 'researching');
});

test('account import entitlement counts only unique new companies', async () => {
  const store = createStore();
  const tenantId = 'tenant-import-entitlement';
  addTenant(store, tenantId);
  await store.addAccount(tenantId, { displayName: 'Existing Inc' });
  assert.equal(store.parseAccountImportText('A\nB\nC').length, 3);
  assert.equal(store.parseAccountImportText('   \n \n').length, 0);
  assert.equal(store.parseAccountImportText('').length, 0);
  assert.equal(await store.countNewAccountImports(tenantId, 'New Co\nExisting Inc\nNew Co'), 1);
});

test('account import serialization keeps the entitlement decision and write atomic per tenant', async () => {
  const store = createStore();
  const tenantId = 'tenant-import-serialized';
  addTenant(store, tenantId);

  async function importWithinOneAccountLimit(company) {
    return store.serializeAccountImport(tenantId, async () => {
      const current = (await store.findAccounts(tenantId, { page: 1, pageSize: 5 })).total;
      const increment = await store.countNewAccountImports(tenantId, company);
      await new Promise((resolve) => setImmediate(resolve));
      if (current + increment > 1) return { blocked: true, company };
      return store.importAccountsList(tenantId, company);
    });
  }

  const results = await Promise.all([
    importWithinOneAccountLimit('First Serialized Co'),
    importWithinOneAccountLimit('Second Serialized Co'),
  ]);
  assert.equal(results.filter((result) => result.count === 1).length, 1);
  assert.equal(results.filter((result) => result.blocked).length, 1);
  assert.equal((await store.findAccounts(tenantId, { page: 1, pageSize: 5 })).total, 1);
});
