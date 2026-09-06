// Runs SELECT-only fixtures against PostgreSQL; no tables or customer rows are
// modified. --emit-remote emits a compressed runner for an existing Railway SSH
// session, without uploading files or exposing database credentials.
import { brotliCompressSync } from 'node:zlib';
import { buildTenantJobQueries } from '../src/job-queries.js';
import { locationMatchesGeography, classifyWorkStyle } from '../src/job-geography.js';

const tenantId = 'query-quality-fixture';
const jobs = [
  ...Array.from({ length: 35 }, (_, index) => ({ id: `ca-${String(index).padStart(2, '0')}`, title: 'Senior Recruiter', location: index % 2 ? 'Toronto, ON' : 'Vancouver, BC', relevanceScore: 75 })),
  ...['New York, NY', 'London, UK', 'Cambridge, MA', 'Remote - US', 'North America', 'St. John’s, NL', 'New York, NY | Toronto, ON', 'Remote - Canada', 'Hybrid - Toronto, ON'].map((location, index) => ({ id: `other-${index}`, title: 'Recruiter', location, relevanceScore: 60 })),
].map((j) => ({ ...j, tenantId, accountId: 'account-1', companyName: 'Fixture Employer', active: true, postedAt: '2026-09-01', pipelineStage: ['ca-31', 'ca-32', 'ca-33'].includes(j.id) ? 'saved' : '' }));
const jobRows = [...jobs, { ...jobs[0], id: 'foreign-tenant', tenantId: 'not-this-tenant' }].map((j) => ({
  id: j.id, tenant_id: j.tenantId, account_id: j.accountId, title: j.title, company_name: j.companyName,
  location: j.location, source: 'Greenhouse', ats_type: 'greenhouse', posted_at: j.postedAt, active: j.active, raw: j,
}));
const accountRows = [{ id: 'account-1', tenant_id: tenantId, raw: { displayName: 'Fixture Employer' } }];
const contactRows = [{ id: 'contact-1', tenant_id: tenantId, account_id: 'account-1' }, { id: 'unrelated', tenant_id: 'not-this-tenant', account_id: 'account-1' }];

function fixtureStatement(statement) {
  const params = [...statement.params];
  const data = (rows) => { params.push(JSON.stringify(rows)); return `$${params.length}::jsonb`; };
  const prefix = `WITH jobs AS (SELECT * FROM jsonb_to_recordset(${data(jobRows)}) AS x(id text, tenant_id text, account_id text, title text, company_name text, location text, source text, ats_type text, posted_at text, active boolean, raw jsonb)),
    accounts AS (SELECT * FROM jsonb_to_recordset(${data(accountRows)}) AS x(id text, tenant_id text, raw jsonb)),
    contacts AS (SELECT * FROM jsonb_to_recordset(${data(contactRows)}) AS x(id text, tenant_id text, account_id text)) `;
  return { text: prefix + statement.text, params };
}

const tests = [];
for (const geography of ['', 'canada', 'us', 'canada_us', 'gta']) {
  for (const page of [1, 2, 3]) {
    const query = { active: true, geography, pageSize: 20, page, sortBy: 'relevance', hasContacts: true, minRelevance: 45 };
    const expected = jobs.filter((j) => locationMatchesGeography(j, geography))
      .sort((a, b) => b.relevanceScore - a.relevanceScore || a.id.localeCompare(b.id));
    const built = buildTenantJobQueries(tenantId, query);
    tests.push({ name: `${geography || 'all'} page ${page}`, rows: fixtureStatement(built.rows), count: fixtureStatement(built.count), total: expected.length, ids: expected.slice((page - 1) * 20, page * 20).map((j) => j.id) });
  }
}
for (const workStyle of ['remote', 'hybrid', 'onsite']) {
  const expected = jobs.filter((j) => classifyWorkStyle(j) === workStyle).sort((a, b) => a.id.localeCompare(b.id));
  const built = buildTenantJobQueries(tenantId, { workStyle });
  tests.push({ name: workStyle, rows: fixtureStatement(built.rows), count: fixtureStatement(built.count), total: expected.length, ids: expected.map((j) => j.id) });
}
const builtIds = buildTenantJobQueries(tenantId, { ids: 'ca-31,ca-32,ca-33,foreign-tenant', pageSize: 2 });
tests.push({ name: 'pipeline IDs before pagination and tenant isolation', rows: fixtureStatement(builtIds.rows), count: fixtureStatement(builtIds.count), total: 3, ids: ['ca-31', 'ca-32'] });

