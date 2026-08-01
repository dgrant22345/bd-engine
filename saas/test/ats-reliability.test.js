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

test('job imports discard non-HTTP links before they reach the customer UI', async () => {
  const store = createStore();
  const tenantId = 'tenant-unsafe-job-url';
  addTenant(store, tenantId);
  await addReadyBoard(store, tenantId, {
    companyName: 'Safe Link Labs',
    atsType: 'greenhouse',
    boardId: 'safe-link-labs',
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ jobs: [{
    id: 'unsafe-url',
    title: 'Security Engineer',
    location: { name: 'Toronto, ON' },
    absolute_url: 'javascript:alert(1)',
  }] });

  try {
    await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    const imported = await store.findJobs(tenantId, { page: 1, pageSize: 20 });
    assert.equal(imported.total, 1);
    assert.equal(imported.items[0].jobUrl, '');
    assert.equal(imported.items[0].url, '');
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

test('Jobvite imports its current server-rendered careers board', async () => {
  const store = createStore();
  const tenantId = 'tenant-jobvite-html';
  addTenant(store, tenantId);
  await addReadyBoard(store, tenantId, {
    companyName: 'Jobvite HTML Labs',
    atsType: 'jobvite',
    boardId: 'jobvite-html-labs',
    resolvedBoardUrl: 'https://jobs.jobvite.com/jobvite-html-labs/jobs',
  });

  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(`<table class="jv-job-list"><tbody>
      <tr><td class="jv-job-list-name"><a href="/jobvite-html-labs/job/jv-1">Account Executive</a></td><td class="jv-job-list-location">Toronto, Ontario</td></tr>
      <tr><td class="jv-job-list-name"><a href="/jobvite-html-labs/job/jv-2">Sales Engineer</a></td><td class="jv-job-list-location">Chicago, Illinois</td></tr>
    </tbody></table>`, { status: 200, headers: { 'content-type': 'text/html' } });
  };

  try {
    const result = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(result.stats.newJobs, 2);
    assert.deepEqual(requestedUrls, ['https://jobs.jobvite.com/jobvite-html-labs/jobs']);
    const jobs = await store.findJobs(tenantId, { page: 1, pageSize: 20 });
    assert.deepEqual(jobs.items.map((job) => job.title).sort(), ['Account Executive', 'Sales Engineer']);
    assert.ok(jobs.items.every((job) => job.source === 'Jobvite' && /jobs\.jobvite\.com/.test(job.jobUrl)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('discovery decodes ATS links embedded as escaped JavaScript strings', async () => {
  const store = createStore();
  const tenantId = 'tenant-escaped-ats-discovery';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, {
    displayName: 'Escaped Link Labs',
    domain: 'escaped-link-labs.example',
    careersUrl: 'https://escaped-link-labs.example/careers',
  });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Escaped Link Labs',
    domain: 'escaped-link-labs.example',
    careersUrl: 'https://escaped-link-labs.example/careers',
    atsType: 'unknown',
    discoveryStatus: 'needs_review',
    reviewStatus: 'pending',
    active: false,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === 'https://escaped-link-labs.example/careers') {
      return new Response('<script>window.jobs=[{jobUrl:\\"https:\\/\\/jobs.ashbyhq.com\\/escaped-link-labs\\/job-1\\"}]</script>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (value.includes('api.ashbyhq.com/posting-api/job-board/escaped-link-labs')) {
      return Response.json({ jobs: [{ id: 'job-1', title: 'Sales Lead', location: 'Toronto, ON', jobUrl: 'https://jobs.ashbyhq.com/escaped-link-labs/job-1' }] });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const result = await store.runAtsDiscovery(tenantId, {
      limit: 1,
      discoveryConcurrency: 1,
      plan,
    });
    assert.equal(result.stats.mapped, 1);
    const config = (await store.findConfigs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(config.atsType, 'ashby');
    assert.equal(config.boardId, 'escaped-link-labs');
    assert.equal(config.discoveryStatus, 'resolved');
    assert.equal(config.discoveryMethod, 'careers_page_link');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('discovery follows direct ATS links exposed on an official company homepage', async () => {
  const store = createStore();
  const tenantId = 'tenant-homepage-ats-discovery';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, {
    displayName: 'Homepage Link Labs',
    domain: 'homepage-link-labs.example',
  });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: account.displayName,
    domain: account.domain,
    discoveryStatus: 'needs_review',
    reviewStatus: 'pending',
    active: false,
  });

  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    requestedUrls.push(value);
    if (value === 'https://homepage-link-labs.example/') {
      return new Response('<footer><a href="https://jobs.lever.co/homepage-link-labs">Careers</a></footer>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    if (value.includes('api.lever.co/v0/postings/homepage-link-labs')) {
      return Response.json([{
        id: 'homepage-role-1',
        text: 'Strategy Manager',
        hostedUrl: 'https://jobs.lever.co/homepage-link-labs/homepage-role-1',
        categories: { location: 'Remote' },
      }]);
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const result = await store.runAtsDiscovery(tenantId, {
      limit: 1,
      discoveryConcurrency: 1,
      plan,
    });
    assert.equal(result.stats.mapped, 1);
    assert.ok(requestedUrls.includes('https://homepage-link-labs.example/'));
    const config = (await store.findConfigs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(config.atsType, 'lever');
    assert.equal(config.boardId, 'homepage-link-labs');
    assert.equal(config.discoveryStatus, 'resolved');
    assert.equal(config.discoveryMethod, 'careers_page_link');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('static career fetches never follow redirects into a private network', async () => {
  const store = createStore();
  const tenantId = 'tenant-private-redirect';
  addTenant(store, tenantId);
  await addReadyBoard(store, tenantId, {
    companyName: 'Redirect Safety Labs',
    atsType: 'custom_static',
    boardId: 'redirect-safety-labs',
    resolvedBoardUrl: 'https://redirect-safety-labs.example/jobs',
  });

  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/internal-jobs' },
    });
  };

  try {
    const result = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(result.stats.errors, 1);
    assert.deepEqual(requestedUrls, ['https://redirect-safety-labs.example/jobs']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
