import { dbQuery, isDbReady } from './db.js';

const DISABLED = process.env.BD_RELATIONAL_MIRROR === 'false';
const syncCursors = new Map(); // tenantId -> section -> last updatedAt synced

function cursorFor(tenantId) {
  if (!syncCursors.has(tenantId)) syncCursors.set(tenantId, new Map());
  return syncCursors.get(tenantId);
}

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function nullableText(value) {
  const normalized = text(value).trim();
  return normalized || null;
}

function normalizeKey(value) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function canonicalDomain(value) {
  return text(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/:\d+$/, '');
}

function canonicalLinkedInUrl(value) {
  const raw = text(value).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${path}`;
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

function normalizedEmail(value) {
  return text(value).trim().toLowerCase();
}

function accountIdentityKey(item) {
  const domain = canonicalDomain(item.canonicalDomain || item.domain);
  if (domain) return `domain:${domain}`;
  const name = normalizeKey(item.normalizedName || item.normalizedCompanyName || item.displayName || item.companyName);
  return name ? `name:${name}` : '';
}

function contactIdentityKey(item) {
  const linkedin = canonicalLinkedInUrl(item.linkedinUrl || item.linkedin_url);
  if (linkedin) return `linkedin:${linkedin}`;
  const email = normalizedEmail(item.email);
  if (email) return `email:${email}`;
  const name = normalizeKey(item.fullName || item.name);
  const company = normalizeKey(item.companyName || item.normalizedCompanyName);
  return name && company ? `name-company:${name}|${company}` : '';
}

function jobNaturalKey(item) {
  if (item.naturalKey) return text(item.naturalKey);
  const providerId = text(item.jobId || item.providerJobId).trim();
  const sourceUrl = text(item.jobUrl || item.url || item.sourceUrl).trim().toLowerCase();
  const accountKey = text(item.configId || item.accountId || normalizeKey(item.companyName)).trim();
  const ats = normalizeKey(item.atsType || item.ats || item.source);
  if (providerId) return [item.tenantId, accountKey, ats, providerId].map(normalizeKey).join('|');
  if (sourceUrl) return [item.tenantId, ats, sourceUrl].map(normalizeKey).join('|');
  return [item.tenantId, accountKey, ats, item.title, item.location].map(normalizeKey).join('|');
}

function configIdentityKey(item) {
  const board = normalizeKey(item.boardId || item.resolvedBoardUrl || item.careersUrl || item.domain);
  const company = normalizeKey(item.normalizedCompanyName || item.companyName);
  const ats = normalizeKey(item.atsType || item.ats);
  return [company, ats, board].filter(Boolean).join('|');
}

function int(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function bool(value, fallback = true) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function stamp(item = {}) {
  return text(item.updatedAt || item.updated_at || item.createdAt || item.created_at);
}

function changedItems(tenantId, section, items = []) {
  const cursors = cursorFor(tenantId);
  const last = cursors.get(section) || '';
  return items.filter((item) => {
    if (!item?.id) return false;
    const itemStamp = stamp(item);
    return !last || !itemStamp || itemStamp > last;
  });
}

function advanceCursor(tenantId, section, items = []) {
  const maxStamp = items.reduce((max, item) => {
    const itemStamp = stamp(item);
    return itemStamp && itemStamp > max ? itemStamp : max;
  }, cursorFor(tenantId).get(section) || '');
  if (maxStamp) cursorFor(tenantId).set(section, maxStamp);
}

async function upsertRows(tenantId, section, items, upsert) {
  const changed = changedItems(tenantId, section, items);
  for (const item of changed) {
    await upsert({ ...item, tenantId: item.tenantId || tenantId });
  }
  advanceCursor(tenantId, section, items);
  return { changed: changed.length, total: items.length };
}

export async function syncTenantRelationalMirror(tenantId, data = {}) {
  if (DISABLED || !isDbReady()) return { skipped: true };
  const result = {};
  if (Array.isArray(data.accounts)) result.accounts = await upsertRows(tenantId, 'accounts', data.accounts, upsertAccount);
  if (Array.isArray(data.contacts)) result.contacts = await upsertRows(tenantId, 'contacts', data.contacts, upsertContact);
  if (Array.isArray(data.jobs)) result.jobs = await upsertRows(tenantId, 'jobs', data.jobs, upsertJob);
  if (Array.isArray(data.configs)) result.configs = await upsertRows(tenantId, 'configs', data.configs, upsertConfig);
  if (Array.isArray(data.activities)) result.activities = await upsertRows(tenantId, 'activities', data.activities, upsertActivity);
  if (Array.isArray(data.tasks)) result.tasks = await upsertRows(tenantId, 'tasks', data.tasks, upsertTask);
  return { ok: true, ...result };
}

export async function wipeTenantRelationalMirror(tenantId) {
  if (DISABLED || !isDbReady()) return { skipped: true };
  const tables = ['tasks', 'activities', 'board_configs', 'jobs', 'contacts', 'accounts'];
  const deleted = {};
  for (const table of tables) {
    const res = await dbQuery(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    deleted[table] = res?.rowCount || 0;
  }
  syncCursors.delete(tenantId);
  return { ok: true, deleted };
}

async function upsertAccount(item) {
  const identityKey = accountIdentityKey(item);
  const domain = canonicalDomain(item.canonicalDomain || item.domain);
  await dbQuery(
    `INSERT INTO accounts (id, tenant_id, display_name, normalized_name, domain, canonical_domain, identity_key, industry, location, status, outreach_status, target_score, open_role_count, next_action, notes, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       normalized_name = EXCLUDED.normalized_name,
       domain = EXCLUDED.domain,
       canonical_domain = EXCLUDED.canonical_domain,
       identity_key = EXCLUDED.identity_key,
       industry = EXCLUDED.industry,
       location = EXCLUDED.location,
       status = EXCLUDED.status,
       outreach_status = EXCLUDED.outreach_status,
       target_score = EXCLUDED.target_score,
       open_role_count = EXCLUDED.open_role_count,
       next_action = EXCLUDED.next_action,
       notes = EXCLUDED.notes,
       raw = EXCLUDED.raw,
       updated_at = EXCLUDED.updated_at`,
    [
      item.id, item.tenantId, text(item.displayName || item.companyName), text(item.normalizedName || item.normalizedCompanyName),
      text(item.domain || item.canonicalDomain), domain, identityKey, text(item.industry), text(item.location), text(item.status || 'new'),
      text(item.outreachStatus || 'not_started'), int(item.targetScore || item.dailyScore), int(item.openRoleCount || item.jobCount),
      text(item.nextAction), text(item.notes), JSON.stringify(item), text(item.createdAt), text(item.updatedAt || item.createdAt),
    ]
  );
}

async function upsertContact(item) {
  const email = normalizedEmail(item.email);
  const linkedin = canonicalLinkedInUrl(item.linkedinUrl || item.linkedin_url);
  const identityKey = contactIdentityKey(item);
  await dbQuery(
    `INSERT INTO contacts (id, tenant_id, account_id, full_name, first_name, last_name, email, normalized_email, linkedin_url, canonical_linkedin_url, identity_key, company_name, title, connected_on, outreach_status, priority_score, notes, source, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       full_name = EXCLUDED.full_name,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       email = EXCLUDED.email,
       normalized_email = EXCLUDED.normalized_email,
       linkedin_url = EXCLUDED.linkedin_url,
       canonical_linkedin_url = EXCLUDED.canonical_linkedin_url,
       identity_key = EXCLUDED.identity_key,
       company_name = EXCLUDED.company_name,
       title = EXCLUDED.title,
       connected_on = EXCLUDED.connected_on,
       outreach_status = EXCLUDED.outreach_status,
       priority_score = EXCLUDED.priority_score,
       notes = EXCLUDED.notes,
       source = EXCLUDED.source,
       raw = EXCLUDED.raw,
       updated_at = EXCLUDED.updated_at`,
    [
      item.id, item.tenantId, nullableText(item.accountId), text(item.fullName || item.name), text(item.firstName), text(item.lastName),
      text(item.email), email, text(item.linkedinUrl || item.linkedin_url), linkedin, identityKey, text(item.companyName), text(item.title), text(item.connectedOn),
      text(item.outreachStatus || 'not_started'), int(item.priorityScore), text(item.notes), text(item.source || 'manual'),
      JSON.stringify(item), text(item.createdAt), text(item.updatedAt || item.createdAt),
    ]
  );
}

async function upsertJob(item) {
  const naturalKey = jobNaturalKey(item);
  const firstSeenAt = text(item.firstSeenAt || item.first_seen_at || item.createdAt);
  const lastSeenAt = text(item.lastSeenAt || item.last_seen_at || item.retrievedAt || item.importedAt || item.updatedAt || item.createdAt);
  await dbQuery(
    `INSERT INTO jobs (id, tenant_id, account_id, title, company_name, location, source, ats_type, source_url, job_url, posted_at, active, natural_key, first_seen_at, last_seen_at, closed_at, import_run_id, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       title = EXCLUDED.title,
       company_name = EXCLUDED.company_name,
       location = EXCLUDED.location,
       source = EXCLUDED.source,
       ats_type = EXCLUDED.ats_type,
       source_url = EXCLUDED.source_url,
       job_url = EXCLUDED.job_url,
       posted_at = EXCLUDED.posted_at,
       active = EXCLUDED.active,
       natural_key = EXCLUDED.natural_key,
       first_seen_at = COALESCE(NULLIF(jobs.first_seen_at, ''), EXCLUDED.first_seen_at),
       last_seen_at = EXCLUDED.last_seen_at,
       closed_at = EXCLUDED.closed_at,
       import_run_id = EXCLUDED.import_run_id,
       raw = EXCLUDED.raw,
       updated_at = EXCLUDED.updated_at`,
    [
      item.id, item.tenantId, nullableText(item.accountId), text(item.title), text(item.companyName), text(item.location),
      text(item.source), text(item.atsType || item.ats), text(item.sourceUrl), text(item.jobUrl || item.url),
      text(item.postedAt), bool(item.active, true), naturalKey, firstSeenAt, lastSeenAt, text(item.closedAt || item.closed_at),
      text(item.importRunId || item.import_run_id), JSON.stringify(item), text(item.createdAt), text(item.updatedAt || item.createdAt),
    ]
  );
}

async function upsertConfig(item) {
  const identityKey = configIdentityKey(item);
  await dbQuery(
    `INSERT INTO board_configs (id, tenant_id, account_id, company_name, normalized_company_name, ats_type, board_id, domain, careers_url, resolved_board_url, identity_key, discovery_status, review_status, active, last_checked_at, last_imported_at, last_import_status, last_import_error, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       company_name = EXCLUDED.company_name,
       normalized_company_name = EXCLUDED.normalized_company_name,
       ats_type = EXCLUDED.ats_type,
       board_id = EXCLUDED.board_id,
       domain = EXCLUDED.domain,
       careers_url = EXCLUDED.careers_url,
       resolved_board_url = EXCLUDED.resolved_board_url,
       identity_key = EXCLUDED.identity_key,
       discovery_status = EXCLUDED.discovery_status,
       review_status = EXCLUDED.review_status,
       active = EXCLUDED.active,
       last_checked_at = EXCLUDED.last_checked_at,
       last_imported_at = EXCLUDED.last_imported_at,
       last_import_status = EXCLUDED.last_import_status,
       last_import_error = EXCLUDED.last_import_error,
       raw = EXCLUDED.raw,
       updated_at = EXCLUDED.updated_at`,
    [
      item.id, item.tenantId, nullableText(item.accountId), text(item.companyName), text(item.normalizedCompanyName),
      text(item.atsType || item.ats), text(item.boardId), text(item.domain), text(item.careersUrl),
      text(item.resolvedBoardUrl || item.boardUrl || item.sourceUrl), identityKey, text(item.discoveryStatus), text(item.reviewStatus),
      bool(item.active, true), text(item.lastCheckedAt), text(item.lastImportedAt || item.lastImportAt),
      text(item.lastImportStatus), text(item.lastImportError), JSON.stringify(item),
      text(item.createdAt), text(item.updatedAt || item.createdAt),
    ]
  );
}

async function upsertActivity(item) {
  await dbQuery(
    `INSERT INTO activities (id, tenant_id, account_id, contact_id, type, summary, notes, occurred_at, created_by_user_id, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       contact_id = EXCLUDED.contact_id,
       type = EXCLUDED.type,
       summary = EXCLUDED.summary,
       notes = EXCLUDED.notes,
       occurred_at = EXCLUDED.occurred_at,
       created_by_user_id = EXCLUDED.created_by_user_id,
       raw = EXCLUDED.raw,
       updated_at = EXCLUDED.updated_at`,
    [
      item.id, item.tenantId, nullableText(item.accountId), nullableText(item.contactId), text(item.type || 'note'),
      text(item.summary), text(item.notes), text(item.occurredAt || item.createdAt), nullableText(item.createdByUserId),
      JSON.stringify(item), text(item.createdAt), text(item.updatedAt || item.createdAt),
    ]
  );
}

async function upsertTask(item) {
  await dbQuery(
    `INSERT INTO tasks (id, tenant_id, account_id, contact_id, title, status, priority, due_date, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       contact_id = EXCLUDED.contact_id,
       title = EXCLUDED.title,
       status = EXCLUDED.status,
       priority = EXCLUDED.priority,
       due_date = EXCLUDED.due_date,
       raw = EXCLUDED.raw,
       updated_at = EXCLUDED.updated_at`,
    [
      item.id, item.tenantId, nullableText(item.accountId), nullableText(item.contactId), text(item.title || item.summary),
      text(item.status || 'pending'), text(item.priority), text(item.dueDate || item.dueAt),
      JSON.stringify(item), text(item.createdAt), text(item.updatedAt || item.createdAt),
    ]
  );
}
