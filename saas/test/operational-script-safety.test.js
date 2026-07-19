import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { requireMaintenanceApproval, workspaceLabel } from '../src/maintenance-safety.js';

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

test('maintenance approval requires tenant scope, exact confirmation, and a backup reference', () => {
  assert.doesNotThrow(() => requireMaintenanceApproval({ apply: false }));
  assert.throws(
    () => requireMaintenanceApproval({ apply: true, expectedConfirmation: 'REPAIR', confirmation: 'REPAIR', backupReference: '123456789012' }),
    /--tenant/iu
  );
  assert.throws(
    () => requireMaintenanceApproval({ apply: true, tenantId: 'tenant-1', expectedConfirmation: 'REPAIR', confirmation: 'repair', backupReference: '123456789012' }),
    /--confirm REPAIR/iu
  );
  assert.throws(
    () => requireMaintenanceApproval({ apply: true, tenantId: 'tenant-1', expectedConfirmation: 'REPAIR', confirmation: 'REPAIR', backupReference: 'short' }),
    /--backup-reference/iu
  );
  assert.doesNotThrow(() => requireMaintenanceApproval({
    apply: true,
    tenantId: 'tenant-1',
    expectedConfirmation: 'REPAIR',
    confirmation: 'REPAIR',
    backupReference: 'backup-sha-123456',
  }));
  assert.equal(workspaceLabel(0), 'workspace 1');
});

test('bulk mutation scripts are dry-run by default and use guarded apply paths', async () => {
  const expectations = [
    ['backfill-relational.mjs', 'BACKFILL_RELATIONAL'],
    ['snapshot-relational-to-legacy.mjs', 'SNAPSHOT_LEGACY'],
    ['repair-board-account-links.mjs', 'LINK_BOARD_CONFIGS'],
    ['repair-rollups.mjs', 'REPAIR_ROLLUPS'],
    ['cleanup-test-data.mjs', 'DELETE_TEST_DATA'],
  ];
  for (const [name, confirmation] of expectations) {
    const source = await scriptSource(name);
    assert.match(source, /(?:process\.argv\.includes|flag)\('--apply'\)/u, `${name} must require --apply`);
    assert.match(source, new RegExp(confirmation, 'u'), `${name} must require its exact confirmation`);
    assert.match(source, /backupReference/iu, `${name} must require a backup reference`);
  }
});

test('rollup repair is atomic across relational, legacy, and audit storage', async () => {
  const source = await scriptSource('repair-rollups.mjs');
  assert.match(source, /dbTransaction\(async \(query\)/u);
  assert.match(source, /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/u);
  assert.match(source, /UPDATE accounts SET/u);
  assert.match(source, /UPDATE tenant_data data/u);
  assert.match(source, /INSERT INTO audit_log/u);
  assert.doesNotMatch(source, /dbQuery\('BEGIN'/u);
});

test('relational write canary fails closed before mutating a workspace', async () => {
  const source = await scriptSource('verify-relational-write-canary.mjs');
  assert.match(source, /mutating && !apply/u);
  assert.match(source, /CREATE_RELATIONAL_CANARY/u);
  assert.match(source, /CLEANUP_RELATIONAL_CANARY/u);
  assert.match(source, /backupReference/iu);
  assert.match(source, /A relational write canary already exists/u);
  assert.doesNotMatch(source, /DELETE FROM board_configs WHERE tenant_id = \$1 AND id = \$2/u);
  assert.match(source, /raw->>'source' = 'system_canary'/u);
});

test('routine maintenance output omits direct customer identifiers', async () => {
  const scripts = [
    'backfill-relational.mjs',
    'check-relational-parity.mjs',
    'cleanup-test-data.mjs',
    'repair-board-account-links.mjs',
    'repair-rollups.mjs',
    'report-job-coverage.mjs',
    'snapshot-relational-to-legacy.mjs',
    'verify-relational-canary.mjs',
    'verify-relational-write-canary.mjs',
  ];
  for (const name of scripts) {
    const source = await scriptSource(name);
    const outputCalls = [...source.matchAll(/console\.(?:log|error)\(([\s\S]*?)\);/gu)].map((match) => match[1]).join('\n');
    assert.doesNotMatch(outputCalls, /\btenantId\b|displayName|workspace\?\.name|\.email\b/u, `${name} output must remain aggregate-only`);
  }
});
