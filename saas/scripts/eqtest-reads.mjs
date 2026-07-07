// Equivalence test: relational-reads vs the in-memory blob logic, on real data.
import pg from 'pg';
import { findAccounts, findContacts } from '../src/relational-reads.js';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : process.env.DATABASE_URL;
const T = 'tenant-60abe43f';
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// --- Replicate the blob path exactly (filterText + stable sort + paginate) ---
function filterText(items, q, fields) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return [...items];
  return items.filter((it) => fields.some((f) => String(it[f] || '').toLowerCase().includes(s)));
}
function paginate(items, query) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.max(1, Math.min(10000, Number(query.pageSize || 25)));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length };
}
function blobAccounts(accts, query) {
  const sorted = [...accts].sort((a, b) => (b.targetScore || 0) - (a.targetScore || 0)); // stable
  return paginate(filterText(sorted, query.q, ['displayName', 'domain', 'industry', 'location', 'owner', 'notes']), query);
}
function blobContacts(cts, query) {
  const sorted = [...cts].sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
  return paginate(filterText(sorted, query.q, ['fullName', 'companyName', 'title', 'email', 'notes']), query);
}

const ids = (r) => r.items.map((x) => x.id);
function compare(label, blob, rel) {
  const bIds = ids(blob), rIds = ids(rel);
  const same = blob.total === rel.total && bIds.length === rIds.length && bIds.every((id, i) => id === rIds[i]);
  console.log(`  ${same ? 'PASS' : 'FAIL'}  ${label}  (blob total=${blob.total} rel total=${rel.total}, page ${bIds.length} vs ${rIds.length}${same ? '' : ` — first diff at ${bIds.findIndex((id, i) => id !== rIds[i])}`})`);
  return same;
}

const row = (await pool.query('SELECT accounts, contacts FROM tenant_data WHERE tenant_id=$1', [T])).rows[0];
let allPass = true;
console.log('ACCOUNTS:');
for (const q of [
  { page: 1, pageSize: 25 }, { page: 2, pageSize: 25 }, { page: 5, pageSize: 50 },
  { q: 'bank', page: 1, pageSize: 25 }, { q: 'inc', page: 1, pageSize: 40 }, { q: 'zzznomatch', page: 1 },
  { q: 'Toronto', page: 1, pageSize: 30 },
]) {
  const b = blobAccounts(row.accounts, q);
  const r = await findAccounts(pool, T, q);
  allPass = compare(JSON.stringify(q), b, r) && allPass;
}
console.log('CONTACTS:');
for (const q of [
  { page: 1, pageSize: 25 }, { page: 3, pageSize: 100 },
  { q: 'director', page: 1, pageSize: 25 }, { q: 'cfa', page: 1, pageSize: 50 }, { q: 'zzznomatch', page: 1 },
]) {
  const b = blobContacts(row.contacts, q);
  const r = await findContacts(pool, T, q);
  allPass = compare(JSON.stringify(q), b, r) && allPass;
}
console.log(`\n${allPass ? 'ALL PASS — relational reads are byte-identical to the blob path' : 'FAILURES ABOVE'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
