import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startLocalServer } from './fixtures/local-server.mjs';

// The legal version a signup must accept, read from the server source the same
// way the landing page embeds it.
const COMMERCIAL_LEGAL_VERSION = /const COMMERCIAL_LEGAL_VERSION = '([^']+)'/
  .exec(readFileSync(new URL('../src/server.js', import.meta.url), 'utf8'))[1];

// Signs up a workspace and returns a fetch helper that carries its session.
async function signUp(origin) {
  let cookie = '';
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      body,
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers },
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length) cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* Non-JSON bodies are reported by status. */ }
    return { status: response.status, json };
  };
  const signup = await call('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Import Tester',
      email: `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: 'import-password-1',
      workspaceName: 'Import Workspace',
      persona: 'bd',
      legalAcceptance: { accepted: true, termsVersion: COMMERCIAL_LEGAL_VERSION, privacyVersion: COMMERCIAL_LEGAL_VERSION },
    }),
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  return call;
}

const upload = (body) => ({ method: 'POST', headers: { 'Content-Type': 'text/csv;charset=utf-8' }, body });
const contactCount = async (call) => (await call('/api/contacts?page=1&pageSize=1')).json.total;
const standardCsv = 'First Name,Last Name,Company,Position\nAna,Stone,Acme,VP Talent\nBo,Lee,Globex,Recruiter';

async function waitForJob(call, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { json } = await call(`/api/background-jobs/${jobId}`);
    if (json.status === 'completed' || json.status === 'failed') return json;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return assert.fail('The import job did not finish.');
}

test('a preview request made with ?dryRun=true never imports', { timeout: 30000 }, async (t) => {
  const { origin } = await startLocalServer(t);
  const call = await signUp(origin);

  // This is the request the app sends for "Preview CSV": a raw file upload
  // with its options in the query string.
  const preview = await call('/api/import/connections-csv?dryRun=true&useEmptyState=true&fileName=Connections.csv', upload(standardCsv));
  assert.equal(preview.status, 200);
  assert.equal(preview.json.dryRun, true);
  assert.equal(preview.json.jobId, undefined);
  assert.equal(preview.json.stats.imported, 2);
  assert.equal(await contactCount(call), 0);

  const dedicated = await call('/api/import/connections-csv/preview?dryRun=true', upload(standardCsv));
  assert.equal(dedicated.status, 200);
  assert.equal(dedicated.json.dryRun, true);
  assert.equal(await contactCount(call), 0);
});

test('an import tracks every company with trackAll and no names in the URL', { timeout: 30000 }, async (t) => {
  const { origin } = await startLocalServer(t);
  const call = await signUp(origin);

  const accepted = await call('/api/import/connections-csv?dryRun=false&trackAll=true&untrackedCompany=Globex', upload(standardCsv));
  assert.equal(accepted.status, 202, JSON.stringify(accepted.json));
  const job = await waitForJob(call, accepted.json.jobId);
  assert.equal(job.status, 'completed', JSON.stringify(job));
  assert.equal(job.result.stats.imported, 2);
  assert.equal(await contactCount(call), 2);

  const accounts = (await call('/api/accounts?page=1&pageSize=10')).json.items;
  assert.deepEqual(accounts.map((item) => [item.displayName, Boolean(item.tracked)]).sort(), [['Acme', true], ['Globex', false]]);
});

test('uploads are decoded from the encoding spreadsheets actually write', { timeout: 30000 }, async (t) => {
  const { origin } = await startLocalServer(t);
  const call = await signUp(origin);
  const text = 'First Name;Last Name;Company;Position\nJos\u00e9;Mu\u00f1oz;Soci\u00e9t\u00e9 G\u00e9n\u00e9rale;Directeur';

  for (const [label, body] of [
    ['windows-1252', Buffer.from(text, 'latin1')],
    ['utf-16', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])],
    ['utf-8', Buffer.from(text, 'utf8')],
  ]) {
    const preview = await call('/api/import/connections-csv/preview', upload(body));
    assert.equal(preview.status, 200, label);
    assert.equal(preview.json.preview[0].fullName, 'Jos\u00e9 Mu\u00f1oz', label);
    assert.equal(preview.json.preview[0].companyName, 'Soci\u00e9t\u00e9 G\u00e9n\u00e9rale', label);
  }
});

test('an unusable file is refused before anything is queued', { timeout: 30000 }, async (t) => {
  const { origin } = await startLocalServer(t);
  const call = await signUp(origin);

  for (const path of ['/api/import/connections-csv/preview', '/api/import/connections-csv?dryRun=false']) {
    const refused = await call(path, upload('Colour,Size\nRed,Large'));
    assert.equal(refused.status, 400, path);
    assert.equal(refused.json.code, 'unrecognized_columns', path);
    assert.match(refused.json.error, /but found: Colour, Size\./, path);
    assert.ok(refused.json.expectedHeaders.includes('Company'), path);
    assert.equal(refused.json.jobId, undefined, path);
  }
  assert.equal(await contactCount(call), 0);
});
