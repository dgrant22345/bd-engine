/**
 * CG-003: frontend-to-server route manifest.
 *
 * Extracts every /api path the frontend calls (app/app.js + the cloud shell)
 * and every route the server implements, then fails CI when a visible action
 * targets a route that is missing or answered by a blanket 501.
 *
 * Matching rules:
 * - A STATIC frontend path (no template parameter) must have a LITERAL server
 *   route. Param regexes do not count: /api/accounts/bulk being swallowed by
 *   the /api/accounts/:id matcher is a mis-route, not an implementation.
 * - A TEMPLATED frontend path (/api/accounts/:param/...) must match one of the
 *   server's pathname.match(...) regexes.
 * - Paths under a startsWith(...) => 501 prefix are unsupported unless a more
 *   specific literal/regex route exists.
 *
 * KNOWN_DEFERRED is the audited debt list (P0.2). CG-004/CG-005 must implement
 * or remove these controls and shrink this list to empty. The test also fails
 * if a KNOWN_DEFERRED entry becomes implemented, so the list cannot go stale.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appPath = new URL('../../app/app.js', import.meta.url);
const shellPath = new URL('../public/index.html', import.meta.url);
const serverPath = new URL('../src/server.js', import.meta.url);

// Audited dead/unsupported visible actions (P0.2). CG-004 implemented accounts
// bulk/import; CG-005 removed the workbook / local-enrichment / Sheets-sync
// frontend code. Keep this EMPTY — every visible action must have an
// implemented route. Add entries only with a ticket that owns the removal.
const KNOWN_DEFERRED = [];

function extractFrontendPaths(source) {
  const paths = new Set();
  const callPattern = /(?:api|fetch)\((?:`|')(\/api\/[^'`)]*)/g;
  for (const match of source.matchAll(callPattern)) {
    let path = match[1];
    path = path.split('?')[0];
    path = path.split('${buildQuery')[0];
    path = path.replace(/\$\{[^}]*\}/g, ':param');
    path = path.replace(/\/+$/, '');
    if (path.length > '/api/'.length) paths.add(path);
  }
  return [...paths].sort();
}

function extractServerRoutes(source) {
  const literals = new Set(
    [...source.matchAll(/pathname === '(\/api\/[^']*)'/g)].map((m) => m[1])
  );
  const regexes = [
    // pathname.match(/^\/api\/accounts\/([^/]+)$/) — capture the regex body
    // non-greedily up to the closing "/)" (bodies contain ")" internally).
    ...source.matchAll(/pathname\.match\(\/(.+?)\/\)/g),
    // /^\/api\/...$/.test(pathname)
    ...source.matchAll(/\/(\^\\\/api.+?)\/\.test\(pathname\)/g),
  ]
    .map((m) => {
      try {
        return new RegExp(m[1]);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const unsupportedPrefixes = [];
  const prefixPattern = /pathname\.startsWith\('(\/api\/[^']*)'\)[^]*?sendJson\(res,\s*501/g;
  for (const match of source.matchAll(prefixPattern)) unsupportedPrefixes.push(match[1]);
  return { literals, regexes, unsupportedPrefixes };
}

function isImplemented(path, routes) {
  if (path.includes(':param')) {
    const concrete = path.replaceAll(':param', 'sample-id-1234');
    return routes.regexes.some((re) => re.test(concrete));
  }
  return routes.literals.has(path);
}

async function buildManifest() {
  const [app, shell, server] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(shellPath, 'utf8'),
    readFile(serverPath, 'utf8'),
  ]);
  const frontendPaths = extractFrontendPaths(app + '\n' + shell);
  const routes = extractServerRoutes(server);
  return { frontendPaths, routes };
}

test('route manifest extraction finds a realistic surface', async () => {
  const { frontendPaths, routes } = await buildManifest();
  assert.ok(frontendPaths.length >= 40, `only ${frontendPaths.length} frontend paths extracted — extractor regressed`);
  assert.ok(routes.literals.size >= 40, `only ${routes.literals.size} literal routes extracted — extractor regressed`);
  assert.ok(routes.regexes.length >= 8, `only ${routes.regexes.length} param routes extracted — extractor regressed`);
  assert.ok(routes.unsupportedPrefixes.length >= 1, 'expected at least one 501 prefix');
});

test('every visible frontend API call has an implemented server route', async () => {
  const { frontendPaths, routes } = await buildManifest();
  const dead = frontendPaths.filter(
    (path) => !isImplemented(path, routes) && !KNOWN_DEFERRED.includes(path)
  );
  assert.deepEqual(
    dead,
    [],
    `Frontend calls with no implemented server route (implement the route or remove the control):\n  ${dead.join('\n  ')}`
  );
});

test('KNOWN_DEFERRED stays honest: entries are removed once implemented', async () => {
  const { frontendPaths, routes } = await buildManifest();
  for (const path of KNOWN_DEFERRED) {
    assert.ok(
      frontendPaths.includes(path),
      `${path} is no longer called by the frontend — remove it from KNOWN_DEFERRED`
    );
    assert.ok(
      !isImplemented(path, routes),
      `${path} is now implemented — remove it from KNOWN_DEFERRED so the manifest enforces it`
    );
  }
});
