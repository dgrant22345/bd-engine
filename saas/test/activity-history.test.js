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
