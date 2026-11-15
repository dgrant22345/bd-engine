import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initDb, closeDb, dbQuery, dbSaveTenant, dbSaveBackgroundJob } from '../src/db.js';
import { syncTenantRelationalChanges, syncTenantRelationalMirror } from '../src/relational-writes.js';
import { buildJobGeographySql, isGtaLocation } from '../src/job-geography.js';
import { createStore } from '../src/store.js';

const target = new URL(process.env.DATABASE_URL || 'postgres://missing');
if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1'].includes(target.hostname)
  || !['/bd_ingestion_fixture', '/bd_engine_recovery_source'].includes(target.pathname)) throw new Error('Ingestion verification requires an isolated local fixture database in NODE_ENV=test.');
const tenantId = `ingestion-fixture-${randomUUID()}`;
const now = new Date().toISOString();
if (!await initDb()) throw new Error('Fixture database unavailable');
try {
  await dbSaveTenant({ id: tenantId, slug: tenantId, name: 'Ingestion fixture', plan: 'trial', status: 'active', createdAt: now, updatedAt: now });
  const original = { id: `${tenantId}-original`, tenantId, naturalKey: `${tenantId}|stable-role`, title: 'Original', active: true,
    pipelineStage: 'replied', relevanceFeedback: { vote: 'relevant' }, createdAt: '2025-01-01T00:00:00Z', firstSeenAt: '2025-01-01T00:00:00Z', updatedAt: now };
  await syncTenantRelationalChanges(tenantId, { jobs: [original] });
  const startedAt = performance.now();
  const retries = await Promise.all([1, 2].map(n => syncTenantRelationalChanges(tenantId, { jobs: [{ ...original,
    id: `${tenantId}-retry-${n}`, title: 'Refreshed', pipelineStage: '', relevanceFeedback: undefined, updatedAt: new Date().toISOString() }] })));
  assert.ok(retries.every(result => result.jobIdentities[0].job.id === original.id));
  const snapshot = { jobs: [{ ...original, id: `${tenantId}-stale-snapshot`, title: 'Snapshot refreshed', pipelineStage: '', relevanceFeedback: undefined, updatedAt: new Date(Date.now() + 1000).toISOString() }] };
  await syncTenantRelationalMirror(tenantId, snapshot, { reconcile: true });
  assert.equal(snapshot.jobs.length, 1); assert.equal(snapshot.jobs[0].id, original.id);
  const rows = (await dbQuery('SELECT id, raw, first_seen_at FROM jobs WHERE tenant_id=$1', [tenantId])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].id, original.id);
  assert.equal(rows[0].raw.pipelineStage, 'replied'); assert.equal(rows[0].raw.relevanceFeedback.vote, 'relevant');
  assert.equal(rows[0].first_seen_at, original.firstSeenAt);
  // An existing old record that changes identity is retained as history.
  const historical = { ...original, id: `${tenantId}-historical`, naturalKey: `${tenantId}|old-role`, pipelineStage: 'saved', updatedAt: now };
  await syncTenantRelationalChanges(tenantId, { jobs: [historical] });
  const changed = await syncTenantRelationalChanges(tenantId, { jobs: [{ ...historical, naturalKey: original.naturalKey }] });
  assert.equal(changed.jobIdentities[0].retiredJob.pipelineStage, 'saved');
  const retained = (await dbQuery('SELECT raw FROM jobs WHERE tenant_id=$1 ORDER BY id', [tenantId])).rows.map(row => row.raw);
  assert.equal(retained.length, 2); assert.equal(retained.filter(row => row.active).length, 1);
  assert.ok(retained.some(row => row.supersededBy === original.id));
  const places = ['Toronto, ON', 'Newmarket, ON', 'Nisku-Alberta-Canada', 'Ottawa, Ontario, Canada', 'Toronto, Ohio, United States'];
  const geography = await dbQuery(`SELECT location, ${buildJobGeographySql('gta', 'location')} AS matches FROM unnest($1::text[]) AS place(location)`, [places]);
  for (const row of geography.rows) assert.equal(row.matches, isGtaLocation(row.location), row.location);
  // No in-memory background jobs: health must still read persisted failures.
  await dbSaveBackgroundJob(tenantId, { id: `${tenantId}-failed`, type: 'live-job-import', status: 'failed', finishedAt: now, updatedAt: now });
  const health = await createStore().getOperationalMetrics();
  assert.ok(health.ingestionFailedRuns24h >= 1); assert.equal(health.healthy, false); assert.equal(health.historyAvailable, true);
  console.log(`PostgreSQL ingestion identity, preserved workflow, geography parity and restart health verified in ${Math.round(performance.now() - startedAt)}ms.`);
} finally {
  await dbQuery('DELETE FROM tenants WHERE id=$1', [tenantId]);
  await closeDb();
}
