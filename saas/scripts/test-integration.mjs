// End-to-end: store.findAccounts/findContacts with BD_USE_RELATIONAL on,
// exercising store -> relational-reads -> db pool against the real tenant.
process.env.BD_USE_RELATIONAL = 'true';
process.env.DATABASE_URL = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : process.env.DATABASE_URL;

const { initDb, closeDb } = await import('../src/db.js');
await initDb();
const { createStore } = await import('../src/store.js');
const store = createStore();

const T = 'tenant-60abe43f';
// Give the store a tenant profile so assertTenant passes (no blob load needed).
store.ensureTenant({ id: T, slug: 'derek', name: 'Derek', plan: 'owner', status: 'active', persona: 'bd' }, { id: 'user-int' });

const t0 = Date.now();
const acc = await store.findAccounts(T, { page: 1, pageSize: 5 });
const accMs = Date.now() - t0;
const t1 = Date.now();
const con = await store.findContacts(T, { q: 'director', page: 1, pageSize: 5 });
const conMs = Date.now() - t1;

console.log(`findAccounts (flag ON): total=${acc.total}, page=${acc.items.length}, ${accMs}ms`);
console.log('  top:', acc.items.map((a) => `${a.displayName}(${a.targetScore})`).join(', '));
console.log(`findContacts q="director" (flag ON): total=${con.total}, page=${con.items.length}, ${conMs}ms`);
console.log('  top:', con.items.map((c) => c.fullName).join(', '));
console.log('\nShape check — items are full account objects:', typeof acc.items[0] === 'object' && 'normalizedName' in acc.items[0]);
await closeDb();
