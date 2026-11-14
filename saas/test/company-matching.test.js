import test from 'node:test';
import assert from 'node:assert/strict';
import { betterCompanyDisplayName, createAccountNameIndex, domainLabel, isDomainDerivedName } from '../src/company-matching.js';
import { createStore } from '../src/store.js';

const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

test('names people use match companies added by domain, and nothing looser', () => {
  const accounts = [
    { displayName: 'Sunlife', domain: 'sunlife.com' },
    { displayName: 'Lightspeedhq', domain: 'lightspeedhq.com' },
    { displayName: 'Cibc', domain: 'cibc.com' },
    { displayName: 'TD Bank', domain: 'td.com' },
    { displayName: 'Canadiantire', domain: 'corp.canadiantire.ca' },
  ];
  const index = createAccountNameIndex(accounts, normalizeKey);
  const match = (name) => index.get(normalizeKey(name))?.displayName || '';
  assert.equal(match('Sun Life'), 'Sunlife');
  assert.equal(match('Sun Life Financial'), 'Sunlife');
  assert.equal(match('Lightspeed Commerce'), 'Lightspeedhq');
  assert.equal(match('CIBC'), 'Cibc');
  assert.equal(match('Canadian Tire Corporation'), 'Canadiantire');
  // Different companies that share letters stay apart.
  assert.equal(match('TD Synnex'), '');
  assert.equal(match('Sunlight Labs'), '');
  assert.equal(match('Light'), '');
  assert.equal(domainLabel('https://corp.canadiantire.ca/careers'), 'canadiantire');
  assert.equal(domainLabel('example.co.uk'), 'example');
});

test('an ambiguous name matches no company', () => {
  const index = createAccountNameIndex([
    { displayName: 'Northwind', domain: 'northwind.com' },
    { displayName: 'Northwind Group', domain: 'northwindgroup.ca' },
  ], normalizeKey);
  assert.equal(index.get(normalizeKey('Northwind Inc')), undefined);
});

test('a domain-made name gives way to the name people use', () => {
  assert.equal(isDomainDerivedName({ displayName: 'Sunlife', domain: 'sunlife.com' }), true);
  assert.equal(isDomainDerivedName({ displayName: 'TD Bank', domain: 'td.com' }), false);
  assert.equal(betterCompanyDisplayName({ displayName: 'Sunlife', domain: 'sunlife.com' }, 'Sun Life'), 'Sun Life');
  assert.equal(betterCompanyDisplayName({ displayName: 'Cibc', domain: 'cibc.com' }, 'CIBC'), 'CIBC');
  assert.equal(betterCompanyDisplayName({ displayName: 'Canadiantire', domain: 'corp.canadiantire.ca' }, 'Canadian Tire Corporation'), 'Canadian Tire');
  assert.equal(betterCompanyDisplayName({ displayName: 'Shopify', domain: 'shopify.com' }, 'Shopify Inc.'), '');
  assert.equal(betterCompanyDisplayName({ displayName: 'TD Bank', domain: 'td.com' }, 'TD'), '');
});

test('people imported after a domain watchlist link to those companies and rename them', async () => {
  const store = createStore();
  const tenantId = 'tenant-company-matching';
  store.ensureTenant({ id: tenantId, name: 'Matching' }, { id: `${tenantId}-owner` });
  await store.importAccountsList(tenantId, ['company,domain', 'Sunlife,sunlife.com', 'Lightspeedhq,lightspeedhq.com', 'Cibc,cibc.com'].join('\n'));
  const sunlife = (await store.findAccounts(tenantId, { page: 1, pageSize: 10 })).items.find((item) => item.domain === 'sunlife.com');
  store.addConfig(tenantId, { companyName: 'Sunlife', accountId: sunlife.id, atsType: 'workday', boardId: 'sunlife/Experienced-Jobs', discoveryStatus: 'resolved', reviewStatus: 'approved', active: true });

  const csv = [
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Sofia,Martins,,,Sun Life,Recruitment Manager,19 Feb 2024',
    'Grace,Kim,,,Lightspeed Commerce,Engineering Manager,14 Jul 2024',
    'Liam,Roy,,,CIBC,Senior Talent Acquisition Partner,05 May 2023',
    'Ana,Stone,,,Sunlight Labs,VP Talent,01 Jan 2024',
  ].join('\n');
  await store.importLinkedInCSV(tenantId, csv, {});

  const accounts = (await store.findAccounts(tenantId, { page: 1, pageSize: 20 })).items;
  const byDomain = (domain) => accounts.find((item) => item.domain === domain);
  assert.equal(byDomain('sunlife.com').displayName, 'Sun Life');
  assert.deepEqual(byDomain('sunlife.com').aliases, ['Sunlife']);
  assert.equal(byDomain('lightspeedhq.com').displayName, 'Lightspeed Commerce');
  assert.equal(byDomain('cibc.com').displayName, 'CIBC');
  assert.ok(accounts.some((item) => item.displayName === 'Sunlight Labs'), 'an unrelated company is created separately');
  assert.equal(accounts.length, 4);

  const people = (await store.findContacts(tenantId, { page: 1, pageSize: 20 })).items;
  const accountOf = (name) => people.find((person) => person.fullName === name)?.accountId;
  assert.equal(accountOf('Sofia Martins'), byDomain('sunlife.com').id);
  assert.equal(accountOf('Grace Kim'), byDomain('lightspeedhq.com').id);
  assert.equal(accountOf('Liam Roy'), byDomain('cibc.com').id);

  const [config] = (await store.findConfigs(tenantId, { page: 1, pageSize: 10 })).items;
  assert.equal(config.companyName, 'Sun Life', 'the job board follows the new name');
});

test('adding a network company to the watchlist starts tracking it instead of skipping it', async () => {
  const store = createStore();
  const tenantId = 'tenant-watchlist-network';
  store.ensureTenant({ id: tenantId, name: 'Watchlist' }, { id: `${tenantId}-owner` });
  await store.importLinkedInCSV(tenantId, ['First Name,Last Name,URL,Email Address,Company,Position,Connected On', 'Maya,Chen,,,Wealthsimple,Head of Talent,03 Oct 2025'].join('\n'), {});
  let [company] = (await store.findAccounts(tenantId, { page: 1, pageSize: 10 })).items;
  assert.equal(company.tracked, false);
  const result = await store.importAccountsList(tenantId, ['company,domain', 'Wealthsimple,wealthsimple.com'].join('\n'));
  assert.equal(result.count, 0);
  assert.equal(result.tracked, 1);
  assert.equal(result.skipped[0].reason, 'now_tracked');
  [company] = (await store.findAccounts(tenantId, { page: 1, pageSize: 10 })).items;
  assert.equal(company.tracked, true);
  assert.equal(company.domain, 'wealthsimple.com');
});
