import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { createReminderStore, getNewRoleDigest, ROLE_DIGEST_ID, weekStartDate } from '../src/followup-reminders.js';
import { buildRoleDigestEmail } from '../src/email.js';

const at = (iso) => new Date(iso);
const weeklyStore = () => createReminderStore({ enabled: () => false, id: ROLE_DIGEST_ID, title: 'Weekly role digest', viewType: 'jobs', cadence: 'weekly' });

test('week starts on Monday in every position of the week', () => {
  assert.equal(weekStartDate('2026-11-09'), '2026-11-09'); // Monday
  assert.equal(weekStartDate('2026-11-12'), '2026-11-09'); // Thursday
  assert.equal(weekStartDate('2026-11-15'), '2026-11-09'); // Sunday
  assert.equal(weekStartDate('2026-11-16'), '2026-11-16');
  assert.equal(weekStartDate('2027-01-01'), '2026-12-28'); // across a year boundary
});

test('weekly digest is opt-in, starts the following week, and sends once per week', async () => {
  const store = weeklyStore();
  const sent = [];
  const roles = { items: [{ companyName: 'Northstar Robotics', newRoles: 2, titles: ['Controls Engineer'] }], total: 2, summary: { companyCount: 1 } };
  let available = roles;
  const options = (now) => ({ now, getRecipient: async () => ({ eligible: true, to: 'digest@example.test' }), getTasks: async () => available, send: async (payload) => { sent.push(payload); return { sent: true }; } });

  // Off by default: nothing is sent without a saved opt-in.
  assert.equal((await store.get('t', 'u')).emailEnabled, false);
  assert.equal((await store.deliver('t', 'u', options(at('2026-11-16T15:00:00Z')))).reason, 'disabled');

  // Turned on Thursday Nov 12 (Toronto): the rest of that week is skipped.
  const saved = await store.put('t', 'u', { version: 0, emailEnabled: true, timezone: 'America/Toronto', hour: 9 }, { now: at('2026-11-12T18:00:00Z') });
  assert.equal(saved.emailEnabled, true);
  for (const later of ['2026-11-12T19:00:00Z', '2026-11-13T15:00:00Z', '2026-11-15T23:00:00Z']) {
    assert.equal((await store.deliver('t', 'u', options(at(later)))).reason, 'not_due', later);
  }

  // Monday Nov 16: not before 09:00 local, then exactly once.
  assert.equal((await store.deliver('t', 'u', options(at('2026-11-16T13:30:00Z')))).reason, 'not_due'); // 08:30 Toronto
  assert.equal((await store.deliver('t', 'u', options(at('2026-11-16T14:05:00Z')))).sent, true); // 09:05 Toronto
  assert.equal((await store.deliver('t', 'u', options(at('2026-11-16T14:10:00Z')))).reason, 'not_due');
  assert.equal((await store.deliver('t', 'u', options(at('2026-11-19T15:00:00Z')))).reason, 'not_due');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].total, 2);
  assert.deepEqual(sent[0].summary, { companyCount: 1 });

  // A week with nothing new sends no email and is not retried all week.
  available = { items: [], total: 0, summary: { companyCount: 0 } };
  assert.equal((await store.deliver('t', 'u', options(at('2026-11-23T15:00:00Z')))).reason, 'nothing_new');
  available = roles;
  assert.equal((await store.deliver('t', 'u', options(at('2026-11-25T15:00:00Z')))).reason, 'not_due');
  assert.equal(sent.length, 1);

  // If Monday was missed (for example an outage), the week is caught up later.
  assert.equal((await store.deliver('t', 'u', options(at('2026-12-02T15:00:00Z')))).sent, true); // Wednesday
  assert.equal(sent.length, 2);
  assert.notEqual(sent[0].idempotencyKey, sent[1].idempotencyKey);

  // Turning it off stops delivery; the preference version protects against stale saves.
  const current = await store.get('t', 'u');
  await store.put('t', 'u', { version: current.version, emailEnabled: false, timezone: 'America/Toronto', hour: 9 });
  assert.equal((await store.deliver('t', 'u', options(at('2026-12-07T15:00:00Z')))).reason, 'disabled');
  await assert.rejects(store.put('t', 'u', { version: 0, emailEnabled: true, timezone: 'UTC', hour: 9 }), (error) => error.status === 409);
});

