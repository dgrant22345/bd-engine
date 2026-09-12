import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('completed tasks log once and activity supports search, type and sort', async () => {
  const store = createStore();
  const tenantId = store.getSession().tenant.id;
  const task = await store.createTask(tenantId, { summary: 'Review Toronto hiring context' });
  await store.completeTask(tenantId, task.id, 'tester');
  await store.completeTask(tenantId, task.id, 'tester');
  const history = await store.findActivities(tenantId, { type: 'task_completed', q: 'Toronto' });
  assert.equal(history.total, 1);
  assert.match(history.items[0].summary, /Completed task/);
  await store.addActivity(tenantId, 'tester', { summary: 'Older Toronto outreach', type: 'outreach', occurredAt: '2025-01-01T12:00:00Z' });
  const oldest = await store.findActivities(tenantId, { q: 'Toronto', sort: 'oldest' });
  assert.equal(oldest.items[0].summary, 'Older Toronto outreach');
  assert.equal((await store.findActivities(tenantId, { q: 'no-such-activity' })).total, 0);
});

test('sent outreach completes only the explicitly linked account task', async () => {
  const store = createStore();
  const tenantId = store.getSession().tenant.id;
  const linked = await store.createTask(tenantId, { accountId: 'account-a', summary: 'Send introduction' });
  const other = await store.createTask(tenantId, { accountId: 'account-b', summary: 'Send introduction' });
  await assert.rejects(store.addActivity(tenantId, 'tester', { accountId: 'account-a', type: 'outreach', summary: 'Sent introduction', completeTaskId: other.id }), /belonging to this account/);
  await store.addActivity(tenantId, 'tester', { accountId: 'account-a', type: 'outreach', summary: 'Sent introduction', completeTaskId: linked.id });
  assert.equal((await store.findTasks(tenantId, { status: 'completed', accountId: 'account-a' })).items[0].id, linked.id);
  assert.equal((await store.findTasks(tenantId, { status: 'pending', accountId: 'account-b' })).items[0].id, other.id);
  const history = await store.findActivities(tenantId, { accountId: 'account-a' });
  assert.equal(history.items.filter(item => item.type === 'outreach').length, 1);
  assert.equal(history.items.filter(item => item.type === 'task_completed').length, 1);
});
