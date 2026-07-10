/**
 * Equivalence test: SQL-pushdown list reads (relational-queries.js, against
 * codex's accounts/contacts mirror) vs the in-memory store semantics.
 *
 * READ-ONLY against prod except initDb()'s idempotent IF-NOT-EXISTS DDL (the
 * app's own boot path; the mirror is already deployed, so this is a no-op).
 *
 * Usage: node scripts/eqtest-queries.mjs
 *   requires DATABASE_URL (public proxy) in env.
 */
import { initDb, dbQuery, closeDb } from '../src/db.js';
import * as rq from '../src/relational-queries.js';

const TENANT = process.env.EQ_TENANT || 'tenant-60abe43f';

// ── Faithful replica of store.js in-memory helpers ──────────────────────────
function filterText(items, query, fields) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => fields.some((field) => String(item[field] || '').toLowerCase().includes(q)));
}
function paginate(items, query = {}) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.max(1, Math.min(10000, Number(query.pageSize || 25)));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageSize, total: items.length };
}
// store.js stores accounts sorted by targetScore DESC (stable), contacts by
// priorityScore DESC (stable). Blob array order is the stable tiebreak.
function storeSortedByScore(items, scoreKey) {
  return [...items].sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));
}
// The order the SQL adapter targets: score DESC, updated_at DESC, id ASC.
// updated_at mirrors codex's writer stamp: item.updatedAt || item.createdAt.
const stamp = (x) => String(x.updatedAt || x.createdAt || '');
function sqlOrder(items, scoreKey) {
  return [...items].sort((a, b) =>
    (b[scoreKey] || 0) - (a[scoreKey] || 0) ||
    stamp(b).localeCompare(stamp(a)) ||
    String(a.id || '').localeCompare(String(b.id || '')));
}

const ACCT_FIELDS = ['displayName', 'domain', 'industry', 'location', 'owner', 'notes'];
const CONT_FIELDS = ['fullName', 'companyName', 'title', 'email', 'notes'];

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

async function loadBlob() {
  const row = (await dbQuery('SELECT accounts, contacts FROM tenant_data WHERE tenant_id = $1', [TENANT])).rows[0];
  if (!row) throw new Error(`no tenant_data row for ${TENANT}`);
  return { accounts: row.accounts || [], contacts: row.contacts || [] };
}

async function runEntity(label, blobItems, scoreKey, fields, sqlFn, queries) {
  console.log(`\n=== ${label} (blob n=${blobItems.length}) ===`);
  const memScore = storeSortedByScore(blobItems, scoreKey);   // today's in-memory order
  const memSql = sqlOrder(blobItems, scoreKey);               // order the SQL adapter targets
  for (const q of queries) {
    const memAll = filterText(memScore, q.q, fields);
    const memPage = paginate(memAll, q);
    const sqlPage = await sqlFn(TENANT, q);
    const label2 = `${label} q=${JSON.stringify(q.q || '')} p${q.page || 1}/${q.pageSize || 25}`;

    // 1. filter correctness — totals must match the blob filter exactly.
    check(`${label2} total (${sqlPage.total})`, sqlPage.total === memPage.total,
      `sql=${sqlPage.total} mem=${memPage.total}`);

    // 2. SQL page must equal the same filter+paginate over the SQL-target order.
    const memSqlPage = paginate(filterText(memSql, q.q, fields), q);
    const idsA = sqlPage.items.map((x) => x.id).join('|');
    const idsB = memSqlPage.items.map((x) => x.id).join('|');
    check(`${label2} page ids == target order`, idsA === idsB,
      `\n    sql=${idsA.slice(0, 120)}\n    mem=${idsB.slice(0, 120)}`);
  }

  // 3. Full ordered id list straight from SQL (no pageSize clamp), for exact
  //    order + membership checks over the WHOLE entity.
  const table = label === 'accounts' ? 'accounts' : 'contacts';
  const scoreCol = label === 'accounts' ? 'target_score' : 'priority_score';
  const sqlIds = (await dbQuery(
    `SELECT id FROM ${table} WHERE tenant_id = $1 ORDER BY ${scoreCol} DESC, updated_at DESC, id ASC`,
    [TENANT])).rows.map((r) => r.id);
  const memScoreIds = memScore.map((x) => x.id);       // today's in-memory order
  const memSqlIds = memSql.map((x) => x.id);           // faithful SQL-target order

  // Exact order equivalence: SQL == the faithful target order, byte for byte.
  check(`${label} full-list order == target order`, JSON.stringify(sqlIds) === JSON.stringify(memSqlIds),
    `first diff at ${sqlIds.findIndex((id, i) => id !== memSqlIds[i])}`);
  // Membership equivalence: same id set as the in-memory list.
  check(`${label} full-list same member set (n=${sqlIds.length})`,
    sqlIds.length === memScoreIds.length && new Set([...sqlIds, ...memScoreIds]).size === sqlIds.length);

  // Quantify user-visible reordering vs today's score-only stable order.
  const posDiff = sqlIds.reduce((n, id, i) => n + (id === memScoreIds[i] ? 0 : 1), 0);
  const distinctScores = new Set(memScore.map((x) => x[scoreKey] || 0)).size;
  console.log(`  info  ${label}: ${posDiff}/${sqlIds.length} positions differ from today's order; ${distinctScores} distinct scores (intra-tie reordering by updated_at)`);
}

(async () => {
  await initDb();
  const t0 = Date.now();
  const { accounts, contacts } = await loadBlob();
  console.log(`Loaded blob in ${Date.now() - t0}ms`);

  await runEntity('accounts', accounts, 'targetScore', ACCT_FIELDS, (t, q) => rq.findAccounts(t, q), [
    { q: '', page: 1, pageSize: 25 },
    { q: '', page: 5, pageSize: 25 },
    { q: '', page: 3, pageSize: 100 },
    { q: 'bank', page: 1, pageSize: 25 },
    { q: 'inc', page: 1, pageSize: 25 },
    { q: 'toronto', page: 1, pageSize: 25 },
    { q: 'capital', page: 2, pageSize: 10 },
    { q: 'zzzznomatch', page: 1, pageSize: 25 },
  ]);

  await runEntity('contacts', contacts, 'priorityScore', CONT_FIELDS, (t, q) => rq.findContacts(t, q), [
    { q: '', page: 1, pageSize: 25 },
    { q: '', page: 10, pageSize: 50 },
    { q: 'director', page: 1, pageSize: 25 },
    { q: 'cfa', page: 1, pageSize: 25 },
    { q: 'vp', page: 1, pageSize: 25 },
    { q: 'toronto', page: 1, pageSize: 25 },
    { q: 'zzzznomatch', page: 1, pageSize: 25 },
  ]);

  console.log(`\n==== ${pass} pass / ${fail} fail ====`);
  await closeDb();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
