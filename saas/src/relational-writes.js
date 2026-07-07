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
  await dbQuery(
    `INSERT INTO accounts (id, tenant_id, display_name, normalized_name, domain, industry, location, status, outreach_status, target_score, open_role_count, next_action, notes, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       normalized_name = EXCLUDED.normalized_name,
       domain = EXCLUDED.domain,
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
      text(item.domain || item.canonicalDomain), text(item.industry), text(item.location), text(item.status || 'new'),
      text(item.outreachStatus || 'not_started'), int(item.targetScore || item.dailyScore), int(item.openRoleCount || item.jobCount),
      text(item.nextAction), text(item.notes), JSON.stringify(item), text(item.createdAt), text(item.updatedAt || item.createdAt),
    ]
  );
}

async function upsertContact(item) {
  await dbQuery(
    `INSERT INTO contacts (id, tenant_id, account_id, full_name, first_name, last_name, email, linkedin_url, company_name, title, connected_on, outreach_status, priority_score, notes, source, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       full_name = EXCLUDED.full_name,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       email = EXCLUDED.email,
       linkedin_url = EXCLUDED.linkedin_url,
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
      text(item.email), text(item.linkedinUrl || item.linkedin_url), text(item.companyName), text(item.title), text(item.connectedOn),
      text(item.outreachStatus || 'not_started'), int(item.priorityScore), text(item.notes), text(item.source || 'manual'),
      JSON.stringify(item), text(item.createdAt), text(item.updatedAt || item.createdAt),
    ]
  );
}

async function upsertJob(item) {
  await dbQuery(
    `INSERT INTO jobs (id, tenant_id, account_id, title, company_name, location, source, ats_type, source_url, job_url, posted_at, active, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
       raw = EXCLUDED.raw,
       updated_at = EXCLUDED.updated_at`,
    [
      item.id, item.tenantId, nullableText(item.accountId), text(item.title), text(item.companyName), text(item.location),
      text(item.source), text(item.atsType || item.ats), text(item.sourceUrl), text(item.jobUrl || item.url),
      text(item.postedAt), bool(item.active, true), JSON.stringify(item), text(item.createdAt), text(item.updatedAt || item.createdAt),
    ]
  );
}

async function upsertConfig(item) {
  await dbQuery(
    `INSERT INTO board_configs (id, tenant_id, account_id, company_name, normalized_company_name, ats_type, board_id, domain, careers_url, discovery_status, review_status, active, raw, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       company_name = EXCLUDED.company_name,
       normalized_company_name = EXCLUDED.normalized_company_name,
       ats_type = EXCLUDED.ats_type,
       board_id = EXCLUDED.board_id,
       domain = EXCLUDED.domain,
       careers_url = EXCLUDED.careers_url,
       discovery_status = EXCLUDED.discovery_status,
       review_status = EXCLUDED.review_status,
       active = EXCLUDED.active,
       raw = EXCLUDED.raw,
       updated_at = EXCLUDED.updated_at`,
    [
      item.id, item.tenantId, nullableText(item.accountId), text(item.companyName), text(item.normalizedCompanyName),
      text(item.atsType || item.ats), text(item.boardId), text(item.domain), text(item.careersUrl),
      text(item.discoveryStatus), text(item.reviewStatus), bool(item.active, true), JSON.stringify(item),
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
