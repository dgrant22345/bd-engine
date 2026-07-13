/**
 * BD Engine Cloud — PostgreSQL persistence layer.
 *
 * Uses PostgreSQL as a JSON document store to persist:
 *   - Users (id, email, password_hash, name, etc.)
 *   - Tenants (id, name, slug, plan, persona, etc.)
 *   - Memberships (tenant_id, user_id, role)
 *   - Tenant data (accounts, contacts, jobs, configs, activities as JSON)
 *
 * Falls back to pure in-memory mode when DATABASE_URL is not set.
 */

import pg from 'pg';

const { Pool } = pg;

let pool = null;
let dbReady = false;
const memoryStripeWebhookEvents = new Map();

// ── Connection ──────────────────────────────────────────────────────────────

export function isDbEnabled() {
  return !!process.env.DATABASE_URL;
}

export function isDbReady() {
  return dbReady;
}

export async function dbQuery(text, params = []) {
  if (!dbReady || !pool) return null;
  return pool.query(text, params);
}

async function runSchemaMigration(id, description, migrate) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [738260701]);
    const existing = await client.query('SELECT id FROM schema_migrations WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      await migrate(client);
      await client.query(
        'INSERT INTO schema_migrations (id, description, applied_at) VALUES ($1, $2, $3)',
        [id, description, new Date().toISOString()]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function initDb() {
  if (!isDbEnabled()) {
    console.log('  DB: No DATABASE_URL — running in-memory only');
    return false;
  }

  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: Math.max(1, Math.min(20, Number(process.env.BD_DB_POOL_MAX) || 5)),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });

    // Test connection
    const client = await pool.connect();
    client.release();

    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        email_verified_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'trial',
        status TEXT NOT NULL DEFAULT 'trialing',
        persona TEXT NOT NULL DEFAULT 'bd',
        storage_mode TEXT NOT NULL DEFAULT 'legacy',
        stripe_customer_id TEXT NOT NULL DEFAULT '',
        stripe_subscription_id TEXT NOT NULL DEFAULT '',
        billing_grace_ends_at TEXT NOT NULL DEFAULT '',
        billing_last_payment_failed_at TEXT NOT NULL DEFAULT '',
        referral_code TEXT NOT NULL DEFAULT '',
        referred_by_tenant_id TEXT NOT NULL DEFAULT '',
        referral_credited_at TEXT NOT NULL DEFAULT '',
        referral_credit_transaction_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memberships (
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS tenant_data (
        tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
        accounts JSONB NOT NULL DEFAULT '[]',
        contacts JSONB NOT NULL DEFAULT '[]',
        jobs JSONB NOT NULL DEFAULT '[]',
        configs JSONB NOT NULL DEFAULT '[]',
        activities JSONB NOT NULL DEFAULT '[]',
        tasks JSONB NOT NULL DEFAULT '[]',
        settings JSONB NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'pageview',
        path TEXT NOT NULL DEFAULT '/',
        referrer TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        tenant_id TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        day TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'processing',
        attempts INTEGER NOT NULL DEFAULT 1,
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        data JSONB NOT NULL DEFAULT '{}',
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);
      CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx ON password_reset_tokens (expires_at);

      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens (user_id);
      CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_idx ON email_verification_tokens (expires_at);

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL DEFAULT '',
        normalized_name TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        outreach_status TEXT NOT NULL DEFAULT 'not_started',
        target_score INTEGER NOT NULL DEFAULT 0,
        open_role_count INTEGER NOT NULL DEFAULT 0,
        next_action TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        raw JSONB NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id TEXT,
        full_name TEXT NOT NULL DEFAULT '',
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        linkedin_url TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        connected_on TEXT NOT NULL DEFAULT '',
        outreach_status TEXT NOT NULL DEFAULT 'not_started',
        priority_score INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        raw JSONB NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        ats_type TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        job_url TEXT NOT NULL DEFAULT '',
        posted_at TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        raw JSONB NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS board_configs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id TEXT,
        company_name TEXT NOT NULL DEFAULT '',
        normalized_company_name TEXT NOT NULL DEFAULT '',
        ats_type TEXT NOT NULL DEFAULT '',
        board_id TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL DEFAULT '',
        careers_url TEXT NOT NULL DEFAULT '',
        discovery_status TEXT NOT NULL DEFAULT '',
        review_status TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        raw JSONB NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id TEXT,
        contact_id TEXT,
        type TEXT NOT NULL DEFAULT 'note',
        summary TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL DEFAULT '',
        created_by_user_id TEXT,
        raw JSONB NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_id TEXT,
        contact_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT NOT NULL DEFAULT '',
        due_date TEXT NOT NULL DEFAULT '',
        raw JSONB NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);

    await pool.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_grace_ends_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_last_payment_failed_at TEXT NOT NULL DEFAULT '';
      UPDATE tenants
         SET billing_grace_ends_at = (NOW() + INTERVAL '7 days')::text
       WHERE status = 'past_due' AND billing_grace_ends_at = '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_code TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referred_by_tenant_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_credited_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_credit_transaction_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenant_data ADD COLUMN IF NOT EXISTS tasks JSONB DEFAULT '[]';
      -- Partial saves pass NULL for un-loaded sections and rely on COALESCE in
      -- the upsert to preserve existing data. But NOT NULL is checked on the
      -- INSERT tuple BEFORE ON CONFLICT arbitration, so those saves were
      -- rejected outright ("null value in column ... violates not-null"),
      -- silently losing imported jobs, activities and tasks. Drop NOT NULL so
      -- the COALESCE-preserve pattern actually works; dbLoadTenantData already
      -- coerces NULL to [].
      ALTER TABLE tenant_data ALTER COLUMN accounts DROP NOT NULL;
      ALTER TABLE tenant_data ALTER COLUMN contacts DROP NOT NULL;
      ALTER TABLE tenant_data ALTER COLUMN jobs DROP NOT NULL;
      ALTER TABLE tenant_data ALTER COLUMN configs DROP NOT NULL;
      ALTER TABLE tenant_data ALTER COLUMN activities DROP NOT NULL;
      ALTER TABLE tenant_data ALTER COLUMN tasks DROP NOT NULL;
      ALTER TABLE tenant_data ALTER COLUMN settings DROP NOT NULL;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS storage_mode TEXT NOT NULL DEFAULT 'legacy';
      CREATE UNIQUE INDEX IF NOT EXISTS tenants_referral_code_idx ON tenants (referral_code) WHERE referral_code <> '';
      CREATE INDEX IF NOT EXISTS analytics_events_day_idx ON analytics_events (day);
      CREATE INDEX IF NOT EXISTS analytics_events_visitor_idx ON analytics_events (visitor_id);
      CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events (created_at);
      CREATE INDEX IF NOT EXISTS stripe_webhook_events_status_updated_idx ON stripe_webhook_events (status, updated_at);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS normalized_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT '';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS industry TEXT NOT NULL DEFAULT '';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS outreach_status TEXT NOT NULL DEFAULT 'not_started';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS target_score INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS open_role_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS next_action TEXT NOT NULL DEFAULT '';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS account_id TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS connected_on TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS outreach_status TEXT NOT NULL DEFAULT 'not_started';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS priority_score INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS account_id TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ats_type TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS account_id TEXT;
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS company_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS normalized_company_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS ats_type TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS board_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS careers_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS discovery_status TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS account_id TEXT;
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS contact_id TEXT;
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'note';
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '';
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS occurred_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE activities ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS account_id TEXT;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS contact_id TEXT;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS accounts_tenant_updated_idx ON accounts (tenant_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS contacts_tenant_updated_idx ON contacts (tenant_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS jobs_tenant_updated_idx ON jobs (tenant_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS board_configs_tenant_updated_idx ON board_configs (tenant_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS activities_tenant_updated_idx ON activities (tenant_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS tasks_tenant_updated_idx ON tasks (tenant_id, updated_at, id);
    `);

    await runSchemaMigration('20260707_persistence_foundation', 'Add audit/import durability, identity keys, and query indexes', async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS import_runs (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          run_type TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'started',
          source TEXT NOT NULL DEFAULT '',
          source_hash TEXT NOT NULL DEFAULT '',
          started_at TEXT NOT NULL,
          completed_at TEXT NOT NULL DEFAULT '',
          rows_total INTEGER NOT NULL DEFAULT 0,
          rows_created INTEGER NOT NULL DEFAULT 0,
          rows_updated INTEGER NOT NULL DEFAULT 0,
          rows_skipped INTEGER NOT NULL DEFAULT 0,
          rows_failed INTEGER NOT NULL DEFAULT 0,
          warnings JSONB NOT NULL DEFAULT '[]',
          errors JSONB NOT NULL DEFAULT '[]',
          metadata JSONB NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS import_run_items (
          id BIGSERIAL PRIMARY KEY,
          import_run_id TEXT REFERENCES import_runs(id) ON DELETE CASCADE,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          entity_type TEXT NOT NULL DEFAULT '',
          entity_id TEXT NOT NULL DEFAULT '',
          natural_key TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          source_row JSONB NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_log (
          id BIGSERIAL PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          actor_user_id TEXT NOT NULL DEFAULT '',
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL DEFAULT '',
          entity_id TEXT NOT NULL DEFAULT '',
          before JSONB,
          after JSONB,
          metadata JSONB NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );

        ALTER TABLE accounts ADD COLUMN IF NOT EXISTS identity_key TEXT NOT NULL DEFAULT '';
        ALTER TABLE accounts ADD COLUMN IF NOT EXISTS canonical_domain TEXT NOT NULL DEFAULT '';

        ALTER TABLE contacts ADD COLUMN IF NOT EXISTS identity_key TEXT NOT NULL DEFAULT '';
        ALTER TABLE contacts ADD COLUMN IF NOT EXISTS normalized_email TEXT NOT NULL DEFAULT '';
        ALTER TABLE contacts ADD COLUMN IF NOT EXISTS canonical_linkedin_url TEXT NOT NULL DEFAULT '';

        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS natural_key TEXT NOT NULL DEFAULT '';
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS first_seen_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_seen_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS closed_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE jobs ADD COLUMN IF NOT EXISTS import_run_id TEXT NOT NULL DEFAULT '';

        ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS identity_key TEXT NOT NULL DEFAULT '';
        ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS resolved_board_url TEXT NOT NULL DEFAULT '';
        ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS last_checked_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS last_imported_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS last_import_status TEXT NOT NULL DEFAULT '';
        ALTER TABLE board_configs ADD COLUMN IF NOT EXISTS last_import_error TEXT NOT NULL DEFAULT '';

        CREATE INDEX IF NOT EXISTS accounts_tenant_score_idx ON accounts (tenant_id, target_score DESC, updated_at DESC, id);
        CREATE INDEX IF NOT EXISTS accounts_tenant_identity_idx ON accounts (tenant_id, identity_key) WHERE identity_key <> '';
        CREATE INDEX IF NOT EXISTS accounts_tenant_normalized_idx ON accounts (tenant_id, normalized_name) WHERE normalized_name <> '';
        CREATE INDEX IF NOT EXISTS accounts_tenant_domain_idx ON accounts (tenant_id, canonical_domain) WHERE canonical_domain <> '';

        CREATE INDEX IF NOT EXISTS contacts_tenant_account_priority_idx ON contacts (tenant_id, account_id, priority_score DESC, updated_at DESC, id);
        CREATE INDEX IF NOT EXISTS contacts_tenant_identity_idx ON contacts (tenant_id, identity_key) WHERE identity_key <> '';
        CREATE INDEX IF NOT EXISTS contacts_tenant_email_idx ON contacts (tenant_id, normalized_email) WHERE normalized_email <> '';
        CREATE INDEX IF NOT EXISTS contacts_tenant_linkedin_idx ON contacts (tenant_id, canonical_linkedin_url) WHERE canonical_linkedin_url <> '';

        CREATE INDEX IF NOT EXISTS jobs_tenant_posted_idx ON jobs (tenant_id, active, posted_at DESC, updated_at DESC, id);
        CREATE INDEX IF NOT EXISTS jobs_tenant_account_posted_idx ON jobs (tenant_id, account_id, posted_at DESC, updated_at DESC, id);
        CREATE INDEX IF NOT EXISTS jobs_tenant_natural_key_idx ON jobs (tenant_id, natural_key) WHERE natural_key <> '';
        CREATE INDEX IF NOT EXISTS jobs_tenant_import_run_idx ON jobs (tenant_id, import_run_id) WHERE import_run_id <> '';

        CREATE INDEX IF NOT EXISTS board_configs_tenant_status_idx ON board_configs (tenant_id, discovery_status, active);
        CREATE INDEX IF NOT EXISTS board_configs_tenant_identity_idx ON board_configs (tenant_id, identity_key) WHERE identity_key <> '';
        CREATE INDEX IF NOT EXISTS board_configs_tenant_board_idx ON board_configs (tenant_id, normalized_company_name, ats_type, board_id) WHERE board_id <> '';
        CREATE INDEX IF NOT EXISTS board_configs_tenant_checked_idx ON board_configs (tenant_id, last_checked_at DESC, id);

        CREATE INDEX IF NOT EXISTS activities_tenant_account_time_idx ON activities (tenant_id, account_id, occurred_at DESC, id);
        CREATE INDEX IF NOT EXISTS tasks_tenant_due_idx ON tasks (tenant_id, status, due_date ASC, updated_at DESC, id);

        CREATE INDEX IF NOT EXISTS import_runs_tenant_started_idx ON import_runs (tenant_id, started_at DESC, id);
        CREATE INDEX IF NOT EXISTS import_runs_tenant_hash_idx ON import_runs (tenant_id, run_type, source_hash) WHERE source_hash <> '';
        CREATE INDEX IF NOT EXISTS import_run_items_run_idx ON import_run_items (import_run_id, status);
        CREATE INDEX IF NOT EXISTS import_run_items_tenant_key_idx ON import_run_items (tenant_id, entity_type, natural_key) WHERE natural_key <> '';
        CREATE INDEX IF NOT EXISTS audit_log_tenant_entity_idx ON audit_log (tenant_id, entity_type, entity_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS audit_log_tenant_action_idx ON audit_log (tenant_id, action, created_at DESC);
      `);
    });

    await runSchemaMigration('20260711_background_job_snapshots', 'Persist tenant-scoped background job status', async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS background_jobs (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          type TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'queued',
          snapshot JSONB NOT NULL DEFAULT '{}',
          queued_at TEXT NOT NULL DEFAULT '',
          started_at TEXT NOT NULL DEFAULT '',
          finished_at TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS background_jobs_tenant_updated_idx
          ON background_jobs (tenant_id, updated_at DESC, id);
      `);
    });

    await runSchemaMigration('20260711_stripe_webhook_idempotency', 'Track Stripe webhook processing and retries', async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS stripe_webhook_events (
          event_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'processing',
          attempts INTEGER NOT NULL DEFAULT 1,
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          processed_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS stripe_webhook_events_status_updated_idx
          ON stripe_webhook_events (status, updated_at);
      `);
    });

    await runSchemaMigration('20260713_email_verification', 'Add advisory email verification lifecycle', async (client) => {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TEXT NOT NULL DEFAULT '';
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          used_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens (user_id);
        CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_idx ON email_verification_tokens (expires_at);
      `);
    });

    dbReady = true;
    console.log('  DB: PostgreSQL connected and tables ready');
    return true;
  } catch (err) {
    console.error('  DB: PostgreSQL connection failed, falling back to in-memory:', err.message);
    pool = null;
    return false;
  }
}

// ── User persistence ────────────────────────────────────────────────────────

export async function dbClaimStripeWebhook(eventId, eventType = '') {
  if (!eventId) return { acquired: false, reason: 'missing_event_id' };
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  if (!dbReady) {
    const existing = memoryStripeWebhookEvents.get(eventId);
    const stale = existing?.status === 'processing' && existing.updatedAt < staleBefore;
    if (existing && existing.status !== 'failed' && !stale) {
      return { acquired: false, duplicate: true, status: existing.status };
    }
    const attempts = Number(existing?.attempts || 0) + 1;
    memoryStripeWebhookEvents.set(eventId, { eventType, status: 'processing', attempts, updatedAt: now });
    return { acquired: true, attempts, storage: 'memory' };
  }

  const result = await pool.query(
    `INSERT INTO stripe_webhook_events (event_id, event_type, status, attempts, error, created_at, updated_at, processed_at)
     VALUES ($1, $2, 'processing', 1, '', $3, $3, '')
     ON CONFLICT (event_id) DO UPDATE SET
       event_type = EXCLUDED.event_type,
       status = 'processing',
       attempts = stripe_webhook_events.attempts + 1,
       error = '',
       updated_at = EXCLUDED.updated_at
     WHERE stripe_webhook_events.status = 'failed'
        OR (stripe_webhook_events.status = 'processing' AND stripe_webhook_events.updated_at < $4)
     RETURNING attempts`,
    [eventId, eventType, now, staleBefore]
  );
  return result.rowCount
    ? { acquired: true, attempts: Number(result.rows[0].attempts || 1), storage: 'postgres' }
    : { acquired: false, duplicate: true };
}

export async function dbCompleteStripeWebhook(eventId) {
  const now = new Date().toISOString();
  if (!dbReady) {
    const existing = memoryStripeWebhookEvents.get(eventId) || {};
    memoryStripeWebhookEvents.set(eventId, { ...existing, status: 'completed', error: '', updatedAt: now, processedAt: now });
    return;
  }
  await pool.query(
    `UPDATE stripe_webhook_events
     SET status = 'completed', error = '', updated_at = $2, processed_at = $2
     WHERE event_id = $1`,
    [eventId, now]
  );
}

export async function dbFailStripeWebhook(eventId, error) {
  const now = new Date().toISOString();
  const message = String(error?.message || error || 'Webhook processing failed').slice(0, 1000);
  if (!dbReady) {
    const existing = memoryStripeWebhookEvents.get(eventId) || {};
    memoryStripeWebhookEvents.set(eventId, { ...existing, status: 'failed', error: message, updatedAt: now });
    return;
  }
  await pool.query(
    `UPDATE stripe_webhook_events
     SET status = 'failed', error = $2, updated_at = $3
     WHERE event_id = $1`,
    [eventId, message, now]
  );
}

export async function dbSaveUser(user) {
  if (!dbReady) return;
  try {
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, status, email_verified_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         status = EXCLUDED.status,
         email_verified_at = EXCLUDED.email_verified_at,
         updated_at = EXCLUDED.updated_at`,
      [user.id, user.email, user.name, user.passwordHash, user.status, user.emailVerifiedAt || '', user.createdAt, user.updatedAt]
    );
  } catch (err) {
    console.error('DB: Failed to save user:', err.message);
  }
}

export async function dbLoadAllUsers() {
  if (!dbReady) return [];
  try {
    const { rows } = await pool.query('SELECT * FROM users');
    return rows.map(r => ({
      id: r.id,
      email: r.email,
      name: r.name,
      passwordHash: r.password_hash,
      status: r.status,
      emailVerifiedAt: r.email_verified_at || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  } catch (err) {
    console.error('DB: Failed to load users:', err.message);
    return [];
  }
}

// ── Tenant persistence ──────────────────────────────────────────────────────

export async function dbSaveTenant(tenant) {
  if (!dbReady) return;
  try {
    await pool.query(
      `INSERT INTO tenants (id, slug, name, plan, status, persona, storage_mode, stripe_customer_id, stripe_subscription_id, billing_grace_ends_at, billing_last_payment_failed_at, referral_code, referred_by_tenant_id, referral_credited_at, referral_credit_transaction_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         name = EXCLUDED.name,
         plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         persona = EXCLUDED.persona,
         storage_mode = EXCLUDED.storage_mode,
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         billing_grace_ends_at = EXCLUDED.billing_grace_ends_at,
         billing_last_payment_failed_at = EXCLUDED.billing_last_payment_failed_at,
         referral_code = EXCLUDED.referral_code,
         referred_by_tenant_id = EXCLUDED.referred_by_tenant_id,
         referral_credited_at = EXCLUDED.referral_credited_at,
         referral_credit_transaction_id = EXCLUDED.referral_credit_transaction_id,
         updated_at = EXCLUDED.updated_at`,
      [
        tenant.id,
        tenant.slug,
        tenant.name,
        tenant.plan,
        tenant.status,
        tenant.persona || 'bd',
        tenant.storageMode || tenant.storage_mode || 'legacy',
        tenant.stripeCustomerId || tenant.stripe_customer_id || '',
        tenant.stripeSubscriptionId || tenant.stripe_subscription_id || '',
        tenant.billingGraceEndsAt || tenant.billing_grace_ends_at || '',
        tenant.billingLastPaymentFailedAt || tenant.billing_last_payment_failed_at || '',
        tenant.referralCode || tenant.referral_code || '',
        tenant.referredByTenantId || tenant.referred_by_tenant_id || '',
        tenant.referralCreditedAt || tenant.referral_credited_at || '',
        tenant.referralCreditTransactionId || tenant.referral_credit_transaction_id || '',
        tenant.createdAt,
        tenant.updatedAt,
      ]
    );
  } catch (err) {
    console.error('DB: Failed to save tenant:', err.message);
    throw err;
  }
}

export async function dbLoadAllTenants() {
  if (!dbReady) return [];
  try {
    const { rows } = await pool.query('SELECT * FROM tenants');
    return rows.map(r => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      plan: r.plan,
      status: r.status,
      persona: r.persona,
      storageMode: r.storage_mode || 'legacy',
      stripeCustomerId: r.stripe_customer_id || '',
      stripeSubscriptionId: r.stripe_subscription_id || '',
      billingGraceEndsAt: r.billing_grace_ends_at || '',
      billingLastPaymentFailedAt: r.billing_last_payment_failed_at || '',
      referralCode: r.referral_code || '',
      referredByTenantId: r.referred_by_tenant_id || '',
      referralCreditedAt: r.referral_credited_at || '',
      referralCreditTransactionId: r.referral_credit_transaction_id || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  } catch (err) {
    console.error('DB: Failed to load tenants:', err.message);
    return [];
  }
}

// ── Membership persistence ──────────────────────────────────────────────────

export async function dbSaveMembership(m) {
  if (!dbReady) return;
  try {
    await pool.query(
      `INSERT INTO memberships (tenant_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [m.tenantId, m.userId, m.role, m.createdAt]
    );
  } catch (err) {
    console.error('DB: Failed to save membership:', err.message);
  }
}

export async function dbLoadAllMemberships() {
  if (!dbReady) return [];
  try {
    const { rows } = await pool.query('SELECT * FROM memberships');
    return rows.map(r => ({
      tenantId: r.tenant_id,
      userId: r.user_id,
      role: r.role,
      createdAt: r.created_at,
    }));
  } catch (err) {
    console.error('DB: Failed to load memberships:', err.message);
    return [];
  }
}

// ── Tenant data persistence (accounts, contacts, jobs, etc.) ────────────────

export async function dbSaveTenantData(tenantId, data, { throwOnError = false } = {}) {
  if (!dbReady) return { saved: false, reason: 'database_not_ready' };
  try {
    // Only stringify if provided, otherwise pass null to trigger COALESCE in SQL
    const s = (v) => (v === undefined || v === null) ? null : JSON.stringify(v);

    await pool.query(
      `INSERT INTO tenant_data (tenant_id, accounts, contacts, jobs, configs, activities, tasks, settings, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE SET
         accounts = COALESCE(EXCLUDED.accounts, tenant_data.accounts),
         contacts = COALESCE(EXCLUDED.contacts, tenant_data.contacts),
         jobs = COALESCE(EXCLUDED.jobs, tenant_data.jobs),
         configs = COALESCE(EXCLUDED.configs, tenant_data.configs),
         activities = COALESCE(EXCLUDED.activities, tenant_data.activities),
         tasks = COALESCE(EXCLUDED.tasks, tenant_data.tasks),
         settings = COALESCE(EXCLUDED.settings, tenant_data.settings),
         updated_at = EXCLUDED.updated_at`,
      [
        tenantId,
        s(data.accounts),
        s(data.contacts),
        s(data.jobs),
        s(data.configs),
        s(data.activities),
        s(data.tasks),
        s(data.settings),
        new Date().toISOString(),
      ]
    );
    return { saved: true };
  } catch (err) {
    console.error('DB: Failed to save tenant data for', tenantId, ':', err.message);
    if (throwOnError) throw err;
    return { saved: false, reason: err.message };
  }
}

export async function dbLoadTenantData(tenantId, includeContacts = true) {
  if (!dbReady) return null;
  try {
    const columns = includeContacts
      ? 'accounts, contacts, jobs, configs, activities, tasks, settings, updated_at'
      : 'accounts, jobs, configs, activities, tasks, settings, updated_at';

    const result = await pool.query(`SELECT ${columns} FROM tenant_data WHERE tenant_id = $1`, [tenantId]);
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      accounts: r.accounts || [],
      contacts: r.contacts || [],
      jobs: r.jobs || [],
      configs: r.configs || [],
      activities: r.activities || [],
      tasks: r.tasks || [],
      settings: r.settings || {},
      updated_at: r.updated_at,
    };
  } catch (err) {
    console.error('DB: Failed to load tenant data:', err.message);
    return null;
  }
}

export async function dbLoadTenantSettings(tenantId) {
  if (!dbReady) return null;
  try {
    const result = await pool.query('SELECT settings FROM tenant_data WHERE tenant_id = $1', [tenantId]);
    return result.rows[0]?.settings || {};
  } catch (err) {
    console.error('DB: Failed to load tenant settings:', err.message);
    return null;
  }
}

export async function dbRecordImportRun(run = {}) {
  if (!dbReady || !run.id || !run.tenantId) return { recorded: false };
  try {
    await pool.query(
      `INSERT INTO import_runs (id, tenant_id, run_type, status, source, source_hash, started_at, completed_at, rows_total, rows_created, rows_updated, rows_skipped, rows_failed, warnings, errors, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         completed_at = EXCLUDED.completed_at,
         rows_total = EXCLUDED.rows_total,
         rows_created = EXCLUDED.rows_created,
         rows_updated = EXCLUDED.rows_updated,
         rows_skipped = EXCLUDED.rows_skipped,
         rows_failed = EXCLUDED.rows_failed,
         warnings = EXCLUDED.warnings,
         errors = EXCLUDED.errors,
         metadata = EXCLUDED.metadata`,
      [
        run.id,
        run.tenantId,
        run.runType || run.type || '',
        run.status || 'started',
        run.source || '',
        run.sourceHash || '',
        run.startedAt || new Date().toISOString(),
        run.completedAt || '',
        Number(run.rowsTotal || 0),
        Number(run.rowsCreated || 0),
        Number(run.rowsUpdated || 0),
        Number(run.rowsSkipped || 0),
        Number(run.rowsFailed || 0),
        JSON.stringify(run.warnings || []),
        JSON.stringify(run.errors || []),
        JSON.stringify(run.metadata || {}),
      ]
    );

    if (Array.isArray(run.items) && run.items.length) {
      for (const item of run.items.slice(0, 2000)) {
        await pool.query(
          `INSERT INTO import_run_items (import_run_id, tenant_id, entity_type, entity_id, natural_key, status, message, source_row, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            run.id,
            run.tenantId,
            item.entityType || '',
            item.entityId || '',
            item.naturalKey || '',
            item.status || '',
            item.message || '',
            JSON.stringify(item.sourceRow || {}),
            item.createdAt || new Date().toISOString(),
          ]
        );
      }
    }
    return { recorded: true };
  } catch (err) {
    console.error('DB: Failed to record import run:', err.message);
    return { recorded: false, reason: err.message };
  }
}

export async function dbGetImportUsageCount(tenantId, runType = 'linkedin_csv') {
  if (!dbReady || !tenantId) return 0;
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM import_runs
       WHERE tenant_id = $1
         AND run_type = $2
         AND status IN ('completed', 'completed_with_warnings')`,
      [tenantId, runType]
    );
    return Number(result.rows[0]?.count || 0);
  } catch (err) {
    console.error('DB: Failed to count import usage:', err.message);
    return 0;
  }
}

export async function dbRecordAuditLog(entry = {}) {
  if (!dbReady || !entry.tenantId || !entry.action) return { recorded: false };
  try {
    await pool.query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, before, after, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        entry.tenantId,
        entry.actorUserId || '',
        entry.action,
        entry.entityType || '',
        entry.entityId || '',
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        JSON.stringify(entry.metadata || {}),
        entry.createdAt || new Date().toISOString(),
      ]
    );
    return { recorded: true };
  } catch (err) {
    console.error('DB: Failed to record audit log:', err.message);
    return { recorded: false, reason: err.message };
  }
}

export async function dbSaveBackgroundJob(tenantId, job = {}) {
  if (!dbReady || !tenantId || !job.id) return { recorded: false };
  const updatedAt = job.updatedAt || job.finishedAt || job.startedAt || job.queuedAt || new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO background_jobs (id, tenant_id, type, status, snapshot, queued_at, started_at, finished_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         type = EXCLUDED.type,
         status = EXCLUDED.status,
         snapshot = EXCLUDED.snapshot,
         queued_at = EXCLUDED.queued_at,
         started_at = EXCLUDED.started_at,
         finished_at = EXCLUDED.finished_at,
         updated_at = EXCLUDED.updated_at`,
      [
        job.id,
        tenantId,
        job.type || '',
        job.status || 'queued',
        JSON.stringify(job),
        job.queuedAt || '',
        job.startedAt || '',
        job.finishedAt || '',
        updatedAt,
      ]
    );
    return { recorded: true };
  } catch (err) {
    console.error('DB: Failed to save background job:', err.message);
    return { recorded: false, reason: err.message };
  }
}

export async function dbLoadBackgroundJob(tenantId, jobId) {
  if (!dbReady || !tenantId || !jobId) return null;
  try {
    const result = await pool.query(
      'SELECT snapshot FROM background_jobs WHERE tenant_id = $1 AND id = $2',
      [tenantId, jobId]
    );
    return result.rows[0]?.snapshot || null;
  } catch (err) {
    console.error('DB: Failed to load background job:', err.message);
    return null;
  }
}

export async function dbLoadRecentBackgroundJobs(tenantId, limit = 20) {
  if (!dbReady || !tenantId) return [];
  try {
    const result = await pool.query(
      `SELECT snapshot
       FROM background_jobs
       WHERE tenant_id = $1
       ORDER BY updated_at DESC, id DESC
       LIMIT $2`,
      [tenantId, Math.max(1, Math.min(100, Number(limit) || 20))]
    );
    return result.rows.map((row) => row.snapshot || {}).filter((job) => job.id);
  } catch (err) {
    console.error('DB: Failed to load recent background jobs:', err.message);
    return [];
  }
}

export async function dbLoadRecoverableBackgroundJobs(limit = 50, { throwOnError = false } = {}) {
  if (!dbReady) return [];
  try {
    const result = await pool.query(
      `SELECT tenant_id, snapshot
       FROM background_jobs
       WHERE status IN ('queued', 'running')
       ORDER BY updated_at ASC, id ASC
       LIMIT $1`,
      [Math.max(1, Math.min(500, Number(limit) || 50))]
    );
    return result.rows.map((row) => ({
      ...(row.snapshot || {}),
      tenantId: row.tenant_id,
    }));
  } catch (err) {
    console.error('DB: Failed to load recoverable background jobs:', err.message);
    if (throwOnError) throw err;
    return [];
  }
}

export async function dbGetTenantDataStats(tenantId) {
  if (!dbReady) return null;
  const startedAt = Date.now();
  try {
    const result = await pool.query(
      `SELECT
         CASE WHEN jsonb_typeof(accounts) = 'array' THEN jsonb_array_length(accounts) ELSE 0 END AS account_count,
         CASE WHEN jsonb_typeof(contacts) = 'array' THEN jsonb_array_length(contacts) ELSE 0 END AS contact_count,
         CASE WHEN jsonb_typeof(jobs) = 'array' THEN jsonb_array_length(jobs) ELSE 0 END AS job_count,
         CASE WHEN jsonb_typeof(configs) = 'array' THEN jsonb_array_length(configs) ELSE 0 END AS config_count,
         CASE WHEN jsonb_typeof(activities) = 'array' THEN jsonb_array_length(activities) ELSE 0 END AS activity_count,
         CASE WHEN jsonb_typeof(tasks) = 'array' THEN jsonb_array_length(tasks) ELSE 0 END AS task_count,
         updated_at
       FROM tenant_data
       WHERE tenant_id = $1`,
      [tenantId]
    );
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > 250) {
      console.warn(`Slow tenant data stats: saas/src/db.js dbGetTenantDataStats ${elapsedMs}ms`);
    }
    if (result.rows.length === 0) {
      return {
        accountCount: 0,
        contactCount: 0,
        jobCount: 0,
        configCount: 0,
        activityCount: 0,
        taskCount: 0,
        updatedAt: '',
        queryMs: elapsedMs,
      };
    }
    const row = result.rows[0];
    return {
      accountCount: Number(row.account_count || 0),
      contactCount: Number(row.contact_count || 0),
      jobCount: Number(row.job_count || 0),
      configCount: Number(row.config_count || 0),
      activityCount: Number(row.activity_count || 0),
      taskCount: Number(row.task_count || 0),
      updatedAt: row.updated_at || '',
      queryMs: elapsedMs,
    };
  } catch (err) {
    console.error('DB: Failed to load tenant data stats:', err.message);
    return null;
  }
}

export async function dbLoadAllTenantData() {
  if (!dbReady) return new Map();
  try {
    const { rows } = await pool.query('SELECT * FROM tenant_data');
    const result = new Map();
    for (const r of rows) {
      result.set(r.tenant_id, {
        accounts: r.accounts || [],
        contacts: r.contacts || [],
        jobs: r.jobs || [],
        configs: r.configs || [],
        activities: r.activities || [],
        tasks: r.tasks || [],
        settings: r.settings || {},
      });
    }
    return result;
  } catch (err) {
    console.error('DB: Failed to load tenant data:', err.message);
    return new Map();
  }
}

// ── First-party analytics ───────────────────────────────────────────────────

const memoryAnalyticsEvents = [];

export async function dbRecordAnalyticsVisit(event) {
  const payload = normalizeAnalyticsEvent(event);
  if (!payload.visitorId) return { recorded: false, reason: 'missing visitor id' };

  if (!dbReady) {
    memoryAnalyticsEvents.push(payload);
    return { recorded: true, storage: 'memory' };
  }

  try {
    await pool.query(
      `INSERT INTO analytics_events (visitor_id, event_type, path, referrer, source, tenant_id, user_id, created_at, day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        payload.visitorId,
        payload.eventType,
        payload.path,
        payload.referrer,
        payload.source,
        payload.tenantId,
        payload.userId,
        payload.createdAt,
        payload.day,
      ]
    );
    return { recorded: true, storage: 'postgres' };
  } catch (err) {
    console.error('DB: Failed to record analytics visit:', err.message);
    return { recorded: false, reason: err.message };
  }
}

export async function dbGetAnalyticsSummary(days = 30) {
  const lookbackDays = Math.max(1, Math.min(365, Number(days) || 30));
  const since = new Date(Date.now() - (lookbackDays - 1) * 24 * 60 * 60 * 1000);
  const sinceDay = since.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  if (!dbReady) {
    return summarizeAnalyticsRows(memoryAnalyticsEvents, sinceDay, today);
  }

  try {
    const [totals, recent, byDay, topPaths, topSources] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS visits, COUNT(DISTINCT visitor_id)::int AS visitors FROM analytics_events`),
      pool.query(
        `SELECT
           COUNT(*)::int AS visits,
           COUNT(DISTINCT visitor_id)::int AS visitors,
           COUNT(*) FILTER (WHERE day = $2)::int AS visits_today,
           COUNT(DISTINCT visitor_id) FILTER (WHERE day = $2)::int AS visitors_today
         FROM analytics_events
         WHERE day >= $1`,
        [sinceDay, today]
      ),
      pool.query(
        `SELECT day, COUNT(*)::int AS visits, COUNT(DISTINCT visitor_id)::int AS visitors
         FROM analytics_events
         WHERE day >= $1
         GROUP BY day
         ORDER BY day ASC`,
        [sinceDay]
      ),
      pool.query(
        `SELECT path, COUNT(*)::int AS visits, COUNT(DISTINCT visitor_id)::int AS visitors
         FROM analytics_events
         WHERE day >= $1
         GROUP BY path
         ORDER BY visits DESC
         LIMIT 8`,
        [sinceDay]
      ),
      pool.query(
        `SELECT source, COUNT(*)::int AS visits, COUNT(DISTINCT visitor_id)::int AS visitors
         FROM analytics_events
         WHERE day >= $1
         GROUP BY source
         ORDER BY visits DESC
         LIMIT 8`,
        [sinceDay]
      ),
    ]);

    return {
      lookbackDays,
      totals: {
        visits: totals.rows[0]?.visits || 0,
        visitors: totals.rows[0]?.visitors || 0,
      },
      recent: {
        visits: recent.rows[0]?.visits || 0,
        visitors: recent.rows[0]?.visitors || 0,
        visitsToday: recent.rows[0]?.visits_today || 0,
        visitorsToday: recent.rows[0]?.visitors_today || 0,
      },
      byDay: byDay.rows.map((row) => ({ day: row.day, visits: row.visits, visitors: row.visitors })),
      topPaths: topPaths.rows.map((row) => ({ path: row.path || '/', visits: row.visits, visitors: row.visitors })),
      topSources: topSources.rows.map((row) => ({ source: row.source || 'direct', visits: row.visits, visitors: row.visitors })),
    };
  } catch (err) {
    console.error('DB: Failed to load analytics summary:', err.message);
    return summarizeAnalyticsRows(memoryAnalyticsEvents, sinceDay, today);
  }
}

