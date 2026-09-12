import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('task queue sorts before pagination and clamps pages after completion', async () => {
  const store = createStore();
  const tenantId = store.getSession().tenant.id;
  for (let index = 0; index < 51; index++) {
    await store.createTask(tenantId, { accountId: 'queue-test', summary: `Queue item ${index}`, dueDate: new Date(Date.UTC(2027, 0, 1 + index)).toISOString() });
  }
  const urgent = await store.createTask(tenantId, { accountId: 'queue-test', summary: 'Urgent follow-up', dueDate: '2020-01-01T12:00:00Z' });
  const first = await store.findTasks(tenantId, { accountId: 'queue-test', pageSize: 50 });
  assert.equal(first.items[0].id, urgent.id);
  assert.equal(first.total, 52);
  const second = await store.findTasks(tenantId, { accountId: 'queue-test', pageSize: 50, page: 2 });
  assert.equal(second.items.length, 2);
  for (const item of second.items) await store.completeTask(tenantId, item.id);
  const after = await store.findTasks(tenantId, { accountId: 'queue-test', pageSize: 50, page: 2 });
  assert.equal(after.page, 1);
  assert.equal(after.total, 50);
  const search = await store.findTasks(tenantId, { accountId: 'queue-test', q: 'URGENT' });
  assert.equal(search.total, 1);
  assert.equal(search.items[0].id, urgent.id);
  assert.equal((await store.findTasks(tenantId, { accountId: 'different-account' })).total, 0);
});

test('task search includes company context and completed work supports name sorting', async () => {
  const store = createStore();
  const tenantId = store.getSession().tenant.id;
  const company = await store.addAccount(tenantId, { displayName: 'Queue Search Company' });
  const later = await store.createTask(tenantId, { accountId: company.id, summary: 'Zebra follow-up' });
  const earlier = await store.createTask(tenantId, { accountId: company.id, summary: 'Alpha follow-up' });
  const found = await store.findTasks(tenantId, { q: 'queue search company', sort: 'name' });
  assert.deepEqual(found.items.map(item => item.id), [earlier.id, later.id]);
  assert.equal(found.items[0].accountName, company.displayName);
  await store.completeTask(tenantId, later.id);
  await store.completeTask(tenantId, earlier.id);
  assert.equal((await store.findTasks(tenantId, { accountId: company.id })).total, 0);
  const done = await store.findTasks(tenantId, { accountId: company.id, status: 'completed', sort: 'name' });
  assert.deepEqual(done.items.map(item => item.id), [earlier.id, later.id]);
  assert.equal((await store.findTasks(tenantId, { status: 'completed', q: 'queue search company' })).total, 2);
});
