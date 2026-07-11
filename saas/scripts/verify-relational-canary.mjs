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
  const accountQueryStartedAt = Date.now();
  const accountPage = await store.findAccounts(tenantId, { page: 1, pageSize: 20 });
  const accountQueryMs = Date.now() - accountQueryStartedAt;
  const contactQueryStartedAt = Date.now();
  const contactPage = await store.findContacts(tenantId, { page: 1, pageSize: 20 });
  const contactQueryMs = Date.now() - contactQueryStartedAt;
  const jobQueryStartedAt = Date.now();
  const jobPage = await store.findJobs(tenantId, { page: 1, pageSize: 20, active: 'true' });
  const jobQueryMs = Date.now() - jobQueryStartedAt;
  const configQueryStartedAt = Date.now();
  const configPage = await store.findConfigs(tenantId, { page: 1, pageSize: 20 });
  const configQueryMs = Date.now() - configQueryStartedAt;
  const usageStartedAt = Date.now();
  const usage = await store.getUsageCounts(tenantId);
  const usageQueryMs = Date.now() - usageStartedAt;
  console.log(JSON.stringify({
    ok: true,
    tenantId,
    workspace: bootstrap.workspace?.name || '',
    accounts: usage.accounts,
    contacts: usage.contacts,
    jobBoards: usage.jobBoards,
    accountPageTotal: accountPage.total,
    accountPageItems: accountPage.items.length,
    accountQueryMs,
    contactPageTotal: contactPage.total,
    contactPageItems: contactPage.items.length,
    contactQueryMs,
    jobPageTotal: jobPage.total,
    jobPageItems: jobPage.items.length,
    jobQueryMs,
    configPageTotal: configPage.total,
    configPageItems: configPage.items.length,
    configQueryMs,
    usageQueryMs,
    elapsedMs: Date.now() - startedAt,
  }));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
