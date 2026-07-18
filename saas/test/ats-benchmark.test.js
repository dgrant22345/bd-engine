import test from 'node:test';
import assert from 'node:assert/strict';
import { runAtsBenchmark } from '../scripts/ats-benchmark.mjs';

test('every supported ATS adapter satisfies the normalized job contract', async () => {
  const result = await runAtsBenchmark({ logger: {} });
  assert.equal(result.ok, true, JSON.stringify(result.rows, null, 2));
  assert.equal(result.rows.length, 12);
  assert.equal(result.jobs.length, 12);
  assert.equal(result.importResult.stats.errors, 0);
});
