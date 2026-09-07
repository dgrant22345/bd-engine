// SELECT-only PostgreSQL verification. CTE fixtures never write customer rows.
// --emit-remote runs the reviewed local query builder on the deployed database
// without copying credentials or replacing deployed application files.
import { brotliCompressSync } from 'node:zlib';
import { buildContactQuerySql, compareContacts } from '../src/contact-queries.js';

const tenant = 'people-query-fixture';
const people = Array.from({ length: 43 }, (_, i) => ({
  id: `ct-${String(i).padStart(2, '0')}`, tenantId: tenant,
  fullName: `Person ${String(42 - i).padStart(2, '0')}`,
  companyName: `Company ${i % 3}`, title: i % 2 ? 'Talent Partner' : 'Engineer',
  email: `fixture-${i}@example.com`, notes: i === 7 ? "O'Neil_100% \\ Montréal" : '',
  priorityScore: i * 2, outreachStatus: ['not_started', 'researching', 'replied'][i % 3],
  updatedAt: `2026-09-${String(i % 6 + 1).padStart(2, '0')}T00:00:00.000Z`,
}));
const rows = [...people, { ...people[0], tenantId: 'another-tenant', id: 'foreign' }].map(p => ({
  id: p.id, tenant_id: p.tenantId, full_name: p.fullName, company_name: p.companyName,
  title: p.title, email: p.email, notes: p.notes, priority_score: p.priorityScore,
  updated_at: p.updatedAt, raw: p,
}));

function statements(built, fixture = false) {
  const make = (sql, values) => {
    const params = [...values];
    if (!fixture) return { text: sql, params };
    params.push(JSON.stringify(rows));
    return { text: `WITH contacts AS (SELECT * FROM jsonb_to_recordset($${params.length}::jsonb)
      AS x(id text, tenant_id text, full_name text, company_name text, title text,
      email text, notes text, priority_score integer, updated_at timestamptz, raw jsonb)) ${sql}`, params };
  };
  return {
    count: make(`SELECT COUNT(*)::int AS total FROM contacts WHERE ${built.where}`, built.countParams),
    rows: make(`SELECT raw FROM contacts WHERE ${built.where} ORDER BY ${built.order} LIMIT ${built.limit} OFFSET ${built.offset}`, built.params),
  };
}
const queries = [];
for (const sortBy of ['name', 'name_desc', 'company', 'recent', 'priority']) {
  for (const page of [1, 2, 3]) queries.push({ sortBy, page, pageSize: 20 });
}
for (const outreachStatus of ['not_started', 'researching', 'replied', 'contacted']) queries.push({ outreachStatus, sortBy: 'name', pageSize: 10 });
for (const q of ["O'Neil_100%", '_', '%', '\\', 'Montréal', 'Talent Partner', 'Company 2', 'no match']) queries.push({ q, sortBy: 'name' });
queries.push({ minScore: 45, sortBy: 'priority', pageSize: 5, page: 2 }, { id: 'ct-07' }, { id: 'foreign' });
const tests = queries.map(query => {
  const built = buildContactQuerySql(tenant, query);
  const expected = people.filter(p => (!built.id || p.id === built.id)
    && (!built.minScore || p.priorityScore >= built.minScore)
    && (!built.outreachStatus || p.outreachStatus === built.outreachStatus)
    && (!built.q || ['fullName', 'companyName', 'title', 'email', 'notes'].some(key => p[key].toLowerCase().includes(built.q.toLowerCase()))))
    .sort((a, b) => compareContacts(a, b, built.sortBy));
  return { query, ...statements(built, true), total: expected.length, ids: expected.slice((built.page - 1) * built.pageSize, built.page * built.pageSize).map(p => p.id) };
});
const live = process.argv.includes('--owner-readonly') ? ['name', 'company', 'recent', 'priority'].map(sortBy => ({
  name: sortBy, ...statements(buildContactQuerySql('', { sortBy, pageSize: 20 })),
})) : [];

async function runChecks(db, tests, live) {
  if (!await db.initDb({ migrate: false, readOnly: true })) throw new Error('A read-only PostgreSQL connection is required');
  try {
    for (const t of tests) {
      const count = await db.dbQuery(t.count.text, t.count.params);
      const rows = await db.dbQuery(t.rows.text, t.rows.params);
      if (count.rows[0].total !== t.total || JSON.stringify(rows.rows.map(r => r.raw.id)) !== JSON.stringify(t.ids)) {
        throw new Error(`Contact fixture failed: ${JSON.stringify(t.query)}`);
      }
    }
    console.log(`PostgreSQL contact fixtures: ${tests.length}/${tests.length} passed (SELECT only)`);
    if (live.length) {
      const owners = await db.dbQuery("SELECT id FROM tenants WHERE plan = 'owner'");
      if (owners.rows.length !== 1) throw new Error('Owner checks require exactly one owner workspace');
      for (const t of live) {
        t.count.params[0] = owners.rows[0].id;
        t.rows.params[0] = owners.rows[0].id;
        const started = performance.now();
        const count = await db.dbQuery(t.count.text, t.count.params);
        const rows = await db.dbQuery(t.rows.text, t.rows.params);
        if (rows.rows.length !== Math.min(20, count.rows[0].total)) throw new Error('Live contact count/page mismatch');
        console.log(JSON.stringify({ path: 'buildContactQuerySql', sort: t.name, total: count.rows[0].total, pageRows: rows.rows.length, elapsedMs: Math.round(performance.now() - started) }));
      }
    }
  } finally { await db.closeDb(); }
}
if (process.argv.includes('--emit-remote')) {
  const source = `import * as db from 'file:///app/src/db.js'; await (${runChecks.toString()})(db, ${JSON.stringify(tests)}, ${JSON.stringify(live)});`;
  console.log(brotliCompressSync(source).toString('base64'));
} else {
  await runChecks(await import('../src/db.js'), tests, live);
}
