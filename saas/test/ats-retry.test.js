import test from 'node:test';
import assert from 'node:assert/strict';
import { readRetryAfterMs, waitForAtsRetry } from '../src/store.js';

test('Retry-After preserves long server cooldowns in seconds and date form', () => {
  const read = (value) => readRetryAfterMs({ headers: new Headers({ 'retry-after': value }) }, Date.parse('2026-09-08T12:00:00Z'));
  assert.equal(read('120'), 120000);
  assert.equal(read('1e308'), Infinity);
  assert.equal(read('Tue, 08 Sep 2026 12:02:00 GMT'), 120000);
  assert.equal(read('Tue, 08 Sep 2026 11:59:00 GMT'), 0);
  assert.equal(read('nonsense'), null);
  assert.equal(readRetryAfterMs({}), null);
});

test('long cooldowns and exhausted budgets defer rather than retry early', async () => {
  const startedAt = performance.now();
  const limited = Object.assign(new Error('HTTP 429'), { retryAfterMs: 120000 });
  await assert.rejects(waitForAtsRetry(limited, 1), (error) => error === limited);
  const hugeCooldown = Object.assign(new Error('HTTP 429'), { retryAfterMs: Infinity });
  await assert.rejects(waitForAtsRetry(hugeCooldown, 1), (error) => error === hugeCooldown);
  const beyondBudget = Object.assign(new Error('HTTP 503'), { retryAfterMs: 1000 });
  await assert.rejects(waitForAtsRetry(beyondBudget, 1, performance.now() + 50), (error) => error === beyondBudget);
  await waitForAtsRetry({ retryAfterMs: 0 }, 1);
  console.log(`Deferred retry fixture: ${(performance.now() - startedAt).toFixed(2)}ms`);
});
