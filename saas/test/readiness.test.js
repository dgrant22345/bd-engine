/**
 * CG-011: readiness decision matrix. Production without durable persistence
 * must fail closed; development in-memory mode stays ready.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getReadinessDecision, shouldLogReadinessFailure } from '../src/readiness.js';

test('production with connected database is ready', () => {
  const decision = getReadinessDecision({ isProduction: true, startupComplete: true, dbEnabled: true, dbReady: true });
  assert.deepEqual(decision, { ready: true });
});

test('production without DATABASE_URL fails closed (no in-memory fallback)', () => {
  const decision = getReadinessDecision({ isProduction: true, startupComplete: true, dbEnabled: false, dbReady: false });
  assert.equal(decision.ready, false);
  assert.match(decision.reason, /in-memory persistence is not allowed in production/);
});

test('production with configured but unreachable database fails closed', () => {
  const decision = getReadinessDecision({ isProduction: true, startupComplete: true, dbEnabled: true, dbReady: false });
  assert.equal(decision.ready, false);
  assert.match(decision.reason, /database is not connected/);
});

test('startup failure is never ready, in any mode', () => {
  for (const isProduction of [true, false]) {
    const decision = getReadinessDecision({ isProduction, startupComplete: false, startupError: 'boom', dbEnabled: true, dbReady: true });
    assert.equal(decision.ready, false);
    assert.match(decision.reason, /startup failed: boom/);
  }
});

test('incomplete startup reports not ready without an error', () => {
  const decision = getReadinessDecision({ isProduction: false, startupComplete: false });
  assert.equal(decision.ready, false);
  assert.match(decision.reason, /startup incomplete/);
});

test('development in-memory mode is intentionally ready', () => {
  const decision = getReadinessDecision({ isProduction: false, startupComplete: true, dbEnabled: false, dbReady: false });
  assert.deepEqual(decision, { ready: true });
});

test('normal startup transition stays quiet while real readiness failures are logged', () => {
  assert.equal(shouldLogReadinessFailure({ ready: false, reason: 'startup incomplete' }), false);
  assert.equal(shouldLogReadinessFailure({ ready: false, reason: 'database is not connected' }), true);
  assert.equal(shouldLogReadinessFailure({ ready: false, reason: 'startup failed: boom' }), true);
  assert.equal(shouldLogReadinessFailure({ ready: true }), false);
});
