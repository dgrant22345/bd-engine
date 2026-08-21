import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createStore } from '../src/store.js';
import {
  COMMERCIAL_OUTCOME_STAGES,
  outcomeStageForActivity,
  validateCommercialOutcomeInput,
} from '../src/commercial-outcomes.js';

function addTenant(store, tenantId) {
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner`, name: 'Owner' });
}

test('commercial outcome input accepts the normalized funnel and rejects invalid revenue data', () => {
  for (const stage of COMMERCIAL_OUTCOME_STAGES) {
    const value = validateCommercialOutcomeInput({ stage, accountId: 'acct-1' });
    assert.equal(value.stage, stage);
    assert.equal(value.currency, 'USD');
    assert.match(value.occurredAt, /^\d{4}-\d{2}-\d{2}T/);
  }

  assert.throws(
    () => validateCommercialOutcomeInput({ stage: 'maybe', accountId: 'acct-1' }),
    /stage must be one of/
  );
  assert.throws(
    () => validateCommercialOutcomeInput({ stage: 'won', accountId: 'acct-1', valueCents: 12.5 }),
    /non-negative integer/
  );
  assert.throws(
    () => validateCommercialOutcomeInput({ stage: 'won', accountId: 'acct-1', lostReason: 'price' }),
    /only be recorded for a lost outcome/
  );
  assert.throws(
    () => validateCommercialOutcomeInput({
      stage: 'won',
      accountId: 'acct-1',
      occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
    /cannot be in the future/
  );
});

test('commercial outcomes are tenant scoped and validate account/contact ownership', async () => {
  const store = createStore();
  const tenantId = 'tenant-outcome-scope-a';
  const otherTenantId = 'tenant-outcome-scope-b';
  addTenant(store, tenantId);
  addTenant(store, otherTenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Acme' });
  const secondAccount = await store.addAccount(tenantId, { displayName: 'Second Co' });
  const otherAccount = await store.addAccount(otherTenantId, { displayName: 'Other Co' });
  const contact = await store.addContact(tenantId, { accountId: account.id, fullName: 'Buyer One' });
  const mismatchedContact = await store.addContact(tenantId, { accountId: secondAccount.id, fullName: 'Buyer Two' });
  const otherContact = await store.addContact(otherTenantId, { accountId: otherAccount.id, fullName: 'Other Buyer' });

  const created = await store.createCommercialOutcome(tenantId, 'user-a', {
    stage: 'meeting_booked',
    accountId: account.id,
    contactId: contact.id,
  });
  assert.equal(created.tenantId, tenantId);
  assert.equal(created.createdByUserId, 'user-a');
  assert.equal((await store.findCommercialOutcomes(tenantId)).total, 1);
  assert.equal((await store.findCommercialOutcomes(otherTenantId)).total, 0);

  await assert.rejects(
    store.createCommercialOutcome(tenantId, 'user-a', { stage: 'won', accountId: otherAccount.id }),
    (error) => error.status === 404 && /Account not found/.test(error.message)
  );
  await assert.rejects(
    store.createCommercialOutcome(tenantId, 'user-a', {
      stage: 'won', accountId: account.id, contactId: otherContact.id,
    }),
    (error) => error.status === 404
  );
  await assert.rejects(
    store.createCommercialOutcome(tenantId, 'user-a', {
      stage: 'won', accountId: account.id, contactId: mismatchedContact.id,
    }),
    /Contact does not belong to the selected account/
  );
});

test('commercial outcome listing and ROI summary expose funnel, value, filters, and pagination', async () => {
  const store = createStore();
  const tenantId = 'tenant-outcome-summary';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Northstar' });
  const stages = [
    ['outreach_logged', null],
    ['replied', null],
    ['positive_reply', null],
    ['meeting_booked', null],
    ['opportunity_created', 250000],
    ['won', 240000],
  ];
  for (const [stage, valueCents] of stages) {
    await store.createCommercialOutcome(tenantId, 'user-summary', {
      stage,
      accountId: account.id,
      valueCents,
      currency: 'CAD',
    });
  }

  const page = await store.findCommercialOutcomes(tenantId, { page: 2, pageSize: 2 });
  assert.equal(page.total, 6);
  assert.equal(page.items.length, 2);
  assert.equal(page.page, 2);
  const wins = await store.findCommercialOutcomes(tenantId, { stage: 'won' });
  assert.equal(wins.total, 1);
  assert.equal(wins.items[0].valueCents, 240000);

  const summary = await store.getCommercialOutcomeSummary(tenantId);
  assert.equal(summary.total, 6);
  assert.equal(summary.uniqueAccounts, 1);
  assert.equal(summary.byStage.outreach_logged, 1);
  assert.equal(summary.byStage.won, 1);
  assert.deepEqual(summary.valuesByCurrency.CAD, {
    opportunityCreatedCents: 250000,
    wonCents: 240000,
    lostCents: 0,
  });
  assert.equal(summary.conversion.outreachToReplyRate, 1);
  assert.equal(summary.conversion.meetingToOpportunityRate, 1);
  assert.equal(summary.conversion.opportunityToWinRate, 1);
  assert.ok(summary.firstOccurredAt);
  assert.ok(summary.lastOccurredAt);
});

test('activity bridge maps established stages and deduplicates the source activity', async () => {
  const store = createStore();
  const tenantId = 'tenant-outcome-activity';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Bridge Co' });
  const activity = await store.addActivity(tenantId, 'user-bridge', {
    accountId: account.id,
    type: 'outreach',
    pipelineStage: 'contacted',
    summary: 'Sent email',
  });
  const first = await store.createCommercialOutcomeFromActivity(tenantId, 'user-bridge', activity, {
    type: 'outreach', pipelineStage: 'contacted',
  });
  const duplicate = await store.createCommercialOutcomeFromActivity(tenantId, 'user-bridge', activity, {
    type: 'outreach', pipelineStage: 'contacted',
  });
  assert.equal(first.id, duplicate.id);
  assert.equal((await store.findCommercialOutcomes(tenantId)).total, 1);
  assert.equal(outcomeStageForActivity({ pipelineStage: 'replied' }), 'replied');
  assert.equal(outcomeStageForActivity({ pipelineStage: 'opportunity' }), 'opportunity_created');
  assert.equal(outcomeStageForActivity({ type: 'note' }), '');
});

test('privacy export and workspace clearing include commercial outcomes', async () => {
  const store = createStore();
  const tenantId = 'tenant-outcome-privacy';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Privacy Co' });
  await store.createCommercialOutcome(tenantId, 'user-privacy', {
    stage: 'lost',
    accountId: account.id,
    valueCents: 100000,
    currency: 'USD',
    lostReason: 'No budget',
  });

  const exported = await store.exportTenantData(tenantId);
  assert.equal(exported.workspace.commercialOutcomes.length, 1);
  assert.equal(exported.workspace.commercialOutcomes[0].lostReason, 'No budget');
  const cleared = await store.clearTenantWorkspaceData(tenantId);
  assert.equal(cleared.deleted.outcomeCount, 1);
  assert.equal(cleared.remaining.outcomeCount, 0);
  assert.equal((await store.findCommercialOutcomes(tenantId)).total, 0);
});

test('server exposes outcome routes, activity bridge, timing, and imported-target activation', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /pathname === '\/api\/outcomes\/summary'/);
  assert.match(server, /pathname === '\/api\/outcomes'/);
  assert.match(server, /bridgeCommercialOutcomeFromActivity/);
  assert.match(server, /Slow commercial outcome summary: saas\/src\/db\.js dbGetCommercialOutcomeSummary/);
  assert.match(server, /source: 'pasted_import'/);
  assert.match(server, /if \(result\.count > 0\)/);
});
