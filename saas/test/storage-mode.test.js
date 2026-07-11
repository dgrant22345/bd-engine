import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, getRelationalPrimaryTenantIds } from '../src/store.js';
import { createTenant } from '../src/users.js';

test('new workspace storage mode is durable tenant metadata', () => {
  const relational = createTenant({ name: 'Relational Test', storageMode: 'relational' }).tenant;
  const legacy = createTenant({ name: 'Legacy Test' }).tenant;

  assert.equal(relational.storageMode, 'relational');
  assert.equal(legacy.storageMode, 'legacy');
});

test('loading a relational tenant registers it as primary for reads and writes', () => {
  const tenant = createTenant({ name: 'Registered Relational Test', storageMode: 'relational' }).tenant;
  const store = createStore();
  store.ensureTenant(tenant, { id: 'storage-mode-owner', name: 'Owner' });

  assert.ok(getRelationalPrimaryTenantIds().includes(tenant.id));
});
