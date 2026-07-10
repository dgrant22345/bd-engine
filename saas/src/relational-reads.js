import { dbQuery, isDbReady } from './db.js';

function rawOrRow(row) {
  return row?.raw && typeof row.raw === 'object' ? row.raw : row;
}

async function selectRows(sql, params) {
  if (!isDbReady()) return [];
  const result = await dbQuery(sql, params);
  return (result?.rows || []).map(rawOrRow);
}

function escapedSearchPattern(value) {
  return `%${String(value || '').trim().replace(/[\\%_]/g, '\\$&')}%`;
}

export async function loadTenantRelationalData(tenantId, includeContacts = true) {
  if (!isDbReady()) return null;
  const [accounts, contacts, jobs, configs, activities, tasks] = await Promise.all([
    selectRows(
      `SELECT raw FROM accounts WHERE tenant_id = $1 ORDER BY target_score DESC, updated_at DESC, id ASC`,
      [tenantId]
    ),
    includeContacts
      ? selectRows(
        `SELECT raw FROM contacts WHERE tenant_id = $1 ORDER BY priority_score DESC, updated_at DESC, id ASC`,
        [tenantId]
      )
      : Promise.resolve([]),
    selectRows(
      `SELECT raw FROM jobs WHERE tenant_id = $1 ORDER BY posted_at DESC, updated_at DESC, id ASC`,
      [tenantId]
    ),
    selectRows(
      `SELECT raw FROM board_configs WHERE tenant_id = $1 ORDER BY updated_at DESC, id ASC`,
      [tenantId]
    ),
    selectRows(
      `SELECT raw FROM activities WHERE tenant_id = $1 ORDER BY occurred_at DESC, created_at DESC, id ASC`,
      [tenantId]
    ),
    selectRows(
      `SELECT raw FROM tasks WHERE tenant_id = $1 ORDER BY due_date ASC, updated_at DESC, id ASC`,
      [tenantId]
    ),
  ]);

  return { accounts, contacts, jobs, configs, activities, tasks, settings: {} };
}

export async function getTenantRelationalStats(tenantId) {
  if (!isDbReady()) return null;
  const result = await dbQuery(
    `SELECT
       (SELECT COUNT(*)::int FROM accounts WHERE tenant_id = $1) AS account_count,
       (SELECT COUNT(*)::int FROM contacts WHERE tenant_id = $1) AS contact_count,
       (SELECT COUNT(*)::int FROM jobs WHERE tenant_id = $1) AS job_count,
       (SELECT COUNT(*)::int FROM board_configs WHERE tenant_id = $1) AS config_count,
       (SELECT COUNT(*)::int FROM activities WHERE tenant_id = $1) AS activity_count,
       (SELECT COUNT(*)::int FROM tasks WHERE tenant_id = $1) AS task_count`,
    [tenantId]
  );
  return result?.rows?.[0] || null;
}

export async function findTenantAccountsRelational(tenantId, query = {}) {
  if (!isDbReady()) return null;
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.max(1, Math.min(10000, Number(query.pageSize || 25)));
  const offset = (page - 1) * pageSize;
  const search = String(query.q || '').trim();
  const params = [tenantId];
  let searchSql = '';
  if (search) {
    params.push(escapedSearchPattern(search));
    searchSql = ` AND (
      display_name ILIKE $2 ESCAPE '\\' OR domain ILIKE $2 ESCAPE '\\' OR
      industry ILIKE $2 ESCAPE '\\' OR location ILIKE $2 ESCAPE '\\' OR
      notes ILIKE $2 ESCAPE '\\' OR COALESCE(raw->>'owner', '') ILIKE $2 ESCAPE '\\'
    )`;
  }
  const countParams = [...params];
  const limitIndex = params.length + 1;
  const offsetIndex = params.length + 2;
  params.push(pageSize, offset);
  const [rowsResult, countResult] = await Promise.all([
    dbQuery(
      `SELECT raw FROM accounts
       WHERE tenant_id = $1${searchSql}
       ORDER BY target_score DESC, updated_at DESC, id ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    ),
    dbQuery(`SELECT COUNT(*)::int AS total FROM accounts WHERE tenant_id = $1${searchSql}`, countParams),
  ]);
  return {
    items: (rowsResult?.rows || []).map(rawOrRow),
    page,
    pageSize,
    total: Number(countResult?.rows?.[0]?.total || 0),
  };
}

export async function findTenantContactsRelational(tenantId, query = {}) {
  if (!isDbReady()) return null;
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.max(1, Math.min(10000, Number(query.pageSize || 25)));
  const offset = (page - 1) * pageSize;
  const search = String(query.q || '').trim();
  const params = [tenantId];
  let searchSql = '';
  if (search) {
    params.push(escapedSearchPattern(search));
    searchSql = ` AND (
      full_name ILIKE $2 ESCAPE '\\' OR company_name ILIKE $2 ESCAPE '\\' OR
      title ILIKE $2 ESCAPE '\\' OR email ILIKE $2 ESCAPE '\\' OR notes ILIKE $2 ESCAPE '\\'
    )`;
  }
  const countParams = [...params];
  const limitIndex = params.length + 1;
  const offsetIndex = params.length + 2;
  params.push(pageSize, offset);
  const [rowsResult, countResult] = await Promise.all([
    dbQuery(
      `SELECT raw FROM contacts
       WHERE tenant_id = $1${searchSql}
       ORDER BY priority_score DESC, updated_at DESC, id ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    ),
    dbQuery(`SELECT COUNT(*)::int AS total FROM contacts WHERE tenant_id = $1${searchSql}`, countParams),
  ]);
  return {
    items: (rowsResult?.rows || []).map(rawOrRow),
    page,
    pageSize,
    total: Number(countResult?.rows?.[0]?.total || 0),
  };
}

