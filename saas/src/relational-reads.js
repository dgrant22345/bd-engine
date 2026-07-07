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
