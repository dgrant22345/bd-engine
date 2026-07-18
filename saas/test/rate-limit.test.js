import test from 'node:test';
import assert from 'node:assert/strict';

import { consumeMemoryRateLimitBucket, hashRateLimitKey } from '../src/rate-limit.js';

test('rate limit keys are stable hashes that do not expose identifiers', () => {
  const raw = 'login:203.0.113.42';
  const hashed = hashRateLimitKey(raw);
  assert.equal(hashed, hashRateLimitKey(raw));
  assert.equal(hashed.length, 64);
  assert.equal(hashed.includes('203.0.113.42'), false);
});

test('fixed window permits the limit, blocks overflow, and resets', () => {
  const buckets = new Map();
  assert.equal(consumeMemoryRateLimitBucket(buckets, 'signup:network', 2, 1000, 10), false);
  assert.equal(consumeMemoryRateLimitBucket(buckets, 'signup:network', 2, 1000, 20), false);
  assert.equal(consumeMemoryRateLimitBucket(buckets, 'signup:network', 2, 1000, 30), true);
  assert.equal(consumeMemoryRateLimitBucket(buckets, 'signup:network', 2, 1000, 1010), false);
});

test('different keys consume independent buckets', () => {
  const buckets = new Map();
  assert.equal(consumeMemoryRateLimitBucket(buckets, 'login:first', 1, 1000, 0), false);
  assert.equal(consumeMemoryRateLimitBucket(buckets, 'login:first', 1, 1000, 1), true);
  assert.equal(consumeMemoryRateLimitBucket(buckets, 'login:second', 1, 1000, 1), false);
});
