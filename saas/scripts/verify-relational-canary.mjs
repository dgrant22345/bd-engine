import { closeDb, initDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { findTenantById, loadFromDb as loadUsersFromDb } from '../src/users.js';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
  const tenantId = arg('--tenant');
  if (!tenantId) throw new Error('Pass --tenant <tenant-id>.');
  if (!(await initDb())) throw new Error('DATABASE_URL is required.');
  await loadUsersFromDb();
  const tenant = findTenantById(tenantId);
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const store = createStore();
  store.ensureTenant(tenant, { id: 'relational-verifier', name: 'Relational Verifier', email: '' });
  const startedAt = Date.now();
  const bootstrap = await store.getBootstrap(tenantId, { includeFilters: true });
  const usage = await store.getUsageCounts(tenantId);
  console.log(JSON.stringify({
    ok: true,
    tenantId,
    workspace: bootstrap.workspace?.name || '',
    accounts: usage.accounts,
    contacts: usage.contacts,
    jobBoards: usage.jobBoards,
    elapsedMs: Date.now() - startedAt,
  }));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
