import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// Real local HTTP server with the isolated in-memory store and the read-only
// demo workspace. No database, email, or payment provider is contacted.
test('People list returns who is worth contacting with the evidence for each person', { timeout: 30000 }, async (t) => {
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
  const demo = await fetch(`${origin}/api/demo/start`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' });
  assert.equal(demo.status, 201, await demo.clone().text());
  const cookie = (demo.headers.get('set-cookie') || '').split(';')[0];
  const list = async (query) => (await fetch(`${origin}/api/contacts?${query}`, { headers: { Cookie: cookie } })).json();

  const ranked = await list('sortBy=call');
  assert.deepEqual(ranked.items.map((person) => person.fullName), ['Priya Shah', 'Marcus Lee', 'Owen Miller', 'Elena Park']);
  const priya = ranked.items[0];
  assert.equal(priya.listContext.linked, true);
  assert.equal(priya.listContext.openRoles, 2);
  assert.equal(priya.listContext.newRoles7d, 2);
  assert.equal(typeof priya.listContext.lastOutreachAt, 'string');
  for (const person of ranked.items) {
    assert.deepEqual(Object.keys(person.listContext).sort(), ['lastOutreachAt', 'linked', 'newRoles7d', 'openRoles']);
    assert.ok(person.listContext.openRoles >= person.listContext.newRoles7d);
  }

  // Other orders keep working and carry the same context.
  const byName = await list('sortBy=name&pageSize=2');
  assert.deepEqual(byName.items.map((person) => person.fullName), ['Elena Park', 'Marcus Lee']);
  assert.equal(byName.total, 4);
  assert.equal(byName.items[0].listContext.openRoles, 1);
  assert.equal((await list('q=no-such-person')).items.length, 0);
});
