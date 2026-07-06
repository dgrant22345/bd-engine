/**
 * BD Engine — database backup.
 *
 * Dumps the durable tables (users, tenants, memberships, tenant_data) to a
 * timestamped JSON file. Ephemeral tables (sessions) and regenerable ones
 * (analytics_events) are skipped.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/backup.mjs [outputDir]
 *   node scripts/backup.mjs --url postgres://... [outputDir]
 *
 * The dump contains password hashes — treat the file as sensitive and store it
 * somewhere access-controlled (object storage, encrypted disk).
 *
 * Restore is intentionally NOT automated (it overwrites live data). To restore,
 * load the JSON and UPSERT each table's rows in dependency order:
 * users -> tenants -> memberships -> tenant_data.
 */
import pg from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const connectionString = arg('--url') || process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
if (!connectionString) {
  console.error('No connection string. Set DATABASE_URL or pass --url.');
  process.exit(1);
}
const outDir = process.argv.find((a, i) => i >= 2 && !a.startsWith('--') && a !== arg('--url')) || 'backups';

const TABLES = ['users', 'tenants', 'memberships', 'tenant_data'];

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 2 });

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dump = { app: 'bd-engine', takenAt: new Date().toISOString(), tables: {} };
  for (const table of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    dump.tables[table] = rows;
    console.log(`  ${table}: ${rows.length} rows`);
  }
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `bd-engine-backup-${stamp}.json`);
  writeFileSync(file, JSON.stringify(dump));
  const bytes = Buffer.byteLength(JSON.stringify(dump));
  console.log(`\nBackup written: ${file} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  await pool.end();
}

main().catch((err) => { console.error('Backup failed:', err.message); process.exit(1); });
