/**
 * DATA-101: network companies vs tracked targets.
 * Imports must not automatically make every employer a refreshable target;
 * discovery and refresh operate on tracked targets only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

function addTenant(store, tenantId) {
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner`, name: 'Owner' });
}

// External probing is irrelevant to these tests — answer every fetch 404 fast.
function mockFetch(t) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  t.after(() => { globalThis.fetch = original; });
}

const csv = `First Name,Last Name,Company,Position,Email Address,URL
Alice,Ng,Acme Systems,VP Talent,alice@acme.example,https://linkedin.com/in/alice-ng
Bob,Diaz,Beta Labs,Director Engineering,bob@beta.example,https://linkedin.com/in/bob-diaz`;

test('LinkedIn import creates network companies, not tracked targets', async () => {
  const store = createStore();
  const tenantId = 'tenant-network';
  addTenant(store, tenantId);
  await store.importLinkedInCSV(tenantId, csv, { plan: { limits: {} } });
  const { items } = await store.findAccounts(tenantId, { page: 1, pageSize: 10 });
  assert.equal(items.length, 2);
  for (const item of items) assert.equal(item.tracked, false, `${item.displayName} should be a network company`);
});

test('account portfolio queries separate tracked targets from network context', async () => {
  const store = createStore();
  const tenantId = 'tenant-account-portfolio';
  store.ensureTenant({ id: tenantId, name: 'Portfolio' }, { id: 'portfolio-owner' });
  await store.addAccount(tenantId, { displayName: 'Tracked Company' });
  const network = await store.addAccount(tenantId, { displayName: 'Network Company' });
  await store.patchAccount(tenantId, network.id, { tracked: false });
  const legacy = await store.addAccount(tenantId, { displayName: 'Legacy Company' });
  delete legacy.tracked;

  const tracked = await store.findAccounts(tenantId, { portfolio: 'tracked', page: 1, pageSize: 20 });
  assert.deepEqual(tracked.items.map((item) => item.displayName).sort(), ['Legacy Company', 'Tracked Company']);
  assert.deepEqual(tracked.portfolioSummary, {
    trackedCompanies: 2,
    networkCompanies: 1,
    legacyUnclassified: 1,
  });

  const networkOnly = await store.findAccounts(tenantId, { portfolio: 'network', page: 1, pageSize: 20 });
  assert.deepEqual(networkOnly.items.map((item) => item.displayName), ['Network Company']);
  assert.equal((await store.findAccounts(tenantId, { portfolio: 'all', page: 1, pageSize: 20 })).total, 3);
});

test('manual add and pasted target lists create tracked targets', async () => {
  const store = createStore();
  const tenantId = 'tenant-tracked';
  addTenant(store, tenantId);
  const manual = await store.addAccount(tenantId, { displayName: 'Handpicked Co' });
  assert.equal(manual.tracked, true);
  await store.importAccountsList(tenantId, 'Pasted Target Inc');
  const pasted = (await store.findAccounts(tenantId, { q: 'Pasted', page: 1, pageSize: 5 })).items[0];
  assert.equal(pasted.tracked, true);
});

test('legacy accounts without the field are grandfathered as tracked', async (t) => {
  mockFetch(t);
  const store = createStore();
  const tenantId = 'tenant-legacy';
  addTenant(store, tenantId);
  const legacy = await store.addAccount(tenantId, { displayName: 'Legacy Corp' });
  delete legacy.tracked; // simulate a record persisted before DATA-101
  const discovery = await store.runAtsDiscovery(tenantId, { plan: { limits: {} } });
  const configs = await store.findConfigs(tenantId, { page: 1, pageSize: 10 });
  assert.equal(configs.total, 1, JSON.stringify(discovery.stats));
});

test('discovery creates configs only for tracked targets', async (t) => {
  mockFetch(t);
  const store = createStore();
  const tenantId = 'tenant-disc';
  addTenant(store, tenantId);
  await store.importLinkedInCSV(tenantId, csv, { plan: { limits: {} } }); // 2 network companies
  await store.addAccount(tenantId, { displayName: 'Chosen Target' });     // 1 tracked
  await store.runAtsDiscovery(tenantId, { plan: { limits: {} } });
  const configs = await store.findConfigs(tenantId, { page: 1, pageSize: 10 });
  assert.equal(configs.total, 1, `expected only the tracked target's config, got ${configs.total}`);
  assert.equal(configs.items[0].companyName, 'Chosen Target');
});

test('tracking a network company makes it eligible for discovery', async (t) => {
  mockFetch(t);
  const store = createStore();
  const tenantId = 'tenant-promote';
  addTenant(store, tenantId);
  await store.importLinkedInCSV(tenantId, csv, { plan: { limits: {} } });
  const acme = (await store.findAccounts(tenantId, { q: 'Acme', page: 1, pageSize: 5 })).items[0];
  await store.patchAccount(tenantId, acme.id, { tracked: true });
  await store.runAtsDiscovery(tenantId, { plan: { limits: {} } });
  const configs = await store.findConfigs(tenantId, { page: 1, pageSize: 10 });
  assert.equal(configs.total, 1);
  assert.equal(configs.items[0].companyName, 'Acme Systems');
});

test('bulk update can track and untrack accounts', async () => {
  const store = createStore();
  const tenantId = 'tenant-bulk-track';
  addTenant(store, tenantId);
  await store.importLinkedInCSV(tenantId, csv, { plan: { limits: {} } });
  const ids = (await store.findAccounts(tenantId, { page: 1, pageSize: 10 })).items.map((i) => i.id);
  const result = await store.bulkUpdateAccounts(tenantId, { ids, tracked: true });
  assert.equal(result.updated, 2);
  const items = (await store.findAccounts(tenantId, { page: 1, pageSize: 10 })).items;
  for (const item of items) assert.equal(item.tracked, true);
});

test('live job import skips network companies’ boards', async (t) => {
  mockFetch(t);
  const store = createStore();
  const tenantId = 'tenant-import-gate';
  addTenant(store, tenantId);
  const tracked = await store.addAccount(tenantId, { displayName: 'Tracked Co' });
  const network = await store.addAccount(tenantId, { displayName: 'Network Co' });
  await store.patchAccount(tenantId, network.id, { tracked: false });
  // Resolved, import-ready boards for both.
  for (const [acct, board] of [[tracked, 'trackedco'], [network, 'networkco']]) {
    store.addConfig(tenantId, {
      accountId: acct.id,
      companyName: acct.displayName,
      atsType: 'greenhouse',
      boardId: board,
      discoveryStatus: 'resolved',
      reviewStatus: 'approved',
      active: true,
    });
  }
  const result = await store.importLiveJobs(tenantId, { plan: { limits: {} }, autoDiscover: false });
  assert.equal(result.stats.configs, 1, `expected 1 board fetched, got ${result.stats.configs}`);
});
