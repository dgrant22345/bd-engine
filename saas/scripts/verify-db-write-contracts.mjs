import { dbClassifyLegacyAccounts, initDb, closeDb } from '../src/db.js';

async function main() {
  if (!await initDb({ migrate: false })) throw new Error('DATABASE_URL is required.');
  const tenantId = `tenant-contract-check-${Date.now()}`;
  const result = await dbClassifyLegacyAccounts(tenantId, [], new Date().toISOString());
  if (!result?.saved || result.relationalUpdated !== 0 || result.legacyUpdated !== 0) {
    throw new Error('No-op target classification contract returned an unexpected result.');
  }
  console.log('Database write contracts verified with a zero-row transaction.');
}

main()
  .catch((error) => {
    console.error(`Database contract verification failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
