import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getPlan } from '../src/billing.js';

const landingPath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../../app/app.js', import.meta.url);
const serverPath = new URL('../src/server.js', import.meta.url);

test('public product claims match implemented job-board coverage and team sync', async () => {
  const [landing, app] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(appPath, 'utf8'),
  ]);

  assert.doesNotMatch(landing, /20\+ platforms/i);
  assert.doesNotMatch(landing, /no manual configuration required/i);
  assert.doesNotMatch(landing, /until team sync ships/i);
  assert.match(landing, /Greenhouse, Lever, Ashby, SmartRecruiters, Workday/);
  assert.match(landing, /BambooHR, Workable, Jobvite/);
  assert.match(landing, /Recruitee, Personio/);
  assert.doesNotMatch(landing, /3 team members/i);
  assert.doesNotMatch(landing, /Team Analytics/);
  assert.match(landing, /Workspace sync across your devices/);
  assert.match(landing, /Workspace notes, sequences, custom fields, activity, and automation rules follow your signed-in account/);
  assert.match(app, /Automatic import supported/);
  assert.match(app, /Tracking only/);
  assert.match(landing, /Find my next role/);
  assert.match(landing, /Start job search/);
  assert.match(app, /Job search workspace/);
});

test('Sales Professional does not advertise unavailable login seats', () => {
  assert.equal(getPlan('sales').limits.users, 1);
});

test('public prices and limits match enforced plan entitlements', async () => {
  const landing = await readFile(landingPath, 'utf8');
  const expectedClaims = [
    ['trial', /\$0<\/span><span class="price-period">\/14 days/, /25 accounts/, /100 contacts/, /50 ATS job boards/, /3 CSV imports/],
    ['sales', /\$10<\/span><span class="price-period">\/month/, /1,000 accounts/, /10,000 contacts/, /Unlimited ATS job boards/],
    ['jobseeker', /\$5<\/span><span class="price-period">\/month/, /200 target companies/, /1,000 network contacts/, /50 CSV imports/],
  ];
  for (const [planId, price, accounts, contacts, finalClaim] of expectedClaims) {
    assert.match(landing, price, `${planId} public price drifted`);
    assert.match(landing, accounts, `${planId} public account limit drifted`);
    assert.match(landing, contacts, `${planId} public contact limit drifted`);
    assert.match(landing, finalClaim, `${planId} public feature limit drifted`);
  }
  assert.deepEqual(getPlan('trial').limits, { accounts: 25, contacts: 100, jobBoards: 50, users: 1, csvImports: 3 });
  assert.deepEqual(getPlan('jobseeker').limits, { accounts: 200, contacts: 1000, jobBoards: 50, users: 1, csvImports: 50 });
  assert.deepEqual(getPlan('sales').limits, { accounts: 1000, contacts: 10000, jobBoards: -1, users: 1, csvImports: -1 });
});

test('password recovery gives users a next step when email delivery is unavailable', async () => {
  const landing = await readFile(landingPath, 'utf8');
  assert.match(landing, /Password reset email is temporarily unavailable/);
  assert.match(landing, /dgfinance15@gmail\.com/);
});

test('authenticated shell exposes actionable support and verification states', async () => {
  const landing = await readFile(landingPath, 'utf8');
  assert.match(landing, /mailto:dgfinance15@gmail\.com/);
  assert.match(landing, /Support center/);
  assert.match(landing, /Your requests/);
  assert.match(landing, /Support inbox/);
  assert.match(landing, /Email verified/);
  assert.match(landing, /Send verification email/);
});

test('customer trust copy matches the sanitized production status surface', async () => {
  const landing = await readFile(landingPath, 'utf8');
  assert.doesNotMatch(landing, /moving from prototype/i);
  assert.doesNotMatch(landing, /Cloud beta/i);
  assert.doesNotMatch(landing, /public status page reports server, database, and Stripe/i);
  assert.match(landing, /public status page reports service availability/i);
  assert.match(landing, /Sample workspace/i);
});

// Handler extraction: the delegated click handler declares `actionName`; the
// delegated submit handler must never reference it (it is out of scope there and
// throws ReferenceError before any form logic runs — CG-001).
async function readDelegatedHandlers() {
  const app = await readFile(appPath, 'utf8');
  const clickStart = app.indexOf("document.addEventListener('click', async (event)");
  const submitStart = app.indexOf("document.addEventListener('submit', async (event)");
  assert.ok(clickStart >= 0, 'delegated click handler not found');
  assert.ok(submitStart > clickStart, 'delegated submit handler not found after click handler');
  const submitEnd = app.indexOf('\n  });', submitStart);
  assert.ok(submitEnd > submitStart, 'submit handler end not found');
  return {
    app,
    clickHandler: app.slice(clickStart, submitStart),
    submitHandler: app.slice(submitStart, submitEnd),
  };
}

