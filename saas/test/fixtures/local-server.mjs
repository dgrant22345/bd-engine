import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// Real local HTTP server with the isolated in-memory store. No database,
// email, or payment provider is contacted.
export async function startLocalServer(t) {
  const portServer = createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
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
