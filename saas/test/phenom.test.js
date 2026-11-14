import test from 'node:test';
import assert from 'node:assert/strict';
import { getPhenomBoardId, getPhenomJobUrl, getPhenomSearchUrl, readPhenomBoard, readPhenomLocale, readPhenomLocation, readPhenomSite } from '../src/phenom.js';
import { createStore } from '../src/store.js';

// Shapes follow the public Phenom pages and widgets API as read from
// jobs.rbc.com, jobs.bmo.com, jobs.bell.ca, careers.opentext.com and
// careers.aircanada.com in November 2026.
const page = (settings, total = null) => `<html><script>phApp.ddo = ${JSON.stringify({ siteConfig: { data: settings } })}; ${total === null ? '' : `phApp.ddo.x = {"eagerLoadRefineSearch":{"status":200,"hits":10,"totalHits":${total}}};`}</script></html>`;
const SETTINGS = { refNum: 'NWCOGLOBAL', locale: 'en_ca', country: 'ca', pageId: 'page35', siteType: 'external', widgetApiEndpoint: 'https://jobs.northwind.example/widgets' };
const role = (id, extra = {}) => ({ jobId: id, title: `Role ${id}`, location: 'Toronto, Ontario, Canada', category: extra.category || 'Technology', postedDate: '2026-11-10T00:00:00.000+0000', ...extra });

test('a Phenom page gives its settings; other pages, and an API on another host, do not', () => {
  const site = readPhenomSite(page(SETTINGS, 791), 'https://jobs.northwind.example/ca/en/search-results');
  assert.deepEqual(site, {
    refNum: 'NWCOGLOBAL', endpoint: 'https://jobs.northwind.example/widgets', origin: 'https://jobs.northwind.example', sitePath: '/ca/en',
    searchUrl: 'https://jobs.northwind.example/ca/en/search-results', locale: 'en_ca', country: 'ca', pageId: 'page35', siteType: 'external', total: 791,
  });
  // The home page redirects to /us/en from some places: the path decides the search page.
  assert.equal(readPhenomSite(page({ ...SETTINGS, locale: 'en_us', country: 'us' }), 'https://jobs.northwind.example/us/en').searchUrl, 'https://jobs.northwind.example/us/en/search-results');
  assert.equal(readPhenomSite('<html>Careers</html>', 'https://jobs.northwind.example/'), null);
  assert.equal(readPhenomSite(page({ ...SETTINGS, widgetApiEndpoint: 'https://collector.attacker.example/widgets' }), 'https://jobs.northwind.example/ca/en'), null);
  assert.equal(readPhenomSite(page({ ...SETTINGS, refNum: '' }), 'https://jobs.northwind.example/ca/en'), null);

  assert.equal(getPhenomSearchUrl({ resolvedBoardUrl: 'https://jobs.northwind.example/ca/en/job/R1/Analyst' }), 'https://jobs.northwind.example/ca/en/search-results');
  assert.equal(getPhenomSearchUrl({}, 'jobs.northwind.example/ca/en'), 'https://jobs.northwind.example/ca/en/search-results');
  assert.equal(getPhenomSearchUrl({ resolvedBoardUrl: 'http://jobs.northwind.example/ca/en/search-results' }, 'not a host'), '');
  assert.equal(getPhenomBoardId('https://jobs.northwind.example/ca/en/search-results'), 'jobs.northwind.example/ca/en');
  assert.equal(getPhenomJobUrl({ jobId: 'R-0001', phenomCountry: 'us', phenomLocale: 'en_us' }, 'https://jobs.northwind.example/ca/en/search-results'), 'https://jobs.northwind.example/us/en/job/R-0001');
  assert.equal(getPhenomJobUrl({ jobId: 'R 2' }, 'https://jobs.northwind.example/ca/en/search-results'), 'https://jobs.northwind.example/ca/en/job/R%202');
  assert.equal(readPhenomLocation({ multi_location: ['Montreal, Quebec'] }), 'Montreal, Quebec');
  assert.equal(readPhenomLocation({ city: 'Waterloo', state: 'Ontario', country: 'Canada' }), 'Waterloo, Ontario, Canada');
});

