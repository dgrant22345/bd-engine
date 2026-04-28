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

// ── Connection ──────────────────────────────────────────────────────────────

export function isDbEnabled() {
  return !!process.env.DATABASE_URL;
}

export function isDbReady() {
  return dbReady;
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
      max: 5,
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'trial',
        status TEXT NOT NULL DEFAULT 'trialing',
        persona TEXT NOT NULL DEFAULT 'bd',
        stripe_customer_id TEXT NOT NULL DEFAULT '',
        stripe_subscription_id TEXT NOT NULL DEFAULT '',
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
    `);

    await pool.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_code TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referred_by_tenant_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_credited_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referral_credit_transaction_id TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX IF NOT EXISTS tenants_referral_code_idx ON tenants (referral_code) WHERE referral_code <> '';
      CREATE INDEX IF NOT EXISTS analytics_events_day_idx ON analytics_events (day);
      CREATE INDEX IF NOT EXISTS analytics_events_visitor_idx ON analytics_events (visitor_id);
      CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events (created_at);
    `);

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

export async function dbSaveUser(user) {
  if (!dbReady) return;
  try {
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [user.id, user.email, user.name, user.passwordHash, user.status, user.createdAt, user.updatedAt]
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
        tenant.id,
        tenant.slug,
        tenant.name,
        tenant.plan,
        tenant.status,
        tenant.persona || 'bd',
        tenant.stripeCustomerId || tenant.stripe_customer_id || '',
        tenant.stripeSubscriptionId || tenant.stripe_subscription_id || '',
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
      stripeCustomerId: r.stripe_customer_id || '',
      stripeSubscriptionId: r.stripe_subscription_id || '',
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

export async function dbSaveTenantData(tenantId, data) {
  if (!dbReady) return;
  try {
    // Only stringify if provided, otherwise pass null to trigger COALESCE in SQL
    const s = (v) => (v === undefined || v === null) ? null : JSON.stringify(v);

    await pool.query(
      `INSERT INTO tenant_data (tenant_id, accounts, contacts, jobs, configs, activities, settings, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id) DO UPDATE SET
         accounts = COALESCE(EXCLUDED.accounts, tenant_data.accounts),
         contacts = COALESCE(EXCLUDED.contacts, tenant_data.contacts),
         jobs = COALESCE(EXCLUDED.jobs, tenant_data.jobs),
         configs = COALESCE(EXCLUDED.configs, tenant_data.configs),
         activities = COALESCE(EXCLUDED.activities, tenant_data.activities),
         settings = COALESCE(EXCLUDED.settings, tenant_data.settings),
         updated_at = EXCLUDED.updated_at`,
      [
        tenantId,
        s(data.accounts),
        s(data.contacts),
        s(data.jobs),
        s(data.configs),
        s(data.activities),
        s(data.settings),
        new Date().toISOString(),
      ]
    );
  } catch (err) {
    console.error('DB: Failed to save tenant data for', tenantId, ':', err.message);
  }
}

export async function dbLoadTenantData(tenantId, includeContacts = true) {
  if (!dbReady) return null;
  try {
    const columns = includeContacts 
      ? 'accounts, contacts, jobs, configs, activities, settings, updated_at'
      : 'accounts, jobs, configs, activities, settings, updated_at';
    
    const result = await pool.query(`SELECT ${columns} FROM tenant_data WHERE tenant_id = $1`, [tenantId]);
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      accounts: r.accounts || [],
      contacts: r.contacts || [],
      jobs: r.jobs || [],
      configs: r.configs || [],
      activities: r.activities || [],
      settings: r.settings || {},
      updated_at: r.updated_at,
    };
  } catch (err) {
    console.error('DB: Failed to load tenant data:', err.message);
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

// ── Shutdown ────────────────────────────────────────────────────────────────

export async function closeDb() {
  if (pool) {
    await pool.end();
    console.log('  DB: PostgreSQL connection closed');
  }
}
