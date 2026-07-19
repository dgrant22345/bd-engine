import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSecurityPolicy, injectScriptNonce } from '../src/security-headers.js';

test('content security policy constrains every active browser resource class', () => {
  const policy = contentSecurityPolicy('test-nonce-value');
  for (const directive of [
    "default-src 'self'",
    "script-src 'self' 'nonce-test-nonce-value'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ]) assert.match(policy, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(policy, /unsafe-eval|\s\*\s|http:/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
});

test('inline scripts receive the same nonce without duplicating existing attributes', () => {
  const html = '<script>boot()</script><script src="/app.js"></script><script nonce="kept">keep()</script>';
  const rendered = injectScriptNonce(html, 'test-nonce-value');
  assert.match(rendered, /<script nonce="test-nonce-value">boot/);
  assert.match(rendered, /<script nonce="test-nonce-value" src="\/app\.js">/);
  assert.match(rendered, /<script nonce="kept">keep/);
  assert.equal(injectScriptNonce(html, 'bad nonce'), html);
});
