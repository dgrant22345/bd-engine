import { dbQuery, isDbReady } from './db.js';

function rawOrRow(row) {
  return row?.raw && typeof row.raw === 'object' ? row.raw : row;
}

async function selectRows(sql, params) {
  if (!isDbReady()) return [];
  const result = await dbQuery(sql, params);
  return (result?.rows || []).map(rawOrRow);
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
    params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
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
