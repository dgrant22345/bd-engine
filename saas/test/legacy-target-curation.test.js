import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../src/store.js';

test('legacy target curation previews and applies a bounded ranked portfolio', async () => {
  const store = createStore();
  const tenantId = `tenant-curation-${Date.now()}`;
  store.ensureTenant({ id: tenantId, name: 'Curation Test' }, { id: 'owner', name: 'Owner' });
  const accounts = [];
  for (const [name, score] of [['Low Co', 10], ['Top Co', 95], ['Middle Co', 50]]) {
    const item = await store.addAccount(tenantId, { displayName: name, targetScore: score });
    delete item.tracked;
    accounts.push(item);
  }

  const preview = await store.curateLegacyTargets(tenantId, { targetLimit: 2 });
  assert.equal(preview.applied, false);
  assert.equal(preview.legacyCompanies, 3);
  assert.deepEqual(preview.preview.slice(0, 2).map((item) => item.displayName), ['Top Co', 'Middle Co']);
  assert.ok(accounts.every((item) => typeof item.tracked !== 'boolean'));

  const applied = await store.curateLegacyTargets(tenantId, { targetLimit: 2, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(accounts.filter((item) => item.tracked).length, 2);
  assert.equal(accounts.find((item) => item.displayName === 'Low Co').tracked, false);
});

test('legacy target curation prefers role-fit evidence over a generic account score', async () => {
  const store = createStore();
  const tenantId = `tenant-role-curation-${Date.now()}`;
  store.ensureTenant({ id: tenantId, name: 'Role Curation' }, { id: 'owner', name: 'Owner' });
  const generic = await store.addAccount(tenantId, { displayName: 'Generic High Score', targetScore: 99 });
  const roleFit = await store.addAccount(tenantId, {
    displayName: 'Focused Role Fit',
    targetScore: 40,
    strongFitRoleCount: 1,
    relevantRoleCount: 3,
  });
  delete generic.tracked;
  delete roleFit.tracked;

  const preview = await store.curateLegacyTargets(tenantId, { targetLimit: 1 });
  assert.equal(preview.preview[0].displayName, 'Focused Role Fit');
  assert.equal(preview.preview[0].strongFitRoleCount, 1);
  assert.equal(preview.preview[0].relevantRoleCount, 3);
});

test('target rebalance reranks every company and demotes placeholder employers', async () => {
  const store = createStore();
  const tenantId = `tenant-rebalance-${Date.now()}`;
  store.ensureTenant({ id: tenantId, name: 'Rebalance Test' }, { id: 'owner', name: 'Owner' });
  const placeholder = await store.addAccount(tenantId, {
    displayName: 'Self-employed',
    targetScore: 100,
    strongFitRoleCount: 50,
    tracked: true,
  });
  const weak = await store.addAccount(tenantId, { displayName: 'Weak Target', targetScore: 20, tracked: true });
  const roleFit = await store.addAccount(tenantId, {
    displayName: 'Focused Employer',
    targetScore: 30,
    strongFitRoleCount: 3,
    relevantRoleCount: 8,
    tracked: false,
  });
  const identityReview = await store.addAccount(tenantId, {
    displayName: 'Another Employer',
    domain: 'gmail.com',
    strongFitRoleCount: 2,
    relevantRoleCount: 5,
    tracked: false,
  });

  const preview = await store.rebalanceTrackedTargets(tenantId, { targetLimit: 2 });
  assert.equal(preview.applied, false);
  assert.equal(preview.additions, 2);
  assert.equal(preview.removals, 2);
  assert.deepEqual(preview.preview.map((item) => item.displayName), ['Focused Employer', 'Another Employer']);
  assert.deepEqual(preview.identityReview[0].identityIssues, ['Personal or invalid company domain']);

  const applied = await store.rebalanceTrackedTargets(tenantId, { targetLimit: 2, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(roleFit.tracked, true);
  assert.equal(identityReview.tracked, true);
  assert.equal(placeholder.tracked, false);
  assert.equal(weak.tracked, false);
});
