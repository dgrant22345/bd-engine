import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSession,
  destroySession,
  getSession,
  isRecentAuthentication,
  markSessionStepUp,
} from '../src/auth.js';

test('privileged authentication accepts only recent non-future timestamps', () => {
  const nowMs = Date.parse('2026-07-18T12:00:00.000Z');
  const maxAgeMs = 15 * 60 * 1000;
  assert.equal(isRecentAuthentication({ createdAt: '2026-07-18T11:46:00.000Z' }, maxAgeMs, nowMs), true);
  assert.equal(isRecentAuthentication({ createdAt: '2026-07-18T11:44:00.000Z' }, maxAgeMs, nowMs), false);
  assert.equal(isRecentAuthentication({ createdAt: '2026-07-18T12:01:00.000Z' }, maxAgeMs, nowMs), false);
  assert.equal(isRecentAuthentication({}, maxAgeMs, nowMs), false);
});

test('password step-up refreshes and persists the session authentication time', async () => {
  const { sessionId } = await createSession('step-up-user', 'step-up-tenant', {
    createdAt: '2026-07-18T10:00:00.000Z',
  });
  try {
    await markSessionStepUp(sessionId, '2026-07-18T12:00:00.000Z');
    const session = getSession(sessionId);
    assert.equal(session.stepUpAt, '2026-07-18T12:00:00.000Z');
    assert.equal(isRecentAuthentication(session, 15 * 60 * 1000, Date.parse('2026-07-18T12:14:59.000Z')), true);
  } finally {
    await destroySession(sessionId);
  }
});