// A widgets API whose paging is unstable: every page past the first repeats
// some roles and skips others, as observed on boards over 500 roles.
function unstableApi(roles, { categories = true } = {}) {
  const calls = [];
  const post = async (_url, body) => {
    const request = JSON.parse(body);
    calls.push(request);
    let pool = roles;
    if (request.selected_fields?.category) pool = roles.filter((item) => request.selected_fields.category.includes(item.category));
    if (request.counts) {
      const value = {};
      if (categories) for (const item of roles) value[item.category] = (value[item.category] || 0) + 1;
      return { refineSearch: { status: 200, hits: 1, totalHits: roles.length, data: { jobs: pool.slice(0, 1), aggregations: [{ field: 'category', value }] } } };
    }
    // Past the first page the window drifts three roles ahead, so roles
    // 10-12 never appear in either order; one category at a time is stable.
    const start = request.selected_fields?.category || request.from === 0 ? request.from : request.from + 3;
    const jobs = pool.slice(start, start + request.size);
    return { refineSearch: { status: 200, hits: jobs.length, totalHits: pool.length, data: { jobs } } };
  };
  return { post, calls };
}

test('a board over one page is read whole, falling back to one category at a time', async () => {
  const roles = Array.from({ length: 23 }, (_, index) => role(`R${index}`, { category: index % 2 ? 'Sales' : 'Technology' }));
  const { post, calls } = unstableApi(roles);
  const site = readPhenomSite(page(SETTINGS), 'https://jobs.northwind.example/ca/en/search-results');
  const result = await readPhenomLocale(site, 'en_ca', 'ca', post, { pageSize: 10 });
  assert.equal(result.complete, true);
  assert.deepEqual(result.jobs.map((item) => item.jobId).sort(), roles.map((item) => item.jobId).sort());
  assert.ok(calls.some((request) => request.sortBy === 'Most recent'), 'a second order is read');
  assert.ok(calls.some((request) => request.selected_fields?.category), 'then one category at a time');
  assert.equal(result.jobs[0].phenomLocale, 'en_ca');

  // Without categories to fall back on, the missing roles make it incomplete.
  const bare = unstableApi(roles, { categories: false });
  const partial = await readPhenomLocale(site, 'en_ca', 'ca', bare.post, { pageSize: 10 });
  assert.equal(partial.complete, false);
  assert.ok(partial.jobs.length < roles.length);

  const peek = await readPhenomLocale(site, 'en_ca', 'ca', post, { pageSize: 1, firstPageOnly: true });
  assert.deepEqual([peek.jobs.length, peek.total], [1, 23]);
});

test('the Canadian and US listings are both read, unless the site ignores the locale', async () => {
  const getText = async () => page({ ...SETTINGS, locale: 'en_us', country: 'us' });
  const searchUrl = 'https://jobs.northwind.example/us/en/search-results';
  // BMO: each country lists its own roles.
  const byCountry = { us: [role('US1'), role('US2')], ca: [role('CA1')] };
  const split = await readPhenomBoard(searchUrl, { getText, postJson: async (_url, body) => {
    const { country } = JSON.parse(body);
    const jobs = byCountry[country] || [];
    return { refineSearch: { status: 200, hits: jobs.length, totalHits: jobs.length, data: { jobs } } };
  } });
  assert.deepEqual(split.jobs.map((item) => `${item.jobId}:${item.phenomCountry}`), ['US1:us', 'US2:us', 'CA1:ca']);
  assert.equal(split.complete, true);

  // RBC: every locale lists the same roles; the extra one is peeked at, not read.
  let requests = 0;
  const same = await readPhenomBoard(searchUrl, { getText, postJson: async () => {
    requests += 1;
    return { refineSearch: { status: 200, hits: 2, totalHits: 2, data: { jobs: byCountry.us } } };
  } });
  assert.equal(same.jobs.length, 2);
  assert.equal(requests, 2, 'one read of the site locale, one peek at Canada');

  // A failing extra locale is skipped; a failing site locale is an error.
  const flaky = await readPhenomBoard(searchUrl, { getText, postJson: async (_url, body) => {
    if (JSON.parse(body).country === 'ca') throw new Error('HTTP 500');
    return { refineSearch: { status: 200, hits: 1, totalHits: 1, data: { jobs: [role('US1')] } } };
  } });
  assert.equal(flaky.jobs.length, 1);
  await assert.rejects(readPhenomBoard(searchUrl, { getText, postJson: async () => { throw new Error('HTTP 503'); } }), /HTTP 503/);
  await assert.rejects(readPhenomBoard(searchUrl, { getText: async () => '<html></html>', postJson: async () => ({}) }), /settings not found/);
});

