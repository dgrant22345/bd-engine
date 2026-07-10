import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('workspace collaboration data and tasks persist through the store contract', async () => {
  const store = createStore();
  const tenantId = store.getSession().tenant.id;

  const preferences = await store.patchWorkspacePreferences(tenantId, {
    accountNotes: {
      'acct-test': [{ id: 1, text: 'Shared note', at: new Date().toISOString() }],
    },
    customFields: [{ name: 'Territory', type: 'text', options: '' }],
    ignoredField: 'must not be persisted',
  });

  assert.equal(preferences.accountNotes['acct-test'][0].text, 'Shared note');
  assert.equal(preferences.customFields[0].name, 'Territory');
  assert.equal(preferences.ignoredField, undefined);

  const task = await store.createTask(tenantId, {
    summary: 'Follow up with the hiring manager',
    dueDate: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const pending = await store.findTasks(tenantId, { status: 'pending', page: 1, pageSize: 250 });
  assert.ok(pending.items.some((item) => item.id === task.id));

  const completedTask = await store.completeTask(tenantId, task.id);
  assert.equal(completedTask.status, 'completed');
  const completed = await store.findTasks(tenantId, { status: 'completed', page: 1, pageSize: 250 });
  assert.ok(completed.items.some((item) => item.id === task.id));
});
