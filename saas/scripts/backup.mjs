/**
 * BD Engine database backup.
 *
 * Creates a compressed logical backup of the durable Postgres tables. Production
 * backups are encrypted with AES-256-GCM and fail closed when no key is set.
 *
 * Usage:
 *   npm run backup
 *   node scripts/backup.mjs --out backups/nightly.json.gz.enc
 *   node scripts/backup.mjs --url postgres://... --include-volatile
 *   node scripts/backup.mjs --public-url --out backups/railway.json.gz.enc
 */
import pg from 'pg';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { deserializeBackup, parseBackupEncryptionKey, serializeBackup } from '../src/backup-format.js';
import { backupTables } from '../src/backup-schema.js';

const { Pool } = pg;

function flag(name) {
  return process.argv.includes(name);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function positionalOutputDir() {
  return process.argv
    .slice(2)
    .find((value, index, args) => {
      if (value.startsWith('--')) return false;
      const previous = args[index - 1];
      return !['--url', '--out', '--output'].includes(previous);
    });
}

function connectionString() {
  if (flag('--public-url')) return process.env.DATABASE_PUBLIC_URL;
  return arg('--url') || process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
}

function sslConfig() {
  return process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };
}

function backupPath(encrypted) {
  const explicit = arg('--out') || arg('--output');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `bd-engine-backup-${stamp}.json.gz${encrypted ? '.enc' : ''}`;
  if (explicit) {
    const target = resolve(explicit);
    return extname(target) ? target : resolve(target, filename);
  }
  return resolve(positionalOutputDir() || process.env.BD_BACKUP_DIR || 'backups', filename);
}

async function tableExists(client, table) {
  const result = await client.query('SELECT to_regclass($1) AS table_name', [`public.${table}`]);
  return !!result.rows[0]?.table_name;
}

async function dumpTable(client, table) {
  if (!(await tableExists(client, table.name))) {
    return { skipped: true, rows: [] };
  }
  const result = await client.query(`SELECT * FROM ${table.name} ORDER BY ${table.orderBy}`);
  return { skipped: false, rows: result.rows };
}

async function verifyBackupFile(file, encryptionKey) {
  if (!existsSync(file)) throw new Error(`Backup was not written: ${file}`);
  const stored = await readFile(file);
  const parsed = deserializeBackup(stored, encryptionKey);
  if (parsed.app !== 'bd-engine' || !parsed.tables || typeof parsed.tables !== 'object') {
    throw new Error('Backup verification failed: unexpected file format.');
  }
  return {
    bytes: stored.byteLength,
    sha256: createHash('sha256').update(stored).digest('hex'),
  };
}

async function main() {
  const url = connectionString();
  if (!url) {
    console.error(flag('--public-url')
      ? 'No public database connection. DATABASE_PUBLIC_URL is not configured.'
      : 'No database connection. Set DATABASE_URL or pass --url.');
    process.exit(1);
  }

  const production = process.env.BD_CLOUD_ENV === 'production'
    || process.env.NODE_ENV === 'production'
    || process.env.RAILWAY_ENVIRONMENT_NAME === 'production';
  const encryptionKey = parseBackupEncryptionKey(process.env.BD_BACKUP_ENCRYPTION_KEY, {
    required: production || flag('--require-encryption'),
  });
  const includeVolatile = flag('--include-volatile');
  const skipAnalytics = flag('--skip-analytics');
  const tables = backupTables({ includeVolatile, skipAnalytics });
  const outFile = backupPath(Boolean(encryptionKey));

  const pool = new Pool({ connectionString: url, ssl: sslConfig(), max: 2 });
  const client = await pool.connect();
  const startedAt = Date.now();
  const backup = {
    app: 'bd-engine',
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    includesVolatileTables: includeVolatile,
    skippedAnalytics: skipAnalytics,
    encryption: encryptionKey ? 'aes-256-gcm' : 'none',
    tables: {},
    tableCounts: {},
  };
  let snapshotOpen = false;

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    snapshotOpen = true;
    for (const table of tables) {
      const { skipped, rows } = await dumpTable(client, table);
      if (skipped) {
        backup.tableCounts[table.name] = 'missing';
        console.log(`  ${table.name}: skipped, table does not exist`);
        continue;
      }
      backup.tables[table.name] = rows;
      backup.tableCounts[table.name] = rows.length;
      console.log(`  ${table.name}: ${rows.length} row(s)`);
    }
    await client.query('COMMIT');
    snapshotOpen = false;

    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, serializeBackup(backup, encryptionKey));
    const verification = await verifyBackupFile(outFile, encryptionKey);
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log('');
    console.log(`Backup written: ${outFile}`);
    console.log(`Size: ${(verification.bytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`SHA-256: ${verification.sha256}`);
    console.log(`Encrypted: ${encryptionKey ? 'yes (AES-256-GCM)' : 'no (development only)'}`);
    console.log(`Verified: yes (${basename(outFile)}, ${elapsedSeconds}s)`);
  } catch (error) {
    if (snapshotOpen) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
