/**
 * CG-007/CG-008: account rollup repair — recompute openRoleCount / jobCount /
 * connectionCount from relational truth (active jobs, linked contacts).
 *
 * Default is DRY RUN: prints affected workspaces and per-field change totals,
 * writes nothing. --apply performs the repair inside a transaction per tenant,
 * updating both the typed columns and the raw JSON payload so storage parity
 * is preserved. Refuses to apply without --backup-done acknowledging that a
 * fresh verified backup exists.
 *
 * IMPORTANT (apply mode): the running app holds tenants in memory and its next
 * debounced save would clobber DB-level repairs. Apply only during a window
 * where the app will be restarted right after (railway redeploy), or against a
 * tenant known to be evicted/idle.
 *
 * Usage:
 *   node scripts/repair-rollups.mjs                     # dry run, all tenants
 *   node scripts/repair-rollups.mjs --tenant <id>       # dry run, one tenant
 *   node scripts/repair-rollups.mjs --tenant <id> --apply --backup-done
 */
import { initDb, dbQuery, closeDb } from '../src/db.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes('--apply');
const BACKUP_DONE = process.argv.includes('--backup-done');

function isActiveJob(job) {
  return job && job.active !== false;
}

async function loadRows(table, tenantId) {
  const result = await dbQuery(`SELECT id, raw FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  return result?.rows || [];
}

async function repairTenant(tenantId) {
  const [accounts, contacts, jobs] = await Promise.all([
    loadRows('accounts', tenantId),
    loadRows('contacts', tenantId),
    loadRows('jobs', tenantId),
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
    if (before.openRoleCount === activeJobs && before.jobCount === activeJobs && before.connectionCount === linkedContacts) continue;
    changes.push({ id, displayName: raw.displayName, before, after: { openRoleCount: activeJobs, jobCount: activeJobs, connectionCount: linkedContacts } });
  }

  if (APPLY && changes.length) {
    // One transaction per tenant: typed columns + raw JSON stay consistent.
    await dbQuery('BEGIN', []);
    try {
      for (const change of changes) {
        await dbQuery(
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
          [tenantId, change.id, change.after.openRoleCount, change.after.connectionCount, new Date().toISOString()]
        );
      }
      await dbQuery('COMMIT', []);
    } catch (err) {
      await dbQuery('ROLLBACK', []);
      throw err;
    }
  }

  return { tenantId, accountCount: accounts.length, changes };
}

async function main() {
  if (APPLY && !BACKUP_DONE) {
    throw new Error('--apply requires --backup-done (take and verify a backup first).');
  }
  const ready = await initDb({ migrate: false, readOnly: !APPLY });
  if (!ready) throw new Error('DATABASE_URL is required.');

  const tenantFilter = arg('--tenant');
  const tenants = tenantFilter
    ? [{ tenant_id: tenantFilter }]
    : (await dbQuery('SELECT DISTINCT tenant_id FROM accounts ORDER BY tenant_id', [])).rows;

  let totalChanged = 0;
  for (const { tenant_id: tenantId } of tenants) {
    const result = await repairTenant(tenantId);
    totalChanged += result.changes.length;
    if (!result.changes.length) {
      console.log(`${tenantId}: rollups already match relational truth (${result.accountCount} accounts)`);
      continue;
    }
    const roleDrops = result.changes.filter((c) => c.after.openRoleCount < c.before.openRoleCount).length;
    const roleRaises = result.changes.filter((c) => c.after.openRoleCount > c.before.openRoleCount).length;
    console.log(`${tenantId}: ${result.changes.length}/${result.accountCount} accounts ${APPLY ? 'REPAIRED' : 'need repair'} (roles corrected down: ${roleDrops}, up: ${roleRaises})`);
    for (const change of result.changes.slice(0, 5)) {
      console.log(`  ${change.displayName || change.id}: roles ${change.before.openRoleCount}→${change.after.openRoleCount}, jobs ${change.before.jobCount}→${change.after.jobCount}, connections ${change.before.connectionCount}→${change.after.connectionCount}`);
    }
    if (result.changes.length > 5) console.log(`  … and ${result.changes.length - 5} more`);
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN — nothing written'}: ${totalChanged} account(s) across ${tenants.length} workspace(s)`);
}

main()
  .catch((err) => {
    console.error('Rollup repair failed:', err.message);
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeDb();
  });
