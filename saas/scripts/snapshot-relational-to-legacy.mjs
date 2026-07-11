import { closeDb, dbCheckRelationalContentParity, dbGetTenantDataStats, dbLoadTenantSettings, dbSaveTenantData, initDb } from '../src/db.js';
import { getTenantRelationalStats, loadTenantRelationalData } from '../src/relational-reads.js';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const tenantId = arg('--tenant');
  const dryRun = process.argv.includes('--dry-run');
  if (!tenantId) throw new Error('Pass --tenant <tenant-id>.');
  if (!(await initDb())) throw new Error('DATABASE_URL is required.');

  const [data, settings, before, relational] = await Promise.all([
    loadTenantRelationalData(tenantId, true),
    dbLoadTenantSettings(tenantId),
    dbGetTenantDataStats(tenantId),
    getTenantRelationalStats(tenantId),
  ]);
  if (!data || !relational) throw new Error(`Relational workspace not found: ${tenantId}`);

  const summary = { tenantId, dryRun, before, relational };
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, ...summary }));
    return;
  }

  const saved = await dbSaveTenantData(tenantId, { ...data, settings: settings || {} }, { throwOnError: true });
  if (!saved?.saved) throw new Error(`Legacy snapshot save failed: ${saved?.reason || 'unknown error'}`);
  const parity = await dbCheckRelationalContentParity([tenantId]);
  if (!parity?.healthy) throw new Error(`Legacy snapshot content verification failed for ${tenantId}.`);
  console.log(JSON.stringify({ ok: true, ...summary, parity }));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
