/**
 * BD Engine database backup.
 *
 * Creates a compressed logical backup of the durable Postgres tables. The
 * output contains user records and password hashes, so treat it as sensitive.
 *
 * Usage:
 *   npm run backup
 *   node scripts/backup.mjs --out backups/nightly.json.gz
 *   node scripts/backup.mjs --url postgres://... --include-volatile
 */
import pg from 'pg';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const { Pool } = pg;

const BASE_TABLES = [
  { name: 'users', orderBy: 'id' },
  { name: 'tenants', orderBy: 'id' },
  { name: 'memberships', orderBy: 'tenant_id, user_id' },
  { name: 'tenant_data', orderBy: 'tenant_id' },
  { name: 'accounts', orderBy: 'tenant_id, id' },
  { name: 'contacts', orderBy: 'tenant_id, id' },
  { name: 'jobs', orderBy: 'tenant_id, id' },
  { name: 'board_configs', orderBy: 'tenant_id, id' },
  { name: 'activities', orderBy: 'tenant_id, id' },
  { name: 'tasks', orderBy: 'tenant_id, id' },
  { name: 'import_runs', orderBy: 'tenant_id, started_at, id' },
  { name: 'import_run_items', orderBy: 'tenant_id, id' },
  { name: 'audit_log', orderBy: 'tenant_id, id' },
  { name: 'background_jobs', orderBy: 'tenant_id, updated_at, id' },
  { name: 'stripe_webhook_events', orderBy: 'created_at, event_id' },
  { name: 'schema_migrations', orderBy: 'id' },
  { name: 'analytics_events', orderBy: 'id' },
];

const VOLATILE_TABLES = [
  { name: 'sessions', orderBy: 'id' },
  { name: 'password_reset_tokens', orderBy: 'created_at' },
];

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
      return !['--url', '--out'].includes(previous);
    });
}

function connectionString() {
  return arg('--url') || process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
}

function sslConfig() {
  return process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };
}

function backupPath() {
  const explicit = arg('--out');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `bd-engine-backup-${stamp}.json.gz`;
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

async function verifyBackupFile(file) {
  if (!existsSync(file)) throw new Error(`Backup was not written: ${file}`);
  const compressed = await readFile(file);
  const json = gunzipSync(compressed).toString('utf8');
  const parsed = JSON.parse(json);
  if (parsed.app !== 'bd-engine' || !parsed.tables || typeof parsed.tables !== 'object') {
    throw new Error('Backup verification failed: unexpected file format.');
  }
  return {
    bytes: compressed.byteLength,
    sha256: createHash('sha256').update(compressed).digest('hex'),
  };
}

async function main() {
  const url = connectionString();
  if (!url) {
    console.error('No database connection. Set DATABASE_URL or pass --url.');
    process.exit(1);
  }

  const includeVolatile = flag('--include-volatile');
  const skipAnalytics = flag('--skip-analytics');
  const tables = BASE_TABLES
    .filter((table) => !(skipAnalytics && table.name === 'analytics_events'))
    .concat(includeVolatile ? VOLATILE_TABLES : []);
  const outFile = backupPath();

  const pool = new Pool({ connectionString: url, ssl: sslConfig(), max: 2 });
  const client = await pool.connect();
  const startedAt = Date.now();
  const backup = {
    app: 'bd-engine',
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    includesVolatileTables: includeVolatile,
    skippedAnalytics: skipAnalytics,
    tables: {},
    tableCounts: {},
  };

  try {
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

    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, gzipSync(Buffer.from(JSON.stringify(backup))));
    const verification = await verifyBackupFile(outFile);
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log('');
    console.log(`Backup written: ${outFile}`);
    console.log(`Size: ${(verification.bytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`SHA-256: ${verification.sha256}`);
    console.log(`Verified: yes (${basename(outFile)}, ${elapsedSeconds}s)`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
