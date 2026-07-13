import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const plan = { displayName: 'Unlimited', limits: { jobBoards: -1 } };
const providerJob = {
  id: 901,
  title: 'Lifecycle Engineer',
  location: { name: 'Toronto, ON' },
  absolute_url: 'https://boards.greenhouse.io/lifecycle/jobs/901',
  updated_at: '2026-07-01T12:00:00Z',
};

test('successful board refreshes close missing jobs and reactivate returning jobs', async () => {
  const store = createStore();
  const tenantId = 'tenant-job-lifecycle';
  store.ensureTenant({ id: tenantId, name: 'Lifecycle workspace' }, { id: tenantId + '-owner' });
  const account = await store.addAccount(tenantId, { displayName: 'Lifecycle Labs' });
  const config = store.addConfig(tenantId, {
    companyName: 'Lifecycle Labs',
    atsType: 'greenhouse',
    boardId: 'lifecycle',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });
  assert.equal(config.accountId || '', '');

  const responses = [
    { jobs: [providerJob] },
    new Error('temporary network failure'),
    { jobs: [] },
    { jobs: [providerJob] },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const first = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(first.stats.newJobs, 1);
    assert.equal(first.stats.closedJobs, 0);
    const linkedConfig = (await store.findConfigs(tenantId, { page: 1, pageSize: 10 })).items[0];
    assert.equal(linkedConfig.accountId, account.id);

    const failed = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(failed.stats.errors, 1);
    assert.equal(failed.stats.closedJobs, 0);
    assert.equal((await store.findJobs(tenantId, { active: 'true', page: 1, pageSize: 10 })).total, 1);

    const empty = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(empty.stats.closedJobs, 1);
    assert.equal((await store.findJobs(tenantId, { active: 'true', page: 1, pageSize: 10 })).total, 0);
    const closed = (await store.findJobs(tenantId, { page: 1, pageSize: 10 })).items[0];
    assert.equal(closed.active, false);
    assert.ok(closed.closedAt);

    const returned = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(returned.stats.newJobs, 0);
    assert.equal(returned.stats.reactivatedJobs, 1);
    const jobs = await store.findJobs(tenantId, { page: 1, pageSize: 10 });
    assert.equal(jobs.total, 1);
    assert.equal(jobs.items[0].active, true);
    assert.equal(jobs.items[0].closedAt, '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
