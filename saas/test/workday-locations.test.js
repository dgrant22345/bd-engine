import test from 'node:test';
import assert from 'node:assert/strict';
import { clearWorkdayLocationCache, formatWorkdayLocations, getWorkdayDetailUrl, isWorkdayMultiLocation, resolveWorkdayLocations } from '../src/workday-locations.js';
import { createStore } from '../src/store.js';

const API = 'https://td.wd3.myworkdayjobs.com/wday/cxs/td/TD_Bank_Careers/jobs';
// Shapes from TD's public CXS endpoints, November 2026.
const DIEPPE = { jobPostingInfo: { location: 'Dieppe, New Brunswick', additionalLocations: ['Moncton, New Brunswick', 'Riverview, New Brunswick'], country: { descriptor: 'Canada' } } };

test('multi-location text, detail URLs and the places a role names', () => {
  for (const text of ['3 Locations', '1 Location', '2 emplacements', ' 12 Locations ']) assert.equal(isWorkdayMultiLocation(text), true, text);
  for (const text of ['Toronto, Ontario', 'Locations', '', 'Remote - 2 Locations']) assert.equal(isWorkdayMultiLocation(text), false, text);
  assert.equal(getWorkdayDetailUrl(API, '/job/Dieppe/Advisor_R1'), 'https://td.wd3.myworkdayjobs.com/wday/cxs/td/TD_Bank_Careers/job/Dieppe/Advisor_R1');
  // Only Workday's own API, and only a job path.
  assert.equal(getWorkdayDetailUrl('https://internal.example/wday/cxs/td/Site/jobs', '/job/X'), '');
  assert.equal(getWorkdayDetailUrl(API, 'https://elsewhere.example/job/X'), '');
  assert.equal(formatWorkdayLocations(DIEPPE.jobPostingInfo), 'Dieppe, New Brunswick, Canada; Moncton, New Brunswick; Riverview, New Brunswick');
  assert.equal(formatWorkdayLocations({ location: 'Toronto, Ontario, Canada', country: { descriptor: 'Canada' } }), 'Toronto, Ontario, Canada');
  assert.equal(formatWorkdayLocations({ location: 'A', additionalLocations: ['B', 'C', 'D', 'E', 'F', 'G'] }), 'A; B; C; D; E; and 2 more');
  assert.equal(formatWorkdayLocations({}), '');
});

test('each role page is read once, within a limit and a deadline, and failures keep the original text', async () => {
  clearWorkdayLocationCache();
  const posting = (id, locationsText = '3 Locations') => ({ externalPath: `/job/Place/Role_${id}`, locationsText });
  const reads = [];
  const getJson = async (url) => { reads.push(url); if (url.endsWith('_R3')) throw new Error('HTTP 500'); return DIEPPE; };
  const first = [posting('R1'), posting('R2'), posting('R3'), posting('R4', 'Toronto, Ontario')];
  const stats = await resolveWorkdayLocations(first, { apiUrl: API, getJson });
  assert.deepEqual(stats, { multiLocation: 3, fromCache: 0, fetched: 2, unresolved: 1 });
  assert.equal(first[0].locationsText, 'Dieppe, New Brunswick, Canada; Moncton, New Brunswick; Riverview, New Brunswick');
  assert.equal(first[0].locationsSummary, '3 Locations');
  assert.equal(first[2].locationsText, '3 Locations', 'a failed read keeps the original');
  assert.equal(first[3].locationsText, 'Toronto, Ontario');

  reads.length = 0;
  const again = [posting('R1'), posting('R5'), posting('R6')];
  const cached = await resolveWorkdayLocations(again, { apiUrl: API, getJson, limit: 1 });
  assert.deepEqual(cached, { multiLocation: 3, fromCache: 1, fetched: 1, unresolved: 1 });
  assert.equal(reads.length, 1, 'remembered roles are not read again; the limit holds');

  let now = 0;
  const late = await resolveWorkdayLocations([posting('R7')], { apiUrl: API, getJson, deadlineAt: 10, clock: () => (now += 20) });
  assert.deepEqual(late, { multiLocation: 1, fromCache: 0, fetched: 0, unresolved: 1 });
});

test('a Canada-focused workspace keeps multi-location Workday roles that are in Canada', async () => {
  clearWorkdayLocationCache();
  const store = createStore();
  const tenantId = 'tenant-workday-multi-location';
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner` });
  await store.patchSettings(tenantId, { geographyFocus: 'Canada' });
  const account = await store.addAccount(tenantId, { displayName: 'TD Bank' });
  store.addConfig(tenantId, { companyName: 'TD Bank', accountId: account.id, atsType: 'workday', boardId: 'td/TD_Bank_Careers', apiUrl: API, resolvedBoardUrl: 'https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers', discoveryStatus: 'resolved', reviewStatus: 'approved', active: true });
  const postings = [
    { title: 'Branch Advisor', externalPath: '/job/Dieppe/Branch-Advisor_R1', locationsText: '3 Locations', postedOn: 'Posted Today' },
    { title: 'US Advisor', externalPath: '/job/Mount-Laurel/US-Advisor_R2', locationsText: '6 Locations', postedOn: 'Posted Today' },
    { title: 'Analyst', externalPath: '/job/Toronto/Analyst_R3', locationsText: 'Toronto, Ontario', postedOn: 'Posted Today' },
  ];
  const details = {
    '/job/Dieppe/Branch-Advisor_R1': DIEPPE,
    '/job/Mount-Laurel/US-Advisor_R2': { jobPostingInfo: { location: 'Mount Laurel, New Jersey', additionalLocations: ['Boston, Massachusetts'], country: { descriptor: 'United States of America' } } },
  };
  let detailReads = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    const json = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    if (value === API && init.method === 'POST') return json({ total: postings.length, jobPostings: postings });
    const path = value.replace('https://td.wd3.myworkdayjobs.com/wday/cxs/td/TD_Bank_Careers', '');
    if (details[path]) { detailReads += 1; return json(details[path]); }
    return new Response('not found', { status: 404 });
  };
  try {
    const plan = { displayName: 'Unlimited', limits: { jobBoards: -1 } };
    await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    const jobs = (await store.findJobs(tenantId, { page: 1, pageSize: 20 })).items;
    assert.deepEqual(jobs.map((item) => item.title).sort(), ['Analyst', 'Branch Advisor'], 'the US-only role is left out, the Canadian one is kept');
    assert.equal(jobs.find((item) => item.title === 'Branch Advisor').location, 'Dieppe, New Brunswick, Canada; Moncton, New Brunswick; Riverview, New Brunswick');
    assert.equal(detailReads, 2);
    await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(detailReads, 2, 'the next refresh reuses what it read');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
