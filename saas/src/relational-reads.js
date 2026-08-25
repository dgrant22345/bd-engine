import { dbQuery, isDbReady } from './db.js';
import { decorateAccountsWithConfigs } from './account-resolution.js';

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

export async function getTenantUsageCountsRelational(tenantId) {
  if (!isDbReady()) return null;
  const result = await dbQuery(
    `SELECT
       (SELECT COUNT(*)::int FROM accounts WHERE tenant_id = $1) AS accounts,
       (SELECT COUNT(*)::int FROM contacts WHERE tenant_id = $1) AS contacts,
       (SELECT COUNT(*)::int FROM board_configs WHERE tenant_id = $1 AND active IS NOT FALSE) AS job_boards`,
    [tenantId]
  );
  const row = result?.rows?.[0];
  if (!row) return null;
  return {
    accounts: Number(row.accounts || 0),
    contacts: Number(row.contacts || 0),
    jobBoards: Number(row.job_boards || 0),
  };
}

export async function getTenantFiltersRelational(tenantId) {
  if (!isDbReady()) return null;
  const [accountResult, configResult] = await Promise.all([
    dbQuery(
      `SELECT
         ARRAY_AGG(DISTINCT industry) FILTER (WHERE industry <> '') AS industries,
         ARRAY_AGG(DISTINCT status) FILTER (WHERE status <> '') AS statuses,
         ARRAY_AGG(DISTINCT outreach_status) FILTER (WHERE outreach_status <> '') AS outreach_statuses
       FROM accounts WHERE tenant_id = $1`,
      [tenantId]
    ),
    dbQuery(
      `SELECT
         ARRAY_AGG(DISTINCT COALESCE(NULLIF(raw->>'ats', ''), NULLIF(raw->>'atsType', ''), NULLIF(ats_type, '')))
           FILTER (WHERE COALESCE(NULLIF(raw->>'ats', ''), NULLIF(raw->>'atsType', ''), NULLIF(ats_type, '')) IS NOT NULL) AS ats_types,
         ARRAY_AGG(DISTINCT discovery_status) FILTER (WHERE discovery_status <> '') AS config_discovery_statuses,
         ARRAY_AGG(DISTINCT raw->>'confidenceBand') FILTER (WHERE COALESCE(raw->>'confidenceBand', '') <> '') AS config_confidence_bands,
         ARRAY_AGG(DISTINCT review_status) FILTER (WHERE review_status <> '') AS config_review_statuses
       FROM board_configs WHERE tenant_id = $1`,
      [tenantId]
    ),
  ]);
  const accountRow = accountResult?.rows?.[0];
  const configRow = configResult?.rows?.[0];
  if (!accountRow || !configRow) return null;
  const sorted = (values) => (values || []).sort((a, b) => String(a).localeCompare(String(b)));
  return {
    atsTypes: sorted(configRow.ats_types),
    industries: sorted(accountRow.industries),
    statuses: sorted(accountRow.statuses),
    outreachStatuses: sorted(accountRow.outreach_statuses),
    configDiscoveryStatuses: sorted(configRow.config_discovery_statuses),
    configConfidenceBands: sorted(configRow.config_confidence_bands),
    configReviewStatuses: sorted(configRow.config_review_statuses),
  };
}

