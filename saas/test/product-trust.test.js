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

test('every literal UI action is routed to a click handler', async () => {
  const app = await readFile(appPath, 'utf8');
  const actions = [...app.matchAll(/data-action=["']([^"'$<{]+)["']/g)].map((match) => match[1]);
  for (const action of new Set(actions)) {
    const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(app, new RegExp(`actionName\\s*===\\s*['"]${escaped}['"]|case\\s+['"]${escaped}['"]`), `Missing handler for ${action}`);
  }
});

test('the read-only demo can showcase outreach generation without enabling edits', async () => {
  const server = await readFile(serverPath, 'utf8');
  assert.match(server, /generate-outreach\$\/\.test\(pathname\)/);
  assert.match(server, /String\(method \|\| ''\)\.toUpperCase\(\) === 'POST'/);
  assert.match(server, /pathname === '\/api\/auth\/logout'/);
  assert.doesNotMatch(server, /pathname === '\/api\/imports\/jobs'/);
});
