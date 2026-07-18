import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const plan = { displayName: 'Unlimited', limits: { jobBoards: -1 } };

function addTenant(store, tenantId) {
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner`, name: 'Owner' });
}

async function addReadyBoard(store, tenantId, config) {
  const account = await store.addAccount(tenantId, { displayName: config.companyName });
  return store.addConfig(tenantId, {
    accountId: account.id,
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
    ...config,
  });
}

test('incomplete SmartRecruiters pagination preserves the previous complete job set', async () => {
  const store = createStore();
  const tenantId = 'tenant-smartrecruiters-pagination';
  addTenant(store, tenantId);
  await addReadyBoard(store, tenantId, {
    companyName: 'Pagination Labs',
    atsType: 'smartrecruiters',
    boardId: 'pagination-labs',
  });

  let refresh = 1;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(String(url)).searchParams.get('offset') || 0);
    if (refresh === 1) {
      return Response.json({
        totalFound: 1,
        content: [{
          id: 'stable-job',
          name: 'Stable Account Executive',
          location: { city: 'Toronto', region: 'ON', country: 'Canada' },
          ref: 'https://jobs.smartrecruiters.com/pagination-labs/stable-job',
          releasedDate: '2026-07-01T12:00:00Z',
        }],
      });
    }
    if (offset === 0) {
      return Response.json({
        totalFound: 101,
        content: [{
          id: 'partial-job',
          name: 'Partial Result',
          location: { city: 'Toronto', region: 'ON', country: 'Canada' },
          ref: 'https://jobs.smartrecruiters.com/pagination-labs/partial-job',
        }],
      });
    }
    return new Response('missing page', { status: 404 });
  };

  try {
    const first = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(first.stats.newJobs, 1);

    refresh = 2;
    const failed = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(failed.stats.errors, 1);
    assert.equal(failed.stats.closedJobs, 0);
    assert.match(failed.errors[0].error, /existing jobs were preserved/i);

    const activeJobs = await store.findJobs(tenantId, { active: 'true', page: 1, pageSize: 20 });
    assert.equal(activeJobs.total, 1);
    assert.equal(activeJobs.items[0].title, 'Stable Account Executive');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Canada geography excludes ambiguous foreign and US locations', async () => {
  const store = createStore();
  const tenantId = 'tenant-geography-canada';
  addTenant(store, tenantId);
  await store.patchSettings(tenantId, { geographyFocus: 'Canada' });
  await addReadyBoard(store, tenantId, {
    companyName: 'Location Labs',
    atsType: 'greenhouse',
    boardId: 'location-labs',
  });

  const locations = [
    ['Toronto role', 'Toronto, ON'],
    ['Newfoundland role', "St. John's, NL"],
    ['Washington role', 'Vancouver, WA'],
    ['Netherlands role', 'Amsterdam, NL'],
    ['Australia role', 'Victoria, Australia'],
    ['EMEA role', 'Remote - EMEA'],
    ['Latin America role', 'Remote - Latin America'],
    ['North America role', 'Remote - North America'],
    ['Plain remote role', 'Remote'],
    ['Sentence role', 'Work based on customer needs'],
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    jobs: locations.map(([title, location], index) => ({
      id: `location-${index}`,
      title,
      location: { name: location },
      absolute_url: `https://boards.greenhouse.io/location-labs/jobs/${index}`,
      updated_at: '2026-07-01T12:00:00Z',
    })),
  });

  try {
    await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    const jobs = await store.findJobs(tenantId, { active: 'true', page: 1, pageSize: 20 });
    assert.deepEqual(
      jobs.items.map((job) => job.title).sort(),
      ['Newfoundland role', 'North America role', 'Plain remote role', 'Toronto role']
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('US geography recognizes state codes without accepting Canadian cities', async () => {
  const store = createStore();
  const tenantId = 'tenant-geography-us';
  addTenant(store, tenantId);
  await store.patchSettings(tenantId, { geographyFocus: 'US' });
  await addReadyBoard(store, tenantId, {
    companyName: 'US Location Labs',
    atsType: 'greenhouse',
    boardId: 'us-location-labs',
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ jobs: [
    { id: 'wa', title: 'Washington role', location: { name: 'Vancouver, WA' }, absolute_url: 'https://example.test/wa' },
    { id: 'on', title: 'Ontario role', location: { name: 'Toronto, ON' }, absolute_url: 'https://example.test/on' },
  ] });

  try {
    await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    const jobs = await store.findJobs(tenantId, { active: 'true', page: 1, pageSize: 20 });
    assert.equal(jobs.total, 1);
    assert.equal(jobs.items[0].title, 'Washington role');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('XML and HTML providers retry transient rate limits', async () => {
  const store = createStore();
  const tenantId = 'tenant-text-provider-retry';
  addTenant(store, tenantId);
  await addReadyBoard(store, tenantId, {
    companyName: 'Personio Retry Labs',
    atsType: 'personio',
    boardId: 'retry-labs',
    careersUrl: 'https://retry-labs.jobs.personio.de/',
  });

  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requests++;
    if (requests === 1) {
      return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } });
    }
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
      <workzag-jobs><position><id>retry-1</id><office>Toronto, ON</office>
      <department>Sales</department><name>Sales Engineer</name>
      <createdAt>2026-07-12T12:14:07+0000</createdAt></position></workzag-jobs>`, {
      status: 200,
      headers: { 'content-type': 'application/xml' },
    });
  };

  try {
    const result = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(requests, 2);
    assert.equal(result.stats.newJobs, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