async function runChecks(db, tests, liveQuery, legacyFind = null) {
  if (!await db.initDb({ migrate: false, readOnly: true })) throw new Error('A read-only PostgreSQL connection is required');
  try {
    for (const t of tests) {
      const count = await db.dbQuery(t.count.text, t.count.params);
      const rows = await db.dbQuery(t.rows.text, t.rows.params);
      const ids = rows.rows.map((row) => row.raw.id);
      if (count.rows[0].total !== t.total || JSON.stringify(ids) !== JSON.stringify(t.ids)) throw new Error(`Fixture mismatch: ${t.name} (${count.rows[0].total}/${t.total})`);
      if (rows.rows.some((row) => row.raw.connectionCount !== 1)) throw new Error(`Network count mismatch: ${t.name}`);
    }
    console.log(`PostgreSQL job query fixtures: ${tests.length}/${tests.length} passed`);
    if (liveQuery) {
      const owners = await db.dbQuery("SELECT id FROM tenants WHERE plan = 'owner'");
      if (owners.rows.length !== 1) throw new Error('Live owner comparison requires exactly one owner workspace');
      const id = owners.rows[0].id;
      const enabled = String(process.env.BD_RELATIONAL_SQL_JOB_TENANTS || '').split(',').map((v) => v.trim());
      console.log(JSON.stringify({ jobSqlEnabledForOwner: enabled.includes('*') || enabled.includes(id) }));
      if (legacyFind) {
        const started = performance.now();
        const old = await legacyFind(id, { geography: 'canada', active: true, minRelevance: 45, sortBy: 'relevance', pageSize: 20 });
        console.log(JSON.stringify({ path: 'deployed findTenantJobsRelational Canada + relevance', total: old.total, pageRows: old.items.length, elapsedMs: Math.round(performance.now() - started) }));
      }
      for (const statement of [liveQuery.count, liveQuery.rows]) statement.params[0] = id;
      const start = performance.now();
      const count = await db.dbQuery(liveQuery.count.text, liveQuery.count.params);
      const rows = await db.dbQuery(liveQuery.rows.text, liveQuery.rows.params);
      console.log(JSON.stringify({ path: 'buildTenantJobQueries Canada + relevance', total: count.rows[0].total, pageRows: rows.rows.length, elapsedMs: Math.round(performance.now() - start) }));
      const legacyCount = await db.dbQuery(`SELECT COUNT(*)::int AS present_in_legacy FROM jobs j
        WHERE j.tenant_id = $1 AND j.active AND EXISTS (SELECT 1 FROM tenant_data d, jsonb_array_elements(d.jobs) item WHERE d.tenant_id = $1 AND item->>'id' = j.id)`, [id]);
      const total = await db.dbQuery('SELECT COUNT(*)::int AS active FROM jobs WHERE tenant_id = $1 AND active', [id]);
      console.log(JSON.stringify({ legacyOverlap: legacyCount.rows[0].present_in_legacy, relationalActive: total.rows[0].active }));
    }
  } finally { await db.closeDb(); }
}

const liveQuery = process.argv.includes('--owner-readonly') ? buildTenantJobQueries('', { geography: 'canada', active: true, minRelevance: 45, sortBy: 'relevance', pageSize: 20 }) : null;
if (process.argv.includes('--emit-remote')) {
  const source = `import * as db from 'file:///app/src/db.js';\nimport { findTenantJobsRelational } from 'file:///app/src/relational-reads.js';\nawait (${runChecks.toString()})(db, ${JSON.stringify(tests)}, ${JSON.stringify(liveQuery)}, findTenantJobsRelational);`;
  console.log(brotliCompressSync(source).toString('base64'));
} else {
  await runChecks(await import('../src/db.js'), tests, liveQuery);
}
