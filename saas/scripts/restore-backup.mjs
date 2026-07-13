/**
 * BD Engine database restore.
 *
 * Validates or restores a backup produced by scripts/backup.mjs. Actual writes
 * require BD_RESTORE_CONFIRM=RESTORE so this cannot be run accidentally.
 *
 * Usage:
 *   npm run restore -- --file backups/bd-engine-backup-...json.gz --dry-run
 *   BD_RESTORE_CONFIRM=RESTORE npm run restore -- --file backups/bd-engine-backup-...json.gz
 */
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const { Pool } = pg;

const TABLE_ORDER = [
  'users',
  'tenants',
  'memberships',
  'tenant_data',
  'accounts',
  'contacts',
  'jobs',
  'board_configs',
  'activities',
  'tasks',
  'import_runs',
  'import_run_items',
  'audit_log',
  'support_tickets',
  'support_ticket_messages',
  'background_jobs',
  'stripe_webhook_events',
  'schema_migrations',
  'analytics_events',
  'sessions',
  'password_reset_tokens',
];

const GENERIC_ID_TABLES = new Set([
  'accounts',
  'contacts',
  'jobs',
  'board_configs',
  'activities',
  'tasks',
  'import_runs',
  'import_run_items',
  'audit_log',
  'support_tickets',
  'support_ticket_messages',
  'background_jobs',
  'schema_migrations',
]);

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

function jsonValue(value, fallback) {
  if (value === undefined || value === null) return JSON.stringify(fallback);
  return JSON.stringify(value);
}

async function readBackup(file) {
  if (!file) throw new Error('Pass a backup with --file <path>.');
  const buffer = await readFile(file);
  const text = file.endsWith('.gz') ? gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
  const parsed = JSON.parse(text);
  if (parsed.app !== 'bd-engine' || !parsed.tables || typeof parsed.tables !== 'object') {
    throw new Error('This does not look like a BD Engine backup.');
  }
  return parsed;
}

async function upsertUsers(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO users (id, email, name, password_hash, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [row.id, row.email, row.name || '', row.password_hash, row.status || 'active', row.created_at, row.updated_at]
    );
  }
}

async function upsertTenants(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO tenants (id, slug, name, plan, status, persona, stripe_customer_id, stripe_subscription_id, referral_code, referred_by_tenant_id, referral_credited_at, referral_credit_transaction_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         name = EXCLUDED.name,
         plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         persona = EXCLUDED.persona,
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         referral_code = EXCLUDED.referral_code,
         referred_by_tenant_id = EXCLUDED.referred_by_tenant_id,
         referral_credited_at = EXCLUDED.referral_credited_at,
         referral_credit_transaction_id = EXCLUDED.referral_credit_transaction_id,
         updated_at = EXCLUDED.updated_at`,
      [
        row.id,
        row.slug,
        row.name,
        row.plan || 'trial',
        row.status || 'trialing',
        row.persona || 'bd',
        row.stripe_customer_id || '',
        row.stripe_subscription_id || '',
        row.referral_code || '',
        row.referred_by_tenant_id || '',
        row.referral_credited_at || '',
        row.referral_credit_transaction_id || '',
        row.created_at,
        row.updated_at,
      ]
    );
  }
}

async function upsertMemberships(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [row.tenant_id, row.user_id, row.role || 'member', row.created_at]
    );
  }
}

async function upsertTenantData(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO tenant_data (tenant_id, accounts, contacts, jobs, configs, activities, tasks, settings, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE SET
         accounts = EXCLUDED.accounts,
         contacts = EXCLUDED.contacts,
         jobs = EXCLUDED.jobs,
         configs = EXCLUDED.configs,
         activities = EXCLUDED.activities,
         tasks = EXCLUDED.tasks,
         settings = EXCLUDED.settings,
         updated_at = EXCLUDED.updated_at`,
      [
        row.tenant_id,
        jsonValue(row.accounts, []),
        jsonValue(row.contacts, []),
        jsonValue(row.jobs, []),
        jsonValue(row.configs, []),
        jsonValue(row.activities, []),
        jsonValue(row.tasks, []),
        jsonValue(row.settings, {}),
        row.updated_at || new Date().toISOString(),
      ]
    );
  }
}

