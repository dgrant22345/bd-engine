import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavedWorkStore, validateSavedWork } from '../src/saved-work.js';

const draft = { title: 'Message to Jamie', body: { text: 'A specific, reviewed message.', contactId: 'person-1' }, version: 0 };
test('draft names and optional role context persist with bounds and optimistic rename protection', async () => {
  const store = createSavedWorkStore({ enabled: () => false });
  const body = { ...draft.body, roleTitle: 'Talent Manager', companyName: 'Example', goal: 'recruiting_follow_up', background: 'Ten years of recruiting experience', ignored: 'never saved' };
  const first = await store.put('t', 'u', 'draft', 'named', { ...draft, body });
  assert.equal(first.body.roleTitle, body.roleTitle); assert.equal(first.body.background, body.background);
  assert.equal(first.body.ignored, undefined);
  const renamed = await store.put('t', 'u', 'draft', 'named', { ...first, title: 'Canada hiring conversation' });
  assert.deepEqual(renamed.body, first.body);
  assert.equal((await store.list('t', 'u', 'draft', { q: 'Canada hiring' })).total, 1);
  await assert.rejects(store.put('t', 'u', 'draft', 'named', { ...first, title: 'Stale rename' }), { status: 409 });
  for (const [key, length] of [['roleTitle', 501], ['companyName', 301], ['background', 1001], ['goal', 61]]) {
    assert.throws(() => validateSavedWork('draft', { ...draft, body: { ...body, [key]: 'x'.repeat(length) } }), { status: 400 });
  }
});
test('saved drafts survive fresh reads and are isolated by user and tenant', async () => {
  const store = createSavedWorkStore({ enabled: () => false });
  const item = await store.put('tenant-a', 'user-a', 'draft', 'draft-1', draft);
  assert.equal(item.version, 1);
  assert.equal((await store.get('tenant-a', 'user-a', 'draft', 'draft-1')).body.text, draft.body.text);
  assert.equal(await store.get('tenant-b', 'user-a', 'draft', 'draft-1'), null);
  assert.equal(await store.get('tenant-a', 'user-b', 'draft', 'draft-1'), null);
  assert.equal((await store.list('tenant-a', 'user-b', 'draft')).total, 0);
  assert.equal((await store.list('tenant-a', 'user-a', 'draft', { summary: '1' })).total, 1);
  assert.equal((await store.export('tenant-a', 'user-a')).length, 1);
  await store.clearTenant('tenant-a');
  assert.equal((await store.export('tenant-a', 'user-a')).length, 0);
});
test('stale saves and deletes cannot overwrite another device', async () => {
  const store = createSavedWorkStore({ enabled: () => false });
  const first = await store.put('t', 'u', 'draft', 'd', draft);
  await assert.rejects(store.put('t', 'u', 'draft', 'd', draft), { status: 409 });
  const second = await store.put('t', 'u', 'draft', 'd', { ...first, body: { text: 'New version' } });
  await assert.rejects(store.put('t', 'u', 'draft', 'd', first), { status: 409 });
  await assert.rejects(store.remove('t', 'u', 'draft', 'd', first.version), { status: 409 });
  assert.equal((await store.get('t', 'u', 'draft', 'd')).body.text, 'New version');
  await store.remove('t', 'u', 'draft', 'd', second.version);
  assert.equal(await store.get('t', 'u', 'draft', 'd'), null);
});
test('saved views retain supported filters, not arbitrary data or page positions', () => {
  const item = validateSavedWork('view', { title: 'Ready people', version: 0, body: { q: 'manager', outreachStatus: 'ready_to_contact', sortBy: 'recent', page: 9, tenantId: 'other' } });
  assert.deepEqual(item.body, { q: 'manager', outreachStatus: 'ready_to_contact', sortBy: 'recent', minScore: '' });
  assert.throws(() => validateSavedWork('view', { title: 'Bad', version: 0, body: { sortBy: 'DROP TABLE contacts' } }), { status: 400 });
  assert.throws(() => validateSavedWork('draft', { ...draft, body: { text: 'x'.repeat(12001) } }), { status: 400 });
  assert.throws(() => validateSavedWork('draft', { ...draft, version: -1 }), { status: 400 });
});
test('SQL saves and reads bind the complete private scope and expected version', async () => {
  const calls = [];
  const store = createSavedWorkStore({ enabled: () => true, query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 'd', kind: 'draft', title: draft.title, body: draft.body, version: 2, total: '1' }] }; } });
  await store.put('t', 'u', 'draft', 'd', { ...draft, version: 1 });
  assert.match(calls[0].sql, /tenant_id=\$1 AND user_id=\$2 AND kind=\$3 AND id=\$4 AND version=\$8/);
  assert.deepEqual(calls[0].params.slice(0, 4), ['t', 'u', 'draft', 'd']);
  assert.equal(calls[0].params[7], 1);
  await store.list('t', 'u', 'draft', { q: "'; DELETE FROM saved_work;--" });
  assert.doesNotMatch(calls[1].sql, /DELETE/);
  assert.equal(calls[1].params[3], "'; delete from saved_work;--");
});

test('saved library pages clamp after deletion and searches stay scoped', async () => {
  const store = createSavedWorkStore({ enabled: () => false });
  for (let index = 0; index < 51; index++) await store.put('t', 'u', 'view', `view-${index}`, { title: `View ${index}`, body: { q: 'Jamie' }, version: 0 });
  const last = await store.list('t', 'u', 'view', { page: 2 });
  assert.equal(last.items.length, 1);
  await store.remove('t', 'u', 'view', last.items[0].id, last.items[0].version);
  assert.equal((await store.list('t', 'u', 'view', { page: 2 })).page, 1);
  assert.equal((await store.list('other', 'u', 'view', { q: 'View' })).total, 0);
  assert.throws(() => validateSavedWork('draft', null), { status: 400 });
});
