import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { buildProductEvent } from '../src/product-analytics.js';

test('people_added is keyed once per workspace and carries no personal data', () => {
  const first = buildProductEvent({ eventType: 'people_added', tenantId: 'tenant-1', userId: 'user-1', eventKey: 'tenant-1', dimensions: { persona: 'bd', email: 'person@example.com', fullName: 'Private Person' } });
  const second = buildProductEvent({ eventType: 'people_added', tenantId: 'tenant-1', userId: 'user-2', eventKey: 'tenant-1' });
  assert.equal(first.eventKey, second.eventKey);
  assert.equal(first.path, '/funnel/people-added');
  assert.doesNotMatch(JSON.stringify(first), /person@example\.com|Private Person/);
});

// Real local HTTP server with the isolated in-memory store. No database,
// email, or payment provider is contacted.
test('adding the first person records one activation step for the workspace', { timeout: 30000 }, async (t) => {
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const port = portServer.address().port; await new Promise((resolve) => portServer.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const email = 'activation-steps@example.com';
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', BD_CLOUD_HOST: '127.0.0.1', BD_CLOUD_PORT: String(port), BD_CLOUD_BASE_URL: origin,
      STRIPE_SECRET_KEY: '', RESEND_API_KEY: '', SMTP_HOST: '', BD_OWNER_EMAILS: '', BD_ANALYTICS_ADMIN_EMAILS: email },
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
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, password: 'Activation-steps-2026', name: 'Activation Steps', workspaceName: 'Activation Steps', persona: 'bd', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } }),
  });
  assert.equal(signup.status, 201, await signup.clone().text());
  const cookie = signup.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const request = (path, options = {}) => fetch(`${origin}${path}`, { ...options, headers: { cookie, origin, 'content-type': 'application/json', ...options.headers } });
  const funnelRow = async () => (await (await request('/api/admin/bootstrap')).json()).analytics.funnel.find((row) => row.eventType === 'people_added');

  // An empty People list is not an activation step.
  assert.equal((await request('/api/contacts')).status, 200);
  assert.equal(await funnelRow(), undefined);

  const created = await request('/api/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Private Person', title: 'Talent Lead', companyName: 'Northstar Robotics' }) });
  assert.equal(created.status, 201, await created.clone().text());
  // Later additions and list reads do not add rows.
  assert.equal((await request('/api/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Second Person' }) })).status, 201);
  assert.equal((await request('/api/contacts')).status, 200);

  const row = await funnelRow();
  assert.equal(row.workspaces, 1);
  assert.equal(row.events, 1);
  const admin = await (await request('/api/admin/bootstrap')).json();
  assert.doesNotMatch(JSON.stringify(admin.analytics), /Private Person|Second Person|Northstar Robotics/);
});
