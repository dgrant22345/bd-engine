import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createStore } from '../src/store.js';
import {
  buildActivityApiResponse,
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
    () => validateCommercialOutcomeInput({ stage: 'replied', accountId: 'acct-1', valueCents: 0 }),
    /only be recorded for opportunity_created, won, or lost outcomes/
  );
  assert.throws(
    () => validateCommercialOutcomeInput({ stage: 'meeting_booked', accountId: 'acct-1', currency: 'CAD' }),
    /only be recorded for opportunity_created, won, or lost outcomes/
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

test('activity API responses distinguish recorded outcomes from explicit partial success', () => {
  const activity = { id: 'activity-1', summary: 'Client agreed to proceed' };
  const recorded = buildActivityApiResponse(activity, {
    status: 'recorded',
    outcome: { id: 'outcome-1', stage: 'won' },
  });
  assert.equal(recorded.id, activity.id);
  assert.equal(recorded.commercialOutcomeStatus, 'recorded');
  assert.equal(recorded.commercialOutcome.id, 'outcome-1');
  assert.equal(recorded.partialSuccess, false);
  assert.equal(recorded.warning, null);

  const partial = buildActivityApiResponse(activity, { status: 'failed' });
  assert.equal(partial.id, activity.id);
  assert.equal(partial.commercialOutcomeStatus, 'failed');
  assert.equal(partial.commercialOutcome, null);
  assert.equal(partial.partialSuccess, true);
  assert.equal(partial.warning.code, 'commercial_outcome_not_recorded');
  assert.match(partial.warning.message, /activity was saved/i);
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
      ...(valueCents === null ? {} : { currency: 'CAD' }),
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
  assert.equal(outcomeStageForActivity({ pipelineStage: 'opportunity_created' }), 'opportunity_created');
  assert.equal(outcomeStageForActivity({ pipelineStage: 'positive_reply' }), 'positive_reply');
  assert.equal(outcomeStageForActivity({ pipelineStage: 'meeting_booked' }), 'meeting_booked');
  assert.equal(outcomeStageForActivity({ pipelineStage: 'won' }), 'won');
  assert.equal(outcomeStageForActivity({ pipelineStage: 'lost' }), 'lost');
  assert.equal(outcomeStageForActivity({ type: 'note' }), '');
});

test('activity timestamps and commercial stages project safely onto legacy account statuses', async () => {
  const store = createStore();
  const tenantId = 'tenant-outcome-activity-stages';
  addTenant(store, tenantId);
  const stageCases = [
    ['outreach_logged', 'not_started', 'contacted'],
    ['positive_reply', 'contacted', 'replied'],
    ['meeting_booked', 'replied', 'opportunity'],
    ['opportunity_created', 'replied', 'opportunity'],
    ['won', 'replied', 'opportunity'],
    ['lost', 'replied', 'replied'],
  ];
  const occurredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  for (const [pipelineStage, initialStatus, expectedStatus] of stageCases) {
    const account = await store.addAccount(tenantId, {
      displayName: `Stage ${pipelineStage}`,
      outreachStatus: initialStatus,
    });
    const activity = await store.addActivity(tenantId, 'user-stage', {
      accountId: account.id,
      type: 'pipeline',
      pipelineStage,
      occurredAt,
      summary: `Recorded ${pipelineStage}`,
    });
    assert.equal(activity.occurredAt, occurredAt);
    const detail = await store.getAccountDetail(tenantId, account.id);
    assert.equal(detail.account.outreachStatus, expectedStatus, pipelineStage);
  }

  const unchanged = await store.addAccount(tenantId, {
    displayName: 'Unsupported Stage',
    outreachStatus: 'ready_to_contact',
  });
  await store.addActivity(tenantId, 'user-stage', {
    accountId: unchanged.id,
    type: 'pipeline',
    pipelineStage: 'contract_sent',
    occurredAt,
    summary: 'Contract sent outside the mapped funnel',
  });
  assert.equal((await store.getAccountDetail(tenantId, unchanged.id)).account.outreachStatus, 'ready_to_contact');

  const progressed = await store.addAccount(tenantId, {
    displayName: 'Monotonic Stage',
    outreachStatus: 'opportunity',
  });
  await store.addActivity(tenantId, 'user-stage', {
    accountId: progressed.id,
    pipelineStage: 'contacted',
    occurredAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal((await store.getAccountDetail(tenantId, progressed.id)).account.outreachStatus, 'opportunity');
});

test('activity logging rejects empty submissions but accepts a recognized result', async () => {
  const store = createStore();
  const tenantId = 'tenant-outcome-activity-empty';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Meaningful Activity Co' });
  const before = store.getActivity(tenantId, { page: 1, pageSize: 25 }).total;

  await assert.rejects(
    store.addActivity(tenantId, 'user-empty', {
      accountId: account.id,
      type: 'note',
      summary: '   ',
      notes: 'Unstructured notes alone are not the activity summary.',
    }),
    (error) => error.status === 400 && /summary or select a recognized result/.test(error.message)
  );
  assert.equal(store.getActivity(tenantId, { page: 1, pageSize: 25 }).total, before);

  const mapped = await store.addActivity(tenantId, 'user-empty', {
    accountId: account.id,
    pipelineStage: 'positive_reply',
    summary: '   ',
  });
  assert.match(mapped.summary, /positive reply/i);
});

test('activity keeps submitted commercial context and terminal outcome notes', async () => {
  const store = createStore();
  const tenantId = 'tenant-outcome-activity-context';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Context Co' });

  for (const stage of ['lost', 'won']) {
    const payload = {
      accountId: account.id,
      pipelineStage: stage,
      summary: stage === 'lost' ? 'Budget moved to next year' : 'Signed retained search agreement',
      outcomeNotes: stage === 'lost' ? 'Revisit in Q1' : 'Kickoff is scheduled for Monday',
      lostReason: stage === 'lost' ? 'Budget timing' : '',
      valueCents: 750000,
      currency: 'CAD',
    };
    const activity = await store.addActivity(tenantId, 'user-context', payload);
    assert.equal(activity.valueCents, 750000);
    assert.equal(activity.currency, 'CAD');
    assert.equal(activity.lostReason, payload.lostReason);
    assert.equal(activity.outcomeNotes, payload.outcomeNotes);

    const outcome = await store.createCommercialOutcomeFromActivity(
      tenantId,
      'user-context',
      activity,
      payload
    );
    assert.match(outcome.notes, new RegExp(payload.summary));
    assert.match(outcome.notes, new RegExp(payload.outcomeNotes));
    assert.equal(outcome.lostReason, payload.lostReason);
  }
});

test('activity remains durable when derived outcome validation fails', async () => {
  const store = createStore();
  const tenantId = 'tenant-outcome-activity-partial';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Partial Success Co' });
  const payload = {
    accountId: account.id,
    pipelineStage: 'replied',
    summary: 'Reply received with an invalid commercial value attached',
    valueCents: 12345,
    currency: 'CAD',
    outcomeNotes: 'Preserve this context for correction.',
  };

  const activity = await store.addActivity(tenantId, 'user-partial', payload);
  await assert.rejects(
    store.createCommercialOutcomeFromActivity(tenantId, 'user-partial', activity, payload),
    /only be recorded for opportunity_created, won, or lost outcomes/
  );
  const saved = store.getActivity(tenantId, { page: 1, pageSize: 25 }).items[0];
  assert.equal(saved.id, activity.id);
  assert.equal(saved.valueCents, payload.valueCents);
  assert.equal(saved.currency, payload.currency);
  assert.equal(saved.outcomeNotes, payload.outcomeNotes);
  assert.equal((await store.findCommercialOutcomes(tenantId)).total, 0);
});

test('activity logging rejects invalid or future occurrence times before mutation', async () => {
  const store = createStore();
  const tenantId = 'tenant-outcome-activity-time';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Time Safe Co' });
  const before = store.getActivity(tenantId, { page: 1, pageSize: 25 }).total;

  await assert.rejects(
    store.addActivity(tenantId, 'user-time', {
      accountId: account.id,
      pipelineStage: 'meeting_booked',
      occurredAt: 'not-a-date',
    }),
    (error) => error.status === 400 && /valid date and time/.test(error.message)
  );
  await assert.rejects(
    store.addActivity(tenantId, 'user-time', {
      accountId: account.id,
      pipelineStage: 'meeting_booked',
      occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
    (error) => error.status === 400 && /cannot be in the future/.test(error.message)
  );
  assert.equal(store.getActivity(tenantId, { page: 1, pageSize: 25 }).total, before);
  assert.equal((await store.getAccountDetail(tenantId, account.id)).account.outreachStatus, 'not_started');
});

test('backdated activity does not regress an account last-contacted timestamp', async () => {
  const store = createStore();
  const tenantId = 'tenant-outcome-activity-last-contacted';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Chronology Co' });
  const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const older = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await store.addActivity(tenantId, 'user-time', { accountId: account.id, occurredAt: recent, summary: 'Recent note' });
  await store.addActivity(tenantId, 'user-time', { accountId: account.id, occurredAt: older, summary: 'Older note' });
  assert.equal((await store.getAccountDetail(tenantId, account.id)).account.lastContactedAt, recent);
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
  assert.match(server, /buildActivityApiResponse\(activity, bridgeResult\)/);
  assert.match(server, /buildActivityApiResponse\(result, bridgeResult\)/);
  assert.match(server, /status: 'failed'/);
  assert.match(server, /Slow commercial outcome summary: saas\/src\/db\.js dbGetCommercialOutcomeSummary/);
  assert.match(server, /source: 'pasted_import'/);
  assert.match(server, /store\.serializeAccountImport\(tenantId, async \(\) =>/);
  assert.match(server, /if \(result\.count > 0\)/);
});
