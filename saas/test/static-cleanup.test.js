import test from 'node:test';
import assert from 'node:assert/strict';
import { quarantineStaticBrowseJobs } from '../src/store.js';

test('static cleanup quarantines only explicit collection URLs and preserves worked-on records', () => {
  const configs = [{ id: 'static', atsType: 'custom_static' }, { id: 'ats', atsType: 'greenhouse' }];
  const row = (id, path, extra = {}) => ({ id, configId: 'static', active: true,
    title: 'Category Manager', jobUrl: `https://example.com${path}`, ...extra });
  const jobs = [row('bad', '/jobs/s-recruitment/'), row('search', '/jobs/search'),
    row('saved', '/jobs/s-recruitment/', { pipelineStage: 'saved' }),
    row('real', '/jobs/category-manager-123'), row('deep', '/jobs/s-tech/platform-engineer-123'),
    row('other', '/jobs/search', { configId: 'ats' }), row('unselected', '/jobs/search', { configId: 'elsewhere' }),
    row('closed', '/jobs/search', { active: false }), row('invalid', '/jobs/search', { jobUrl: 'invalid' })];
  const before = structuredClone(jobs);
  const startedAt = performance.now();
  const changed = quarantineStaticBrowseJobs(jobs, configs, '2026-09-08T00:00:00Z');
  console.log(`Static cleanup fixture: ${(performance.now() - startedAt).toFixed(2)}ms`);
  assert.deepEqual(changed.map((item) => item.id), ['bad', 'search']);
  assert.equal(jobs.length, before.length, 'no record is deleted');
  assert.equal(jobs[0].closureReason, 'invalid_collection_page');
  assert.equal(jobs[0].closedAt, '2026-09-08T00:00:00Z');
  assert.deepEqual(jobs.slice(2), before.slice(2));
  assert.equal(quarantineStaticBrowseJobs(jobs, configs).length, 0, 'cleanup is idempotent');
});
