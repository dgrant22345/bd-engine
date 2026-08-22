import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAcquisitionDimensions, buildAcquisitionSource, buildProductEvent } from '../src/product-analytics.js';

test('acquisition sources retain a bounded campaign identifier without customer data', () => {
  assert.equal(
    buildAcquisitionSource({ source: 'LinkedIn', campaign: 'Coverage Denominator' }),
    'linkedin.coverage-denominator'
  );
  assert.equal(buildAcquisitionSource({ source: 'HRNxt' }), 'hrnxt');
  const privateSource = buildAcquisitionSource({ source: 'person@example.com', campaign: 'x'.repeat(80) });
  assert.equal(privateSource.startsWith('direct.'), true);
  assert.equal(privateSource.includes('person'), false);
  assert.equal(privateSource.length, 39);
  assert.equal(buildAcquisitionSource({}, 'referral'), 'referral');
});

test('product events use hashed idempotency and visitor identifiers', () => {
  const event = buildProductEvent({
    eventType: 'setup_completed',
    tenantId: 'tenant-private',
    userId: 'user-private',
    eventKey: 'setup-v1',
    dimensions: { persona: 'jobseeker', planId: 'trial' },
  });
  assert.equal(event.visitorId.includes('user-private'), false);
  assert.equal(event.eventKey.includes('tenant-private'), false);
  assert.equal(event.eventKey.length, 64);
  assert.deepEqual(event.metadata, { persona: 'jobseeker', planId: 'trial' });
});

test('signup attribution keeps an immutable first touch and a bounded last non-direct touch', () => {
  const dimensions = buildAcquisitionDimensions({
    version: 2,
    firstTouch: {
      source: 'LinkedIn',
      medium: 'Organic Social',
      campaign: 'Founder Workflow',
      content: 'Signal Demo',
      landingPath: '/job-search?email=never-stored@example.com',
      persona: 'jobseeker',
    },
    lastNonDirectTouch: {
      source: 'Discord',
      medium: 'Community',
      campaign: 'Signal Clinic',
      content: 'Office Hours',
      landingPath: '/ats-checker?target=private',
      persona: 'bd',
    },
  }, { persona: 'bd' });

  assert.deepEqual(dimensions, {
    persona: 'bd',
    source: 'discord.signal-clinic',
    firstTouchSource: 'linkedin',
    firstTouchMedium: 'organic-social',
    firstTouchCampaign: 'founder-workflow',
    firstTouchContent: 'signal-demo',
    firstTouchLandingPath: '/job-search',
    firstTouchPersona: 'jobseeker',
    lastNonDirectSource: 'discord',
    lastNonDirectMedium: 'community',
    lastNonDirectCampaign: 'signal-clinic',
    lastNonDirectContent: 'office-hours',
    lastNonDirectLandingPath: '/ats-checker',
    lastNonDirectPersona: 'bd',
  });
  assert.equal(JSON.stringify(dimensions).includes('?'), false);
  assert.equal(JSON.stringify(dimensions).includes('@'), false);
});

test('validated referrals replace only the last non-direct touch', () => {
  const dimensions = buildAcquisitionDimensions({
    firstTouch: {
      source: 'linkedin',
      medium: 'organic',
      campaign: 'founder-post',
      landingPath: '/',
      persona: 'bd',
    },
    lastNonDirectTouch: {
      source: 'newsletter',
      medium: 'email',
      campaign: 'august',
      landingPath: '/',
      persona: 'bd',
    },
  }, { persona: 'bd', forceLastNonDirectSource: 'referral' });

  assert.equal(dimensions.firstTouchSource, 'linkedin');
  assert.equal(dimensions.firstTouchCampaign, 'founder-post');
  assert.equal(dimensions.lastNonDirectSource, 'referral');
  assert.equal(dimensions.lastNonDirectCampaign, undefined);
  assert.equal(dimensions.source, 'referral');
});

test('product events reject unknown types and discard arbitrary dimensions', () => {
  assert.throws(() => buildProductEvent({ eventType: 'customer_email' }), /Unsupported product event/);
  const event = buildProductEvent({
    eventType: 'target_created',
    tenantId: 'tenant-1',
    dimensions: { email: 'private@example.com', source: 'manual' },
  });
  assert.deepEqual(event.metadata, { source: 'manual' });

  const privateEvent = buildProductEvent({
    eventType: 'target_created',
    tenantId: 'tenant-1',
    dimensions: {
      source: 'person@example.com',
      firstTouchLandingPath: '/customers/private-contact?email=person@example.com',
      firstTouchContent: 'https://example.com/private',
      firstTouchPersona: 'arbitrary-persona',
    },
  });
  assert.deepEqual(privateEvent.metadata, {});
});

test('signup milestones retain document versions without accepting arbitrary consent content', () => {
  const event = buildProductEvent({
    eventType: 'signup_completed',
    tenantId: 'tenant-1',
    userId: 'user-1',
    dimensions: {
      termsVersion: '2026-08-21',
      privacyVersion: '2026-08-21',
      acceptedAt: 'client-controlled timestamp',
      consentNote: 'arbitrary customer content',
    },
  });
  assert.deepEqual(event.metadata, {
    termsVersion: '2026-08-21',
    privacyVersion: '2026-08-21',
  });
});

test('core value milestones are accepted and idempotent per workspace', () => {
  const board = buildProductEvent({ eventType: 'board_resolved', tenantId: 'tenant-1', eventKey: 'tenant-1' });
  const jobs = buildProductEvent({ eventType: 'useful_jobs_found', tenantId: 'tenant-1', eventKey: 'tenant-1' });
  assert.notEqual(board.eventKey, jobs.eventKey);
  assert.equal(board.eventType, 'board_resolved');
  assert.equal(jobs.eventType, 'useful_jobs_found');
});

test('commercial outcome milestones cover the funnel without customer content', () => {
  const outcomeTypes = [
    'outreach_logged',
    'reply_received',
    'positive_reply_received',
    'meeting_booked',
    'opportunity_created',
    'client_won',
    'client_lost',
  ];
  const events = outcomeTypes.map((eventType) => buildProductEvent({
    eventType,
    tenantId: 'tenant-private',
    userId: 'user-private',
    eventKey: 'tenant-private',
    dimensions: {
      source: 'outcome_log',
      contactEmail: 'buyer@example.com',
      notes: 'Customer-confidential deal detail',
    },
  }));

  assert.deepEqual(events.map((event) => event.eventType), outcomeTypes);
  assert.equal(new Set(events.map((event) => event.eventKey)).size, outcomeTypes.length);
  for (const event of events) {
    assert.deepEqual(event.metadata, { source: 'outcome_log' });
    assert.doesNotMatch(JSON.stringify(event.metadata), /buyer@example\.com|Customer-confidential/);
    assert.doesNotMatch(event.visitorId, /tenant-private|user-private/);
    assert.doesNotMatch(event.eventKey, /tenant-private|user-private/);
  }
});