function normalizeAnalyticsEvent(event = {}) {
  const createdAt = new Date().toISOString();
  return {
    visitorId: String(event.visitorId || '').trim().slice(0, 96),
    eventType: String(event.eventType || 'pageview').trim().slice(0, 32) || 'pageview',
    path: sanitizeAnalyticsPath(event.path),
    referrer: sanitizeAnalyticsReferrer(event.referrer),
    source: sanitizeAnalyticsSource(event.source),
    tenantId: String(event.tenantId || '').trim().slice(0, 96),
    userId: String(event.userId || '').trim().slice(0, 96),
    createdAt,
    day: createdAt.slice(0, 10),
  };
}

function sanitizeAnalyticsPath(value) {
  const raw = String(value || '/').trim() || '/';
  try {
    const url = new URL(raw, 'https://bd-engine.local');
    return `${url.pathname || '/'}${url.hash || ''}`.slice(0, 240);
  } catch {
    return raw.split('?')[0].slice(0, 240) || '/';
  }
}

function sanitizeAnalyticsReferrer(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname || ''}`.slice(0, 240);
  } catch {
    return raw.split('?')[0].slice(0, 240);
  }
}

function sanitizeAnalyticsSource(value) {
  const normalized = String(value || 'direct').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
  return (normalized || 'direct').slice(0, 80);
}

function summarizeAnalyticsRows(rows, sinceDay, today) {
  const recentRows = rows.filter((row) => row.day >= sinceDay);
  const unique = (items) => new Set(items.map((row) => row.visitorId)).size;
  const byDayMap = new Map();
  const pathMap = new Map();
  const sourceMap = new Map();

  for (const row of recentRows) {
    if (!byDayMap.has(row.day)) byDayMap.set(row.day, []);
    byDayMap.get(row.day).push(row);
    const pathRows = pathMap.get(row.path) || [];
    pathRows.push(row);
    pathMap.set(row.path, pathRows);
    const sourceRows = sourceMap.get(row.source) || [];
    sourceRows.push(row);
    sourceMap.set(row.source, sourceRows);
  }

  return {
    lookbackDays: Math.max(1, Math.round((Date.now() - Date.parse(`${sinceDay}T00:00:00Z`)) / (24 * 60 * 60 * 1000)) + 1),
    totals: { visits: rows.length, visitors: unique(rows) },
    recent: {
      visits: recentRows.length,
      visitors: unique(recentRows),
      visitsToday: recentRows.filter((row) => row.day === today).length,
      visitorsToday: unique(recentRows.filter((row) => row.day === today)),
    },
    byDay: Array.from(byDayMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([day, dayRows]) => ({ day, visits: dayRows.length, visitors: unique(dayRows) })),
    topPaths: summarizeAnalyticsGroup(pathMap, 'path'),
    topSources: summarizeAnalyticsGroup(sourceMap, 'source'),
  };
}

function summarizeAnalyticsGroup(groupMap, key) {
  return Array.from(groupMap.entries())
    .map(([name, rows]) => ({ [key]: name || (key === 'source' ? 'direct' : '/'), visits: rows.length, visitors: new Set(rows.map((row) => row.visitorId)).size }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 8);
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function dbSaveSession(session) {
  if (!dbReady) return;
  try {
    const { id, userId, tenantId, createdAt, expiresAt, ...extra } = session;
    await pool.query(
      `INSERT INTO sessions (id, user_id, tenant_id, data, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         tenant_id = EXCLUDED.tenant_id,
         data = EXCLUDED.data,
         expires_at = EXCLUDED.expires_at`,
      [id, userId, tenantId || null, JSON.stringify(extra || {}), expiresAt, createdAt]
    );
  } catch (err) {
    console.error('DB: Failed to save session:', err.message);
  }
}

export async function dbDeleteSession(sessionId) {
  if (!dbReady) return;
  try {
    await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  } catch (err) {
    console.error('DB: Failed to delete session:', err.message);
  }
}

export async function dbLoadActiveSessions() {
  if (!dbReady) return [];
  try {
    // Opportunistically purge expired rows, then return the live ones.
    await pool.query('DELETE FROM sessions WHERE expires_at < $1', [new Date().toISOString()]);
    const { rows } = await pool.query('SELECT id, user_id, tenant_id, data, expires_at, created_at FROM sessions');
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      tenantId: r.tenant_id || undefined,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      ...(r.data && typeof r.data === 'object' ? r.data : {}),
    }));
  } catch (err) {
    console.error('DB: Failed to load sessions:', err.message);
    return [];
  }
}

// ── Shutdown ────────────────────────────────────────────────────────────────

export async function dbSavePasswordResetToken(record) {
  if (!dbReady) return;
  try {
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1 OR expires_at < $2 OR used_at <> $3', [
      record.userId,
      new Date().toISOString(),
      '',
    ]);
    await pool.query(
      `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [record.tokenHash, record.userId, record.expiresAt, record.usedAt || '', record.createdAt]
    );
  } catch (err) {
    console.error('DB: Failed to save password reset token:', err.message);
  }
}

