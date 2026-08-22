import test from 'node:test';
import assert from 'node:assert/strict';

import { dbGetAnalyticsSummary, dbRecordProductEvent } from '../src/db.js';

async function recordMilestone(tenantId, eventType, metadata = {}) {
  return dbRecordProductEvent({
    visitorId: `visitor-${tenantId}`,
    eventType,
    path: `/funnel/${eventType.replace(/_/g, '-')}`,
    source: 'product',
    tenantId,
    userId: `user-${tenantId}`,
    eventKey: `${tenantId}-${eventType}`,
    metadata,
  });
}

test('seven-day activation requires setup, a target, a usable signal, and an action', async () => {
  const activatedTenant = 'activation-complete';
  for (const eventType of [
    'signup_completed',
    'setup_completed',
    'target_created',
    'board_resolved',
    'outreach_generated',
  ]) {
    await recordMilestone(activatedTenant, eventType, eventType === 'signup_completed' ? {
      firstTouchSource: 'linkedin',
      firstTouchCampaign: 'founder-workflow',
      persona: 'bd',
    } : {});
  }

  const pendingTenant = 'activation-pending';
  for (const eventType of ['signup_completed', 'setup_completed', 'target_created', 'useful_jobs_found']) {
    await recordMilestone(pendingTenant, eventType, eventType === 'signup_completed' ? {
      firstTouchSource: 'discord',
      firstTouchCampaign: 'signal-clinic',
      persona: 'bd',
    } : {});
  }

  const summary = await dbGetAnalyticsSummary(30);
  assert.deepEqual(summary.activation, {
    windowDays: 7,
    cohortSignups: 2,
    workspaces: 1,
    pendingWindow: 1,
  });
  assert.deepEqual(summary.activationBySource, [
    {
      source: 'linkedin',
      campaign: 'founder-workflow',
      persona: 'bd',
      signups: 1,
      workspaces: 1,
      pendingWindow: 0,
    },
    {
      source: 'discord',
      campaign: 'signal-clinic',
      persona: 'bd',
      signups: 1,
      workspaces: 0,
      pendingWindow: 1,
    },
  ]);
});
