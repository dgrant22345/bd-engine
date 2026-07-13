import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const plan = { displayName: 'Unlimited', limits: { accounts: -1, contacts: -1 } };

function csvRow({ company, title, email = 'alex@alpha.example' }) {
  return [
    'First Name,Last Name,Company,Position,Email Address,URL',
    `Alex,Chen,${company},${title},${email},https://linkedin.com/in/alex-chen`,
  ].join('\n');
}

test('repeat LinkedIn imports refresh employment without duplicating the contact', async () => {
  const store = createStore();
  const tenantId = 'tenant-contact-refresh';
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: tenantId + '-owner', name: 'Owner' });

  const initial = await store.importLinkedInCSV(tenantId, csvRow({
    company: 'Alpha Labs',
    title: 'Recruiter',
  }), { plan });
  assert.equal(initial.stats.contactsCreated, 1);

  const changedCsv = csvRow({
    company: 'Beta Systems',
    title: 'VP Talent',
    email: '',
  });
  const preview = await store.importLinkedInCSV(tenantId, changedCsv, { plan, dryRun: true });
  assert.equal(preview.stats.contactsUpdated, 1);
  assert.equal(preview.preview[0].action, 'Update');
  const beforeCommit = await store.findContacts(tenantId, { page: 1, pageSize: 10 });
  assert.equal(beforeCommit.items[0].companyName, 'Alpha Labs');

  const changed = await store.importLinkedInCSV(tenantId, changedCsv, { plan });
  assert.equal(changed.stats.contactsCreated, 0);
  assert.equal(changed.stats.contactsUpdated, 1);
  assert.equal(changed.stats.duplicatesSkipped, 0);

  const contacts = await store.findContacts(tenantId, { page: 1, pageSize: 10 });
  assert.equal(contacts.total, 1);
  const alex = contacts.items[0];
  assert.equal(alex.companyName, 'Beta Systems');
  assert.equal(alex.title, 'VP Talent');
  assert.equal(alex.email, 'alex@alpha.example');
  assert.equal(alex.seniority, 'vp');
  assert.equal(alex.isTalentLeader, true);
  assert.equal(alex.employmentHistory.length, 1);
  assert.equal(alex.employmentHistory[0].companyName, 'Alpha Labs');
  assert.equal(alex.employmentHistory[0].title, 'Recruiter');
  assert.ok(alex.employmentHistory[0].lastObservedAt);

  const accounts = await store.findAccounts(tenantId, { page: 1, pageSize: 10 });
  const alpha = accounts.items.find((item) => item.displayName === 'Alpha Labs');
  const beta = accounts.items.find((item) => item.displayName === 'Beta Systems');
  assert.equal(alpha.connectionCount, 0);
  assert.equal(beta.connectionCount, 1);
  assert.equal(beta.seniorContactCount, 1);
  assert.equal(beta.talentContactCount, 1);

  const repeated = await store.importLinkedInCSV(tenantId, csvRow({
    company: 'Beta Systems',
    title: 'VP Talent',
    email: '',
  }), { plan });
  assert.equal(repeated.stats.contactsUpdated, 0);
  assert.equal(repeated.stats.duplicatesSkipped, 1);
  const afterRepeat = await store.findContacts(tenantId, { page: 1, pageSize: 10 });
  assert.equal(afterRepeat.items[0].employmentHistory.length, 1);
});
