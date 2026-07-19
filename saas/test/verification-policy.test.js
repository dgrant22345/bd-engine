import test from 'node:test';
import assert from 'node:assert/strict';

import { isEmailVerificationRequired, requiresVerifiedEmail } from '../src/verification-policy.js';

test('email verification enforcement requires an explicit rollout flag', () => {
  assert.equal(isEmailVerificationRequired({}), false);
  assert.equal(isEmailVerificationRequired({ BD_REQUIRE_EMAIL_VERIFICATION: 'false' }), false);
  assert.equal(isEmailVerificationRequired({ BD_REQUIRE_EMAIL_VERIFICATION: 'TRUE' }), true);
});

test('verification protects imports, discovery, and external resolution work', () => {
  for (const pathname of [
    '/api/import/connections-csv',
    '/api/import/connections-csv/preview',
    '/api/import/jobs',
    '/api/discovery/run',
    '/api/admin/pipeline/start',
    '/api/accounts/account-1/resolve-now',
    '/api/accounts/account-1/deep-verify',
    '/api/configs/config-1/resolve',
    '/api/enrichment/account-1/rerun-resolution',
  ]) {
    assert.equal(requiresVerifiedEmail(pathname, 'POST'), true, pathname);
  }
});

test('verification does not block reads, support, billing, or local edits', () => {
  for (const [pathname, method] of [
    ['/api/import/jobs', 'GET'],
    ['/api/support/tickets', 'POST'],
    ['/api/billing/checkout', 'POST'],
    ['/api/accounts/account-1', 'PATCH'],
    ['/api/configs/config-1/review', 'POST'],
    ['/api/auth/logout', 'POST'],
  ]) {
    assert.equal(requiresVerifiedEmail(pathname, method), false, `${method} ${pathname}`);
  }
});
