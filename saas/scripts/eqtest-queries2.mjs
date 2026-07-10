/**
 * Equivalence test for the second batch of SQL reads: getTenantJobs (findJobs
 * source), findConfigs, getAccountDetailData — vs faithful in-memory replicas
 * from the blob. READ-ONLY against prod (except initDb's idempotent DDL).
 *
 * Usage: DATABASE_URL=... node scripts/eqtest-queries2.mjs
 */
import { initDb, dbQuery, closeDb } from '../src/db.js';
import * as rq from '../src/relational-queries.js';

const TENANT = process.env.EQ_TENANT || 'tenant-60abe43f';
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
};
const idset = (arr) => new Set(arr.map((x) => x.id));
const sameSet = (a, b) => a.length === b.length && new Set([...a.map((x) => x.id), ...b.map((x) => x.id)]).size === a.length;

(async () => {
  await initDb();
  const blob = (await dbQuery(
    'SELECT accounts, contacts, jobs, configs, activities FROM tenant_data WHERE tenant_id = $1', [TENANT])).rows[0];
  const accounts = blob.accounts || [], contacts = blob.contacts || [], jobs = blob.jobs || [],
    configs = blob.configs || [], activities = blob.activities || [];

  // ── getTenantJobs: must equal jobsForTenant (postedAt DESC), byte-for-byte ──
  console.log('\n=== getTenantJobs ===');
  // deterministic target order: postedAt DESC, id ASC (adapter's tiebreak)
  const memJobs = [...jobs].sort((a, b) =>
    String(b.postedAt).localeCompare(String(a.postedAt)) || String(a.id).localeCompare(String(b.id)));
  const sqlJobs = await rq.getTenantJobs(TENANT);
  check(`count (${sqlJobs.length})`, sqlJobs.length === memJobs.length, `sql=${sqlJobs.length} mem=${memJobs.length}`);
  check('postedAt-DESC order == target order', JSON.stringify(sqlJobs.map((j) => j.id)) === JSON.stringify(memJobs.map((j) => j.id)),
    `first diff at ${sqlJobs.findIndex((j, i) => j.id !== memJobs[i]?.id)}`);
  check('same member set', sameSet(sqlJobs, memJobs));

  // ── findConfigs: total + membership; SQL order = updated_at DESC, id ASC ──
  console.log('\n=== findConfigs ===');
  const cfgAll = await rq.findConfigs(TENANT, { page: 1, pageSize: 10000 });
  check(`total (${cfgAll.total})`, cfgAll.total === configs.length, `sql=${cfgAll.total} blob=${configs.length}`);
  const memCfgOrder = [...configs].sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.id).localeCompare(String(b.id)));
  const cfgFull = await dbQuery(
    'SELECT id FROM board_configs WHERE tenant_id = $1 ORDER BY updated_at DESC, id ASC', [TENANT]);
  check('full-list order == target order',
    JSON.stringify(cfgFull.rows.map((r) => r.id)) === JSON.stringify(memCfgOrder.map((c) => c.id)),
    `first diff at ${cfgFull.rows.findIndex((r, i) => r.id !== memCfgOrder[i]?.id)}`);
  // page 2 membership
  const cfgP2 = await rq.findConfigs(TENANT, { page: 2, pageSize: 25 });
  const memP2 = memCfgOrder.slice(25, 50);
  check('page2 ids match', JSON.stringify(cfgP2.items.map((c) => c.id)) === JSON.stringify(memP2.map((c) => c.id)));

  // ── getAccountDetailData: pick accounts that actually have related records ──
  console.log('\n=== getAccountDetailData ===');
  const byNorm = (acc) => acc.normalizedName;
  const withJobs = accounts.filter((a) => jobs.some((j) => j.accountId === a.id)).slice(0, 3);
  const withContacts = accounts.filter((a) => contacts.some((c) => c.accountId === a.id)).slice(0, 3);
  const sample = [...new Set([...withJobs, ...withContacts, accounts[0]])].filter(Boolean).slice(0, 5);
  console.log(`  sampling ${sample.length} accounts`);
  for (const a of sample) {
    const d = await rq.getAccountDetailData(TENANT, a.id);
    const memC = contacts.filter((c) => c.accountId === a.id);
    const memJ = jobs.filter((j) => j.accountId === a.id);
    const memA = activities.filter((x) => x.accountId === a.id);
    const memCfg = configs.filter((c) => c.normalizedCompanyName === byNorm(a));
    const ok = d && d.account.id === a.id && sameSet(d.contacts, memC) && sameSet(d.jobs, memJ) &&
      sameSet(d.activities, memA) && sameSet(d.configs, memCfg);
    check(`${a.id} (c=${memC.length} j=${memJ.length} a=${memA.length} cfg=${memCfg.length})`, ok,
      d ? `sql c=${d.contacts.length} j=${d.jobs.length} a=${d.activities.length} cfg=${d.configs.length}` : 'null');
  }
  const missing = await rq.getAccountDetailData(TENANT, 'acct-does-not-exist');
  check('missing account → null', missing === null);

  console.log(`\n==== ${pass} pass / ${fail} fail ====`);
  await closeDb();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
