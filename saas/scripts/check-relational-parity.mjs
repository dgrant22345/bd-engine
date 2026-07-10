import pg from 'pg';
import { compareTenantDataCounts } from '../src/relational-reads.js';

const { Pool } = pg;

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for relational parity checks.');
  const pool = new Pool({
    connectionString,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 2,
  });
  const requestedTenant = arg('--tenant');
  const deep = process.argv.includes('--deep');
  const deepColumns = deep ? `,
         (SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(td.accounts, '[]'::jsonb)) item JOIN accounts r ON r.tenant_id = td.tenant_id AND r.id = item->>'id' WHERE r.raw IS DISTINCT FROM item) AS content_accounts,
         (SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(td.contacts, '[]'::jsonb)) item JOIN contacts r ON r.tenant_id = td.tenant_id AND r.id = item->>'id' WHERE r.raw IS DISTINCT FROM item) AS content_contacts,
         (SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(td.jobs, '[]'::jsonb)) item JOIN jobs r ON r.tenant_id = td.tenant_id AND r.id = item->>'id' WHERE r.raw IS DISTINCT FROM item) AS content_jobs,
         (SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(td.configs, '[]'::jsonb)) item JOIN board_configs r ON r.tenant_id = td.tenant_id AND r.id = item->>'id' WHERE r.raw IS DISTINCT FROM item) AS content_configs,
         (SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(td.activities, '[]'::jsonb)) item JOIN activities r ON r.tenant_id = td.tenant_id AND r.id = item->>'id' WHERE r.raw IS DISTINCT FROM item) AS content_activities,
         (SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(td.tasks, '[]'::jsonb)) item JOIN tasks r ON r.tenant_id = td.tenant_id AND r.id = item->>'id' WHERE r.raw IS DISTINCT FROM item) AS content_tasks`
    : '';
  try {
    const result = await pool.query(
      `SELECT td.tenant_id,
         CASE WHEN jsonb_typeof(td.accounts) = 'array' THEN jsonb_array_length(td.accounts) ELSE 0 END AS blob_accounts,
         CASE WHEN jsonb_typeof(td.contacts) = 'array' THEN jsonb_array_length(td.contacts) ELSE 0 END AS blob_contacts,
         CASE WHEN jsonb_typeof(td.jobs) = 'array' THEN jsonb_array_length(td.jobs) ELSE 0 END AS blob_jobs,
         CASE WHEN jsonb_typeof(td.configs) = 'array' THEN jsonb_array_length(td.configs) ELSE 0 END AS blob_configs,
         CASE WHEN jsonb_typeof(td.activities) = 'array' THEN jsonb_array_length(td.activities) ELSE 0 END AS blob_activities,
         CASE WHEN jsonb_typeof(td.tasks) = 'array' THEN jsonb_array_length(td.tasks) ELSE 0 END AS blob_tasks,
         (SELECT COUNT(*)::int FROM accounts WHERE tenant_id = td.tenant_id) AS relational_accounts,
         (SELECT COUNT(*)::int FROM contacts WHERE tenant_id = td.tenant_id) AS relational_contacts,
         (SELECT COUNT(*)::int FROM jobs WHERE tenant_id = td.tenant_id) AS relational_jobs,
         (SELECT COUNT(*)::int FROM board_configs WHERE tenant_id = td.tenant_id) AS relational_configs,
         (SELECT COUNT(*)::int FROM activities WHERE tenant_id = td.tenant_id) AS relational_activities,
         (SELECT COUNT(*)::int FROM tasks WHERE tenant_id = td.tenant_id) AS relational_tasks
         ${deepColumns}
       FROM tenant_data td
       ${requestedTenant ? 'WHERE td.tenant_id = $1' : ''}
       ORDER BY td.tenant_id`,
      requestedTenant ? [requestedTenant] : []
    );
    let mismatchCount = 0;
    for (const row of result.rows) {
      const parity = compareTenantDataCounts({
        accountCount: row.blob_accounts,
        contactCount: row.blob_contacts,
        jobCount: row.blob_jobs,
        configCount: row.blob_configs,
        activityCount: row.blob_activities,
        taskCount: row.blob_tasks,
      }, {
        account_count: row.relational_accounts,
        contact_count: row.relational_contacts,
        job_count: row.relational_jobs,
        config_count: row.relational_configs,
        activity_count: row.relational_activities,
        task_count: row.relational_tasks,
      }, true);
      if (deep) {
        for (const entity of ['accounts', 'contacts', 'jobs', 'configs', 'activities', 'tasks']) {
          const mismatchCount = Number(row[`content_${entity}`] || 0);
          if (mismatchCount) parity.mismatches.push({ entity: `${entity}-content`, blobCount: mismatchCount, relationalCount: 0 });
        }
        parity.matches = parity.mismatches.length === 0;
      }
      if (parity.matches) {
        console.log(`OK ${row.tenant_id}`);
      } else {
        mismatchCount += 1;
        console.error(`MISMATCH ${row.tenant_id}: ${parity.mismatches.map((item) => `${item.entity} ${item.blobCount}/${item.relationalCount}`).join(', ')}`);
      }
    }
    if (mismatchCount) throw new Error(`${mismatchCount} tenant workspace(s) failed relational parity.`);
    console.log(`Relational parity verified for ${result.rows.length} tenant workspace(s).`);
  } finally {
    await pool.end();
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
