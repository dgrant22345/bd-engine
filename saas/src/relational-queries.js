/**
 * SQL-pushdown list reads against codex's relational mirror (accounts/contacts
 * tables + `raw` JSONB). These replace the in-memory `filterText → sort →
 * paginate` scan for the account/contact lists so a large tenant's list views no
 * longer require loading the whole 30MB blob into process memory.
 *
 * Equivalence contract (matches store.js exactly):
 *   findAccounts  = paginate(filterText(accounts sorted by targetScore DESC),
 *                            q over [displayName, domain, industry, location,
 *                                    owner, notes])
 *   findContacts  = paginate(filterText(contacts sorted by priorityScore DESC),
 *                            q over [fullName, companyName, title, email, notes])
 *
 * - Filter columns are read from `raw->>'field'` (the camelCase keys of the
 *   stored object) so ILIKE substring matching is byte-identical to the JS
 *   `String(item[field]).toLowerCase().includes(q)` path.
 * - Ordering uses the mirror's canonical tiebreak `updated_at DESC, id ASC`
 *   (same as loadTenantRelationalData) — the in-memory arrays are stored sorted
 *   by score, so score order is preserved; within a score tie the SQL tiebreak
 *   is deterministic where the in-memory insertion order was not.
 *
 * Gated behind BD_RELATIONAL_READS in store.js and only correct once the mirror
 * is backfilled for the tenant (codex's dual-write / backfill).
 */

import { dbQuery, isDbReady } from './db.js';

function likeParam(value) {
  // Escape LIKE wildcards so the match is a literal substring, matching `.includes()`.
  return `%${String(value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function pageParams(query = {}) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.max(1, Math.min(10000, Number(query.pageSize || 25)));
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

// Build the "q" text-search clause across the given raw->> JSONB fields.
function textSearch(q, fields, params) {
  const trimmed = String(q || '').trim();
  if (!trimmed) return '';
  params.push(likeParam(trimmed));
  const p = `$${params.length}`;
  return ' AND (' + fields.map((f) => `${f} ILIKE ${p}`).join(' OR ') + ')';
}

export function relationalReadsEnabled() {
  return process.env.BD_RELATIONAL_READS === 'true' && isDbReady();
}

export async function findAccounts(tenantId, query = {}) {
  const { page, pageSize, offset, limit } = pageParams(query);
  const params = [tenantId];
  const where = 'tenant_id = $1' + textSearch(query.q, [
    "raw->>'displayName'", "raw->>'domain'", "raw->>'industry'", "raw->>'location'", "raw->>'owner'", "raw->>'notes'",
  ], params);
  const total = (await dbQuery(`SELECT count(*)::int AS c FROM accounts WHERE ${where}`, params)).rows[0].c;
  const rows = (await dbQuery(
    `SELECT raw FROM accounts WHERE ${where}
     ORDER BY target_score DESC, updated_at DESC, id ASC
     LIMIT ${limit} OFFSET ${offset}`,
    params)).rows;
  return { items: rows.map((r) => r.raw), page, pageSize, total };
}

export async function findContacts(tenantId, query = {}) {
  const { page, pageSize, offset, limit } = pageParams(query);
  const params = [tenantId];
  const where = 'tenant_id = $1' + textSearch(query.q, [
    "raw->>'fullName'", "raw->>'companyName'", "raw->>'title'", "raw->>'email'", "raw->>'notes'",
  ], params);
  const total = (await dbQuery(`SELECT count(*)::int AS c FROM contacts WHERE ${where}`, params)).rows[0].c;
  const rows = (await dbQuery(
    `SELECT raw FROM contacts WHERE ${where}
     ORDER BY priority_score DESC, updated_at DESC, id ASC
     LIMIT ${limit} OFFSET ${offset}`,
    params)).rows;
  return { items: rows.map((r) => r.raw), page, pageSize, total };
}

// Jobs are few per tenant (hundreds), so fetch the tenant's jobs from SQL and
// let store.js apply the existing in-memory filters/sort byte-for-byte. Returns
// the raw job objects pre-sorted like jobsForTenant (postedAt DESC).
export async function getTenantJobs(tenantId) {
  const rows = (await dbQuery('SELECT raw FROM jobs WHERE tenant_id = $1', [tenantId])).rows;
  return rows
    .map((r) => r.raw)
    // postedAt DESC like jobsForTenant, with an id tiebreak so equal-postedAt
    // order is deterministic (vs the in-memory blob-array-order tiebreak).
    .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)) || String(a.id).localeCompare(String(b.id)));
}

// findConfigs is a plain tenant filter + pagination (no text search) — push it
// straight into SQL. Deterministic order (board_configs has no array-index col).
export async function findConfigs(tenantId, query = {}) {
  const { page, pageSize, offset, limit } = pageParams(query);
  const total = (await dbQuery('SELECT count(*)::int AS c FROM board_configs WHERE tenant_id = $1', [tenantId])).rows[0].c;
  const rows = (await dbQuery(
    `SELECT raw FROM board_configs WHERE tenant_id = $1
     ORDER BY updated_at DESC, id ASC
     LIMIT ${limit} OFFSET ${offset}`,
    [tenantId])).rows;
  return { items: rows.map((r) => r.raw), page, pageSize, total };
}

// One account plus its related records, fetched by index. store.js keeps the
// persona/action-plan shaping. Returns null if the account is not in the tenant.
export async function getAccountDetailData(tenantId, accountId) {
  const acct = (await dbQuery(
    "SELECT raw, normalized_name FROM accounts WHERE tenant_id = $1 AND id = $2", [tenantId, accountId])).rows[0];
  if (!acct) return null;
  const [contacts, jobs, activities, configs] = await Promise.all([
    dbQuery('SELECT raw FROM contacts WHERE tenant_id = $1 AND account_id = $2 ORDER BY priority_score DESC, id ASC', [tenantId, accountId]),
    dbQuery('SELECT raw FROM jobs WHERE tenant_id = $1 AND account_id = $2 ORDER BY posted_at DESC, id ASC', [tenantId, accountId]),
    dbQuery('SELECT raw FROM activities WHERE tenant_id = $1 AND account_id = $2 ORDER BY occurred_at DESC, id ASC', [tenantId, accountId]),
    dbQuery('SELECT raw FROM board_configs WHERE tenant_id = $1 AND normalized_company_name = $2 ORDER BY id ASC', [tenantId, acct.normalized_name]),
  ]);
  return {
    account: acct.raw,
    contacts: contacts.rows.map((r) => r.raw),
    jobs: jobs.rows.map((r) => r.raw),
    activities: activities.rows.map((r) => r.raw),
    configs: configs.rows.map((r) => r.raw),
  };
}
