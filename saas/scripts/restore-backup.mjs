/**
 * BD Engine database restore.
 *
 * Validates or restores a backup produced by scripts/backup.mjs. Actual writes
 * require both --apply and BD_RESTORE_CONFIRM=RESTORE.
 *
 * Usage:
 *   npm run restore -- --file backups/bd-engine-backup-...json.gz.enc --dry-run
 *   BD_RESTORE_CONFIRM=RESTORE npm run restore -- --file backups/bd-engine-backup-...json.gz.enc --apply
 */
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { deserializeBackup, isEncryptedBackup, parseBackupEncryptionKey } from '../src/backup-format.js';
import { BACKUP_TABLES } from '../src/backup-schema.js';
import { buildBackupUpsert, quoteBackupIdentifier, validateBackupRows } from '../src/backup-restore.js';

const { Pool } = pg;
const TABLE_ORDER = BACKUP_TABLES.map((table) => table.name);
const TABLE_SCHEMA = new Map(BACKUP_TABLES.map((table) => [table.name, table]));
const LEGACY_ONLY_TABLES = new Set(['users', 'tenants', 'memberships', 'tenant_data']);
const NONEMPTY_GUARD_TABLES = ['users', 'tenants', 'memberships', 'tenant_data', 'accounts', 'contacts', 'jobs', 'board_configs'];

function flag(name) {
  return process.argv.includes(name);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function connectionString() {
  return arg('--url') || process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
}

function sslConfig() {
  return process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };
}

async function readBackup(file) {
  if (!file) throw new Error('Pass a backup with --file <path>.');
  const buffer = await readFile(file);
  const encrypted = isEncryptedBackup(buffer);
  const key = parseBackupEncryptionKey(process.env.BD_BACKUP_ENCRYPTION_KEY, { required: encrypted });
  const parsed = deserializeBackup(buffer, key);
  if (parsed.app !== 'bd-engine' || !parsed.tables || typeof parsed.tables !== 'object' || Array.isArray(parsed.tables)) {
    throw new Error('This does not look like a BD Engine backup.');
  }
  return parsed;
}

async function upsertRows(client, table, rows) {
  for (const row of rows) {
    const statement = buildBackupUpsert(table, row);
    await client.query(statement.text, statement.values);
  }
}

async function resetSequence(client, table) {
  const schema = TABLE_SCHEMA.get(table);
  if (!schema?.serial) return;
  const sequence = await client.query('SELECT pg_get_serial_sequence($1, $2) AS name', [table, schema.serial]);
  const sequenceName = sequence.rows[0]?.name;
  if (!sequenceName) return;
  await client.query(
    `SELECT setval($1::regclass, GREATEST(COALESCE(MAX(${quoteBackupIdentifier(schema.serial)}), 1), 1), COUNT(*) > 0)
     FROM ${quoteBackupIdentifier(table)}`,
    [sequenceName]
  );
}

async function assertRestoreTargetEmpty(client) {
  if (flag('--allow-nonempty')) return;
  for (const table of NONEMPTY_GUARD_TABLES) {
    const exists = await client.query('SELECT to_regclass($1) AS table_name', [`public.${table}`]);
    if (!exists.rows[0]?.table_name) continue;
    const count = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteBackupIdentifier(table)}`);
    if (Number(count.rows[0]?.count || 0) > 0) {
      throw new Error(`Restore target is not empty (${table} contains rows). Use a fresh database or pass --allow-nonempty only under an approved recovery plan.`);
    }
  }
}

async function lockRestoreTarget(client) {
  for (const table of TABLE_ORDER) {
    const exists = await client.query('SELECT to_regclass($1) AS table_name', [`public.${table}`]);
    if (exists.rows[0]?.table_name) {
      await client.query(`LOCK TABLE ${quoteBackupIdentifier(table)} IN ACCESS EXCLUSIVE MODE`);
    }
  }
}

async function main() {
  const file = arg('--file');
  const dryRun = flag('--dry-run');
  const legacyOnly = flag('--legacy-only');
  const backup = await readBackup(file);
  validateBackupRows(backup);

  const counts = Object.fromEntries(TABLE_ORDER.map((table) => [table, backup.tables[table]?.length || 0]));
  console.log(`Backup: ${file}`);
  console.log(`Created: ${backup.createdAt || backup.takenAt || 'unknown'}`);
  for (const table of TABLE_ORDER) {
    if (counts[table]) console.log(`  ${table}: ${counts[table]} row(s)`);
  }

  if (dryRun) {
    console.log('Dry run passed: backup is readable and structurally valid.');
    return;
  }
  if (!flag('--apply') || process.env.BD_RESTORE_CONFIRM !== 'RESTORE') {
    throw new Error('Refusing to write. Pass --apply and set BD_RESTORE_CONFIRM=RESTORE.');
  }

  const url = connectionString();
  if (!url) throw new Error('No database connection. Set DATABASE_URL or pass --url.');

  const pool = new Pool({ connectionString: url, ssl: sslConfig(), max: 2 });
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await lockRestoreTarget(client);
    await assertRestoreTargetEmpty(client);
    for (const table of TABLE_ORDER) {
      if (legacyOnly && !LEGACY_ONLY_TABLES.has(table)) continue;
      await upsertRows(client, table, backup.tables[table] || []);
    }
    for (const table of TABLE_ORDER) {
      if (legacyOnly && !LEGACY_ONLY_TABLES.has(table)) continue;
      await resetSequence(client, table);
    }
    await client.query('COMMIT');
    transactionOpen = false;
    console.log('Restore complete.');
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Restore failed:', error.message);
  process.exit(1);
});
