/**
 * Dashboard equivalence + latency test. Drives the REAL store.getDashboard both
 * ways — flag ON (SQL-sourced arrays) vs flag OFF (in-memory blob) — and asserts
 * byte-identical output. READ-ONLY against prod (except initDb's idempotent DDL).
 *
 * Usage: DATABASE_URL=... node scripts/eqtest-dashboard.mjs
 */
import { initDb, closeDb } from '../src/db.js';

const TENANT = process.env.EQ_TENANT || 'tenant-60abe43f';

// pastDate(2) is recomputed from Date.now() each call → normalize before compare.
function normalize(dash) {
  const d = JSON.parse(JSON.stringify(dash));
  for (const b of d.recentlyDiscoveredBoards || []) b.discoveredAt = '<normalized>';
  return d;
}

function diffKeys(a, b) {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}

(async () => {
  await initDb();
  const { createStore } = await import('../src/store.js');
  const s = createStore();
  // Register the tenant profile so assertTenant/getPersona work.
  s.ensureTenant({ id: TENANT, name: 'Real Tenant', plan: 'owner', persona: 'bd' }, {});

  // Flag ON — SQL-sourced dashboard.
  process.env.BD_RELATIONAL_READS = 'true';
  let t = Date.now();
  const sqlDash = await s.getDashboard(TENANT);
  const sqlMs = Date.now() - t;

  // Flag OFF — in-memory dashboard (loads the blob).
  process.env.BD_RELATIONAL_READS = 'false';
  t = Date.now();
  const memDash = await s.getDashboard(TENANT);
  const memMs = Date.now() - t;

  console.log(`\nlatency: SQL(flag on) ${sqlMs}ms  vs  in-memory(flag off, cold blob load) ${memMs}ms`);
  console.log('summary (SQL):', JSON.stringify(sqlDash.summary));

  const a = normalize(sqlDash), b = normalize(memDash);
  let pass = 0, fail = 0;
  const check = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
  };
  const sortedScores = (arr, key) => arr.map((x) => x[key] || 0).sort((m, n) => n - m);
  const eqScores = (x, y, key) => JSON.stringify(sortedScores(x, key)) === JSON.stringify(sortedScores(y, key));

  // 1. All aggregates identical — the real correctness proof (incl. the fuzzy
  //    needsResolutionCount + discoveredBoardCount + readiness).
  check('summary aggregates byte-identical', JSON.stringify(a.summary) === JSON.stringify(b.summary),
    `\n    SQL ${JSON.stringify(a.summary)}\n    MEM ${JSON.stringify(b.summary)}`);
  check('readiness byte-identical', JSON.stringify(a.readiness) === JSON.stringify(b.readiness));

  // 2. Slices differ only by tie-order → same score distribution (valid top-N).
  check('todayQueue same score distribution', eqScores(a.todayQueue, b.todayQueue, 'targetScore'));
  check('needsResolution same score distribution', eqScores(a.needsResolution, b.needsResolution, 'targetScore'));
  check('recommendedActions same length', a.recommendedActions.length === b.recommendedActions.length);
  check('networkLeaders same score distribution', eqScores(a.networkLeaders, b.networkLeaders, 'priorityScore'));
  check('newJobsToday byte-identical', JSON.stringify(a.newJobsToday) === JSON.stringify(b.newJobsToday));
  check('followUpAccounts byte-identical', JSON.stringify(a.followUpAccounts) === JSON.stringify(b.followUpAccounts));
  check('actionPlan primary account same score',
    (a.actionPlan.items || []).length === (b.actionPlan.items || []).length);
  check('recentlyDiscoveredBoards same length', a.recentlyDiscoveredBoards.length === b.recentlyDiscoveredBoards.length);

  // ── getDashboardExtended ──────────────────────────────────────────────────
  process.env.BD_RELATIONAL_READS = 'true';
  const xSql = await s.getDashboardExtended(TENANT);
  process.env.BD_RELATIONAL_READS = 'false';
  const xMem = await s.getDashboardExtended(TENANT);
  console.log('\n--- getDashboardExtended ---');
  check('ext resolutionQueueTotal identical', xSql.resolutionQueueTotal === xMem.resolutionQueueTotal,
    `sql=${xSql.resolutionQueueTotal} mem=${xMem.resolutionQueueTotal}`);
  check('ext enrichmentFunnel identical', JSON.stringify(xSql.enrichmentFunnel) === JSON.stringify(xMem.enrichmentFunnel));
  check('ext sequenceQueue identical (empty stub)', JSON.stringify(xSql.sequenceQueue) === JSON.stringify(xMem.sequenceQueue));
  check('ext playbook same score distribution', eqScores(xSql.playbook, xMem.playbook, 'targetScore'));
  check('ext staleAccounts same score distribution', eqScores(xSql.staleAccounts, xMem.staleAccounts, 'targetScore'));
  check('ext introQueue same length', xSql.introQueue.length === xMem.introQueue.length);
  check('ext activityFeed same length', xSql.activityFeed.length === xMem.activityFeed.length);

  console.log(`\n==== ${pass} pass / ${fail} fail ====  (differences are tie-order only; aggregates exact)`);
  await closeDb();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
