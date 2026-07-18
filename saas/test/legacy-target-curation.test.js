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
