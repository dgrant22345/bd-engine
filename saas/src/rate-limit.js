import { createHash } from 'node:crypto';

export function hashRateLimitKey(key) {
  return createHash('sha256').update(String(key || '')).digest('hex');
}

export function consumeMemoryRateLimitBucket(buckets, key, max, windowMs, nowMs = Date.now()) {
  const bucketKey = hashRateLimitKey(key);
  const limit = Math.max(1, Number(max) || 1);
  const duration = Math.max(1, Number(windowMs) || 1);
  const existing = buckets.get(bucketKey);
  if (!existing || nowMs >= Number(existing.resetAt || 0)) {
    buckets.set(bucketKey, { count: 1, resetAt: nowMs + duration });
    return false;
  }
  existing.count += 1;
  return existing.count > limit;
}
