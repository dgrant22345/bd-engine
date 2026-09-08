import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const mode of ['legacy', 'primary']) {
  test(`focus persistence waits, reports failures and drains writes (${mode})`, () => {
    const result = spawnSync(process.execPath, ['--experimental-test-module-mocks',
      fileURLToPath(new URL('./fixtures/focus-persistence.mjs', import.meta.url)), mode], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, DATABASE_URL: '', BD_RELATIONAL_READ_TENANTS: '',
        BD_RELATIONAL_WRITE_TENANTS: mode === 'primary' ? 'focus-persistence' : '' },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    console.log(result.stdout.trim());
  });
}
