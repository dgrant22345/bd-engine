import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Real local HTTP server with the isolated in-memory store. No database,
// email, or payment provider is contacted.
async function startLocalServer(t) {
  const portServer = createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: '',
      BD_CLOUD_HOST: '127.0.0.1',
      BD_CLOUD_PORT: String(port),
      BD_CLOUD_BASE_URL: origin,
      STRIPE_SECRET_KEY: '',
      RESEND_API_KEY: '',
      SMTP_HOST: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${origin}/readyz`)).ok) break;
    } catch { /* Local startup is still in progress. */ }
    assert.equal(child.exitCode, null, output);
    if (attempt === 99) assert.fail(`Local server did not become ready: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { origin, child, getOutput: () => output };
}

test('directory paths are answered without stopping the server', { timeout: 30000 }, async (t) => {
  const { origin, child, getOutput } = await startLocalServer(t);

  // Each of these names a directory that exists inside a static root.
  for (const path of ['/media', '/media/', '/media/campaign', '/fonts', '/guides/', '/app/icons', '/app/icons/']) {
    const response = await fetch(`${origin}${path}`);
    await response.arrayBuffer();
    assert.ok(response.status < 500, `${path} returned ${response.status}`);
    assert.equal(child.exitCode, null, `server exited after ${path}: ${getOutput()}`);
  }

  // The process must still be serving ordinary requests afterwards.
  const ready = await fetch(`${origin}/readyz`);
  assert.equal(ready.status, 200);
  const stylesheet = await fetch(`${origin}/brand.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type') || '', /^text\/css/);
  assert.ok((await stylesheet.text()).length > 100);
  assert.equal(child.exitCode, null, getOutput());
});

test('signed-out visitors and crawlers receive the landing page in the HTML', { timeout: 30000 }, async (t) => {
  const { origin } = await startLocalServer(t);
  const visibleText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const home = await (await fetch(`${origin}/`)).text();
  assert.match(home, /<div id="cloud-root" data-prerendered="landing">/);
  assert.match(visibleText(home), /Know which target accounts are worth your next call\./);
  assert.match(visibleText(home), /Simple pricing|Recruiter Pro/);

  const jobSearch = await (await fetch(`${origin}/job-search?utm_source=linkedin`)).text();
  assert.match(visibleText(jobSearch), /Know which employers are worth your next move\./);
  assert.match(jobSearch, /<title>BD Engine for Job Seekers/);

  // URLs that open on another view keep the client-rendered shell.
  for (const path of ['/?login=1', '/?signup=1', '/?legal=privacy', '/?reset=abc', '/?verify=abc']) {
    const html = await (await fetch(`${origin}${path}`)).text();
    assert.match(html, /<div id="cloud-root"><\/div>/, path);
  }

  // A signed-in browser (here: the read-only demo session) is not shown marketing first.
  const demo = await fetch(`${origin}/api/demo/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: '{}',
  });
  assert.equal(demo.status, 201, await demo.clone().text());
  const cookie = (demo.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'demo session cookie');
  const signedIn = await (await fetch(`${origin}/`, { headers: { Cookie: cookie } })).text();
  assert.match(signedIn, /<div id="cloud-root"><\/div>/);
});

test('public pages ship icons and self-hosted fonts with no third-party font origin', { timeout: 30000 }, async (t) => {
  const { origin } = await startLocalServer(t);

  const favicon = await fetch(`${origin}/favicon.ico`);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get('content-type'), 'image/x-icon');
  const iconBytes = Buffer.from(await favicon.arrayBuffer());
  assert.deepEqual([...iconBytes.subarray(0, 4)], [0, 0, 1, 0], 'ICO signature');

  for (const path of ['/', '/job-search', '/ats-checker', '/recruiter-walkthrough', '/guides', '/guides/ats-job-board-coverage', '/guides/workday-job-search', '/guides/linkedin-connections-job-search', '/guides/find-hiring-companies-staffing', '/guides/export-linkedin-connections-csv']) {
    const response = await fetch(`${origin}${path}`);
    const html = await response.text();
    assert.equal(response.status, 200, path);
    assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="48x48">/, path);
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/, path);
    assert.match(html, /<link rel="preload" href="\/fonts\/inter-latin-wght-normal\.woff2" as="font" type="font\/woff2" crossorigin>/, path);
    assert.match(html, /href="\/brand\.css\?v=[A-Za-z0-9_-]{22}"/, path);
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/, path);
    assert.doesNotMatch(response.headers.get('content-security-policy') || '', /googleapis|gstatic/, path);
  }

  const font = await fetch(`${origin}/fonts/inter-latin-wght-normal.woff2`);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal(font.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const brandCss = readFileSync(new URL('../public/brand.css', import.meta.url), 'utf8');
  assert.match(brandCss, /@font-face \{\s*font-family: 'Inter';[^}]*url\('\/fonts\/inter-latin-wght-normal\.woff2'\)/);
  assert.match(brandCss, /font-display: swap/);
});

