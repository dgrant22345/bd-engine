import assert from 'node:assert/strict';
import test from 'node:test';
import { isUnsafeCrossSiteRequest } from '../src/request-security.js';

const allowed = new Set(['https://app.example.com']);

test('unsafe browser requests require an allowed origin', () => {
  assert.equal(isUnsafeCrossSiteRequest({ method: 'POST', headers: { origin: 'https://app.example.com' } }, allowed), false);
  assert.equal(isUnsafeCrossSiteRequest({ method: 'POST', headers: { origin: 'https://evil.example' } }, allowed), true);
  assert.equal(isUnsafeCrossSiteRequest({ method: 'DELETE', headers: { origin: 'null' } }, allowed), true);
  assert.equal(isUnsafeCrossSiteRequest({ method: 'PATCH', headers: { 'sec-fetch-site': 'cross-site' } }, allowed), true);
});

test('safe reads and originless server webhooks remain available', () => {
  assert.equal(isUnsafeCrossSiteRequest({ method: 'GET', headers: { origin: 'https://evil.example' } }, allowed), false);
  assert.equal(isUnsafeCrossSiteRequest({ method: 'POST', headers: {} }, allowed), false);
});
