/**
 * Recompute account role and contact rollups from relational truth.
 *
 * Dry-run is the default. Apply mode is limited to one workspace and requires
 * an exact confirmation plus a verified backup reference. Relational rows,
 * the legacy snapshot, and the audit record commit in one transaction.
 *
 * Usage:
 *   node scripts/repair-rollups.mjs
 *   node scripts/repair-rollups.mjs --tenant <id>
 *   node scripts/repair-rollups.mjs --tenant <id> --apply \
 *     --confirm REPAIR_ROLLUPS --backup-reference <backup-id-or-sha>
 */
import { initDb, dbQuery, dbTransaction, closeDb } from '../src/db.js';
import { requireMaintenanceApproval, workspaceLabel } from '../src/maintenance-safety.js';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const apply = process.argv.includes('--apply');
const tenantFilter = String(arg('--tenant') || '').trim();
const confirmation = String(arg('--confirm') || '');
const backupReference = String(arg('--backup-reference') || '').trim();

function isActiveJob(job) {
  return job && job.active !== false;
}

async function loadRows(query, table, tenantId) {
  const result = await query(`SELECT id, raw FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  return result?.rows || [];
}

async function inspectTenant(query, tenantId) {
  const [accounts, contacts, jobs] = await Promise.all([
    loadRows(query, 'accounts', tenantId),
    loadRows(query, 'contacts', tenantId),
    loadRows(query, 'jobs', tenantId),
  ]);

  const activeJobsByAccount = new Map();
  for (const { raw } of jobs) {
    if (raw?.accountId && isActiveJob(raw)) {
      activeJobsByAccount.set(raw.accountId, (activeJobsByAccount.get(raw.accountId) || 0) + 1);
    }
  }
  const contactsByAccount = new Map();
  for (const { raw } of contacts) {
    if (raw?.accountId) {
      contactsByAccount.set(raw.accountId, (contactsByAccount.get(raw.accountId) || 0) + 1);
    }
  }

  const changes = [];
  for (const { id, raw } of accounts) {
    if (!raw) continue;
    const activeJobs = activeJobsByAccount.get(id) || 0;
    const linkedContacts = contactsByAccount.get(id) || 0;
    const before = {
      openRoleCount: Number(raw.openRoleCount || 0),
      jobCount: Number(raw.jobCount || 0),
      connectionCount: Number(raw.connectionCount || 0),
    };
    const after = { openRoleCount: activeJobs, jobCount: activeJobs, connectionCount: linkedContacts };
    if (before.openRoleCount === after.openRoleCount
      && before.jobCount === after.jobCount
      && before.connectionCount === after.connectionCount) continue;
    changes.push({ id, before, after });
  }

  return { accounts, changes };
}

function summarize(accounts, changes) {
  return {
    accountCount: accounts.length,
    changedCount: changes.length,
    roleDrops: changes.filter((change) => change.after.openRoleCount < change.before.openRoleCount).length,
    roleRaises: changes.filter((change) => change.after.openRoleCount > change.before.openRoleCount).length,
  };
}

async function repairTenant(tenantId) {
  if (!apply) {
    const { accounts, changes } = await inspectTenant(dbQuery, tenantId);
    return summarize(accounts, changes);
  }

  return dbTransaction(async (query) => {
    await query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const { accounts, changes } = await inspectTenant(query, tenantId);
    if (changes.length) {
      const timestamp = new Date().toISOString();
      const legacyUpdates = Object.fromEntries(changes.map(({ id, after }) => [id, after]));
      for (const change of changes) {
        const updated = await query(
          `UPDATE accounts SET
             open_role_count = $3,
             raw = raw || jsonb_build_object(
               'openRoleCount', $3::int,
               'jobCount', $3::int,
               'connectionCount', $4::int,
               'updatedAt', $5::text
             ),
             updated_at = $5
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, change.id, change.after.openRoleCount, change.after.connectionCount, timestamp]
        );
        if (updated.rowCount !== 1) throw new Error('An account changed during the rollup repair. Retry from a new dry run.');
      }

      const legacy = await query(
        `UPDATE tenant_data data
         SET accounts = repaired.accounts, updated_at = $3
         FROM (
           SELECT coalesce(jsonb_agg(
             CASE
               WHEN updates.value IS NULL THEN account.item
               ELSE account.item || updates.value || jsonb_build_object('updatedAt', $3::text)
             END
             ORDER BY account.ordinality
           ), '[]'::jsonb) AS accounts
           FROM tenant_data source
           CROSS JOIN LATERAL jsonb_array_elements(source.accounts) WITH ORDINALITY AS account(item, ordinality)
           LEFT JOIN jsonb_each($2::jsonb) updates ON updates.key = account.item->>'id'
           WHERE source.tenant_id = $1
         ) repaired
         WHERE data.tenant_id = $1`,
        [tenantId, JSON.stringify(legacyUpdates), timestamp]
      );
      if (legacy.rowCount !== 1) throw new Error('The legacy workspace snapshot is missing; no rollups were changed.');

      await query(
        `INSERT INTO audit_log
          (tenant_id, actor_user_id, action, entity_type, entity_id, before, after, metadata, created_at)
         VALUES ($1, '', 'account.rollups_repaired', 'tenant', $1, $2, $3, $4, $5)`,
        [
          tenantId,
          JSON.stringify({ accountCount: accounts.length }),
          JSON.stringify({ repairedAccountCount: changes.length }),
          JSON.stringify({ backupReference, privacySafe: true }),
          timestamp,
        ]
      );
    }
    return summarize(accounts, changes);
  });
}

async function main() {
  requireMaintenanceApproval({
    apply,
    tenantId: tenantFilter,
    confirmation,
    expectedConfirmation: 'REPAIR_ROLLUPS',
    backupReference,
    action: 'Applying the rollup repair',
  });
  if (!await initDb({ migrate: false, readOnly: !apply })) throw new Error('DATABASE_URL is required.');

  const tenants = tenantFilter
    ? [{ tenant_id: tenantFilter }]
    : (await dbQuery('SELECT DISTINCT tenant_id FROM accounts ORDER BY tenant_id', [])).rows;

  let totalChanged = 0;
  for (const [index, { tenant_id: tenantId }] of tenants.entries()) {
    const result = await repairTenant(tenantId);
    totalChanged += result.changedCount;
    console.log(JSON.stringify({
      workspace: workspaceLabel(index),
      mode: apply ? 'applied' : 'dry-run',
      ...result,
    }));
  }
  console.log(JSON.stringify({
    mode: apply ? 'applied' : 'dry-run',
    workspaceCount: tenants.length,
    changedAccountCount: totalChanged,
    auditRecorded: apply && totalChanged > 0,
  }));
}

main()
  .catch((error) => {
    console.error(`Rollup repair failed: ${error.message}`);
    process.exitCode = 2;
  })
  .finally(closeDb);
