import test from 'node:test';
import assert from 'node:assert/strict';

import { isPublicAddress, validatePublicUrl } from '../src/public-url.js';

test('outbound ATS URLs reject private, local, credentialed, and unusual destinations', async () => {
  for (const value of [
    'http://127.0.0.1/jobs',
    'http://10.0.0.1/jobs',
    'http://[::1]/jobs',
    'http://service.railway.internal/jobs',
    'https://user:password@example.com/jobs',
    'https://example.com:8443/jobs',
  ]) {
    await assert.rejects(validatePublicUrl(value), /Private|credentials|Non-standard/);
  }

  const privateLookup = async () => [{ address: '192.168.1.4', family: 4 }];
  await assert.rejects(validatePublicUrl('https://careers.example.com/jobs', privateLookup), /Private or local/);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('169.254.1.2'), false);
  assert.equal(isPublicAddress('fd00::1'), false);
  assert.equal(isPublicAddress('::ffff:7f00:1'), false);
});

test('outbound ATS URLs accept a DNS-verified public destination and strip fragments', async () => {
  const publicLookup = async () => [{ address: '8.8.8.8', family: 4 }];
  assert.equal(
    await validatePublicUrl('https://careers.example.com/jobs#openings', publicLookup),
    'https://careers.example.com/jobs'
  );
});