function normalizedAtsFilter(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.includes('greenhouse')) return ['like', '%greenhouse%'];
  if (normalized.includes('lever')) return ['like', '%lever%'];
  if (normalized.includes('ashby')) return ['like', '%ashby%'];
  if (normalized.includes('smartrecruiters')) return ['like', '%smartrecruiters%'];
  if (normalized.includes('jobvite')) return ['like', '%jobvite%'];
  if (normalized.includes('workday') || normalized.includes('myworkdayjobs')) return ['like', '%workday%'];
  if (normalized.includes('bamboohr')) return ['like', '%bamboohr%'];
  if (normalized.includes('customstatic') || normalized.includes('staticcareers')) return ['in', ['customstatic', 'staticcareers']];
  return ['equal', normalized];
}

export async function findTenantJobsRelational(tenantId, query = {}) {
  if (!isDbReady()) return null;
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.max(1, Math.min(10000, Number(query.pageSize || 25)));
  const offset = (page - 1) * pageSize;
  const params = [tenantId];
  const clauses = ['j.tenant_id = $1'];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const search = String(query.q || '').trim();
  if (search) {
    const ref = addParam(escapedSearchPattern(search));
    clauses.push(`(j.title ILIKE ${ref} ESCAPE '\\' OR j.company_name ILIKE ${ref} ESCAPE '\\' OR j.location ILIKE ${ref} ESCAPE '\\' OR j.source ILIKE ${ref} ESCAPE '\\')`);
  }
  if (query.ats) {
    const [mode, value] = normalizedAtsFilter(query.ats);
    const expression = `lower(regexp_replace(COALESCE(NULLIF(j.ats_type, ''), j.source), '[^a-z0-9]', '', 'g'))`;
    if (mode === 'like') clauses.push(`${expression} LIKE ${addParam(value)}`);
    else if (mode === 'in') clauses.push(`${expression} = ANY(${addParam(value)}::text[])`);
    else clauses.push(`${expression} = ${addParam(value)}`);
  }
  if (query.active === 'true' || query.active === true) clauses.push('j.active IS NOT FALSE');
  else if (query.active === 'false' || query.active === false) clauses.push('j.active IS FALSE');
  if (query.isNew === 'true' || query.isNew === true) clauses.push(`lower(COALESCE(j.raw->>'isNew', 'false')) IN ('true', '1', 'yes')`);
  else if (query.isNew === 'false' || query.isNew === false) clauses.push(`lower(COALESCE(j.raw->>'isNew', 'false')) NOT IN ('true', '1', 'yes')`);
  const recencyDays = Number(query.recencyDays || 0);
  if (recencyDays > 0) {
    const ref = addParam(Math.floor(recencyDays));
    clauses.push(`j.posted_at ~ '^\\d{4}-\\d{2}-\\d{2}' AND (CURRENT_DATE - substring(j.posted_at, 1, 10)::date) <= ${ref}`);
  }

  const whereSql = clauses.join(' AND ');
  const countParams = [...params];
  const limitRef = addParam(pageSize);
  const offsetRef = addParam(offset);
  const orderSql = query.sortBy === 'retrieved'
    ? `COALESCE(j.raw->>'retrievedAt', j.raw->>'importedAt', '') DESC, source_order.position ASC`
    : 'source_order.position ASC';
  const [rowsResult, countResult] = await Promise.all([
    dbQuery(
      `WITH source_order AS (
         SELECT item->>'id' AS id, position
         FROM tenant_data, jsonb_array_elements(jobs) WITH ORDINALITY AS ordered(item, position)
         WHERE tenant_id = $1
       )
       SELECT j.raw
       FROM jobs j
       JOIN source_order ON source_order.id = j.id
       WHERE ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ${limitRef} OFFSET ${offsetRef}`,
      params
    ),
    dbQuery(`SELECT COUNT(*)::int AS total FROM jobs j WHERE ${whereSql}`, countParams),
  ]);
  return {
    items: (rowsResult?.rows || []).map(rawOrRow),
    page,
    pageSize,
    total: Number(countResult?.rows?.[0]?.total || 0),
  };
}

export function compareTenantDataCounts(blobStats = {}, relationalStats = {}, includeContacts = true) {
  const fields = [
    ['accounts', 'accountCount', 'account_count'],
    ['jobs', 'jobCount', 'job_count'],
    ['configs', 'configCount', 'config_count'],
    ['activities', 'activityCount', 'activity_count'],
    ['tasks', 'taskCount', 'task_count'],
  ];
  if (includeContacts) fields.push(['contacts', 'contactCount', 'contact_count']);

  const mismatches = fields.flatMap(([entity, blobKey, relationalKey]) => {
    const blobCount = Number(blobStats[blobKey] || 0);
    const relationalCount = Number(relationalStats[relationalKey] || relationalStats[blobKey] || 0);
    return blobCount === relationalCount ? [] : [{ entity, blobCount, relationalCount }];
  });
  return { matches: mismatches.length === 0, mismatches };
}
