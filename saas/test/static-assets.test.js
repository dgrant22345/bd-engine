import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  etagMatches,
  getFileValidator,
  looksLikeAssetPath,
  parseByteRange,
  staticCacheControl,
  versionAssetUrls,
  versionTokenFromEtag,
} from '../src/static-assets.js';

test('only content-addressed requests and fonts are cached without revalidation', () => {
  const immutable = 'public, max-age=31536000, immutable';
  assert.equal(staticCacheControl({ versionMatches: true, contentType: 'text/css; charset=utf-8' }), immutable);
  assert.equal(staticCacheControl({ versionMatches: false, contentType: 'font/woff2' }), immutable);
  // An unversioned or stale token must never pin a stylesheet or script.
  assert.equal(staticCacheControl({ versionMatches: false, contentType: 'text/css; charset=utf-8' }), 'no-cache');
  assert.equal(staticCacheControl({ versionMatches: false, contentType: 'application/javascript; charset=utf-8' }), 'no-cache');
  assert.equal(staticCacheControl({ versionMatches: false, contentType: 'image/svg+xml' }), 'no-cache');
  assert.equal(staticCacheControl({ versionMatches: false, contentType: 'video/mp4' }), 'public, max-age=86400');
  assert.equal(staticCacheControl({ versionMatches: false, contentType: 'image/png' }), 'public, max-age=86400');
});

test('file validators follow content, not modification time', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bd-static-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'asset.css');
  writeFileSync(file, 'body { color: teal; }');
  const first = getFileValidator(file);
  assert.match(first.etag, /^"[A-Za-z0-9_-]{22}"$/);
  assert.equal(first.size, 21);

  // Same bytes with a new timestamp (a redeploy) keep the same validator.
  utimesSync(file, new Date(), new Date(Date.now() + 60000));
  assert.equal(getFileValidator(file).etag, first.etag);

  writeFileSync(file, 'body { color: navy; }');
  utimesSync(file, new Date(), new Date(Date.now() + 120000));
  assert.notEqual(getFileValidator(file).etag, first.etag);
  assert.equal(versionTokenFromEtag(`W/${first.etag}`), first.etag.slice(1, -1));
});

test('conditional requests use weak comparison', () => {
  assert.equal(etagMatches('"abc"', '"abc"'), true);
  assert.equal(etagMatches('W/"abc"', '"abc"'), true);
  assert.equal(etagMatches('"zzz", W/"abc"', '"abc"'), true);
  assert.equal(etagMatches('*', '"abc"'), true);
  assert.equal(etagMatches('"abcd"', '"abc"'), false);
  assert.equal(etagMatches('', '"abc"'), false);
  assert.equal(etagMatches(undefined, '"abc"'), false);
});

test('byte ranges are parsed strictly', () => {
  assert.deepEqual(parseByteRange('bytes=0-1', 1000), { start: 0, end: 1 });
  assert.deepEqual(parseByteRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-200', 1000), { start: 800, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-5000', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseByteRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=1000-', 1000), { unsatisfiable: true });
  assert.deepEqual(parseByteRange('bytes=-0', 1000), { unsatisfiable: true });
  // Absent, malformed, reversed, or multi-range headers fall back to the full file.
  for (const header of [undefined, '', 'bytes=', 'bytes=-', 'bytes=5-2', 'bytes=0-1,5-6', 'items=0-1', 'bytes=a-b']) {
    assert.equal(parseByteRange(header, 1000), null, String(header));
  }
});

test('stylesheet and script references are rewritten to the current content hash', () => {
  const versions = { '/cloud.css': 'HASHCSS', '/ats-checker.js': 'HASHJS' };
  const html = [
    '<link rel="stylesheet" href="/cloud.css?v=20261008-premium-ui-01">',
    '<link rel="stylesheet" href="/missing.css?v=old">',
    '<script type="module" src="/ats-checker.js"></script>',
    '<link rel="stylesheet" href="https://example.com/remote.css">',
    '<img src="/brand-mark.svg" alt="">',
    '<iframe src="/app/"></iframe>',
  ].join('\n');
  const rewritten = versionAssetUrls(html, (assetPath) => versions[assetPath] || '');
  assert.match(rewritten, /href="\/cloud\.css\?v=HASHCSS"/);
  assert.match(rewritten, /src="\/ats-checker\.js\?v=HASHJS"/);
  // Unknown files, other origins, and non-code assets are left exactly as written.
  assert.match(rewritten, /href="\/missing\.css\?v=old"/);
  assert.match(rewritten, /href="https:\/\/example\.com\/remote\.css"/);
  assert.match(rewritten, /src="\/brand-mark\.svg"/);
  assert.match(rewritten, /src="\/app\/"/);
});

test('asset-shaped paths are distinguished from page paths', () => {
  for (const path of ['/favicon.ico', '/wp-login.php', '/media/missing.png', '/a/b/app.js.map']) {
    assert.equal(looksLikeAssetPath(path), true, path);
  }
  for (const path of ['/', '/pricing', '/guides/nope', '/media/', '/v1.2/', '']) {
    assert.equal(looksLikeAssetPath(path), false, path);
  }
});
