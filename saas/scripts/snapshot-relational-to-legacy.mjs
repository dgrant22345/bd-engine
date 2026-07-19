import { closeDb, dbCheckRelationalContentParity, dbGetTenantDataStats, dbLoadTenantSettings, dbSaveTenantData, initDb } from '../src/db.js';
import { getTenantRelationalStats, loadTenantRelationalData } from '../src/relational-reads.js';
import { requireMaintenanceApproval } from '../src/maintenance-safety.js';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const tenantId = String(arg('--tenant') || '').trim();
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  if (!tenantId) throw new Error('Pass --tenant <tenant-id>.');
  requireMaintenanceApproval({
    apply,
    tenantId,
    confirmation: String(arg('--confirm') || ''),
    expectedConfirmation: 'SNAPSHOT_LEGACY',
    backupReference: String(arg('--backup-reference') || ''),
    action: 'Applying the legacy snapshot',
  });
  if (!(await initDb({ migrate: false, readOnly: dryRun }))) throw new Error('DATABASE_URL is required.');

  const [data, settings, before, relational] = await Promise.all([
    loadTenantRelationalData(tenantId, true),
    dbLoadTenantSettings(tenantId),
    dbGetTenantDataStats(tenantId),
    getTenantRelationalStats(tenantId),
  ]);
  if (!data || !relational) throw new Error('The requested relational workspace was not found.');

  const summary = { mode: dryRun ? 'dry-run' : 'applied', workspaceCount: 1, legacy: before, relational };
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, ...summary }));
    return;
  }

  const saved = await dbSaveTenantData(tenantId, { ...data, settings: settings || {} }, { throwOnError: true });
  if (!saved?.saved) throw new Error(`Legacy snapshot save failed: ${saved?.reason || 'unknown error'}`);
  const parity = await dbCheckRelationalContentParity([tenantId]);
  if (!parity?.healthy) throw new Error('Legacy snapshot content verification failed.');
  console.log(JSON.stringify({ ok: true, ...summary, parityVerified: Boolean(parity?.healthy) }));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
