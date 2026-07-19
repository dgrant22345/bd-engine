import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSecurityPolicy } from '../src/security-headers.js';

test('content security policy constrains every active browser resource class', () => {
  const policy = contentSecurityPolicy();
  for (const directive of [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ]) assert.match(policy, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(policy, /unsafe-eval|\s\*\s|http:/);
});
