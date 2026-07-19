import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readOnlyScripts = [
  'semantic-integrity.mjs',
  'report-job-coverage.mjs',
  'verify-relational-canary.mjs',
];

const nonMigratingScripts = [
  ...readOnlyScripts,
  'snapshot-relational-to-legacy.mjs',
  'verify-db-write-contracts.mjs',
  'repair-board-account-links.mjs',
  'repair-rollups.mjs',
  'backfill-relational.mjs',
  'verify-relational-write-canary.mjs',
];

async function scriptSource(name) {
  return readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
}

test('operational scripts never auto-run schema migrations', async () => {
  for (const name of nonMigratingScripts) {
    const source = await scriptSource(name);
    assert.match(source, /initDb\(\{\s*migrate:\s*false/iu, `${name} must disable migrations`);
  }
});

test('report-only scripts enforce read-only database sessions', async () => {
  for (const name of readOnlyScripts) {
    const source = await scriptSource(name);
    assert.match(source, /readOnly:\s*true/iu, `${name} must enable read-only mode`);
  }

  const parity = await scriptSource('check-relational-parity.mjs');
  assert.match(parity, /default_transaction_read_only=on/iu);

  const cleanup = await scriptSource('cleanup-test-data.mjs');
  assert.match(cleanup, /apply\s*\?\s*undefined\s*:\s*'-c default_transaction_read_only=on'/iu);
});
