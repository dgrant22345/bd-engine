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
  accountId: i % 4 === 0 ? '' : `acct-${i % 5}`,
  email: `fixture-${i}@example.com`, notes: i === 7 ? "O'Neil_100% \\ Montréal" : '',
  priorityScore: i * 2, outreachStatus: ['not_started', 'researching', 'replied'][i % 3],
  updatedAt: `2026-09-${String(i % 6 + 1).padStart(2, '0')}T00:00:00.000Z`,
}));
const rows = [...people, { ...people[0], tenantId: 'another-tenant', id: 'foreign' }].map(p => ({
  id: p.id, tenant_id: p.tenantId, account_id: p.accountId || null, full_name: p.fullName, company_name: p.companyName,
  title: p.title, email: p.email, notes: p.notes, priority_score: p.priorityScore,
  updated_at: p.updatedAt, raw: p,
}));

// Roles for the "worth contacting first" order: acct-1 and acct-3 have an
// active role; acct-2 has only a closed one; acct-4's role belongs to another workspace.
// With a saved focus (minimum score 45), only acct-3's role is in it: acct-1's
// are outside the focus or below the score, acct-2's is closed.
const jobs = [
  { tenant_id: tenant, account_id: 'acct-1', active: true, raw: { relevanceScore: 60, matchesSearchFocus: false } },
  { tenant_id: tenant, account_id: 'acct-1', active: true, raw: { relevanceScore: 30, matchesSearchFocus: true } },
  { tenant_id: tenant, account_id: 'acct-3', active: true, raw: { relevanceScore: 80, matchesSearchFocus: true } },
  { tenant_id: tenant, account_id: 'acct-2', active: false, raw: { relevanceScore: 90, matchesSearchFocus: true } },
  { tenant_id: 'another-tenant', account_id: 'acct-4', active: true, raw: { relevanceScore: 90, matchesSearchFocus: true } },
];
const hiringAccounts = new Set(jobs.filter(job => job.tenant_id === tenant && job.active).map(job => job.account_id));
const focusAccounts = new Set(jobs.filter(job => job.tenant_id === tenant && job.active && job.raw.matchesSearchFocus !== false && job.raw.relevanceScore >= 45).map(job => job.account_id));
const hiringTier = (person, focus) => (focus != null && focusAccounts.has(person.accountId) ? 2 : hiringAccounts.has(person.accountId) ? 1 : 0);

function statements(built, fixture = false) {
  const make = (sql, values) => {
    const params = [...values];
    if (!fixture) return { text: sql, params };
    params.push(JSON.stringify(rows), JSON.stringify(jobs));
    return { text: `WITH contacts AS (SELECT * FROM jsonb_to_recordset($${params.length - 1}::jsonb)
      AS x(id text, tenant_id text, account_id text, full_name text, company_name text, title text,
      email text, notes text, priority_score integer, updated_at timestamptz, raw jsonb)),
      jobs AS (SELECT * FROM jsonb_to_recordset($${params.length}::jsonb) AS j(tenant_id text, account_id text, active boolean, raw jsonb)) ${sql}`, params };
  };
  return {
    count: make(`SELECT COUNT(*)::int AS total FROM contacts WHERE ${built.where}`, built.countParams),
    rows: make(`SELECT raw FROM contacts WHERE ${built.where} ORDER BY ${built.order} LIMIT ${built.limit} OFFSET ${built.offset}`, built.params),
  };
}
const queries = [];
for (const sortBy of ['name', 'name_desc', 'company', 'recent', 'priority', 'call']) {
  for (const page of [1, 2, 3]) queries.push({ sortBy, page, pageSize: 20 });
}
for (const outreachStatus of ['not_started', 'researching', 'replied', 'contacted']) queries.push({ outreachStatus, sortBy: 'name', pageSize: 10 });
for (const q of ["O'Neil_100%", '_', '%', '\\', 'Montréal', 'Talent Partner', 'Company 2', 'no match']) queries.push({ q, sortBy: 'name' });
queries.push({ minScore: 45, sortBy: 'priority', pageSize: 5, page: 2 }, { id: 'ct-07' }, { id: 'foreign' });
queries.push({ sortBy: 'call', outreachStatus: 'researching', pageSize: 10 }, { sortBy: 'call', q: 'Talent Partner', pageSize: 7, page: 2 });
queries.push({ sortBy: 'call', pageSize: 20, focus: 45 }, { sortBy: 'call', pageSize: 20, page: 2, focus: 45 }, { sortBy: 'call', outreachStatus: 'replied', pageSize: 6, focus: 45 });
const tests = queries.map(query => {
  const built = buildContactQuerySql(tenant, query, { focusMinimumRelevance: query.focus ?? null });
  const expected = people.filter(p => (!built.id || p.id === built.id)
    && (!built.minScore || p.priorityScore >= built.minScore)
    && (!built.outreachStatus || p.outreachStatus === built.outreachStatus)
    && (!built.q || ['fullName', 'companyName', 'title', 'email', 'notes'].some(key => p[key].toLowerCase().includes(built.q.toLowerCase()))))
    .sort((a, b) => compareContacts(a, b, built.sortBy, person => hiringTier(person, query.focus)));
  return { query, ...statements(built, true), total: expected.length, ids: expected.slice((built.page - 1) * built.pageSize, built.page * built.pageSize).map(p => p.id) };
});
const live = process.argv.includes('--owner-readonly') ? ['name', 'company', 'recent', 'priority', 'call'].map(sortBy => ({
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
