import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { buildContactQuerySql, normalizeContactQuery, validateContactInput } from '../src/contact-queries.js';

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
});
