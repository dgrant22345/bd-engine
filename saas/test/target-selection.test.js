import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

function addTenant(store, tenantId) {
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: tenantId + '-owner', name: 'Owner' });
}

const selectionCsv = [
  'First Name,Last Name,Company,Position,Email Address,URL',
  'Ian,Maker,Low Signal Co,Developer,ian@gmail.com,https://linkedin.com/in/ian-maker',
  'Tara,Lead,Priority Systems,VP Talent,tara@priority.example,https://linkedin.com/in/tara-lead',
  'Sam,Chief,Priority Systems,CTO,sam@priority.example,https://linkedin.com/in/sam-chief',
].join('\n');

test('company preview ranks useful targets before applying the plan account cap', async () => {
  const store = createStore();
  const tenantId = 'tenant-target-preview';
  addTenant(store, tenantId);

  const preview = await store.importLinkedInCSV(tenantId, selectionCsv, {
    dryRun: true,
    plan: { displayName: 'One account', limits: { accounts: 1, contacts: 100 } },
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.companies.length, 2);
  assert.equal(preview.companies[0].companyName, 'Priority Systems');
  assert.equal(preview.companies[0].recommended, true);
  assert.equal(preview.companies[0].selected, true);
  assert.equal(preview.companies[0].overLimit, false);
  assert.equal(preview.companies[1].companyName, 'Low Signal Co');
  assert.equal(preview.companies[1].overLimit, true);
  assert.equal(preview.companies[1].selected, false);
  assert.equal(preview.companies[1].domain, '');
});

test('selected preview companies become tracked targets while the rest remain network companies', async () => {
  const store = createStore();
  const tenantId = 'tenant-target-selection';
  addTenant(store, tenantId);

  const result = await store.importLinkedInCSV(tenantId, selectionCsv, {
    plan: { displayName: 'Unlimited', limits: { accounts: -1, contacts: -1 } },
    trackedCompanies: ['priority systems'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.stats.trackedTargetsSelected, 1);

  const accounts = await store.findAccounts(tenantId, { page: 1, pageSize: 10 });
  const priority = accounts.items.find((item) => item.displayName === 'Priority Systems');
  const lowSignal = accounts.items.find((item) => item.displayName === 'Low Signal Co');
  assert.equal(priority.tracked, true);
  assert.equal(lowSignal.tracked, false);
});

test('selecting an existing network company promotes it without creating a duplicate', async () => {
  const store = createStore();
  const tenantId = 'tenant-target-promotion';
  addTenant(store, tenantId);
  const plan = { displayName: 'Unlimited', limits: { accounts: -1, contacts: -1 } };

  await store.importLinkedInCSV(tenantId, selectionCsv, { plan, trackedCompanies: [] });
  const before = await store.findAccounts(tenantId, { page: 1, pageSize: 10 });
  assert.equal(before.total, 2);
  assert.equal(before.items.find((item) => item.displayName === 'Low Signal Co').tracked, false);

  await store.importLinkedInCSV(tenantId, selectionCsv, {
    plan,
    trackedCompanies: ['LOW SIGNAL CO'],
  });
  const after = await store.findAccounts(tenantId, { page: 1, pageSize: 10 });
  assert.equal(after.total, 2);
  assert.equal(after.items.find((item) => item.displayName === 'Low Signal Co').tracked, true);
});
