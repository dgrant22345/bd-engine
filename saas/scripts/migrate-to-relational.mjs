/**
 * BD Engine — backfill tenant_data JSONB blobs into the normalized rel_* tables.
 *
 * Safe to run against production: it only writes to the new rel_* tables and
 * never touches tenant_data or the running app. Idempotent per tenant
 * (DELETE + re-INSERT), so re-running refreshes a tenant's rows.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate-to-relational.mjs [--tenant <id>]
 *   node scripts/migrate-to-relational.mjs --url postgres://... --tenant tenant-60abe43f
 *   node scripts/migrate-to-relational.mjs --url ... --verify        (counts only)
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
const hasFlag = (name) => process.argv.includes(name);

const connectionString = arg('--url') || process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
if (!connectionString) { console.error('No connection string. Set DATABASE_URL or pass --url.'); process.exit(1); }
const onlyTenant = arg('--tenant');
const verifyOnly = hasFlag('--verify');

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 4 });

const s = (v) => (v === undefined || v === null ? null : String(v));
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.trunc(x) : 0; };
const bool = (v) => v !== false;

// Give every record a unique id WITHIN its tenant (legacy 4-char ids collide).
function dedupeIds(arr) {
  const seen = new Set();
  let collisions = 0;
  for (const item of arr) {
    let id = String(item.id || '');
    if (!id) { id = `gen-${seen.size}-${Math.random().toString(36).slice(2, 10)}`; item.id = id; }
    if (seen.has(id)) {
      collisions += 1;
      let k = 2, candidate = `${id}__d${k}`;
      while (seen.has(candidate)) { k += 1; candidate = `${id}__d${k}`; }
      item.id = candidate;
      id = candidate;
    }
    seen.add(id);
  }
  return collisions;
}

const ENTITIES = {
  rel_accounts: {
    cols: ['tenant_id', 'id', 'ord', 'normalized_name', 'display_name', 'domain', 'status', 'priority_tier', 'target_score', 'job_count', 'connection_count', 'updated_at', 'data'],
    row: (t, a, i) => [t, a.id, i, s(a.normalizedName), s(a.displayName), s(a.domain || a.canonicalDomain), s(a.status), s(a.priorityTier), n(a.targetScore), n(a.jobCount), n(a.connectionCount), s(a.updatedAt), JSON.stringify(a)],
  },
  rel_contacts: {
    cols: ['tenant_id', 'id', 'ord', 'account_id', 'full_name', 'company_name', 'title', 'email', 'priority_score', 'updated_at', 'data'],
    row: (t, c, i) => [t, c.id, i, s(c.accountId), s(c.fullName), s(c.companyName), s(c.title), s(c.email), n(c.priorityScore), s(c.updatedAt), JSON.stringify(c)],
  },
  rel_jobs: {
    cols: ['tenant_id', 'id', 'ord', 'account_id', 'title', 'company_name', 'location', 'ats_type', 'active', 'posted_at', 'updated_at', 'data'],
    row: (t, j, i) => [t, j.id, i, s(j.accountId), s(j.title), s(j.companyName), s(j.location), s(j.atsType), bool(j.active), s(j.postedAt), s(j.updatedAt), JSON.stringify(j)],
  },
  rel_board_configs: {
    cols: ['tenant_id', 'id', 'account_id', 'normalized_company_name', 'ats_type', 'board_id', 'discovery_status', 'review_status', 'active', 'updated_at', 'data'],
    row: (t, c) => [t, c.id, s(c.accountId), s(c.normalizedCompanyName), s(c.atsType), s(c.boardId), s(c.discoveryStatus), s(c.reviewStatus), bool(c.active), s(c.updatedAt), JSON.stringify(c)],
  },
  rel_activities: {
    cols: ['tenant_id', 'id', 'account_id', 'contact_id', 'type', 'occurred_at', 'data'],
    row: (t, a) => [t, a.id, s(a.accountId), s(a.contactId), s(a.type), s(a.occurredAt), JSON.stringify(a)],
  },
  rel_tasks: {
    cols: ['tenant_id', 'id', 'account_id', 'status', 'due_date', 'data'],
    row: (t, x) => [t, x.id, s(x.accountId), s(x.status), s(x.dueDate), JSON.stringify(x)],
  },
};

// Map the tenant_data column -> rel table.
const SOURCE = {
  rel_accounts: 'accounts',
  rel_contacts: 'contacts',
  rel_jobs: 'jobs',
  rel_board_configs: 'configs',
  rel_activities: 'activities',
  rel_tasks: 'tasks',
};

async function batchInsert(client, table, cols, rows) {
  if (!rows.length) return;
  const chunkSize = 400;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const params = [];
    let p = 1;
    for (const r of chunk) {
      values.push(`(${cols.map(() => `$${p++}`).join(',')})`);
      params.push(...r);
    }
    await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params);
  }
}

async function migrateTenant(client, tenantId, blob) {
  const counts = {};
  const collisions = {};
  for (const [table, def] of Object.entries(ENTITIES)) {
    const arr = Array.isArray(blob[SOURCE[table]]) ? blob[SOURCE[table]] : [];
    collisions[table] = dedupeIds(arr);
    await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    await batchInsert(client, table, def.cols, arr.map((item, i) => def.row(tenantId, item, i)));
    counts[table] = arr.length;
  }
  await client.query(
    `INSERT INTO rel_migration_state (tenant_id, migrated_at, counts) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE SET migrated_at = EXCLUDED.migrated_at, counts = EXCLUDED.counts`,
    [tenantId, new Date().toISOString(), JSON.stringify(counts)]
  );
  return { counts, collisions };
}

async function verify(client, tenantId) {
  const blob = (await client.query(
    `SELECT jsonb_array_length(accounts) a, jsonb_array_length(contacts) c, jsonb_array_length(jobs) j,
            jsonb_array_length(configs) cf, jsonb_array_length(activities) ac, coalesce(jsonb_array_length(tasks),0) tk
     FROM tenant_data WHERE tenant_id = $1`, [tenantId])).rows[0];
  const rel = {};
  for (const table of Object.keys(ENTITIES)) {
    rel[table] = Number((await client.query(`SELECT count(*) c FROM ${table} WHERE tenant_id = $1`, [tenantId])).rows[0].c);
  }
  return { blob, rel };
}

async function main() {
  if (!verifyOnly) {
    const schema = readFileSync(join(__dirname, '..', 'migrations', '001_relational.sql'), 'utf8');
    await pool.query(schema);
    console.log('Applied schema: rel_* tables ready.');
  }

  const where = onlyTenant ? 'WHERE tenant_id = $1' : '';
  const params = onlyTenant ? [onlyTenant] : [];
  const tenants = (await pool.query(`SELECT tenant_id FROM tenant_data ${where} ORDER BY tenant_id`, params)).rows.map((r) => r.tenant_id);
  console.log(`${verifyOnly ? 'Verifying' : 'Migrating'} ${tenants.length} tenant(s)...`);

  for (const tenantId of tenants) {
    if (verifyOnly) {
      const { blob, rel } = await verify(pool, tenantId);
      console.log(`  ${tenantId}: blob a/c/j=${blob.a}/${blob.c}/${blob.j} rel=${rel.rel_accounts}/${rel.rel_contacts}/${rel.rel_jobs}`);
      continue;
    }
    const blob = (await pool.query('SELECT accounts, contacts, jobs, configs, activities, tasks FROM tenant_data WHERE tenant_id = $1', [tenantId])).rows[0];
    const src = {
      accounts: blob.accounts || [], contacts: blob.contacts || [], jobs: blob.jobs || [],
      configs: blob.configs || [], activities: blob.activities || [], tasks: blob.tasks || [],
    };
    const client = await pool.connect();
    const startedAt = Date.now();
    try {
      await client.query('BEGIN');
      const { counts, collisions } = await migrateTenant(client, tenantId, src);
      await client.query('COMMIT');
      const collTotal = Object.values(collisions).reduce((a, b) => a + b, 0);
      console.log(`  ${tenantId}: a=${counts.rel_accounts} c=${counts.rel_contacts} j=${counts.rel_jobs} cfg=${counts.rel_board_configs} act=${counts.rel_activities} task=${counts.rel_tasks}` +
        `${collTotal ? ` (deduped ${collTotal} id collisions)` : ''} in ${Date.now() - startedAt}ms`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ${tenantId}: FAILED — ${err.message}`);
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log('Done.');
}

main().catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
