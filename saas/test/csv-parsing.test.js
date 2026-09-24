import test from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { createStore } from '../src/store.js';

function createTenant(tenantId) {
  const store = createStore();
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: tenantId + '-owner', name: 'Owner' });
  return store;
}

const unlimitedPlan = { displayName: 'Unlimited', limits: { accounts: -1, contacts: -1 } };

test('CSV dependency treats duplicate prototype headers as data, not a prototype setter', () => {
  // GHSA-8cw4-87c7-c6xx: guard the dependency even though application imports
  // currently use array records without either of these column options.
  const [record] = parseCsvSync('__proto__,__proto__,name\nfirst,second,Jamie', { columns: true, group_columns_by_name: true });
  assert.equal(Object.getPrototypeOf(record), Object.prototype);
  assert.equal(Object.hasOwn(record, '__proto__'), true);
  assert.deepEqual(record.__proto__, ['first', 'second']);
  assert.equal(record.name, 'Jamie');
});

test('LinkedIn import accepts a BOM, CRLF rows, quoted commas, and escaped quotes', async () => {
  const store = createTenant('tenant-csv-bom');
  const csv = [
    '\uFEFFFirst Name,Last Name,Company,Position,Email Address,URL',
    'Ana,Stone,"Quoted ""Works"", Inc.","VP, Talent",ana@quoted.example,https://linkedin.com/in/ana-stone',
  ].join('\r\n');

  const result = await store.importLinkedInCSV('tenant-csv-bom', csv, { plan: unlimitedPlan });

  assert.equal(result.ok, true);
  assert.equal(result.stats.contactsCreated, 1);
  const accounts = await store.findAccounts('tenant-csv-bom', { page: 1, pageSize: 10 });
  assert.equal(accounts.items[0].displayName, 'Quoted "Works", Inc.');
  const contacts = await store.findContacts('tenant-csv-bom', { page: 1, pageSize: 10 });
  assert.equal(contacts.items[0].title, 'VP, Talent');
});

test('LinkedIn import preserves multiline quoted fields', async () => {
  const store = createTenant('tenant-csv-multiline');
  const csv = [
    'First Name,Last Name,Company,Position,Email Address,URL',
    'Mina,Lee,Example Labs,"Head of Talent\nand People",mina@example.com,https://linkedin.com/in/mina-lee',
  ].join('\n');

  const result = await store.importLinkedInCSV('tenant-csv-multiline', csv, { plan: unlimitedPlan });

  assert.equal(result.ok, true);
  assert.equal(result.stats.contactsCreated, 1);
  const contacts = await store.findContacts('tenant-csv-multiline', { page: 1, pageSize: 10 });
  assert.equal(contacts.items[0].title, 'Head of Talent\nand People');
});

test('LinkedIn import accepts legacy CR-only exports', async () => {
  const store = createTenant('tenant-csv-cr');
  const csv = [
    'First Name,Last Name,Company,Position,Email Address,URL',
    'Jo,North,Northstar,Recruiter,jo@northstar.example,https://linkedin.com/in/jo-north',
  ].join('\r');

  const result = await store.importLinkedInCSV('tenant-csv-cr', csv, { plan: unlimitedPlan });

  assert.equal(result.ok, true);
  assert.equal(result.stats.contactsCreated, 1);
});

test('malformed CSV returns a structured validation error', async () => {
  const store = createTenant('tenant-csv-invalid');
  const csv = 'First Name,Last Name,Company,Position\nAna,Stone,"Broken Company,VP Talent';

  const result = await store.importLinkedInCSV('tenant-csv-invalid', csv, { plan: unlimitedPlan });

  assert.equal(result.code, 'invalid_csv');
  assert.match(result.error, /could not be parsed/i);
  assert.deepEqual(result.expectedHeaders, ['First Name', 'Last Name', 'Company', 'Position']);
});
