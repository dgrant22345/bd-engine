import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProductEvent } from '../src/product-analytics.js';

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

test('product events reject unknown types and discard arbitrary dimensions', () => {
  assert.throws(() => buildProductEvent({ eventType: 'customer_email' }), /Unsupported product event/);
  const event = buildProductEvent({
    eventType: 'target_created',
    tenantId: 'tenant-1',
    dimensions: { email: 'private@example.com', source: 'manual' },
  });
  assert.deepEqual(event.metadata, { source: 'manual' });
});
