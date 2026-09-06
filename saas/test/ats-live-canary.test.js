import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('live canary refuses a database-connected environment before any network work', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.fetch = () => { throw new Error('Unexpected network request'); };
    const { runAtsLiveCanary } = await import('./scripts/ats-live-canary.mjs');
    await runAtsLiveCanary();
  `], { cwd: new URL('../', import.meta.url), env: { ...process.env, DATABASE_URL: 'postgres://do-not-connect.invalid/canary' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /isolated in-memory workspace/);
  assert.doesNotMatch(child.stderr, /Unexpected network request|do-not-connect/);
});
