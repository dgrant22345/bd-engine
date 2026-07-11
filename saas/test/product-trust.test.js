import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const landingPath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../../app/app.js', import.meta.url);

test('public product claims match implemented job-board coverage and team sync', async () => {
  const [landing, app] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(appPath, 'utf8'),
  ]);

  assert.doesNotMatch(landing, /20\+ platforms/i);
  assert.doesNotMatch(landing, /no manual configuration required/i);
  assert.doesNotMatch(landing, /until team sync ships/i);
  assert.match(landing, /Greenhouse, Lever, Ashby, SmartRecruiters, Workday/);
  assert.match(landing, /Workspace notes, sequences, custom fields, activity, and automation rules sync/);
  assert.match(app, /Live import supported/);
  assert.match(app, /Tracking only/);
});

test('password recovery gives users a next step when email delivery is unavailable', async () => {
  const landing = await readFile(landingPath, 'utf8');
  assert.match(landing, /Password reset email is temporarily unavailable/);
  assert.match(landing, /support@bdengine\.io/);
});
