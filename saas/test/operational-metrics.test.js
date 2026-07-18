import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeOperationalJobs } from '../src/operational-metrics.js';

test('operational metrics flag stale work and failed ingestion', () => {
  const nowMs = Date.parse('2026-07-18T12:00:00.000Z');
  const summary = summarizeOperationalJobs([
    { type: 'ats-discovery', status: 'running', startedAt: '2026-07-18T11:30:00.000Z' },
    { type: 'live-job-import', status: 'completed', finishedAt: '2026-07-18T11:00:00.000Z' },
    { type: 'live-job-import', status: 'failed', finishedAt: '2026-07-18T10:00:00.000Z' },
  ], { nowMs, staleAfterMs: 15 * 60 * 1000 });
  assert.equal(summary.staleJobs, 1);
  assert.equal(summary.recentFailedJobs, 1);
  assert.equal(summary.ingestionSuccessRate24h, 50);
  assert.equal(summary.healthy, false);
});

test('an idle queue without recent failures is healthy', () => {
  const summary = summarizeOperationalJobs([], { nowMs: 1, staleAfterMs: 1000 });
  assert.equal(summary.healthy, true);
  assert.equal(summary.ingestionSuccessRate24h, null);
});

test('queue health follows the 95 percent ingestion SLO', () => {
  const nowMs = Date.parse('2026-07-18T12:00:00.000Z');
  const completed = Array.from({ length: 19 }, (_, index) => ({
    type: 'live-job-import',
    status: 'completed',
    finishedAt: `2026-07-18T${String(index % 10).padStart(2, '0')}:00:00.000Z`,
  }));
  const summary = summarizeOperationalJobs([
    ...completed,
    { type: 'live-job-import', status: 'failed', finishedAt: '2026-07-18T11:00:00.000Z' },
  ], { nowMs });
  assert.equal(summary.ingestionSuccessRate24h, 95);
  assert.equal(summary.healthy, true);
});

test('active work without a valid timestamp is unhealthy', () => {
  const summary = summarizeOperationalJobs([{ type: 'ats-discovery', status: 'running' }]);
  assert.equal(summary.invalidActiveTimestamps, 1);
  assert.equal(summary.healthy, false);
});
