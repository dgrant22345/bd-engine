import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const plan = { limits: { jobBoards: -1 } };
const options = { plan, autoDiscover: false };
async function workspace(id, atsType = 'greenhouse', config = {}) {
  const store = createStore();
  store.ensureTenant({ id, name: id, persona: 'jobseeker' }, { id: `${id}-owner` });
  await store.patchSettings(id, { geographyFocus: 'Global' });
  const account = await store.addAccount(id, { displayName: id, industry: 'Technology' });
  store.addConfig(id, { accountId: account.id, companyName: id, atsType, boardId: id,
    discoveryStatus: 'resolved', reviewStatus: 'approved', active: true, ...config });
  return store;
}
const ghJob = (id, title = 'Talent Acquisition Manager', location = 'Toronto, ON') => ({
  id, title, location: { name: location }, absolute_url: `https://example.test/jobs/${id}`, updated_at: new Date().toISOString(),
});

test('malformed board responses cannot close existing jobs', async (t) => {
  const id = 'quality-malformed';
  const store = await workspace(id);
  let payload = { jobs: [ghJob('keep')] };
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  await store.importLiveJobs(id, options);
  for (const invalid of [{ error: 'upstream failure' }, { jobs: null }, { jobs: {} }, { jobs: [{}] }]) {
    payload = invalid;
    const result = await store.importLiveJobs(id, options);
    assert.equal(result.stats.closedJobs, 0);
    assert.ok(result.errors.length || result.warnings.length);
    assert.equal((await store.findJobs(id, { active: true })).total, 1);
  }
});

test('changing import geography does not mark still-published jobs as closed', async (t) => {
  const id = 'quality-geography-lifecycle';
  const store = await workspace(id);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ jobs: [ghJob('ca'), ghJob('us', undefined, 'New York, NY')] }));
  await store.importLiveJobs(id, options);
  await store.patchSettings(id, { geographyFocus: 'Canada' });
  const imported = await store.importLiveJobs(id, options);
  assert.equal(imported.stats.filteredOutNonCanada, 1);
  assert.equal(imported.stats.closedJobs, 0);
  assert.equal((await store.findJobs(id, { active: true })).total, 2);
  assert.equal((await store.findJobs(id, { active: true, geography: 'canada' })).total, 1);
});

for (const atsType of ['custom_static', 'rippling', 'personio', 'jobvite']) {
  test(`${atsType} does not treat an unrecognized HTML response as a successful empty board`, async (t) => {
    const id = `quality-html-${atsType}`;
    const store = await workspace(id, atsType, { careersUrl: 'https://example.test/careers', resolvedBoardUrl: 'https://example.test/careers' });
    t.mock.method(globalThis, 'fetch', async () => new Response('<html><h1>Temporarily unavailable</h1></html>', { headers: { 'content-type': 'text/html' } }));
    const result = await store.importLiveJobs(id, options);
    assert.ok(result.stats.errors > 0 || result.stats.partialBoards > 0);
    assert.equal(result.stats.closedJobs, 0);
  });
}

test('role focus requires a real title match; exclusions use whole words', async (t) => {
  const id = 'quality-title-focus';
  const store = await workspace(id);
  await store.patchSettings(id, { searchFocus: {
    targetRoles: 'talent acquisition manager, talent operations, recruiting operations manager',
    excludedRoles: 'intern, internship', targetIndustries: 'technology', workStyle: 'remote', minimumRelevanceScore: 45,
  } });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ jobs: [
    ghJob('exact', 'International Talent Acquisition Manager', 'Remote - Canada'),
    ghJob('family', 'Senior Recruiter', 'Remote - Canada'),
    { ...ghJob('department', 'Software Engineer', 'Remote - Canada'), departments: [{ name: 'Talent Acquisition Manager' }] },
    ghJob('generic', 'Business Operations Manager', 'Remote - Canada'),
    ghJob('excluded', 'Talent Acquisition Intern', 'Remote - Canada'),
  ] }));
  await store.importLiveJobs(id, options);
  const matches = await store.findJobs(id, { minRelevance: 45, geography: 'canada' });
  assert.deepEqual(new Set(matches.items.map((j) => j.jobId)), new Set(['exact', 'family']));
  const broad = await store.findJobs(id, { minRelevance: 1 });
  assert.ok(!broad.items.some((j) => j.jobId === 'excluded'), 'excluded jobs never enter a focused shortlist');
});

