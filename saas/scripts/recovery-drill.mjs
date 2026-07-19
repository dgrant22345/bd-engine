/**
 * Disposable PostgreSQL recovery drill.
 *
 * Creates a fresh target database, migrates both databases, seeds representative
 * source data, takes an encrypted backup, restores it, and compares every durable
 * table. Remote databases are rejected unless an operator explicitly opts in.
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKUP_TABLES, backupTables } from '../src/backup-schema.js';
import { closeDb, initDb } from '../src/db.js';

const { Client } = pg;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const FIXED_TIME = '2026-07-19T12:00:00.000Z';
const SOURCE_IDS = Object.freeze({
  user: 'recovery-user-1',
  tenant: 'recovery-tenant-1',
  account: 'recovery-account-1',
  contact: 'recovery-contact-1',
  job: 'recovery-job-1',
  board: 'recovery-board-1',
  importRun: 'recovery-import-1',
  ticket: 'recovery-ticket-1',
});

function databaseUrl(base, database) {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error(`Unsafe database name: ${value}`);
  return `"${value}"`;
}

function sslConfig() {
  return process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };
}

async function runNode(args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${args[0]} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

async function migrate(url) {
  process.env.DATABASE_URL = url;
  const connected = await initDb({ migrate: true });
  assert.equal(connected, true, 'Recovery drill database did not connect.');
  await closeDb();
}

async function assertEmptySource(client) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM tenants) AS tenants,
      (SELECT COUNT(*)::int FROM accounts) AS accounts
  `);
  assert.deepEqual(result.rows[0], { users: 0, tenants: 0, accounts: 0 },
    'Recovery drill source must be a fresh, empty database.');
}

async function seedSource(client) {
  const { user, tenant, account, contact, job, board, importRun, ticket } = SOURCE_IDS;
  const accountRaw = { id: account, displayName: 'Recovery Systems', domain: 'recovery.example', updatedAt: FIXED_TIME };
  const contactRaw = { id: contact, accountId: account, fullName: 'Taylor Restore', email: 'taylor@recovery.example', updatedAt: FIXED_TIME };
  const jobRaw = { id: job, accountId: account, configId: board, title: 'Recovery Engineer', active: true, updatedAt: FIXED_TIME };
  const boardRaw = { id: board, accountId: account, companyName: 'Recovery Systems', atsType: 'greenhouse', boardId: 'recovery', active: true, updatedAt: FIXED_TIME };

  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO users
      (id, email, name, password_hash, status, email_verified_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'active', $5, $5, $5)`,
    [user, 'recovery@example.test', 'Recovery User', 'not-a-real-password-hash', FIXED_TIME]);
    await client.query(`INSERT INTO tenants
      (id, slug, name, plan, status, persona, storage_mode, billing_grace_ends_at, created_at, updated_at)
      VALUES ($1, $2, $3, 'pro', 'active', 'bd', 'relational', $4, $5, $5)`,
    [tenant, 'recovery-tenant', 'Recovery Tenant', '2026-07-26T12:00:00.000Z', FIXED_TIME]);
    await client.query(`INSERT INTO memberships (tenant_id, user_id, role, created_at)
      VALUES ($1, $2, 'owner', $3)`, [tenant, user, FIXED_TIME]);
    await client.query(`INSERT INTO tenant_data
      (tenant_id, accounts, contacts, jobs, configs, activities, tasks, settings, updated_at)
      VALUES ($1, $2, $3, $4, $5, '[]', '[]', $6, $7)`,
    [tenant, [accountRaw], [contactRaw], [jobRaw], [boardRaw], { timezone: 'America/Toronto' }, FIXED_TIME]);

    await client.query(`INSERT INTO accounts
      (id, tenant_id, display_name, normalized_name, domain, status, target_score, raw, created_at, updated_at, identity_key, canonical_domain)
      VALUES ($1, $2, 'Recovery Systems', 'recovery systems', 'recovery.example', 'qualified', 91, $3, $4, $4, $5, 'recovery.example')`,
    [account, tenant, accountRaw, FIXED_TIME, `${tenant}|domain|recovery.example`]);
    await client.query(`INSERT INTO contacts
      (id, tenant_id, account_id, full_name, first_name, last_name, email, company_name, title, source, raw, created_at, updated_at, identity_key, normalized_email)
      VALUES ($1, $2, $3, 'Taylor Restore', 'Taylor', 'Restore', 'taylor@recovery.example', 'Recovery Systems', 'VP Engineering', 'manual', $4, $5, $5, $6, 'taylor@recovery.example')`,
    [contact, tenant, account, contactRaw, FIXED_TIME, `${tenant}|email|taylor@recovery.example`]);
    await client.query(`INSERT INTO jobs
      (id, tenant_id, account_id, title, company_name, location, source, ats_type, source_url, job_url, posted_at, active, raw, created_at, updated_at, natural_key, first_seen_at, last_seen_at, import_run_id)
      VALUES ($1, $2, $3, 'Recovery Engineer', 'Recovery Systems', 'Toronto, ON', 'ats', 'greenhouse', $4, $5, $6, TRUE, $7, $6, $6, $8, $6, $6, $9)`,
    [job, tenant, account, 'https://boards.greenhouse.io/recovery', 'https://boards.greenhouse.io/recovery/jobs/1', FIXED_TIME, jobRaw, `${tenant}|greenhouse|1`, importRun]);
    await client.query(`INSERT INTO board_configs
      (id, tenant_id, account_id, company_name, normalized_company_name, ats_type, board_id, domain, careers_url, discovery_status, review_status, active, raw, created_at, updated_at, identity_key, resolved_board_url, last_checked_at, last_imported_at, last_import_status)
      VALUES ($1, $2, $3, 'Recovery Systems', 'recovery systems', 'greenhouse', 'recovery', 'recovery.example', $4, 'resolved', 'approved', TRUE, $5, $6, $6, $7, $4, $6, $6, 'success')`,
    [board, tenant, account, 'https://boards.greenhouse.io/recovery', boardRaw, FIXED_TIME, `${tenant}|greenhouse|recovery`]);
    await client.query(`INSERT INTO activities
      (id, tenant_id, account_id, contact_id, type, summary, notes, occurred_at, created_by_user_id, raw, created_at, updated_at)
      VALUES ('recovery-activity-1', $1, $2, $3, 'note', 'Recovery note', 'Restored exactly', $4, $5, $6, $4, $4)`,
    [tenant, account, contact, FIXED_TIME, user, { id: 'recovery-activity-1', accountId: account }]);
    await client.query(`INSERT INTO tasks
      (id, tenant_id, account_id, contact_id, title, status, priority, due_date, raw, created_at, updated_at)
      VALUES ('recovery-task-1', $1, $2, $3, 'Verify restored workspace', 'pending', 'high', '2026-07-20', $4, $5, $5)`,
    [tenant, account, contact, { id: 'recovery-task-1', accountId: account }, FIXED_TIME]);

    await client.query(`INSERT INTO import_runs
      (id, tenant_id, run_type, status, source, source_hash, started_at, completed_at, rows_total, rows_created, warnings, errors, metadata)
      VALUES ($1, $2, 'jobs', 'completed', 'recovery-drill', 'sha256:recovery', $3, $3, 1, 1, '[]', '[]', $4)`,
    [importRun, tenant, FIXED_TIME, { provider: 'greenhouse' }]);
    await client.query(`INSERT INTO import_run_items
      (id, import_run_id, tenant_id, entity_type, entity_id, natural_key, status, message, source_row, created_at)
      VALUES (41, $1, $2, 'job', $3, $4, 'created', 'Recovered', $5, $6)`,
    [importRun, tenant, job, `${tenant}|greenhouse|1`, { title: 'Recovery Engineer' }, FIXED_TIME]);
    await client.query(`INSERT INTO audit_log
      (id, tenant_id, actor_user_id, action, entity_type, entity_id, before, after, metadata, created_at)
      VALUES (42, $1, $2, 'job.imported', 'job', $3, NULL, $4, $5, $6)`,
    [tenant, user, job, jobRaw, { requestId: 'recovery-request' }, FIXED_TIME]);
    await client.query(`INSERT INTO support_tickets
      (id, tenant_id, created_by_user_id, category, subject, status, priority, page_url, created_at, updated_at)
      VALUES ($1, $2, $3, 'job_discovery', 'Recovery drill ticket', 'open', 'normal', '/app/#/support', $4, $4)`,
    [ticket, tenant, user, FIXED_TIME]);
    await client.query(`INSERT INTO support_ticket_messages
      (id, ticket_id, tenant_id, author_user_id, author_type, body, internal, created_at)
      VALUES (43, $1, $2, $3, 'customer', 'Please preserve this message.', FALSE, $4)`,
    [ticket, tenant, user, FIXED_TIME]);
    await client.query(`INSERT INTO background_jobs
      (id, tenant_id, type, status, snapshot, queued_at, started_at, finished_at, updated_at)
      VALUES ('recovery-background-1', $1, 'import', 'completed', $2, $3, $3, $3, $3)`,
    [tenant, { imported: 1 }, FIXED_TIME]);
    await client.query(`INSERT INTO account_closures
      (id, subject_hash, status, deleted_tenant_count, metadata, requested_at, updated_at, completed_at)
      VALUES ('recovery-closure-1', 'sha256:anonymous-subject', 'completed', 1, $1, $2, $2, $2)`,
    [{ reason: 'recovery drill synthetic record' }, FIXED_TIME]);
    await client.query(`INSERT INTO stripe_webhook_events
      (event_id, event_type, status, attempts, created_at, updated_at, processed_at)
      VALUES ('evt_recovery_1', 'invoice.paid', 'processed', 1, $1, $1, $1)`, [FIXED_TIME]);
    await client.query(`INSERT INTO analytics_events
      (id, visitor_id, event_type, path, source, tenant_id, user_id, created_at, day, event_key, metadata)
      VALUES (44, 'visitor-recovery', 'activation.completed', '/app/', 'recovery-drill', $1, $2, $3, '2026-07-19', 'recovery-event-1', $4)`,
    [tenant, user, FIXED_TIME, { persona: 'bd' }]);

    // Volatile authentication and rate-limit state is deliberately excluded from standard backups.
    await client.query(`INSERT INTO sessions (id, user_id, tenant_id, data, expires_at, created_at)
      VALUES ('recovery-session-1', $1, $2, $3, '2026-07-20T12:00:00.000Z', $4)`,
    [user, tenant, { csrfToken: 'synthetic' }, FIXED_TIME]);
    await client.query(`INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at)
      VALUES ('recovery-reset-token', $1, '2026-07-20T12:00:00.000Z', $2)`, [user, FIXED_TIME]);
    await client.query(`INSERT INTO email_verification_tokens (token_hash, user_id, expires_at, created_at)
      VALUES ('recovery-verification-token', $1, '2026-07-20T12:00:00.000Z', $2)`, [user, FIXED_TIME]);
    await client.query(`INSERT INTO rate_limit_buckets (bucket_key, window_start, request_count, expires_at, updated_at)
      VALUES ('recovery-rate-limit', $1, 3, '2026-07-20T12:00:00.000Z', $1)`, [FIXED_TIME]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function rowsFor(client, table) {
  const schema = BACKUP_TABLES.find((candidate) => candidate.name === table);
  const result = await client.query(`SELECT * FROM ${table} ORDER BY ${schema.orderBy}`);
  return result.rows;
}

async function verifyRestore(source, target) {
  const durableTables = backupTables();
  for (const table of durableTables) {
    const [expected, actual] = await Promise.all([
      rowsFor(source, table.name),
      rowsFor(target, table.name),
    ]);
    assert.deepEqual(actual, expected, `${table.name} did not restore exactly.`);
    console.log(`  ${table.name}: ${actual.length} row(s), exact match`);
  }

  for (const table of BACKUP_TABLES.filter((candidate) => candidate.volatile)) {
    const result = await target.query(`SELECT COUNT(*)::int AS count FROM ${table.name}`);
    assert.equal(result.rows[0].count, 0, `${table.name} should not be present in a standard restore.`);
  }

  await target.query('BEGIN');
  try {
    const importItem = await target.query(`INSERT INTO import_run_items
      (import_run_id, tenant_id, entity_type, status, created_at)
      VALUES ($1, $2, 'job', 'verified', $3) RETURNING id`,
    [SOURCE_IDS.importRun, SOURCE_IDS.tenant, FIXED_TIME]);
    const audit = await target.query(`INSERT INTO audit_log
      (tenant_id, action, created_at) VALUES ($1, 'recovery.sequence_verified', $2) RETURNING id`,
    [SOURCE_IDS.tenant, FIXED_TIME]);
    const message = await target.query(`INSERT INTO support_ticket_messages
      (ticket_id, tenant_id, author_type, body, created_at)
      VALUES ($1, $2, 'system', 'Sequence verified', $3) RETURNING id`,
    [SOURCE_IDS.ticket, SOURCE_IDS.tenant, FIXED_TIME]);
    const analytics = await target.query(`INSERT INTO analytics_events
      (visitor_id, event_type, created_at, day) VALUES ('sequence-check', 'recovery.sequence_verified', $1, '2026-07-19') RETURNING id`,
    [FIXED_TIME]);
    assert.ok(Number(importItem.rows[0].id) > 41);
    assert.ok(Number(audit.rows[0].id) > 42);
    assert.ok(Number(message.rows[0].id) > 43);
    assert.ok(Number(analytics.rows[0].id) > 44);
  } finally {
    await target.query('ROLLBACK');
  }
}

async function main() {
  const sourceUrl = process.env.RECOVERY_SOURCE_DATABASE_URL || process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('Set RECOVERY_SOURCE_DATABASE_URL to a fresh PostgreSQL database.');
  const source = new URL(sourceUrl);
  if (!LOOPBACK_HOSTS.has(source.hostname) && process.env.BD_RECOVERY_DRILL_ALLOW_REMOTE !== 'true') {
    throw new Error('Recovery drills refuse remote databases. Set BD_RECOVERY_DRILL_ALLOW_REMOTE=true only for an approved disposable target.');
  }
  const sourceName = databaseName(sourceUrl);
  if (!sourceName || sourceName === 'postgres') throw new Error('Recovery drill source must be a dedicated database.');
  const targetName = `bd_recovery_restore_${process.pid}`;
  const adminUrl = databaseUrl(sourceUrl, 'postgres');
  const targetUrl = databaseUrl(sourceUrl, targetName);
  const encryptionKey = `hex:${randomBytes(32).toString('hex')}`;
  const directory = await mkdtemp(join(tmpdir(), 'bd-recovery-drill-'));
  const backupFile = join(directory, 'recovery.json.gz.enc');
  const admin = new Client({ connectionString: adminUrl, ssl: sslConfig() });
  let targetCreated = false;

  console.log(`Recovery drill source: ${sourceName}`);
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quoteIdentifier(targetName)}`);
    targetCreated = true;

    await migrate(sourceUrl);
    const sourceClient = new Client({ connectionString: sourceUrl, ssl: sslConfig() });
    await sourceClient.connect();
    try {
      await assertEmptySource(sourceClient);
      await seedSource(sourceClient);
    } finally {
      await sourceClient.end();
    }

    await runNode(['scripts/backup.mjs', '--out', backupFile, '--require-encryption'], {
      DATABASE_URL: sourceUrl,
      BD_BACKUP_ENCRYPTION_KEY: encryptionKey,
      DB_SSL: process.env.DB_SSL || 'false',
    });
    await migrate(targetUrl);
    await runNode(['scripts/restore-backup.mjs', '--file', backupFile, '--apply'], {
      DATABASE_URL: targetUrl,
      BD_BACKUP_ENCRYPTION_KEY: encryptionKey,
      BD_RESTORE_CONFIRM: 'RESTORE',
      DB_SSL: process.env.DB_SSL || 'false',
    });

    const sourceVerification = new Client({ connectionString: sourceUrl, ssl: sslConfig() });
    const targetVerification = new Client({ connectionString: targetUrl, ssl: sslConfig() });
    await Promise.all([sourceVerification.connect(), targetVerification.connect()]);
    try {
      console.log('Verifying restored tables:');
      await verifyRestore(sourceVerification, targetVerification);
    } finally {
      await Promise.all([sourceVerification.end(), targetVerification.end()]);
    }
    console.log('Recovery drill passed: encrypted backup, transactional restore, data equality, exclusions, and sequences verified.');
  } finally {
    await closeDb().catch(() => {});
    if (targetCreated) {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(targetName)} WITH (FORCE)`).catch((error) => {
        console.error(`Could not remove disposable restore database: ${error.message}`);
      });
    }
    await admin.end().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('Recovery drill failed:', error.message);
  process.exit(1);
});
