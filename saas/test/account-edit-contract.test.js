import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('account controls persist every customer-visible editable field', async () => {
  const store = createStore();
  const tenantId = 'tenant-account-edit-contract';
  store.ensureTenant({ id: tenantId, name: 'Account edit contract' }, { id: 'owner-1', name: 'Owner' });
  const account = await store.addAccount(tenantId, { displayName: 'Editable Company' });

  await store.patchAccount(tenantId, account.id, {
    status: 'in_conversation', outreachStatus: 'replied', priority: 'strategic', owner: 'Owner',
    nextAction: 'Ask for a referral', nextActionAt: '2026-08-01', domain: 'editable.example',
    canonicalDomain: 'editable.example', careersUrl: 'https://editable.example/careers',
    location: 'Toronto, ON', industry: 'Software', tags: [' target ', 'target', 'warm'],
    aliases: [' Editable ', 'EC'], linkedinCompanySlug: 'editable-company', enrichmentStatus: 'manual',
    enrichmentSource: 'manual_review', enrichmentConfidence: 'high', enrichmentConfidenceScore: 140,
    enrichmentNotes: 'Verified by the workspace owner.', notes: 'Customer-visible note.',
  });

  const detail = await store.getAccountDetail(tenantId, account.id);
  assert.equal(detail.account.status, 'in_conversation');
  assert.equal(detail.account.outreachStatus, 'replied');
  assert.equal(detail.account.priority, 'strategic');
  assert.equal(detail.account.careersUrl, 'https://editable.example/careers');
  assert.deepEqual(detail.account.tags, ['target', 'warm']);
  assert.deepEqual([...detail.account.aliases].sort(), ['EC', 'Editable']);
  assert.equal(detail.account.linkedinCompanySlug, 'editable-company');
  assert.equal(detail.account.enrichmentConfidenceScore, 100);
  assert.equal(detail.account.enrichmentNotes, 'Verified by the workspace owner.');
});

test('verified account identity repairs stale linked config identity without replacing a direct ATS source', async () => {
  const store = createStore();
  const tenantId = 'tenant-account-identity-sync';
  store.ensureTenant({ id: tenantId, name: 'Identity sync' }, { id: 'owner-1', name: 'Owner' });
  const account = await store.addAccount(tenantId, {
    displayName: 'Example Company',
    domain: 'gmail.com',
    careersUrl: 'https://gmail.com/careers',
  });
  const config = store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Example Company',
    atsType: 'greenhouse',
    boardId: 'example',
    domain: 'gmail.com',
    careersUrl: 'https://gmail.com/careers',
    source: 'https://job-boards.greenhouse.io/example',
  });

  await store.patchAccount(tenantId, account.id, {
    domain: 'example.com',
    canonicalDomain: 'example.com',
    careersUrl: 'https://example.com/careers',
  });

  const updated = await store.getConfig(tenantId, config.id);
  assert.equal(updated.domain, 'example.com');
  assert.equal(updated.careersUrl, 'https://example.com/careers');
  assert.equal(updated.source, 'https://job-boards.greenhouse.io/example');
});

test('contact score and outreach filters narrow the network list', async () => {
  const store = createStore();
  const tenantId = 'tenant-contact-filter-contract';
  store.ensureTenant({ id: tenantId, name: 'Contact filter contract' }, { id: 'owner-1', name: 'Owner' });
  await store.addContact(tenantId, { fullName: 'High Score', priorityScore: 90, outreachStatus: 'ready_to_contact' });
  await store.addContact(tenantId, { fullName: 'Low Score', priorityScore: 40, outreachStatus: 'contacted' });

  const highScore = await store.findContacts(tenantId, { minScore: '80', page: 1, pageSize: 20 });
  assert.deepEqual(highScore.items.map((item) => item.fullName), ['High Score']);
  const contacted = await store.findContacts(tenantId, { outreachStatus: 'contacted', page: 1, pageSize: 20 });
  assert.deepEqual(contacted.items.map((item) => item.fullName), ['Low Score']);
});

test('board and enrichment filters power the admin review queues', async () => {
  const store = createStore();
  const tenantId = 'tenant-admin-filter-contract';
  store.ensureTenant({ id: tenantId, name: 'Admin filter contract' }, { id: 'owner-1', name: 'Owner' });
  const strong = await store.addAccount(tenantId, { displayName: 'Strong Company', domain: 'strong.example', careersUrl: 'https://strong.example/jobs', targetScore: 90, connectionCount: 2 });
  await store.addAccount(tenantId, { displayName: 'Missing Company', targetScore: 45 });
  store.addConfig(tenantId, { accountId: strong.id, companyName: 'Strong Company', atsType: 'greenhouse', boardId: 'strong', discoveryStatus: 'resolved', confidenceBand: 'high', reviewStatus: 'approved', active: true });
  store.addConfig(tenantId, { companyName: 'Paused Company', atsType: 'lever', boardId: 'paused', discoveryStatus: 'needs_review', confidenceBand: 'medium', reviewStatus: 'pending', active: false });

  const inactiveLever = await store.findConfigs(tenantId, { ats: 'lever', active: 'false', page: 1, pageSize: 20 });
  assert.deepEqual(inactiveLever.items.map((item) => item.companyName), ['Paused Company']);
  const resolved = await store.findConfigs(tenantId, { discoveryStatus: 'resolved', reviewStatus: 'approved', page: 1, pageSize: 20 });
  assert.deepEqual(resolved.items.map((item) => item.companyName), ['Strong Company']);

  const missing = store.getEnrichmentQueue(tenantId, { missingDomain: 'true', missingCareersUrl: 'true', page: 1, pageSize: 20 });
  assert.deepEqual(missing.items.map((item) => item.displayName), ['Missing Company']);
  const connectedHighScore = store.getEnrichmentQueue(tenantId, { hasConnections: 'true', minTargetScore: '80', page: 1, pageSize: 20 });
  assert.deepEqual(connectedHighScore.items.map((item) => item.displayName), ['Strong Company']);
});