for (const atsType of ['ashby', 'lever']) {
  test(`${atsType} preserves Canadian secondary locations and structured work style`, async (t) => {
    const id = `quality-locations-${atsType}`;
    const store = await workspace(id, atsType);
    await store.patchSettings(id, { geographyFocus: 'Canada' });
    const row = atsType === 'ashby'
      ? { id: 'multi', title: 'Recruiter', location: 'New York, NY', secondaryLocations: [{ location: 'Toronto, ON' }], workplaceType: 'Remote', jobUrl: 'https://example.test/multi' }
      : { id: 'multi', text: 'Recruiter', categories: { location: 'New York, NY', allLocations: ['New York, NY', 'Toronto, ON'] }, workplaceType: 'remote', hostedUrl: 'https://example.test/multi' };
    t.mock.method(globalThis, 'fetch', async () => Response.json(atsType === 'lever' ? [row] : { jobs: [row] }));
    const result = await store.importLiveJobs(id, options);
    assert.equal(result.stats.newJobs, 1);
    const matches = await store.findJobs(id, { geography: 'canada', workStyle: 'remote' });
    assert.equal(matches.total, 1);
    assert.match(matches.items[0].location, /Toronto/);
  });
}

test('a capped board is partial, preserves unseen jobs, and reports coverage', async (t) => {
  const id = 'quality-pagination';
  const store = await workspace(id, 'smartrecruiters');
  let large = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    return Response.json({ totalFound: large ? 1200 : 1, content: large
      ? Array.from({ length: 100 }, (_, index) => ({ id: `page-${offset + index}`, name: 'Recruiter', location: { city: 'Toronto', country: 'Canada' }, ref: `https://example.test/${offset + index}` }))
      : [{ id: 'unseen', name: 'Recruiter', location: { city: 'Toronto', country: 'Canada' }, ref: 'https://example.test/unseen' }] });
  });
  await store.importLiveJobs(id, options);
  large = true;
  const result = await store.importLiveJobs(id, options);
  assert.equal(result.stats.closedJobs, 0);
  assert.equal(result.stats.partialBoards, 1);
  assert.ok(result.warnings.some((w) => /partial|incomplete/i.test(w)));
  const config = (await store.findConfigs(id, {})).items[0];
  assert.equal(config.lastImportStatus, 'partial');
  assert.equal(config.lastImportCoverage.reportedTotal, 1200);
});

test('Workday relative posting dates participate in recency filters without fabricating dates for ranges', async (t) => {
  const id = 'quality-workday-dates';
  const store = await workspace(id, 'workday', { boardId: 'fixture/Careers', apiUrl: 'https://fixture.wd5.myworkdayjobs.com/wday/cxs/fixture/Careers/jobs' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ total: 3, jobPostings: [
    { title: 'Recruiter', externalPath: '/job/1', locationsText: 'Toronto, ON', postedOn: 'Posted Today' },
    { title: 'Recruiter', externalPath: '/job/2', locationsText: 'Toronto, ON', postedOn: 'Posted 3 Days Ago' },
    { title: 'Recruiter', externalPath: '/job/3', locationsText: 'Toronto, ON', postedOn: 'Posted 30+ Days Ago' },
  ] }));
  await store.importLiveJobs(id, options);
  const recent = await store.findJobs(id, { recencyDays: 7 });
  assert.equal(recent.total, 2);
  const all = await store.findJobs(id, {});
  const range = all.items.find((j) => j.postingAgeText.includes('30+'));
  assert.equal(range.postedAt, '');
  assert.equal(range.isNew, false);
});