export async function dbCheckRelationalCountParity(excludedTenantIds = []) {
  if (!dbReady) return null;
  const startedAt = Date.now();
  const excluded = Array.isArray(excludedTenantIds) ? excludedTenantIds.filter(Boolean) : [];
  const result = await pool.query(`
    SELECT td.tenant_id
    FROM tenant_data td
    WHERE NOT (td.tenant_id = ANY($1::text[]))
      AND COALESCE((SELECT storage_mode FROM tenants WHERE id = td.tenant_id), 'legacy') <> 'relational'
      AND (
      CASE WHEN jsonb_typeof(td.accounts) = 'array' THEN jsonb_array_length(td.accounts) ELSE 0 END
        <> (SELECT COUNT(*)::int FROM accounts r WHERE r.tenant_id = td.tenant_id)
      OR CASE WHEN jsonb_typeof(td.contacts) = 'array' THEN jsonb_array_length(td.contacts) ELSE 0 END
        <> (SELECT COUNT(*)::int FROM contacts r WHERE r.tenant_id = td.tenant_id)
      OR CASE WHEN jsonb_typeof(td.jobs) = 'array' THEN jsonb_array_length(td.jobs) ELSE 0 END
        <> (SELECT COUNT(*)::int FROM jobs r WHERE r.tenant_id = td.tenant_id)
      OR CASE WHEN jsonb_typeof(td.configs) = 'array' THEN jsonb_array_length(td.configs) ELSE 0 END
        <> (SELECT COUNT(*)::int FROM board_configs r WHERE r.tenant_id = td.tenant_id)
      OR CASE WHEN jsonb_typeof(td.activities) = 'array' THEN jsonb_array_length(td.activities) ELSE 0 END
        <> (SELECT COUNT(*)::int FROM activities r WHERE r.tenant_id = td.tenant_id)
      OR CASE WHEN jsonb_typeof(td.tasks) = 'array' THEN jsonb_array_length(td.tasks) ELSE 0 END
        <> (SELECT COUNT(*)::int FROM tasks r WHERE r.tenant_id = td.tenant_id)
    )
    ORDER BY td.tenant_id
  `, [excluded]);
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM tenant_data td
     WHERE NOT (tenant_id = ANY($1::text[]))
       AND COALESCE((SELECT storage_mode FROM tenants WHERE id = td.tenant_id), 'legacy') <> 'relational'`,
    [excluded]
  );
  return {
    healthy: result.rows.length === 0,
    workspaceCount: Number(totalResult.rows[0]?.total || 0),
    mismatchCount: result.rows.length,
    mismatchedTenantIds: result.rows.slice(0, 10).map((row) => row.tenant_id),
    checkedAt: new Date().toISOString(),
    queryMs: Date.now() - startedAt,
  };
}

export async function dbPruneExpiredOperationalData({ backgroundJobRetentionDays = 14 } = {}) {
  if (!dbReady) return null;
  const nowIso = new Date().toISOString();
  const jobCutoff = new Date(Date.now() - Math.max(1, Number(backgroundJobRetentionDays) || 14) * 86400000).toISOString();
  const [sessions, resetTokens, verificationTokens, backgroundJobs] = await Promise.all([
    pool.query('DELETE FROM sessions WHERE expires_at < $1', [nowIso]),
    pool.query("DELETE FROM password_reset_tokens WHERE expires_at < $1 OR used_at <> ''", [nowIso]),
    pool.query("DELETE FROM email_verification_tokens WHERE expires_at < $1 OR used_at <> ''", [nowIso]),
    pool.query("DELETE FROM background_jobs WHERE status IN ('completed', 'failed', 'cancelled') AND finished_at <> '' AND finished_at < $1", [jobCutoff]),
  ]);
  return {
    sessions: sessions.rowCount || 0,
    resetTokens: resetTokens.rowCount || 0,
    verificationTokens: verificationTokens.rowCount || 0,
    backgroundJobs: backgroundJobs.rowCount || 0,
    cleanedAt: nowIso,
  };
}

export async function dbCheckRelationalContentParity(tenantIds = [], excludedTenantIds = []) {
  if (!dbReady) return null;
  const startedAt = Date.now();
  const scoped = Array.isArray(tenantIds) ? tenantIds.filter(Boolean) : [];
  const excluded = Array.isArray(excludedTenantIds) ? excludedTenantIds.filter(Boolean) : [];
  const result = await pool.query(`
    SELECT td.tenant_id
    FROM tenant_data td
    WHERE ($1::text[] = '{}'::text[] OR td.tenant_id = ANY($1::text[]))
      AND NOT (td.tenant_id = ANY($2::text[]))
      AND COALESCE((SELECT storage_mode FROM tenants WHERE id = td.tenant_id), 'legacy') <> 'relational'
      AND (
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(td.accounts) = 'array' THEN td.accounts ELSE '[]'::jsonb END) item
          LEFT JOIN accounts r ON r.tenant_id = td.tenant_id AND r.id = item->>'id'
          WHERE r.id IS NULL OR r.raw IS DISTINCT FROM item
        ) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(td.contacts) = 'array' THEN td.contacts ELSE '[]'::jsonb END) item
          LEFT JOIN contacts r ON r.tenant_id = td.tenant_id AND r.id = item->>'id'
          WHERE r.id IS NULL OR r.raw IS DISTINCT FROM item
        ) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(td.jobs) = 'array' THEN td.jobs ELSE '[]'::jsonb END) item
          LEFT JOIN jobs r ON r.tenant_id = td.tenant_id AND r.id = item->>'id'
          WHERE r.id IS NULL OR r.raw IS DISTINCT FROM item
        ) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(td.configs) = 'array' THEN td.configs ELSE '[]'::jsonb END) item
          LEFT JOIN board_configs r ON r.tenant_id = td.tenant_id AND r.id = item->>'id'
          WHERE r.id IS NULL OR r.raw IS DISTINCT FROM item
        ) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(td.activities) = 'array' THEN td.activities ELSE '[]'::jsonb END) item
          LEFT JOIN activities r ON r.tenant_id = td.tenant_id AND r.id = item->>'id'
          WHERE r.id IS NULL OR r.raw IS DISTINCT FROM item
        ) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(td.tasks) = 'array' THEN td.tasks ELSE '[]'::jsonb END) item
          LEFT JOIN tasks r ON r.tenant_id = td.tenant_id AND r.id = item->>'id'
          WHERE r.id IS NULL OR r.raw IS DISTINCT FROM item
        )
      )
    ORDER BY td.tenant_id
  `, [scoped, excluded]);
  const checkedResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM tenant_data
     WHERE ($1::text[] = '{}'::text[] OR tenant_id = ANY($1::text[]))
       AND NOT (tenant_id = ANY($2::text[]))
       AND COALESCE((SELECT storage_mode FROM tenants WHERE id = tenant_data.tenant_id), 'legacy') <> 'relational'`,
    [scoped, excluded]
  );
  return {
    healthy: result.rows.length === 0,
    workspaceCount: Number(checkedResult.rows[0]?.total || 0),
    mismatchCount: result.rows.length,
    mismatchedTenantIds: result.rows.slice(0, 10).map((row) => row.tenant_id),
    checkedAt: new Date().toISOString(),
    queryMs: Date.now() - startedAt,
  };
}

