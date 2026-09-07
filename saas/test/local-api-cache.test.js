import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../../app/local-api.js', import.meta.url), 'utf8');
function harness() {
  const requests = [];
  const window = { structuredClone };
  runInNewContext(source, {
    window, Headers, FormData, console, location: { pathname: '/app/' },
    fetch(path, options) {
      return new Promise((resolve, reject) => requests.push({ path, options, reject,
        respond: (payload, status = 200) => resolve({ ok: status < 400, status, json: async () => payload }) }));
    },
  });
  return { requests, api: (path = '/api/contacts', options) => window.bdLocalApi.api({}, path, options), invalidate: window.bdLocalApi.invalidate };
}

test('cached reads deduplicate requests and return isolated copies', async () => {
  const h = harness();
  const first = h.api(); const second = h.api();
  assert.equal(h.requests.length, 1);
  h.requests[0].respond({ items: [{ notes: 'Saved' }] });
  const result = await first;
  result.items[0].notes = 'Local edit';
  assert.equal((await second).items[0].notes, 'Saved');
  assert.equal((await h.api()).items[0].notes, 'Saved');
  assert.equal(h.requests.length, 1);
});

for (const invalidate of ['explicit', 'mutation']) {
  test(`${invalidate} invalidation detaches old requests and prevents stale cache repopulation`, async () => {
    const h = harness();
    const old = h.api();
    if (invalidate === 'explicit') h.invalidate();
    else {
      const save = h.api('/api/contacts/one', { method: 'PATCH', body: '{}' });
      h.requests[1].respond({ notes: 'New' }); await save;
    }
    const count = h.requests.length;
    const fresh = h.api();
    assert.equal(h.requests.length, count + 1, 'post-save read must not join the pre-save request');
    h.requests.at(-1).respond({ notes: 'New' }); await fresh;
    h.requests[0].respond({ notes: 'Old' }); await old;
    assert.equal((await h.api()).notes, 'New');
  });
}

test('old completion cannot remove a newer in-flight read', async () => {
  const h = harness();
  const old = h.api(); h.invalidate();
  const fresh = h.api();
  h.requests[0].respond({ notes: 'Old' }); await old;
  const joined = h.api();
  assert.equal(h.requests.length, 2);
  h.requests[1].respond({ notes: 'New' });
  assert.equal((await fresh).notes, 'New');
  assert.equal((await joined).notes, 'New');
});

test('failed requests are retryable and failed writes preserve valid cache', async () => {
  const h = harness();
  const failed = h.api(); h.requests[0].respond({ error: 'Try again' }, 503);
  await assert.rejects(failed, /Try again/);
  const retry = h.api(); h.requests[1].respond({ notes: 'Saved' }); await retry;
  const save = h.api('/api/contacts/one', { method: 'PATCH', body: '{}' });
  h.requests[2].respond({ error: 'Invalid field' }, 400);
  await assert.rejects(save, /Invalid field/);
  assert.equal((await h.api()).notes, 'Saved');
  assert.equal(h.requests.length, 3);
});

test('forced reads retire old cached and in-flight results without flushing other paths', async () => {
  const h = harness();
  const other = h.api('/api/accounts'); h.requests[0].respond({ total: 1 }); await other;
  const cached = h.api(); h.requests[1].respond({ notes: 'Old' }); await cached;
  const refresh = h.api('/api/contacts', { skipCache: true });
  h.requests[2].respond({ notes: 'Refreshed' }); await refresh;
  const fresh = h.api();
  assert.equal(h.requests.length, 4, 'a forced read must retire the old cached value');
  const forceAgain = h.api('/api/contacts', { skipCache: true });
  h.requests[4].respond({ notes: 'Newest' }); await forceAgain;
  h.requests[3].respond({ notes: 'Superseded' }); await fresh;
  const last = h.api();
  assert.equal(h.requests.length, 6, 'a superseded read must not repopulate cache');
  h.requests[5].respond({ notes: 'Newest' }); await last;
  assert.equal((await h.api('/api/accounts')).total, 1);
  assert.equal(h.requests.length, 6);
});

test('a rejected obsolete read does not detach its replacement', async () => {
  const h = harness();
  const old = h.api(); h.invalidate(); const fresh = h.api();
  h.requests[0].reject(new Error('Failed to fetch'));
  await assert.rejects(old, /Check your connection/);
  const joined = h.api();
  assert.equal(h.requests.length, 2);
  h.requests[1].respond({ notes: 'New' }); await fresh; await joined;
});
