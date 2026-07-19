import test from 'node:test';
import assert from 'node:assert/strict';
import { safeErrorSummary, safeRequestPath } from '../src/operational-logging.js';

test('request logging drops query strings and fragments', () => {
  assert.equal(safeRequestPath('/api/accounts?q=Secret%20Company&token=abc#private'), '/api/accounts');
  assert.equal(safeRequestPath('https://example.com/api/jobs?email=person@example.com'), '/api/jobs');
  assert.equal(safeRequestPath('not a valid URL'), '/not%20a%20valid%20URL');
});

test('operational error summaries redact common customer and credential material', () => {
  const summary = safeErrorSummary(Object.assign(new Error(
    'Failed for person@example.com at https://provider.example/jobs?token=secret token=abcdef and ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890LONG'
  ), { code: 'UPSTREAM_FAILED' }));
  assert.match(summary, /^Error \(UPSTREAM_FAILED\)/);
  assert.doesNotMatch(summary, /person@example\.com/);
  assert.doesNotMatch(summary, /\?token=secret/);
  assert.doesNotMatch(summary, /token=abcdef/);
  assert.doesNotMatch(summary, /ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
  assert.match(summary, /\[email\]/);
  assert.match(summary, /\[redacted\]/);
});
