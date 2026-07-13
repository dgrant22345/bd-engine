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
  assert.doesNotMatch(landing, /3 team members/i);
  assert.doesNotMatch(landing, /Team Analytics/);
  assert.match(landing, /Workspace sync across your devices/);
  assert.match(landing, /Workspace notes, sequences, custom fields, activity, and automation rules follow your signed-in account/);
  assert.match(app, /Live import supported/);
  assert.match(app, /Tracking only/);
  assert.match(landing, /Find my next role/);
  assert.match(landing, /Start job search/);
  assert.match(app, /Job search workspace/);
});

test('Sales Professional does not advertise unavailable login seats', () => {
  assert.equal(getPlan('sales').limits.users, 1);
});

test('password recovery gives users a next step when email delivery is unavailable', async () => {
  const landing = await readFile(landingPath, 'utf8');
  assert.match(landing, /Password reset email is temporarily unavailable/);
  assert.match(landing, /support@bdengine\.io/);
});

test('authenticated shell exposes actionable support and verification states', async () => {
  const landing = await readFile(landingPath, 'utf8');
  assert.match(landing, /mailto:support@bdengine\.io/);
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