test('static assets are cacheable, revalidate cheaply, and support byte ranges', { timeout: 30000 }, async (t) => {
  const { origin } = await startLocalServer(t);

  // The stylesheet URL written into the page is content-addressed and immutable.
  const home = await (await fetch(`${origin}/`)).text();
  const [, stylesheetUrl] = /href="(\/cloud\.css\?v=[A-Za-z0-9_-]{22})"/.exec(home);
  const versioned = await fetch(`${origin}${stylesheetUrl}`);
  assert.equal(versioned.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const etag = versioned.headers.get('etag');
  assert.ok(etag);
  await versioned.arrayBuffer();

  // A hand-written or stale token must not pin the file in caches.
  for (const url of ['/cloud.css', '/cloud.css?v=20261008-premium-ui-01']) {
    const response = await fetch(`${origin}${url}`);
    assert.equal(response.headers.get('cache-control'), 'no-cache', url);
    await response.arrayBuffer();
  }

  const revalidated = await fetch(`${origin}/cloud.css`, { headers: { 'If-None-Match': etag } });
  assert.equal(revalidated.status, 304);
  assert.equal((await revalidated.arrayBuffer()).byteLength, 0);

  // HTML documents carry a per-response nonce and are never stored.
  assert.equal((await fetch(`${origin}/`)).headers.get('cache-control'), 'no-store');

  const video = '/media/recruiter-walkthrough.mp4';
  const head = await fetch(`${origin}${video}`, { method: 'HEAD' });
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  const size = Number(head.headers.get('content-length'));
  assert.ok(size > 1000);

  const firstBytes = await fetch(`${origin}${video}`, { headers: { Range: 'bytes=0-1' } });
  assert.equal(firstBytes.status, 206);
  assert.equal(firstBytes.headers.get('content-range'), `bytes 0-1/${size}`);
  assert.equal((await firstBytes.arrayBuffer()).byteLength, 2);

  const tail = await fetch(`${origin}${video}`, { headers: { Range: 'bytes=-100' } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), `bytes ${size - 100}-${size - 1}/${size}`);
  assert.equal((await tail.arrayBuffer()).byteLength, 100);

  const beyond = await fetch(`${origin}${video}`, { headers: { Range: `bytes=${size}-` } });
  assert.equal(beyond.status, 416);
  assert.equal(beyond.headers.get('content-range'), `bytes */${size}`);
});

test('unknown URLs return 404 and common shortcuts redirect to their views', { timeout: 30000 }, async (t) => {
  const { origin } = await startLocalServer(t);

  for (const path of ['/this-page-does-not-exist', '/guides/nope', '/media']) {
    const response = await fetch(`${origin}${path}`);
    const html = await response.text();
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get('content-type') || '', /^text\/html/, path);
    assert.match(html, /We could not find that page\./, path);
    assert.match(html, /<meta name="robots" content="noindex">/, path);
    assert.doesNotMatch(html, /id="cloud-root"/, path);
  }

  // A missing file gets a short plain response, not an HTML document.
  for (const path of ['/missing.png', '/wp-login.php', '/apple-touch-icon-precomposed.png']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    assert.match(response.headers.get('content-type') || '', /^text\/plain/, path);
    assert.ok((await response.text()).length < 100, path);
  }

  const redirects = {
    '/login': '/?login=1',
    '/signup': '/?signup=1',
    '/signup/?utm_source=linkedin&signup=0': '/?signup=1&utm_source=linkedin',
    '/pricing': '/#pricing',
    '/privacy': '/?legal=privacy',
    '/terms': '/?legal=terms',
  };
  for (const [path, location] of Object.entries(redirects)) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual' });
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('location'), location, path);
  }

  // Existing entry points are unaffected.
  for (const path of ['/', '/index.html', '/job-search/', '/ats-checker', '/guides/', '/recruiter-walkthrough', '/app/', '/robots.txt', '/sitemap.xml']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 200, path);
  }
});

test('workspace page references content-addressed assets that browsers may keep', { timeout: 30000 }, async (t) => {
  const { origin } = await startLocalServer(t);
  const html = await (await fetch(`${origin}/app/`)).text();
  const assets = [...html.matchAll(/\b(?:href|src)="(\/[A-Za-z0-9_./-]+\.(?:css|js))(\?v=[^"]*)?"/g)].map(([, path, query]) => path + (query || ''));

  // Every stylesheet and script, including the main workspace script.
  assert.ok(assets.length >= 9, `found ${assets.length} assets`);
  assert.ok(assets.some((url) => url.startsWith('/app/app.js?v=')), 'workspace script is versioned');
  for (const url of assets) {
    assert.match(url, /\?v=[A-Za-z0-9_-]{22}$/, `${url} is not content-addressed`);
    const response = await fetch(`${origin}${url}`);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable', url);
    await response.arrayBuffer();
  }
  assert.doesNotMatch(html, /premium-ui-01/, 'hand-maintained version token is still served');
});
