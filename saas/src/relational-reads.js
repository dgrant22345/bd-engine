import { dbQuery, isDbReady } from './db.js';
import { decorateAccountsWithConfigs } from './account-resolution.js';
import { buildTenantJobQueries } from './job-queries.js';

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

export async function findTenantJobsRelational(tenantId, query = {}) {
  if (!isDbReady()) return null;
  const startedAt = performance.now();
  const built = buildTenantJobQueries(tenantId, query);
  const [rowsResult, countResult] = await Promise.all([
    dbQuery(built.rows.text, built.rows.params),
    dbQuery(built.count.text, built.count.params),
  ]);
  const items = (rowsResult?.rows || []).map(rawOrRow);
  const accountIds = [...new Set(items.map((item) => item.accountId).filter(Boolean))];
  const contacts = accountIds.length ? await dbQuery(`
    SELECT raw, account_id FROM (
      SELECT raw, account_id, ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY priority_score DESC, id ASC) AS position
      FROM contacts WHERE tenant_id = $1 AND account_id = ANY($2::text[])
    ) ranked WHERE position <= 3`, [tenantId, accountIds]) : null;
  const byAccount = new Map();
  for (const row of contacts?.rows || []) {
    const list = byAccount.get(row.account_id) || [];
    const contact = row.raw || {};
    list.push({ id: contact.id, fullName: contact.fullName, title: contact.title || contact.position || '', seniority: contact.seniority || '', priorityScore: contact.priorityScore || 0, linkedinUrl: contact.linkedinUrl || '', outreachStatus: contact.outreachStatus || 'not_started' });
    byAccount.set(row.account_id, list);
  }
  for (const item of items) {
    item.contacts = byAccount.get(item.accountId) || [];
    item.topContactName ||= item.contacts[0]?.fullName || '';
  }
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (elapsedMs > 250) console.warn(`Slow relational job query: saas/src/relational-reads.js findTenantJobsRelational ${elapsedMs}ms`);
  return { items, page: built.page, pageSize: built.pageSize, total: Number(countResult?.rows?.[0]?.total || 0), summary: {
    activeTotal: Number(countResult?.rows?.[0]?.active_total || 0),
    pipelineTotal: Number(countResult?.rows?.[0]?.pipeline_total || 0),
  } };
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
