import assert from 'node:assert/strict';
import test from 'node:test';
import { clientAddress } from '../src/request-client.js';

test('rate-limit identity ignores caller-controlled forwarded-for values', () => {
  const request = {
    headers: { 'x-forwarded-for': '203.0.113.50' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.equal(clientAddress(request, { trustRailway: false }), '127.0.0.1');
});

test('Railway client identity uses only a validated X-Real-IP value', () => {
  const request = {
    headers: { 'x-real-ip': '203.0.113.25', 'x-forwarded-for': '198.51.100.10' },
    socket: { remoteAddress: '10.0.0.8' },
  };
  assert.equal(clientAddress(request, { trustRailway: true }), '203.0.113.25');
  request.headers['x-real-ip'] = 'not-an-ip';
  assert.equal(clientAddress(request, { trustRailway: true }), '10.0.0.8');
});
