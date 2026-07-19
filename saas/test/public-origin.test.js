import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizePublicOrigin, resolvePublicOrigin } from '../src/public-origin.js';

test('public origin uses validated operator or Railway configuration', () => {
  assert.equal(resolvePublicOrigin({ BD_CLOUD_BASE_URL: 'https://app.example.com/path' }), 'https://app.example.com');
  assert.equal(resolvePublicOrigin({ RAILWAY_PUBLIC_DOMAIN: 'service.up.railway.app' }), 'https://service.up.railway.app');
  assert.equal(resolvePublicOrigin({ RAILWAY_STATIC_URL: 'https://static.example.com/' }), 'https://static.example.com');
});

test('public origin rejects credentials and fails closed in production', () => {
  assert.equal(normalizePublicOrigin('https://operator:secret@example.com'), '');
  assert.equal(normalizePublicOrigin('javascript:alert(1)'), '');
  assert.equal(resolvePublicOrigin({ BD_CLOUD_ENV: 'production' }), '');
  assert.equal(resolvePublicOrigin({}, 9999), 'http://127.0.0.1:9999');
});

test('server URL generation does not consult request Host headers', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /x-forwarded-host|x-forwarded-proto|headers\.host/iu);
  assert.match(server, /function getRequestOrigin\(\) \{\s*return PUBLIC_ORIGIN;/u);
});