export async function findTenantAccountsRelational(tenantId, query = {}) {
  if (!isDbReady()) return null;
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.max(1, Math.min(10000, Number(query.pageSize || 25)));
  const offset = (page - 1) * pageSize;
  const search = String(query.q || '').trim();
  const params = [tenantId];
  let searchSql = '';
  let portfolioSql = '';
  if (query.portfolio === 'tracked') {
    portfolioSql = ` AND COALESCE(raw->>'tracked', 'true') <> 'false'`;
  } else if (query.portfolio === 'network') {
    portfolioSql = ` AND raw->>'tracked' = 'false'`;
  }
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
       WHERE tenant_id = $1${portfolioSql}${searchSql}
       ORDER BY target_score DESC, updated_at DESC, id ASC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    ),
    dbQuery(
      `SELECT
         COUNT(*) FILTER (WHERE TRUE${portfolioSql}${searchSql})::int AS total,
         COUNT(*) FILTER (WHERE COALESCE(raw->>'tracked', 'true') <> 'false')::int AS tracked_companies,
         COUNT(*) FILTER (WHERE raw->>'tracked' = 'false')::int AS network_companies,
         COUNT(*) FILTER (WHERE NOT (COALESCE(raw, '{}'::jsonb) ? 'tracked'))::int AS legacy_unclassified
       FROM accounts WHERE tenant_id = $1`,
      countParams
    ),
  ]);
  const accountRows = (rowsResult?.rows || []).map(rawOrRow);
  const accountIds = accountRows.map((item) => item.id).filter(Boolean);
  const accountNames = accountRows.map((item) => String(item.normalizedName || '').trim().toLowerCase()).filter(Boolean);
  const configResult = accountRows.length
    ? await dbQuery(
      `SELECT raw FROM board_configs
       WHERE tenant_id = $1 AND (
         account_id = ANY($2::text[]) OR
         ((account_id IS NULL OR account_id = '') AND normalized_company_name = ANY($3::text[]))
       )`,
      [tenantId, accountIds, accountNames]
    )
    : null;
  const configRows = (configResult?.rows || []).map(rawOrRow);
  return {
    items: decorateAccountsWithConfigs(accountRows, configRows),
    page,
    pageSize,
    total: Number(countResult?.rows?.[0]?.total || 0),
    portfolioSummary: {
      trackedCompanies: Number(countResult?.rows?.[0]?.tracked_companies || 0),
      networkCompanies: Number(countResult?.rows?.[0]?.network_companies || 0),
      legacyUnclassified: Number(countResult?.rows?.[0]?.legacy_unclassified || 0),
    },
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

export async function findTenantConfigsRelational(tenantId, query = {}) {
  if (!isDbReady()) return null;
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.max(1, Math.min(10000, Number(query.pageSize || 25)));
  const offset = (page - 1) * pageSize;
  const [rowsResult, countResult] = await Promise.all([
    dbQuery(
      `SELECT raw FROM board_configs
       WHERE tenant_id = $1
       ORDER BY updated_at DESC, id ASC
       LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset]
    ),
    dbQuery('SELECT COUNT(*)::int AS total FROM board_configs WHERE tenant_id = $1', [tenantId]),
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
  if (query.geography) {
    if (query.geography === 'gta') {
      clauses.push(`(
        j.location ILIKE '%toronto%' OR j.location ILIKE '%gta%' OR j.location ILIKE '%mississauga%' OR
        j.location ILIKE '%brampton%' OR j.location ILIKE '%markham%' OR j.location ILIKE '%vaughan%' OR
        j.location ILIKE '%oakville%' OR j.location ILIKE '%scarborough%' OR j.location ILIKE '%north york%' OR
        j.location ILIKE '%richmond hill%' OR j.location ILIKE '%etobicoke%' OR j.location ILIKE '%kitchener%' OR
        j.location ILIKE '%waterloo%' OR j.location ILIKE '%hamilton%' OR j.location ILIKE '%, ON%' OR
        j.location ILIKE '%,ON%' OR j.location ILIKE '%ontario%' OR j.location ILIKE '%canada%'
      )`);
    } else if (query.geography === 'remote') {
      clauses.push(`(j.location ILIKE '%remote%' OR j.title ILIKE '%remote%' OR j.raw->>'location' ILIKE '%remote%')`);
    } else if (query.geography === 'local_remote') {
      clauses.push(`(
        j.location ILIKE '%remote%' OR j.title ILIKE '%remote%' OR j.raw->>'location' ILIKE '%remote%' OR
        j.location ILIKE '%toronto%' OR j.location ILIKE '%gta%' OR j.location ILIKE '%mississauga%' OR
        j.location ILIKE '%brampton%' OR j.location ILIKE '%markham%' OR j.location ILIKE '%vaughan%' OR
        j.location ILIKE '%oakville%' OR j.location ILIKE '%scarborough%' OR j.location ILIKE '%north york%' OR
        j.location ILIKE '%richmond hill%' OR j.location ILIKE '%etobicoke%' OR j.location ILIKE '%kitchener%' OR
        j.location ILIKE '%waterloo%' OR j.location ILIKE '%hamilton%' OR j.location ILIKE '%, ON%' OR
        j.location ILIKE '%,ON%' OR j.location ILIKE '%ontario%' OR j.location ILIKE '%canada%'
      )`);
    } else if (query.geography === 'canada') {
      clauses.push(`(
        j.location ILIKE '%canada%' OR j.location ILIKE '%ontario%' OR j.location ILIKE '%quebec%' OR
        j.location ILIKE '%alberta%' OR j.location ILIKE '%british columbia%' OR j.location ILIKE '%toronto%' OR
        j.location ILIKE '%vancouver%' OR j.location ILIKE '%montreal%' OR j.location ILIKE '%calgary%' OR
        j.location ILIKE '%ottawa%' OR j.location ILIKE '%waterloo%' OR j.location ILIKE '%kitchener%' OR
        j.location ILIKE '%mississauga%' OR j.location ILIKE '%markham%' OR j.location ILIKE '%brampton%' OR
        j.location ILIKE '%vaughan%' OR j.location ILIKE '%oakville%' OR j.location ILIKE '%edmonton%' OR
        j.location ILIKE '%halifax%' OR j.location ILIKE '%winnipeg%' OR j.location ILIKE '%victoria%' OR
        j.location ILIKE '%kelowna%' OR j.location ILIKE '%london%' OR j.location ILIKE '%hamilton%' OR
        j.location ILIKE '%guelph%' OR j.location ILIKE '%barrie%' OR j.location ILIKE '%windsor%' OR
        j.location ILIKE '%, ON%' OR j.location ILIKE '%,ON%' OR j.location ILIKE '%, BC%' OR j.location ILIKE '%,BC%' OR
        j.location ILIKE '%, QC%' OR j.location ILIKE '%,QC%' OR j.location ILIKE '%, AB%' OR j.location ILIKE '%,AB%' OR
        j.location ILIKE '%, MB%' OR j.location ILIKE '%,MB%' OR j.location ILIKE '%, SK%' OR j.location ILIKE '%,SK%' OR
        j.location ILIKE '%, NS%' OR j.location ILIKE '%,NS%' OR j.location ILIKE '%, NB%' OR j.location ILIKE '%,NB%' OR
        j.location ILIKE '%, NL%' OR j.location ILIKE '%,NL%' OR j.location ILIKE '%, PE%' OR j.location ILIKE '%,PE%'
      ) AND NOT (
        j.location ILIKE '%united states%' OR j.location ILIKE '%usa%' OR
        j.location ILIKE '%, NY%' OR j.location ILIKE '%, TX%' OR j.location ILIKE '%, MA%' OR
        j.location ILIKE '%, WA%' OR j.location ILIKE '%, IL%' OR j.location ILIKE '%, FL%'
      )`);
    } else if (query.geography === 'us') {
      clauses.push(`(
        j.location ILIKE '%united states%' OR j.location ILIKE '%usa%' OR j.location ILIKE '%u.s.%' OR
        j.location ILIKE '%, CA%' OR j.location ILIKE '%, NY%' OR j.location ILIKE '%, MA%' OR
        j.location ILIKE '%, TX%' OR j.location ILIKE '%, WA%' OR j.location ILIKE '%, FL%' OR
        j.location ILIKE '%, IL%' OR j.location ILIKE '%, GA%' OR j.location ILIKE '%, CO%'
      )`);
    }
  }
  if (query.workStyle) {
    if (query.workStyle === 'remote') {
      clauses.push(`(j.location ILIKE '%remote%' OR j.title ILIKE '%remote%' OR j.raw->>'location' ILIKE '%remote%')`);
    } else if (query.workStyle === 'hybrid') {
      clauses.push(`(j.location ILIKE '%hybrid%' OR j.raw->>'location' ILIKE '%hybrid%')`);
    } else if (query.workStyle === 'onsite') {
      clauses.push(`(j.location ILIKE '%onsite%' OR j.location ILIKE '%on site%' OR j.location ILIKE '%in office%')`);
    } else if (query.workStyle === 'local_remote') {
      clauses.push(`(
        j.location ILIKE '%remote%' OR j.title ILIKE '%remote%' OR j.raw->>'location' ILIKE '%remote%' OR
        j.location ILIKE '%toronto%' OR j.location ILIKE '%gta%' OR j.location ILIKE '%mississauga%' OR
        j.location ILIKE '%brampton%' OR j.location ILIKE '%markham%' OR j.location ILIKE '%vaughan%' OR
        j.location ILIKE '%oakville%' OR j.location ILIKE '%scarborough%' OR j.location ILIKE '%north york%' OR
        j.location ILIKE '%richmond hill%' OR j.location ILIKE '%etobicoke%' OR j.location ILIKE '%kitchener%' OR
        j.location ILIKE '%waterloo%' OR j.location ILIKE '%hamilton%' OR j.location ILIKE '%, ON%' OR
        j.location ILIKE '%,ON%' OR j.location ILIKE '%ontario%' OR j.location ILIKE '%canada%'
      )`);
    }
  }
  if (query.hasContacts === 'true' || query.hasContacts === true || query.hasConnections === 'true' || query.hasConnections === true || query.networkOnly === 'true' || query.networkOnly === true) {
    clauses.push(`COALESCE((j.raw->>'connectionCount')::int, 0) > 0`);
  }
  const minConnections = Number(query.minConnections || 0);
  if (minConnections > 0) {
    clauses.push(`COALESCE((j.raw->>'connectionCount')::int, 0) >= ${addParam(minConnections)}`);
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
  const relevanceExpression = `CASE WHEN COALESCE(j.raw->>'relevanceScore', '') ~ '^\\d+(\\.\\d+)?$' THEN (j.raw->>'relevanceScore')::numeric ELSE -1 END`;
  const minRelevance = Number(query.minRelevance || 0);
  if (minRelevance > 0) clauses.push(`${relevanceExpression} >= ${addParam(minRelevance)}`);

  const whereSql = clauses.join(' AND ');
  const countParams = [...params];
  const limitRef = addParam(pageSize);
  const offsetRef = addParam(offset);
  const orderSql = query.sortBy === 'connections'
    ? `COALESCE((j.raw->>'connectionCount')::int, 0) DESC, ${relevanceExpression} DESC, COALESCE(j.posted_at, j.raw->>'importedAt', '') DESC, source_order.position ASC`
    : query.sortBy === 'relevance'
      ? `${relevanceExpression} DESC, COALESCE(j.posted_at, j.raw->>'importedAt', '') DESC, source_order.position ASC`
      : query.sortBy === 'retrieved'
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
