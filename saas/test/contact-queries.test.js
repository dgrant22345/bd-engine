import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { buildContactQuerySql, normalizeContactQuery, validateContactInput, resolveContactCompany } from '../src/contact-queries.js';

test('people filters and sorting operate across pages and remain tenant scoped', async () => {
  const store = createStore();
  for (const id of ['people-a', 'people-b']) store.ensureTenant({ id, name: id }, { id: `${id}-owner` });
  const rows = [];
  for (const [fullName, companyName, outreachStatus] of [['Zoey', 'Acme', 'not_started'], ['Anna', 'Zeta', 'replied'], ['Ben', 'Beta', 'replied']]) {
    rows.push(await store.addContact('people-a', { fullName, companyName, outreachStatus }));
  }
  await store.addContact('people-b', { fullName: 'Other tenant' });
  assert.deepEqual((await store.findContacts('people-a', { sortBy: 'name', pageSize: 2 })).items.map(x => x.fullName), ['Anna', 'Ben']);
  assert.equal((await store.findContacts('people-a', { sortBy: 'name', page: 2, pageSize: 2 })).items[0].fullName, 'Zoey');
  assert.deepEqual((await store.findContacts('people-a', { sortBy: 'company', outreachStatus: 'replied' })).items.map(x => x.fullName), ['Ben', 'Anna']);
  assert.equal((await store.findContacts('people-b', { id: rows[0].id })).total, 0);
  assert.equal(await store.patchContact('people-b', rows[0].id, { notes: 'forbidden' }), null);
  await store.patchContact('people-a', rows[0].id, { fullName: 'Zoe', notes: 'Source checked\nFollow up later', tenantId: 'people-b' });
  const reloaded = (await store.findContacts('people-a', { id: rows[0].id })).items[0];
  assert.equal(reloaded.fullName, 'Zoe');
  assert.equal(reloaded.notes, 'Source checked\nFollow up later');
  assert.equal(reloaded.tenantId, 'people-a');
});

test('SQL uses bound filters and allowlisted ordering with stable pagination', () => {
  const q = buildContactQuerySql('tenant-a', { q: "O'Neil_100%", outreachStatus: 'replied', id: 'ct-a', page: 2, pageSize: 20, sortBy: 'company' });
  assert.match(q.where, /tenant_id = \$1/);
  assert.match(q.where, /id = \$2/);
  assert.equal(q.params[2], "%O'Neil\\_100\\%%");
  assert.equal(q.params.at(-1), 20);
  assert.equal(q.countParams.length, 4);
  assert.match(q.order, /company_name/);
  assert.doesNotMatch(buildContactQuerySql('a', { sortBy: 'DROP TABLE contacts' }).order, /DROP/);
  assert.deepEqual([normalizeContactQuery({ page: 'NaN', pageSize: 'Infinity' }).page, normalizeContactQuery({ pageSize: 99999 }).pageSize], [1, 10000]);
  assert.equal(normalizeContactQuery({ minScore: 'Infinity' }).minScore, 0);
});

test('person input supports existing fields but rejects unsafe or malformed values', () => {
  assert.equal(validateContactInput({ firstName: 'Alex', lastName: 'Ng' }, { create: true }).fullName, 'Alex Ng');
  assert.throws(() => validateContactInput({ firstName: {} }, { create: true }), { status: 400 });
  assert.throws(() => validateContactInput({ firstName: 'x'.repeat(201) }, { create: true }), { status: 400 });
  assert.deepEqual(validateContactInput({ notes: '  Keep whitespace\n', tenantId: 'other' }), { notes: '  Keep whitespace\n' });
  for (const bad of [{ fullName: ' ' }, { notes: {} }, { linkedinUrl: 'javascript:alert(1)' }, { outreachStatus: 'hired_by_ai' }, { email: 'invalid' }]) {
    assert.throws(() => validateContactInput(bad), { status: 400 });
  }
  for (const bad of [{ accountId: {} }, { companyName: null }, { accountId: 'a'.repeat(201) }]) assert.throws(() => validateContactInput(bad), { status: 400 });
});

test('company matching is exact, explicit, and rejects ambiguity without guessing', () => {
  const accounts = [{ id: 'one', displayName: 'Example Co', aliases: ['Example Ltd'] }];
  assert.equal(resolveContactCompany(accounts, { companyName: ' example  CO ' }).accountId, 'one');
  assert.equal(resolveContactCompany(accounts, { companyName: 'Example Ltd' }).accountId, 'one');
  assert.equal(resolveContactCompany(accounts, { companyName: 'Example' }).accountId, '');
  assert.deepEqual(resolveContactCompany(accounts, { accountId: 'one', companyName: 'Old name' }), { accountId: 'one', companyName: 'Example Co' });
  const duplicates = [...accounts, { id: 'two', displayName: 'Example Co' }];
  assert.throws(() => resolveContactCompany(duplicates, { companyName: 'Example Co' }), { status: 409 });
  assert.equal(resolveContactCompany(duplicates, { companyName: 'Example Co', accountId: '' }).accountId, '');
  assert.equal(resolveContactCompany(duplicates, { companyName: 'Example Co', accountId: 'two' }).accountId, 'two');
  assert.throws(() => resolveContactCompany(accounts, { accountId: 'another-workspace' }), { status: 400 });
});

test('manual company changes update both rollups but preserve historical task and activity associations', async () => {
  const store = createStore();
  const tenant = 'manual-company-links';
  for (const id of [tenant, 'foreign-company-links']) store.ensureTenant({ id, name: id }, { id: `${id}-owner` });
  const oldCompany = await store.addAccount(tenant, { displayName: 'Original Company' });
  const newCompany = await store.addAccount(tenant, { displayName: 'Next Company' });
  const foreign = await store.addAccount('foreign-company-links', { displayName: 'Private Company' });
  const person = await store.addContact(tenant, { fullName: 'Jamie', title: 'Recruiter', companyName: 'original company' });
  assert.equal(person.accountId, oldCompany.id);
  assert.equal((await store.getAccountDetail(tenant, oldCompany.id)).account.connectionCount, 1);
  const task = await store.createTask(tenant, { contactId: person.id, summary: 'Original company follow-up', dueDate: '2026-12-01' });
  await assert.rejects(store.patchContact(tenant, person.id, { accountId: foreign.id, notes: 'must not save' }), { status: 400 });
  assert.notEqual(person.notes, 'must not save');
  await assert.rejects(store.addContact(tenant, { fullName: 'Invalid', accountId: foreign.id }), { status: 400 });
  await store.patchContact(tenant, person.id, { accountId: newCompany.id });
  assert.equal(person.companyName, 'Next Company');
  assert.equal(person.employmentHistory.at(-1).companyName, 'Original Company');
  assert.equal(task.accountId, oldCompany.id);
  assert.equal((await store.getAccountDetail(tenant, oldCompany.id)).account.connectionCount, 0);
  assert.equal((await store.getAccountDetail(tenant, newCompany.id)).account.connectionCount, 1);
  await store.patchContact(tenant, person.id, { accountId: '' });
  assert.equal(person.companyName, 'Next Company');
  assert.equal(person.accountId, '');
  assert.equal((await store.getAccountDetail(tenant, newCompany.id)).account.connectionCount, 0);
  await store.patchContact(tenant, person.id, { notes: 'A note must not relink a person' });
  assert.equal(person.accountId, '');
});