test('every literal UI action is routed to the click handler scope, not just anywhere in the file', async () => {
  const { app, clickHandler } = await readDelegatedHandlers();
  const actions = [...app.matchAll(/data-action=["']([^"'$<{]+)["']/g)].map((match) => match[1]);
  for (const action of new Set(actions)) {
    const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      clickHandler,
      new RegExp(`actionName\\s*===\\s*['"]${escaped}['"]|case\\s+['"]${escaped}['"]`),
      `Missing click handler for ${action} (a branch outside the click handler scope does not count)`
    );
  }
});

test('form submit handler never references click-handler locals (regression: CG-001)', async () => {
  const { submitHandler } = await readDelegatedHandlers();
  assert.doesNotMatch(
    submitHandler,
    /\bactionName\b/,
    'submit handler references actionName, which is declared in the click handler — every non-setup form submit throws ReferenceError before doing any work'
  );
});

test('the read-only demo can showcase outreach generation without enabling edits', async () => {
  const server = await readFile(serverPath, 'utf8');
  assert.match(server, /generate-outreach\$\/\.test\(pathname\)/);
  assert.match(server, /String\(method \|\| ''\)\.toUpperCase\(\) === 'POST'/);
  assert.match(server, /pathname === '\/api\/auth\/logout'/);
  assert.doesNotMatch(server, /pathname === '\/api\/imports\/jobs'/);
});

test('core account actions use accessible app dialogs instead of browser prompts', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.doesNotMatch(app, /(?<!\.)\bprompt\s*\(/);
  assert.doesNotMatch(app, /(?<!\.)\bconfirm\s*\(/);
  assert.match(app, /function showAppDialog/);
  assert.match(app, /aria-modal="true"/);
});

test('pause account uses the supported status update and preserves undo state', async () => {
  const app = await readFile(appPath, 'utf8');
  const start = app.indexOf('async function archiveAccount');
  const end = app.indexOf('\n}', start) + 2;
  const archiveFunction = app.slice(start, end);
  assert.match(archiveFunction, /method: 'PATCH'/);
  assert.match(archiveFunction, /status: 'paused'/);
  assert.match(archiveFunction, /previousStatus/);
  assert.doesNotMatch(archiveFunction, /method: 'DELETE'/);
});

test('customer-visible external links allow only HTTP and HTTPS protocols', async () => {
  const app = await readFile(appPath, 'utf8');
  const helperStart = app.indexOf('function safeExternalHref');
  const helperEnd = app.indexOf('\n}', helperStart) + 2;
  const helper = app.slice(helperStart, helperEnd);
  assert.match(helper, /url\.protocol === 'http:' \|\| url\.protocol === 'https:'/);
  assert.match(app, /safeExternalHref\(item\.linkedinUrl\)/);
  assert.match(app, /safeExternalHref\(item\.jobUrl \|\| item\.url\)/);
  assert.match(app, /safeExternalHref\(account\.careersUrl\)/);
});

test('customer-visible task errors are escaped before HTML insertion', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.match(app, /Failed to load tasks: \$\{escapeHtml\(error\.message \|\| String\(error\)\)\}/);
  assert.doesNotMatch(app, /Failed to load tasks: \$\{error\.message\}/);
});

test('dashboard customization matches every rendered core section', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.match(app, /id: 'workflow', label: 'Getting started'/);
  assert.match(app, /id: 'readiness', label: 'Workspace readiness'/);
  assert.doesNotMatch(app, /id: 'trust', label: 'Trust strip'/);
  assert.match(app, /const defaultDashboardCollapsed/);
});

test('support diagnostics are copyable and explicitly exclude customer content', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.match(app, /function buildSafeDiagnosticSummary/);
  assert.match(app, /data-action="copy-diagnostics"/);
  assert.match(app, /function writeClipboardText/);
  assert.match(app, /document\.execCommand\('copy'\)/);
  assert.match(app, /It excludes contacts, notes, outreach text, and account secrets/);
  const summaryStart = app.indexOf('function buildSafeDiagnosticSummary');
  const summaryEnd = app.indexOf('\n}', summaryStart);
  const summaryFunction = app.slice(summaryStart, summaryEnd);
  assert.doesNotMatch(summaryFunction, /contacts|outreach|notes|email|tenantId|userId/i);
});
