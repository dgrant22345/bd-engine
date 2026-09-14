import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('person outreach records one message and linked follow-up even with concurrent retries', async () => {
  const store = createStore(); const tenantId = store.getSession().tenant.id;
  const person = await store.addContact(tenantId, { fullName: 'Outreach recipient', companyName: 'Example' });
  const payload = { text: 'The actual sent message', confirmed: true, followUpDays: 3, requestId: 'outreach-idempotency-test' };
  await assert.rejects(store.logPersonOutreach(tenantId, 'user', person.id, { ...payload, confirmed: false }));
  await assert.rejects(store.logPersonOutreach(tenantId, 'user', 'other-tenant-contact', payload));
  await assert.rejects(store.addActivity(tenantId, 'user', { type: 'outreach', summary: 'Invalid follow-up link', contactId: 'other-tenant-contact', followUpDays: 3 }));
  await assert.rejects(store.logPersonOutreach(tenantId, 'user', person.id, { ...payload, followUpDays: -1 }));
  const [a, b] = await Promise.all([store.logPersonOutreach(tenantId, 'user', person.id, payload), store.logPersonOutreach(tenantId, 'user', person.id, payload)]);
  assert.equal(a.activity.id, b.activity.id);
  await assert.rejects(store.logPersonOutreach(tenantId, 'user', person.id, { ...payload, text: 'Changed after an uncertain response' }), { status: 409 });
  assert.equal(a.person.outreachStatus, 'contacted');
  const history = await store.findActivities(tenantId, { contactId: person.id });
  assert.equal(history.total, 1); assert.equal(history.items[0].notes, payload.text);
  const tasks = await store.findTasks(tenantId, { contactId: person.id });
  assert.equal(tasks.total, 1); assert.equal(tasks.items[0].contactName, person.fullName);
  await store.patchContact(tenantId, person.id, { outreachStatus: 'replied' });
  const next = await store.logPersonOutreach(tenantId, 'user', person.id, { ...payload, requestId: 'another-sent-message', followUpDays: 0 });
  assert.equal(next.person.outreachStatus, 'replied');
  assert.equal((await store.findTasks(tenantId, { contactId: person.id })).total, 1);
});

test('reschedule and undo preserve history, reject stale edits and never mark a company contacted', async () => {
  const store = createStore(); const tenantId = store.getSession().tenant.id;
  const company = await store.addAccount(tenantId, { displayName: 'Task corrections company' });
  const before = company.lastContactedAt;
  const task = await store.createTask(tenantId, { accountId: company.id, summary: 'Correction fixture' });
  const oldVersion = task.updatedAt;
  await assert.rejects(store.updateTask(tenantId, task.id, 'user', { expectedUpdatedAt: oldVersion, dueDate: '2027-02-30' }));
  await store.updateTask(tenantId, task.id, 'user', { expectedUpdatedAt: oldVersion, dueDate: '2027-02-28' });
  assert.equal(task.dueDate, '2027-02-28T00:00:00.000Z');
  await assert.rejects(store.updateTask(tenantId, task.id, 'user', { expectedUpdatedAt: oldVersion, dueDate: '2027-03-01' }), { status: 409 });
  await store.completeTask(tenantId, task.id, 'user');
  await store.updateTask(tenantId, task.id, 'user', { expectedUpdatedAt: task.updatedAt, status: 'pending' });
  assert.equal(task.status, 'pending'); assert.equal(company.lastContactedAt, before);
  assert.equal(await store.updateTask(tenantId, 'other-workspace-task', 'user', {}), null);
  const history = await store.findActivities(tenantId, { accountId: company.id });
  assert.deepEqual(new Set(history.items.map(item => item.type)), new Set(['task_rescheduled', 'task_completed', 'task_reopened']));
});

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

test('cancelled follow-ups preserve history, stay out of completed work, and can be reopened', async () => {
  const store = createStore(); const tenantId = store.getSession().tenant.id;
  const company = await store.addAccount(tenantId, { displayName: 'Cancellation fixture' });
  const person = await store.addContact(tenantId, { fullName: 'Cancellation recipient', companyName: company.displayName, accountId: company.id });
  const before = company.lastContactedAt;
  const task = await store.createTask(tenantId, { contactId: person.id, summary: 'No longer relevant' });
  const oldVersion = task.updatedAt;
  await assert.rejects(store.updateTask(tenantId, task.id, 'user', { expectedUpdatedAt: oldVersion, status: 'cancelled', dueDate: '2027-01-01' }));
  await store.updateTask(tenantId, task.id, 'user', { expectedUpdatedAt: oldVersion, status: 'cancelled' });
  assert.equal(task.status, 'cancelled'); assert.notEqual(task.updatedAt, oldVersion);
  assert.equal((await store.findTasks(tenantId, { contactId: person.id })).total, 0);
  assert.equal((await store.findTasks(tenantId, { contactId: person.id, status: 'completed' })).total, 0);
  assert.equal((await store.findTasks(tenantId, { contactId: person.id, status: 'cancelled' })).total, 1);
  await assert.rejects(store.completeTask(tenantId, task.id, 'user'), { status: 409 });
  await assert.rejects(store.updateTask(tenantId, task.id, 'user', { expectedUpdatedAt: oldVersion, status: 'cancelled' }), { status: 409 });
  await assert.rejects(store.updateTask(tenantId, task.id, 'user', { expectedUpdatedAt: task.updatedAt, dueDate: '2027-01-01' }));
  const history = await store.findActivities(tenantId, { contactId: person.id });
  assert.equal(history.total, 1); assert.equal(history.items[0].type, 'task_cancelled');
  assert.equal(company.lastContactedAt, before);
  await store.updateTask(tenantId, task.id, 'user', { expectedUpdatedAt: task.updatedAt, status: 'pending' });
  assert.equal((await store.findTasks(tenantId, { contactId: person.id })).total, 1);
  await store.completeTask(tenantId, task.id, 'user');
  assert.equal((await store.findTasks(tenantId, { contactId: person.id, status: 'completed' })).total, 1);
  await assert.rejects(store.updateTask(tenantId, task.id, 'user', { expectedUpdatedAt: task.updatedAt, status: 'cancelled' }));
  assert.equal((await store.findActivities(tenantId, { contactId: person.id })).total, 3);
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

test('person follow-ups validate links and completion remains in person history', async () => {
  const store = createStore();
  const tenantId = store.getSession().tenant.id;
  const person = await store.addContact(tenantId, { fullName: 'Person with follow-up', companyName: 'Example' });
  const task = await store.createTask(tenantId, { contactId: person.id, summary: 'Ask about timing', dueDate: '2027-01-01' });
  assert.equal(task.contactId, person.id);
  assert.equal((await store.findTasks(tenantId, { contactId: person.id })).total, 1);
  await assert.rejects(store.createTask(tenantId, { contactId: 'other-tenant-person', summary: 'Invalid link' }));
  await store.completeTask(tenantId, task.id);
  assert.equal((await store.findTasks(tenantId, { contactId: person.id })).total, 0);
  const history = await store.findActivities(tenantId, { contactId: person.id });
  assert.equal(history.total, 1);
  assert.match(history.items[0].summary, /Ask about timing/);
});