test('digest email states the count, why it was sent, and how to turn it off', () => {
  const message = buildRoleDigestEmail({
    companies: [
      { companyName: 'Northstar <Robotics>', newRoles: 5, titles: ['Controls Engineer', 'PLC Programmer', 'Automation Lead'] },
      { companyName: 'Luma Climate', newRoles: 1, titles: ['Recruiter'] },
    ],
    total: 9, companyCount: 3,
    appUrl: 'https://bd.example/app/#/jobs', settingsUrl: 'https://bd.example/app/#/jobs?digest=settings',
  });
  assert.equal(message.subject, 'BD Engine: 9 new roles at 3 companies this week');
  assert.match(message.text, /Northstar <Robotics>: 5 new roles \(Controls Engineer; PLC Programmer; Automation Lead; and more\)/);
  assert.match(message.text, /Luma Climate: 1 new role \(Recruiter\)/);
  assert.match(message.text, /1 more company has new roles in your workspace\./);
  assert.match(message.text, /You are receiving this because you turned on the weekly role digest/);
  assert.match(message.text, /Turn it off: https:\/\/bd\.example\/app\/#\/jobs\?digest=settings/);
  assert.match(message.html, /Northstar &lt;Robotics&gt;/);
  assert.doesNotMatch(message.html, /<Robotics>/);
  assert.match(message.html, /href="https:\/\/bd\.example\/app\/#\/jobs\?digest=settings">Turn it off<\/a>/);
  assert.equal(buildRoleDigestEmail({ companies: [{ companyName: 'Solo', newRoles: 1, titles: [] }], total: 1, companyCount: 1, appUrl: 'a', settingsUrl: 'b' }).subject, 'BD Engine: 1 new role at 1 company this week');
});

test('new-role query is tenant scoped, limited to seven days, and shaped for the email', async () => {
  const calls = [];
  const digest = await getNewRoleDigest('tenant-1', {
    now: at('2026-11-16T14:00:00Z'),
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ company_name: 'Northstar Robotics', new_roles: 3, titles: ['A', 'B', null], company_count: 2, total_roles: 4 }, { company_name: 'Luma', new_roles: 1, titles: ['C'], company_count: 2, total_roles: 4 }] };
    },
  });
  assert.deepEqual(calls[0].params, ['tenant-1', '2026-11-09T14:00:00.000Z']);
  assert.match(calls[0].sql, /tenant_id=\$1 AND active/);
  assert.match(calls[0].sql, /LIMIT 8/);
  assert.deepEqual(digest, {
    items: [{ companyName: 'Northstar Robotics', newRoles: 3, titles: ['A', 'B'] }, { companyName: 'Luma', newRoles: 1, titles: ['C'] }],
    total: 4,
    summary: { companyCount: 2 },
  });
  assert.deepEqual(await getNewRoleDigest('tenant-1', { query: async () => ({ rows: [] }) }), { items: [], total: 0, summary: { companyCount: 0 } });
});

// Real local HTTP server with the isolated in-memory store and no email provider.
test('digest preference endpoint defaults to off and refuses opt-in without a verified, deliverable address', { timeout: 30000 }, async (t) => {
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const port = portServer.address().port; await new Promise((resolve) => portServer.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', BD_CLOUD_HOST: '127.0.0.1', BD_CLOUD_PORT: String(port), BD_CLOUD_BASE_URL: origin, STRIPE_SECRET_KEY: '', RESEND_API_KEY: '', SMTP_HOST: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => { if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${origin}/readyz`)).ok) break; } catch { /* Local startup is still in progress. */ }
    assert.equal(child.exitCode, null, output);
    if (attempt === 99) assert.fail(`Local server did not become ready: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const signup = await fetch(`${origin}/api/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: 'role-digest@example.com', password: 'Role-digest-2026', name: 'Role Digest', workspaceName: 'Role Digest', persona: 'bd', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } }),
  });
  assert.equal(signup.status, 201, await signup.clone().text());
  const cookie = signup.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const request = (path, options = {}) => fetch(`${origin}${path}`, { ...options, headers: { cookie, origin, 'content-type': 'application/json', ...options.headers } });

  const initial = await (await request('/api/jobs/digest')).json();
  assert.equal(initial.emailEnabled, false);
  assert.equal(initial.version, 0);
  assert.equal(initial.providerConfigured, false);

  const optIn = await request('/api/jobs/digest', { method: 'PUT', body: JSON.stringify({ version: 0, emailEnabled: true, timezone: 'America/Toronto', hour: 9 }) });
  assert.equal(optIn.status, 409);
  assert.match((await optIn.json()).error, /Email delivery is not set up/);
  assert.equal((await (await request('/api/jobs/digest')).json()).emailEnabled, false);

  // Saving it as off is always allowed, and it is separate from follow-up reminders.
  const off = await request('/api/jobs/digest', { method: 'PUT', body: JSON.stringify({ version: 0, emailEnabled: false, timezone: 'America/Toronto', hour: 8 }) });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).hour, 8);
  assert.equal((await (await request('/api/tasks/reminders')).json()).version, 0);

  const bootstrap = await (await request('/api/bootstrap')).json();
  assert.equal(bootstrap.capabilities.roleDigest, true);
  assert.equal((await fetch(`${origin}/api/jobs/digest`)).status, 401);
});
