import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deserializeBackup,
  isEncryptedBackup,
  parseBackupEncryptionKey,
  serializeBackup,
} from '../src/backup-format.js';
import { BACKUP_TABLES, backupTables } from '../src/backup-schema.js';
import { buildBackupUpsert, validateBackupRows } from '../src/backup-restore.js';

const sample = {
  app: 'bd-engine',
  formatVersion: 1,
  createdAt: '2026-07-19T00:00:00.000Z',
  tables: { users: [{ id: 'user-1', email: 'test@example.com' }] },
};
const key = Buffer.alloc(32, 7);

test('backup format preserves legacy compressed and plain JSON files', () => {
  const compressed = serializeBackup(sample);
  assert.equal(isEncryptedBackup(compressed), false);
  assert.deepEqual(deserializeBackup(compressed), sample);
  assert.deepEqual(deserializeBackup(Buffer.from(JSON.stringify(sample))), sample);
});

test('encrypted backups round-trip with AES-256-GCM authentication', () => {
  const encrypted = serializeBackup(sample, key);
  assert.equal(isEncryptedBackup(encrypted), true);
  assert.deepEqual(deserializeBackup(encrypted, key), sample);
  assert.throws(() => deserializeBackup(encrypted), /encrypted.*key/i);
  assert.throws(() => deserializeBackup(encrypted, Buffer.alloc(32, 8)), /incorrect|modified/i);

  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => deserializeBackup(tampered, key), /incorrect|modified/i);
});

test('backup encryption keys must decode to exactly 32 bytes', () => {
  assert.deepEqual(parseBackupEncryptionKey(`base64:${key.toString('base64')}`), key);
  assert.deepEqual(parseBackupEncryptionKey(`hex:${key.toString('hex')}`), key);
  assert.deepEqual(parseBackupEncryptionKey(key.toString('hex')), key);
  assert.equal(parseBackupEncryptionKey(''), null);
  assert.throws(() => parseBackupEncryptionKey('', { required: true }), /required/i);
  assert.throws(() => parseBackupEncryptionKey('too-short'), /32 bytes/i);
  assert.throws(() => parseBackupEncryptionKey(`hex:${key.toString('hex')}zz`), /32 bytes/i);
  assert.throws(() => parseBackupEncryptionKey(`base64:${key.toString('base64')}!`), /32 bytes/i);
});

test('restore CLI verifies encrypted archives and requires two-part write confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bd-backup-test-'));
  const file = join(directory, 'synthetic.json.gz.enc');
  const encodedKey = `base64:${key.toString('base64')}`;
  await writeFile(file, serializeBackup(sample, key));

  try {
    const dryRun = spawnSync(process.execPath, ['scripts/restore-backup.mjs', '--file', file, '--dry-run'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, BD_BACKUP_ENCRYPTION_KEY: encodedKey },
      encoding: 'utf8',
    });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Dry run passed/);

    const missingApply = spawnSync(process.execPath, ['scripts/restore-backup.mjs', '--file', file], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, BD_BACKUP_ENCRYPTION_KEY: encodedKey, BD_RESTORE_CONFIRM: 'RESTORE' },
      encoding: 'utf8',
    });
    assert.equal(missingApply.status, 1);
    assert.match(missingApply.stderr, /Pass --apply/);

    const missingKey = spawnSync(process.execPath, ['scripts/restore-backup.mjs', '--file', file, '--dry-run'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, BD_BACKUP_ENCRYPTION_KEY: '' },
      encoding: 'utf8',
    });
    assert.equal(missingKey.status, 1);
    assert.match(missingKey.stderr, /BACKUP_ENCRYPTION_KEY is required/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('production backup CLI fails before connecting when encryption is not configured', () => {
  const result = spawnSync(process.execPath, ['scripts/backup.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: 'postgres://example.invalid/database',
      BD_CLOUD_ENV: 'production',
      BD_BACKUP_ENCRYPTION_KEY: '',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BACKUP_ENCRYPTION_KEY is required/i);
});

test('backup and restore commands protect snapshot consistency and destination isolation', async () => {
  const [backupScript, restoreScript] = await Promise.all([
    readFile(new URL('../scripts/backup.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/restore-backup.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(backupScript, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(backupScript, /if \(snapshotOpen\).*ROLLBACK/s);
  assert.match(backupScript, /flag\('--public-url'\).*DATABASE_PUBLIC_URL/s);
  assert.match(restoreScript, /assertRestoreTargetEmpty/);
  assert.match(restoreScript, /LOCK TABLE .* IN ACCESS EXCLUSIVE MODE/);
  assert.match(restoreScript, /await client\.query\('BEGIN'\).*await lockRestoreTarget.*await assertRestoreTargetEmpty/s);
  assert.match(restoreScript, /Restore target is not empty/);
  assert.match(restoreScript, /--allow-nonempty/);
  assert.match(restoreScript, /validateBackupRows\(backup\)/);
  assert.doesNotMatch(restoreScript, /INSERT INTO users \(/);
});

test('backup schema covers every durable PostgreSQL table without restore drift', async () => {
  const manifest = JSON.parse(await readFile(new URL('../schema-manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    BACKUP_TABLES.map((table) => table.name).sort(),
    [...manifest.tables].sort()
  );
  assert.ok(BACKUP_TABLES.every((table) => table.conflict.length > 0));
  assert.ok(backupTables().some((table) => table.name === 'account_closures'));
  assert.ok(backupTables().some((table) => table.name === 'commercial_outcomes'));
  assert.ok(!backupTables().some((table) => table.name === 'sessions'));
  assert.ok(backupTables({ includeVolatile: true }).some((table) => table.name === 'email_verification_tokens'));
});

test('restore upserts preserve current user and workspace recovery fields', () => {
  const user = buildBackupUpsert('users', {
    id: 'user-1',
    email: 'test@example.com',
    email_verified_at: '2026-07-19T00:00:00.000Z',
  });
  assert.match(user.text, /"email_verified_at"/);
  assert.ok(user.values.includes('2026-07-19T00:00:00.000Z'));

  const tenant = buildBackupUpsert('tenants', {
    id: 'tenant-1',
    storage_mode: 'relational',
    billing_grace_ends_at: '2026-07-26T00:00:00.000Z',
  });
  assert.match(tenant.text, /"storage_mode"/);
  assert.match(tenant.text, /"billing_grace_ends_at"/);
  assert.ok(tenant.values.includes('relational'));
});

test('restore validation rejects malformed rows before database access', () => {
  assert.throws(() => validateBackupRows({ tables: { users: [{}] } }), /missing required key id/i);
  assert.throws(() => validateBackupRows({ tables: { unknown_table: [] } }), /unsupported tables/i);
  assert.throws(() => validateBackupRows({ tables: { users: {} } }), /must contain an array/i);
});
