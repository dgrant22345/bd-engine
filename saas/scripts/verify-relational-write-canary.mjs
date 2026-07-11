import { closeDb, dbCheckRelationalContentParity, dbQuery, initDb } from '../src/db.js';
import { createStore, flushPendingSaves } from '../src/store.js';
import { findTenantById, loadFromDb as loadUsersFromDb } from '../src/users.js';

const CANARY_ID = 'cfg-relational-write-canary';
const CANARY_ATS = 'relational_canary';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function prepareStore(tenantId) {
  await loadUsersFromDb();
  const tenant = findTenantById(tenantId);
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  const store = createStore();
  store.ensureTenant(tenant, { id: 'relational-write-verifier', name: 'Relational Write Verifier', email: '' });
  return store;
}

async function createCanary(tenantId) {
  const store = await prepareStore(tenantId);
  await store.getBootstrap(tenantId, { includeFilters: true });
  await dbQuery('DELETE FROM board_configs WHERE tenant_id = $1 AND id = $2', [tenantId, CANARY_ID]);
  store.addConfig(tenantId, {
    id: CANARY_ID,
    companyName: 'Relational write canary',
    atsType: CANARY_ATS,
    boardId: CANARY_ID,
    active: false,
    source: 'system_canary',
  });
  await flushPendingSaves();

  const [relational, legacy] = await Promise.all([
    dbQuery('SELECT COUNT(*)::int AS count FROM board_configs WHERE tenant_id = $1 AND id = $2', [tenantId, CANARY_ID]),
    dbQuery(
      `SELECT COUNT(*)::int AS count
       FROM tenant_data
       WHERE tenant_id = $1
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(configs, '[]'::jsonb)) item
           WHERE item->>'id' = $2
         )`,
      [tenantId, CANARY_ID]
    ),
  ]);
  const relationalCount = Number(relational?.rows?.[0]?.count || 0);
  const legacyCount = Number(legacy?.rows?.[0]?.count || 0);
  if (relationalCount !== 1 || legacyCount !== 0) {
    throw new Error(`Canary write failed: relational=${relationalCount}, legacy=${legacyCount}.`);
  }
  return { mode: 'create', relationalCount, legacyCount };
}

async function verifyCanary(tenantId) {
  const store = await prepareStore(tenantId);
  const bootstrap = await store.getBootstrap(tenantId, { includeFilters: true });
  const page = await store.findConfigs(tenantId, { page: 1, pageSize: 10000 });
  const found = page.items.some((item) => item.id === CANARY_ID);
  const filterFound = (bootstrap.filters?.atsTypes || []).includes(CANARY_ATS);
  if (!found || !filterFound) throw new Error(`Canary restart read failed: record=${found}, filter=${filterFound}.`);
  return { mode: 'verify', found, filterFound };
}

async function cleanupCanary(tenantId) {
  const result = await dbQuery(
    `DELETE FROM board_configs
     WHERE tenant_id = $1 AND (id = $2 OR id LIKE 'cfg-write-canary-%')`,
    [tenantId, CANARY_ID]
  );
  const parity = await dbCheckRelationalContentParity([tenantId]);
  if (!parity?.healthy) throw new Error(`Canary cleanup parity failed for ${tenantId}.`);
  return { mode: 'cleanup', deleted: result?.rowCount || 0, parity };
}

async function main() {
  const tenantId = arg('--tenant');
  const mode = arg('--mode') || 'verify';
  if (!tenantId) throw new Error('Pass --tenant <tenant-id>.');
  if (!['create', 'verify', 'cleanup'].includes(mode)) throw new Error('Pass --mode create, verify, or cleanup.');
  if (!(await initDb())) throw new Error('DATABASE_URL is required.');

  const result = mode === 'create'
    ? await createCanary(tenantId)
    : mode === 'cleanup'
      ? await cleanupCanary(tenantId)
      : await verifyCanary(tenantId);
  console.log(JSON.stringify({ ok: true, tenantId, canaryId: CANARY_ID, ...result }));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