export async function dbLoadRelationalPrimaryTenantIds() {
  if (!dbReady) return [];
  const result = await pool.query("SELECT id FROM tenants WHERE storage_mode = 'relational' ORDER BY id");
  return result.rows.map((row) => row.id).filter(Boolean);
}

export async function dbFindPasswordResetToken(tokenHash) {
  if (!dbReady) return null;
  try {
    const { rows } = await pool.query(
      'SELECT token_hash, user_id, expires_at, used_at, created_at FROM password_reset_tokens WHERE token_hash = $1',
      [tokenHash]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      expiresAt: row.expires_at,
      usedAt: row.used_at || '',
      createdAt: row.created_at,
    };
  } catch (err) {
    console.error('DB: Failed to find password reset token:', err.message);
    return null;
  }
}

export async function dbMarkPasswordResetTokenUsed(tokenHash) {
  if (!dbReady) return;
  try {
    await pool.query('UPDATE password_reset_tokens SET used_at = $2 WHERE token_hash = $1', [tokenHash, new Date().toISOString()]);
  } catch (err) {
    console.error('DB: Failed to mark password reset token used:', err.message);
  }
}

export async function dbSaveEmailVerificationToken(record) {
  if (!dbReady) return;
  try {
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1 OR expires_at < $2 OR used_at <> $3', [
      record.userId,
      new Date().toISOString(),
      '',
    ]);
    await pool.query(
      `INSERT INTO email_verification_tokens (token_hash, user_id, expires_at, used_at, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [record.tokenHash, record.userId, record.expiresAt, record.usedAt || '', record.createdAt]
    );
  } catch (err) {
    console.error('DB: Failed to save email verification token:', err.message);
  }
}

export async function dbFindEmailVerificationToken(tokenHash) {
  if (!dbReady) return null;
  try {
    const { rows } = await pool.query(
      'SELECT token_hash, user_id, expires_at, used_at, created_at FROM email_verification_tokens WHERE token_hash = $1',
      [tokenHash]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      expiresAt: row.expires_at,
      usedAt: row.used_at || '',
      createdAt: row.created_at,
    };
  } catch (err) {
    console.error('DB: Failed to find email verification token:', err.message);
    return null;
  }
}

export async function dbMarkEmailVerificationTokenUsed(tokenHash) {
  if (!dbReady) return;
  try {
    await pool.query('UPDATE email_verification_tokens SET used_at = $2 WHERE token_hash = $1', [tokenHash, new Date().toISOString()]);
  } catch (err) {
    console.error('DB: Failed to mark email verification token used:', err.message);
  }
}

export async function closeDb() {
  // Idempotent: a second signal (e.g. double Ctrl+C) must not double-end the pool.
  const p = pool;
  pool = null;
  dbReady = false;
  if (p) {
    await p.end();
    console.log('  DB: PostgreSQL connection closed');
  }
}
