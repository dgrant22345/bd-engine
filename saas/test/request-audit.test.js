import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMutationAuditEntry } from '../src/request-audit.js';

test('successful authenticated workspace mutations produce privacy-safe audit entries', () => {
  const entry = buildMutationAuditEntry({
    method: 'PATCH',
    statusCode: 200,
    tenantId: 'tenant-a',
    userId: 'user-a',
    url: '/api/accounts/acct-1?debug=secret',
    requestId: 'request-a',
  });
  assert.deepEqual(entry, {
    tenantId: 'tenant-a',
    actorUserId: 'user-a',
    action: 'api.patch',
    entityType: 'accounts',
    metadata: {
      route: '/api/accounts/acct-1',
      statusCode: 200,
      requestId: 'request-a',
    },
  });
  assert.equal(JSON.stringify(entry).includes('secret'), false);
});

test('reads, failed writes, and anonymous writes are not audited as successful mutations', () => {
  assert.equal(buildMutationAuditEntry({ method: 'GET', statusCode: 200, tenantId: 't', userId: 'u' }), null);
  assert.equal(buildMutationAuditEntry({ method: 'POST', statusCode: 500, tenantId: 't', userId: 'u' }), null);
  assert.equal(buildMutationAuditEntry({ method: 'POST', statusCode: 201, tenantId: 't' }), null);
});