async function upsertAnalyticsEvents(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO analytics_events (id, visitor_id, event_type, path, referrer, source, tenant_id, user_id, created_at, day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         visitor_id = EXCLUDED.visitor_id,
         event_type = EXCLUDED.event_type,
         path = EXCLUDED.path,
         referrer = EXCLUDED.referrer,
         source = EXCLUDED.source,
         tenant_id = EXCLUDED.tenant_id,
         user_id = EXCLUDED.user_id,
         created_at = EXCLUDED.created_at,
         day = EXCLUDED.day`,
      [
        row.id,
        row.visitor_id || '',
        row.event_type || 'pageview',
        row.path || '/',
        row.referrer || '',
        row.source || '',
        row.tenant_id || '',
        row.user_id || '',
        row.created_at,
        row.day || String(row.created_at || '').slice(0, 10),
      ]
    );
  }
  if (rows.length) {
    await client.query(`SELECT setval(pg_get_serial_sequence('analytics_events', 'id'), (SELECT MAX(id) FROM analytics_events))`);
  }
}

async function upsertSessions(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO sessions (id, user_id, tenant_id, data, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         tenant_id = EXCLUDED.tenant_id,
         data = EXCLUDED.data,
         expires_at = EXCLUDED.expires_at`,
      [row.id, row.user_id, row.tenant_id || null, jsonValue(row.data, {}), row.expires_at, row.created_at]
    );
  }
}

async function upsertPasswordResetTokens(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (token_hash) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         expires_at = EXCLUDED.expires_at,
         used_at = EXCLUDED.used_at,
         created_at = EXCLUDED.created_at`,
      [row.token_hash, row.user_id, row.expires_at, row.used_at || '', row.created_at]
    );
  }
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function upsertGenericById(client, table, rows) {
  for (const row of rows) {
    const columns = Object.keys(row).filter((key) => row[key] !== undefined);
    if (!columns.includes('id')) continue;
    const columnSql = columns.map(quoteIdent).join(', ');
    const valueSql = columns.map((_, index) => `$${index + 1}`).join(', ');
    const updateColumns = columns.filter((column) => column !== 'id');
    const updateSql = updateColumns.length
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(', ')}`
      : 'DO NOTHING';
    await client.query(
      `INSERT INTO ${quoteIdent(table)} (${columnSql}) VALUES (${valueSql}) ON CONFLICT (id) ${updateSql}`,
      columns.map((column) => {
        const value = row[column];
        return value && typeof value === 'object' ? JSON.stringify(value) : value;
      })
    );
  }
  if (rows.length && ['analytics_events', 'import_run_items', 'audit_log', 'support_ticket_messages'].includes(table)) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${quoteIdent(table)}), 1))`);
  }
}

async function upsertStripeWebhookEvents(client, rows) {
  for (const row of rows) {
    const columns = Object.keys(row).filter((key) => row[key] !== undefined);
    if (!columns.includes('event_id')) continue;
    const columnSql = columns.map(quoteIdent).join(', ');
    const valueSql = columns.map((_, index) => `$${index + 1}`).join(', ');
    const updateColumns = columns.filter((column) => column !== 'event_id');
    const updateSql = updateColumns.length
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(', ')}`
      : 'DO NOTHING';
    await client.query(
      `INSERT INTO stripe_webhook_events (${columnSql}) VALUES (${valueSql}) ON CONFLICT (event_id) ${updateSql}`,
      columns.map((column) => row[column])
    );
  }
}

async function restoreTable(client, table, rows) {
  if (!rows?.length) return;
  if (table === 'users') return upsertUsers(client, rows);
  if (table === 'tenants') return upsertTenants(client, rows);
  if (table === 'memberships') return upsertMemberships(client, rows);
  if (table === 'tenant_data') return upsertTenantData(client, rows);
  if (table === 'analytics_events') return upsertAnalyticsEvents(client, rows);
  if (table === 'stripe_webhook_events') return upsertStripeWebhookEvents(client, rows);
  if (table === 'sessions') return upsertSessions(client, rows);
  if (table === 'password_reset_tokens') return upsertPasswordResetTokens(client, rows);
  if (GENERIC_ID_TABLES.has(table)) return upsertGenericById(client, table, rows);
}

async function main() {
  const file = arg('--file');
  const dryRun = flag('--dry-run');
  const legacyOnly = flag('--legacy-only');
  const backup = await readBackup(file);
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

  if (process.env.BD_RESTORE_CONFIRM !== 'RESTORE') {
    throw new Error('Refusing to write. Set BD_RESTORE_CONFIRM=RESTORE to run an actual restore.');
  }

  const url = connectionString();
  if (!url) throw new Error('No database connection. Set DATABASE_URL or pass --url.');

  const pool = new Pool({ connectionString: url, ssl: sslConfig(), max: 2 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of TABLE_ORDER) {
      if (legacyOnly && !['users', 'tenants', 'memberships', 'tenant_data'].includes(table)) continue;
      await restoreTable(client, table, backup.tables[table] || []);
    }
    await client.query('COMMIT');
    console.log('Restore complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Restore failed:', err.message);
  process.exit(1);
});
