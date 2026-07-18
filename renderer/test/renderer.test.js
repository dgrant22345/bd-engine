import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createLimiter, createRendererServer, isAuthorized } from '../src/server.js';
import { isPublicAddress, validatePublicUrl } from '../src/security.js';

const token = 'renderer-test-token-with-32-characters';

test('private and local network destinations are rejected', async () => {
  for (const value of ['http://127.0.0.1/jobs', 'http://10.0.0.1/jobs', 'http://[::1]/jobs', 'http://service.railway.internal/jobs']) {
    await assert.rejects(validatePublicUrl(value), /Private or local/);
  }
  const fakeLookup = async () => [{ address: '192.168.1.4', family: 4 }];
  await assert.rejects(validatePublicUrl('https://careers.example.com/jobs', fakeLookup), /Private or local/);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('169.254.1.2'), false);
  assert.equal(isPublicAddress('fd00::1'), false);
  assert.equal(isPublicAddress('::ffff:7f00:1'), false);
  assert.equal(isPublicAddress('::ffff:0a00:1'), false);
});

test('bearer authentication uses a minimum-length exact token', () => {
  assert.equal(isAuthorized(`Bearer ${token}`, token), true);
  assert.equal(isAuthorized('Bearer wrong-token', token), false);
  assert.equal(isAuthorized('Bearer short', 'short'), false);
});

test('HTTP renderer requires auth and returns only the renderer result', async () => {
  const server = createRendererServer({
    token,
    validateUrl: async (value) => new URL(value).toString(),
    render: async ({ url }) => ({ html: '<main>Jobs</main>', finalUrl: url }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const unauthorized = await fetch(`${baseUrl}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://careers.example.com/jobs' }),
    });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/render`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://careers.example.com/jobs' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { html: '<main>Jobs</main>', finalUrl: 'https://careers.example.com/jobs' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    server.close();
  }
});

test('renderer concurrency is bounded and excess work fails fast', async () => {
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const limiter = createLimiter(async (value) => {
    await blocker;
    return value;
  }, { concurrency: 1, maxQueue: 1 });

  const first = limiter.run('first');
  const second = limiter.run('second');
  await assert.rejects(limiter.run('third'), /busy/);
  assert.equal(limiter.active(), 1);
  assert.equal(limiter.queued(), 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
});
