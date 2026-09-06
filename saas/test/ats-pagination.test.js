import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPaginatedAtsJobs, readAtsReportedTotal } from '../src/ats-pagination.js';

const rows = (offset, count) => Array.from({ length: count }, (_, index) => ({ id: String(offset + index) }));
const defaults = { providerName: 'Fixture', pageSize: 20, maxPages: 250, concurrency: 6, jobKey: (row) => row?.id };
const paginate = (options) => fetchPaginatedAtsJobs({ ...defaults, ...options });

test('totals distinguish zero from unknown and reject malformed counts', () => {
  assert.equal(readAtsReportedTotal(undefined, null), null);
  assert.equal(readAtsReportedTotal(0, 99), 0);
  assert.equal(readAtsReportedTotal('2615'), 2615);
  for (const value of ['', ' ', -1, 1.5, 'many', false, [], {}, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => readAtsReportedTotal(value), /invalid total/);
  }
});

test('fetches a 2,615-role board completely in order with bounded concurrency', async () => {
  let active = 0;
  let peak = 0;
  const offsets = [];
  const result = await paginate({ readPage: async (offset) => {
    offsets.push(offset);
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return { total: 2615, jobs: rows(offset, Math.min(20, 2615 - offset)) };
  } });
  assert.equal(result.complete, true);
  assert.equal(result.jobs.length, 2615);
  assert.deepEqual(result.jobs.map((row) => row.id), rows(0, 2615).map((row) => row.id));
  assert.equal(result.pagination.pagesFetched, 131);
  assert.equal(new Set(offsets).size, 131);
  assert.ok(peak > 1 && peak <= 6);
  assert.ok(result.pagination.elapsedMs >= 0);
});

test('page ceiling produces an explicit partial result', async () => {
  const result = await paginate({ maxPages: 2, readPage: async (offset) => ({ total: 41, jobs: rows(offset, 20) }) });
  assert.equal(result.complete, false);
  assert.equal(result.jobs.length, 40);
  assert.deepEqual(result.pagination.reasons, ['page_limit']);
});

for (const count of [0, 3, 20, 21, 40]) {
  test(`unknown total stops at the first short page (${count} jobs), without speculative 404 requests`, async () => {
    const offsets = [];
    const result = await paginate({ readPage: async (offset) => {
      assert.ok(offset <= count, 'must not request beyond the terminal page');
      offsets.push(offset);
      return { jobs: rows(offset, Math.min(20, count - offset)) };
    } });
    assert.equal(result.complete, true);
    assert.equal(result.reportedTotal, null);
    assert.equal(result.jobs.length, count);
    assert.equal(offsets.length, Math.floor(count / 20) + 1);
  });
}

test('a full unknown-total final page is not proof of completeness', async () => {
  const result = await paginate({ maxPages: 2, readPage: async (offset) => ({ jobs: rows(offset, 20) }) });
  assert.equal(result.complete, false);
  assert.deepEqual(result.pagination.reasons, ['page_limit']);
});

test('an explicit empty board is complete; contradictory zero is not', async () => {
  assert.equal((await paginate({ readPage: async () => ({ total: 0, jobs: [] }) })).complete, true);
  assert.equal((await paginate({ readPage: async () => ({ total: 0, jobs: rows(0, 1) }) })).complete, false);
});

test('repeated pages are deduplicated, stop further requests, and cannot close unseen jobs', async () => {
  const result = await paginate({ concurrency: 2, readPage: async () => ({ total: 2000, jobs: rows(0, 20) }) });
  assert.equal(result.complete, false);
  assert.equal(result.jobs.length, 20);
  assert.equal(result.pagination.pagesFetched, 3);
  assert.equal(result.pagination.duplicateRows, 40);
  assert.ok(result.pagination.reasons.includes('duplicate_jobs'));
});

test('changed totals are partial even when the initial job count was fetched', async () => {
  const result = await paginate({ readPage: async (offset) => ({ total: offset ? 41 : 40, jobs: rows(offset, 20) }) });
  assert.equal(result.jobs.length, 40);
  assert.equal(result.complete, false);
  assert.ok(result.pagination.reasons.includes('total_changed'));
});

test('missing and invalid rows cannot count toward proven coverage', async () => {
  const missing = await paginate({ readPage: async (offset) => ({ total: 21, jobs: offset ? [] : rows(0, 20) }) });
  assert.equal(missing.complete, false);
  assert.ok(missing.pagination.reasons.includes('missing_jobs'));
  const invalid = await paginate({ readPage: async () => ({ total: 2, jobs: [{ id: '0' }, {}] }) });
  assert.equal(invalid.complete, false);
  assert.equal(invalid.jobs.length, 2, 'invalid rows reach the import validator');
  assert.equal(invalid.pagination.uniqueJobs, 1);
  assert.ok(invalid.pagination.reasons.includes('invalid_rows'));
});

test('a failed later page throws a preservation error, not a board-removed HTTP 404', async () => {
  await assert.rejects(paginate({ readPage: async (offset) => {
    if (offset) throw new Error('HTTP 404');
    return { total: 21, jobs: rows(0, 1) }; // short first page is not a terminal page with a known total
  } }), (error) => /existing jobs were preserved/.test(error.message) && !/404/.test(error.message) && /404/.test(error.cause.message));
});

test('time budget stops additional dispatch and propagates one shared request deadline', async () => {
  let elapsed = 100;
  let calls = 0;
  const result = await paginate({ timeBudgetMs: 50, clock: () => elapsed, readPage: async (_offset, { deadlineAt }) => {
    calls++;
    assert.equal(deadlineAt, 150);
    elapsed = 151;
    return { total: 200, jobs: rows(0, 20) };
  } });
  assert.equal(calls, 1);
  assert.equal(result.complete, false);
  assert.ok(result.pagination.reasons.includes('time_budget'));
  assert.equal(result.pagination.elapsedMs, 51);
});

for (const change of ['none', 'total', 'head', 'failure']) {
  test(`head verification guards against a changing board (${change})`, async () => {
    let headRequests = 0;
    const promise = paginate({ recheckFirstPage: true, readPage: async (offset) => {
      if (offset === 0) headRequests++;
      const verifying = offset === 0 && headRequests > 1;
      if (verifying && change === 'failure') throw new Error('HTTP 404');
      return { total: verifying && change === 'total' ? 41 : 40, jobs: rows(verifying && change === 'head' ? 100 : offset, 20) };
    } });
    if (change === 'failure') await assert.rejects(promise, /could not verify.*existing jobs were preserved/);
    else {
      const result = await promise;
      assert.equal(result.complete, change === 'none');
      assert.equal(result.jobs.length, 40);
      assert.equal(result.pagination.verificationRequests, 1);
      assert.equal(result.pagination.pagesFetched, 2);
      if (change !== 'none') assert.ok(result.pagination.reasons.includes(change === 'head' ? 'source_changed' : 'total_changed'));
    }
  });
}
