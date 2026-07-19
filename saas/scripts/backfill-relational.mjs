/**
 * Backfill the relational mirror from existing tenant_data JSONB blobs.
 *
 * Usage:
 *   npm run backfill:relational
 *   npm run backfill:relational -- --tenant tenant-abc123
 *   npm run backfill:relational -- --tenant tenant-abc123 --apply
 *     --confirm BACKFILL_RELATIONAL --backup-reference <backup-id-or-sha>
 */
import { closeDb, dbQuery, initDb } from '../src/db.js';
import { syncTenantRelationalMirror } from '../src/relational-writes.js';
import { requireMaintenanceApproval, workspaceLabel } from '../src/maintenance-safety.js';

function flag(name) {
  return process.argv.includes(name);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function counts(row) {
  return {
    accounts: Array.isArray(row.accounts) ? row.accounts.length : 0,
    contacts: Array.isArray(row.contacts) ? row.contacts.length : 0,
    jobs: Array.isArray(row.jobs) ? row.jobs.length : 0,
    configs: Array.isArray(row.configs) ? row.configs.length : 0,
    activities: Array.isArray(row.activities) ? row.activities.length : 0,
    tasks: Array.isArray(row.tasks) ? row.tasks.length : 0,
  };
}

async function main() {
  const apply = flag('--apply');
  const dryRun = !apply;
  const missingOnly = flag('--missing-only');
  const tenantId = String(arg('--tenant') || '').trim();
  requireMaintenanceApproval({
    apply,
    tenantId,
    confirmation: String(arg('--confirm') || ''),
    expectedConfirmation: 'BACKFILL_RELATIONAL',
    backupReference: String(arg('--backup-reference') || ''),
    action: 'Applying the relational backfill',
  });
  const ready = await initDb({ migrate: false, readOnly: dryRun });
  if (!ready) throw new Error('DATABASE_URL is required for relational backfill.');

  const result = await dbQuery(
    `SELECT tenant_id, accounts, contacts, jobs, configs, activities, tasks
     FROM tenant_data
     ${tenantId ? 'WHERE tenant_id = $1' : ''}
     ORDER BY tenant_id ASC`,
    tenantId ? [tenantId] : []
  );

  const rows = result?.rows || [];
  console.log(`Found ${rows.length} tenant workspace row(s).`);
  for (const [index, row] of rows.entries()) {
    const rowCounts = counts(row);
    const summary = { workspace: workspaceLabel(index), records: rowCounts };
    if (!dryRun) {
      const data = {
        accounts: row.accounts || [],
        contacts: row.contacts || [],
        jobs: row.jobs || [],
        configs: row.configs || [],
        activities: row.activities || [],
        tasks: row.tasks || [],
      };
      if (missingOnly) {
        const tables = { accounts: 'accounts', contacts: 'contacts', jobs: 'jobs', configs: 'board_configs', activities: 'activities', tasks: 'tasks' };
        for (const [section, table] of Object.entries(tables)) {
          const existing = await dbQuery(`SELECT id FROM ${table} WHERE tenant_id = $1`, [row.tenant_id]);
          const existingIds = new Set((existing?.rows || []).map((item) => item.id));
          data[section] = data[section].filter((item) => !existingIds.has(item.id));
        }
        summary.missingRecords = Object.fromEntries(Object.entries(data).map(([key, items]) => [key, items.length]));
      }
      await syncTenantRelationalMirror(row.tenant_id, data);
    }
    console.log(JSON.stringify(summary));
  }
  console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'applied', workspaceCount: rows.length }));
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
