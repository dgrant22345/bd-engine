import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
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
  for (const path of ['/media', '/media/', '/media/campaign', '/guides/', '/app/icons', '/app/icons/']) {
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
