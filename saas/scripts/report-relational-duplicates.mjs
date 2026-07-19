import pg from 'pg';

const { Pool } = pg;

const checks = [
  { key: 'accounts.identity_key', table: 'accounts', columns: ['tenant_id', 'identity_key'], predicate: "identity_key <> ''" },
  { key: 'contacts.identity_key', table: 'contacts', columns: ['tenant_id', 'identity_key'], predicate: "identity_key <> ''" },
  { key: 'contacts.linkedin_url', table: 'contacts', columns: ['tenant_id', 'canonical_linkedin_url'], predicate: "canonical_linkedin_url <> ''" },
  { key: 'jobs.natural_key', table: 'jobs', columns: ['tenant_id', 'natural_key'], predicate: "natural_key <> ''" },
  { key: 'boards.identity_key', table: 'board_configs', columns: ['tenant_id', 'identity_key'], predicate: "identity_key <> ''" },
  { key: 'boards.provider_board', table: 'board_configs', columns: ['tenant_id', 'ats_type', 'board_id'], predicate: "ats_type <> '' AND board_id <> ''" },
];

async function inspect(client, check) {
  const groupedColumns = check.columns.join(', ');
  const result = await client.query(`
    SELECT COUNT(*)::int AS duplicate_groups,
           COALESCE(SUM(row_count - 1), 0)::int AS excess_rows
    FROM (
      SELECT ${groupedColumns}, COUNT(*)::int AS row_count
      FROM ${check.table}
      WHERE ${check.predicate}
      GROUP BY ${groupedColumns}
      HAVING COUNT(*) > 1
    ) duplicates
  `);
  const row = result?.rows?.[0] || {};
  return {
    key: check.key,
    duplicateGroups: Number(row.duplicate_groups || 0),
    excessRows: Number(row.excess_rows || 0),
  };
}

const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
const pool = connectionString ? new Pool({
  connectionString,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 10000,
}) : null;
let client;

try {
  if (!pool) throw new Error('DATABASE_URL is required.');
  client = await pool.connect();
  await client.query('BEGIN READ ONLY');
  const results = [];
  for (const check of checks) results.push(await inspect(client, check));
  await client.query('COMMIT');
  console.table(results);
  const duplicateGroups = results.reduce((sum, row) => sum + row.duplicateGroups, 0);
  const excessRows = results.reduce((sum, row) => sum + row.excessRows, 0);
  console.log(`Relational duplicate audit: ${duplicateGroups} duplicate groups; ${excessRows} excess rows; no customer values emitted.`);
  if (process.argv.includes('--fail-on-duplicates') && duplicateGroups > 0) process.exitCode = 2;
} catch (error) {
  if (client) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original audit error. */ }
  }
  console.error(`Relational duplicate audit failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool?.end();
}
