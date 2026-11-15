import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAccountPriority } from '../src/account-priority.js';
import { applyJobIdentityResolutions, mergeImportedJob } from '../src/job-identity.js';
import { clearSourceRetry, markSourceRetry, summarizeSourceRetries } from '../src/source-retries.js';
import { isGtaLocation } from '../src/job-geography.js';
import { createStore, getScheduledPipelineDecision } from '../src/store.js';
import { summarizeOperationalJobs } from '../src/operational-metrics.js';

const nowMs = Date.parse('2026-11-14T20:00:00Z');

test('GTA matching requires a GTA place rather than a province or country', () => {
  for (const location of ['Nisku-Alberta-Canada', 'Ottawa, Ontario, Canada', 'Canada', 'Ontario', 'Toronto, Ohio, United States', 'Hamilton, ON', 'Kitchener, ON', 'Waterloo, ON']) assert.equal(isGtaLocation(location), false, location);
  for (const location of ['Toronto, ON', 'Mississauga, Ontario, Canada', 'Newmarket, ON', 'Greater Toronto Area']) assert.equal(isGtaLocation(location), true, location);
});

test('import identity reconciliation preserves the durable workflow and first observation', () => {
  const durable = { id: 'durable', tenantId: 't', pipelineStage: 'replied', relevanceFeedback: { vote: 'relevant' }, firstSeenAt: '2025-01-01' };
  const incoming = { id: 'temporary', tenantId: 't', pipelineStage: '', active: true, title: 'Updated role', firstSeenAt: '2026-01-01' };
  const merged = mergeImportedJob(durable, incoming);
  assert.equal(merged.id, 'durable'); assert.equal(merged.pipelineStage, 'replied');
  assert.equal(merged.firstSeenAt, '2025-01-01'); assert.equal(merged.title, 'Updated role');
  assert.equal(merged.relevanceFeedback.vote, 'relevant');
  const rows = [durable, incoming];
  applyJobIdentityResolutions(rows, [{ incomingId: 'temporary', job: merged }]);
  assert.equal(rows.length, 1); assert.equal(rows[0], durable); assert.equal(durable.title, 'Updated role');
  const historical = mergeImportedJob({ ...durable, pipelineStage: '' }, incoming, { pipelineStage: 'saved', firstSeenAt: '2024-01-01' });
  assert.equal(historical.pipelineStage, 'saved'); assert.equal(historical.firstSeenAt, '2024-01-01');
});

test('source retries back off, respect provider cooldown and clear on a complete refresh', () => {
  const source = { active: true, lastImportStatus: 'partial' };
  markSourceRetry(source, null, nowMs);
  assert.equal(source.nextImportRetryAt, '2026-11-14T21:00:00.000Z');
  markSourceRetry(source, { retryAfterMs: 3 * 3600000 }, nowMs);
  assert.equal(source.nextImportRetryAt, '2026-11-14T23:00:00.000Z');
  assert.deepEqual(summarizeSourceRetries([source, { active: false, lastImportStatus: 'failed' }]), { count: 1, nextAttemptAt: source.nextImportRetryAt });
  const settings = { setupComplete: true, lastPipelineRun: new Date(nowMs - 3600000).toISOString(), sourceRetries: summarizeSourceRetries([source]) };
  assert.equal(getScheduledPipelineDecision({ settings, nowMs: nowMs + 3 * 3600000 }).reason, 'sources_due');
  assert.equal(getScheduledPipelineDecision({ settings, nowMs }).reason, 'fresh');
  clearSourceRetry(source); source.lastImportStatus = 'success';
  assert.equal(summarizeSourceRetries([source]).count, 0);
});

test('priority separates companies instead of saturating from raw volume', () => {
  const base = { connectionCount: 4, seniorContactCount: 1, talentContactCount: 1, openRoleCount: 30,
    newRoleCount7d: 2, lastHiringVerifiedAt: new Date(nowMs).toISOString() };
  const ordinary = calculateAccountPriority(base, nowMs).score;
  assert.ok(ordinary > 0 && ordinary < 90);
  assert.ok(calculateAccountPriority({ ...base, connectionCount: 100, openRoleCount: 10000 }, nowMs).score < 100);
  assert.ok(calculateAccountPriority({ ...base, relevantRoleCount: 0 }, nowMs).score < ordinary);
  assert.ok(calculateAccountPriority({ ...base, hiringCoverage: 'partial' }, nowMs).score < ordinary);
  assert.ok(calculateAccountPriority({ ...base, lastHiringVerifiedAt: '2025-01-01' }, nowMs).score < ordinary);
  assert.ok(calculateAccountPriority({ ...base, lastContactedAt: new Date(nowMs).toISOString() }, nowMs).score < ordinary);
});

test('coverage gaps are visible in durable operational health without becoming complete successes', () => {
  const row = { id: 'partial', type: 'live-job-import', status: 'completed', finishedAt: new Date(nowMs).toISOString(), result: { stats: { partialBoards: 2 } } };
  const summary = summarizeOperationalJobs([row], { nowMs });
  assert.equal(summary.ingestionPartialRuns24h, 1);
  assert.equal(summary.ingestionSuccessRate24h, 0); assert.equal(summary.healthy, false);
});

test('a targeted retry skips healthy boards and waits for source cooldown', async t => {
  const store = createStore(); const id = 'targeted-retry-fixture';
  store.ensureTenant({ id, name: id }, { id: `${id}-owner` });
  const first = await store.addAccount(id, { displayName: 'Healthy' });
  const second = await store.addAccount(id, { displayName: 'Retry' });
  for (const [accountId, boardId] of [[first.id, 'healthy-retry-fixture'], [second.id, 'failed-retry-fixture']]) {
    store.addConfig(id, { accountId, companyName: boardId, atsType: 'greenhouse', boardId, discoveryStatus: 'resolved', reviewStatus: 'approved', active: true });
  }
  let fail = true; const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(String(url));
    if (String(url).includes('failed-retry-fixture') && fail) return new Response('Busy', { status: 429, headers: { 'retry-after': '120' } });
    return Response.json({ jobs: [{ id: 'one', title: 'Recruiter', location: { name: 'Toronto, ON' }, absolute_url: 'https://fixture.example/job/1' }] });
  });
  const options = { plan: { limits: { jobBoards: -1 } }, autoDiscover: false };
  const initial = await store.importLiveJobs(id, options);
  assert.equal(initial.stats.errors, 1);
  requested.length = 0;
  await store.importLiveJobs(id, { ...options, retryOnly: true });
  assert.equal(requested.length, 0, 'cooldown prevents early requests');
  const configs = await store.findConfigs(id, { pageSize: 10 });
  const failed = configs.items.find(config => config.boardId === 'failed-retry-fixture');
  (await store.getConfig(id, failed.id)).nextImportRetryAt = new Date(0).toISOString();
  fail = false;
  const retried = await store.importLiveJobs(id, { ...options, retryOnly: true });
  assert.equal(retried.stats.configs, 1); assert.equal(retried.stats.errors, 0);
  assert.equal(requested.length, 1); assert.ok(requested.every(url => url.includes('failed-retry-fixture')));
  assert.equal((await store.getRuntimeStatus(id)).refreshSchedule.sourceRetries.count, 0);
});