test('Phenom roles import with working links, dates and locations, and an incomplete read keeps unseen roles', async () => {
  const store = createStore();
  const tenantId = 'tenant-phenom-import';
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner` });
  await store.patchSettings(tenantId, { geographyFocus: 'Global' });
  const account = await store.addAccount(tenantId, { displayName: 'Northwind Bank' });
  store.addConfig(tenantId, { companyName: 'Northwind Bank', accountId: account.id, atsType: 'phenom', boardId: 'jobs.northwind.example/ca/en', resolvedBoardUrl: 'https://jobs.northwind.example/ca/en/search-results', discoveryStatus: 'resolved', reviewStatus: 'approved', active: true });
  let roles = [role('R1', { title: 'Senior Analyst', multi_location: ['Toronto, Ontario, Canada'], type: 'Full time' }), role('R2'), role('R3'), role('R4', { title: 'Do not apply - test posting' })];
  let unstable = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    if (value === 'https://jobs.northwind.example/ca/en/search-results') return new Response(page(SETTINGS), { status: 200, headers: { 'content-type': 'text/html' } });
    if (value === 'https://jobs.northwind.example/widgets') {
      const request = JSON.parse(init.body);
      // Only Canada has roles; the US peek finds none.
      const pool = request.country === 'ca' ? roles : [];
      const jobs = unstable && request.country === 'ca' ? pool.slice(0, 2) : pool;
      return new Response(JSON.stringify({ refineSearch: { status: 200, hits: jobs.length, totalHits: pool.length, data: { jobs, aggregations: [] } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };
  try {
    const plan = { displayName: 'Unlimited', limits: { jobBoards: -1 } };
    await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    let jobs = (await store.findJobs(tenantId, { page: 1, pageSize: 20, active: '' })).items.sort((a, b) => a.jobId.localeCompare(b.jobId));
    assert.deepEqual(jobs.map((item) => item.jobId), ['R1', 'R2', 'R3'], 'the "Do not apply" posting is left out');
    const [first] = jobs;
    assert.equal(first.title, 'Senior Analyst');
    assert.equal(first.jobUrl, 'https://jobs.northwind.example/ca/en/job/R1');
    assert.equal(first.location, 'Toronto, Ontario, Canada');
    assert.equal(first.postedAt, '2026-11-10T00:00:00.000Z');
    assert.equal(first.source, 'Phenom');
    assert.equal(first.employmentType, 'Full time');

    // A read that cannot reach every role does not close the ones it missed.
    unstable = true;
    roles = roles.slice(0, 3);
    await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    jobs = (await store.findJobs(tenantId, { page: 1, pageSize: 20, active: '' })).items;
    assert.equal(jobs.filter((item) => item.active).length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('discovery finds a Phenom site from the company domain and does not follow its apply links', async () => {
  const store = createStore();
  const tenantId = 'tenant-phenom-discovery';
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner` });
  await store.addAccount(tenantId, { displayName: 'Northwind Bank', domain: 'northwind.example', tracked: true });
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    requested.push(value);
    const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    // The home page carries the settings and, like RBC's, links roles to Workday to apply.
    if (value === 'https://jobs.northwind.example/') return html(`${page(SETTINGS)}<a href="https://northwind.wd3.myworkdayjobs.com/External/job/Toronto/Analyst_R1/apply">Apply</a>`);
    if (value === 'https://jobs.northwind.example/ca/en/search-results') return html(page(SETTINGS, 2));
    if (value === 'https://jobs.northwind.example/widgets') {
      const jobs = JSON.parse(init.body).country === 'ca' ? [role('R1'), role('R2')] : [];
      return new Response(JSON.stringify({ refineSearch: { status: 200, hits: jobs.length, totalHits: jobs.length, data: { jobs } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
  };
  try {
    await store.runAtsDiscovery(tenantId, { plan: { displayName: 'All', limits: { jobBoards: -1 } }, limit: 10, forceRefresh: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const [config] = (await store.findConfigs(tenantId, { page: 1, pageSize: 5 })).items;
  assert.equal(config.atsType, 'phenom');
  assert.equal(config.discoveryStatus, 'resolved');
  assert.equal(config.resolvedBoardUrl, 'https://jobs.northwind.example/ca/en/search-results');
  assert.equal(config.boardId, 'jobs.northwind.example/ca/en');
  assert.ok(!requested.some((value) => value.includes('myworkdayjobs.com')), 'apply links on a Phenom site are not probed');
});
