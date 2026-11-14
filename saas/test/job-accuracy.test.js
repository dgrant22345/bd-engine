import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

// Accuracy of imported roles as people see them: working links, readable
// locations, honest posting dates, and "new" meaning new rather than newly
// tracked. Payload shapes follow the live public APIs checked in November 2026.
const plan = { displayName: 'Unlimited', limits: { jobBoards: -1 } };
const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

async function workspace(id, config, geographyFocus = 'Global') {
  const store = createStore();
  store.ensureTenant({ id, name: id }, { id: `${id}-owner` });
  await store.patchSettings(id, { geographyFocus });
  const account = await store.addAccount(id, { displayName: config.companyName });
  store.addConfig(id, { ...config, accountId: account.id, discoveryStatus: 'resolved', reviewStatus: 'approved', active: true });
  return { store, account };
}

async function withFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await run(); } finally { globalThis.fetch = originalFetch; }
}

const json = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
const jobsOf = async (store, id) => (await store.findJobs(id, { page: 1, pageSize: 100, active: '' })).items;

test('Workday links include the career site, whether the board was saved by API or public URL', async () => {
  const posting = { title: 'Senior Financial Advisor', externalPath: '/job/Vancouver-BC/Senior-Financial-Advisor_2301789', locationsText: 'Vancouver, BC', postedOn: 'Posted Yesterday' };
  for (const [name, config, expected] of [
    ['api-only', { apiUrl: 'https://cibc.wd3.myworkdayjobs.com/wday/cxs/cibc/search/jobs' }, 'https://cibc.wd3.myworkdayjobs.com/search/job/Vancouver-BC/Senior-Financial-Advisor_2301789'],
    ['locale', { apiUrl: 'https://cibc.wd3.myworkdayjobs.com/wday/cxs/cibc/search/jobs', resolvedBoardUrl: 'https://cibc.wd3.myworkdayjobs.com/en-US/search' }, 'https://cibc.wd3.myworkdayjobs.com/en-US/search/job/Vancouver-BC/Senior-Financial-Advisor_2301789'],
  ]) {
    const id = `tenant-workday-link-${name}`;
    const { store } = await workspace(id, { companyName: 'CIBC', atsType: 'workday', boardId: 'cibc/search', ...config });
    await withFetch(async () => json({ total: 1, jobPostings: [posting] }), () => store.importLiveJobs(id, { plan, autoDiscover: false }));
    const [job] = await jobsOf(store, id);
    assert.equal(job.jobUrl, expected, name);
  }
});

test('SmartRecruiters roles link to the public job page and name the country', async () => {
  const id = 'tenant-smartrecruiters-accuracy';
  const { store } = await workspace(id, { companyName: 'Ubisoft', atsType: 'smartrecruiters', boardId: 'Ubisoft2' }, 'Canada');
  const posting = (postingId, location) => ({
    id: postingId, name: `Role ${postingId}`, releasedDate: iso(2), company: { identifier: 'Ubisoft2', name: 'Ubisoft' }, location,
    ref: `https://api.smartrecruiters.com/v1/companies/Ubisoft2/postings/${postingId}`,
  });
  await withFetch(async () => json({ totalFound: 2, content: [
    posting('744000161565892', { city: 'Montreal', region: 'QC', country: 'ca', fullLocation: 'Montreal, QC, Canada' }),
    // No region: "Quebec city, ca" used to read as California and was filtered out.
    posting('744000161565893', { city: 'Quebec city', country: 'ca', fullLocation: 'Quebec city, Canada' }),
  ] }), () => store.importLiveJobs(id, { plan, autoDiscover: false }));
  const jobs = (await jobsOf(store, id)).sort((a, b) => a.jobId.localeCompare(b.jobId));
  assert.deepEqual(jobs.map((job) => job.location), ['Montreal, QC, Canada', 'Quebec city, Canada']);
  assert.deepEqual(jobs.map((job) => job.jobUrl), [
    'https://jobs.smartrecruiters.com/Ubisoft2/744000161565892',
    'https://jobs.smartrecruiters.com/Ubisoft2/744000161565893',
  ]);
});

test('boards without posting dates keep the date unknown instead of "posted today" on every refresh', async () => {
  const id = 'tenant-dateless-board';
  const { store, account } = await workspace(id, { companyName: 'Pace', atsType: 'rippling', boardId: 'pace', resolvedBoardUrl: 'https://ats.rippling.com/pace/jobs' });
  const page = (ids) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { dehydratedState: { queries: [{ state: { data: { items: ids.map((jobId) => ({ id: jobId, name: `Role ${jobId}`, url: `https://ats.rippling.com/pace/jobs/${jobId}`, locations: [{ name: 'Toronto, ON' }] })) } } }] } } } })}</script></html>`;
  let boardIds = ['a1', 'a2'];
  const html = async () => new Response(page(boardIds), { status: 200, headers: { 'content-type': 'text/html' } });

  await withFetch(html, () => store.importLiveJobs(id, { plan, autoDiscover: false }));
  let jobs = await jobsOf(store, id);
  assert.equal(jobs.length, 2);
  for (const job of jobs) {
    assert.equal(job.postedAt, '');
    assert.ok(job.firstSeenAt);
    // Roles already on the board when it was first imported are not new.
    assert.equal(job.isNew, false);
    assert.equal(job.newSince, '');
  }

  boardIds = ['a1', 'a2', 'a3'];
  await withFetch(html, () => store.importLiveJobs(id, { plan, autoDiscover: false }));
  jobs = await jobsOf(store, id);
  const added = jobs.find((job) => job.jobId === 'a3');
  assert.equal(added.postedAt, '');
  assert.equal(added.isNew, true, 'a role that appears after the first import is new');
  assert.equal(jobs.filter((job) => job.isNew).length, 1);

  const context = await store.getPeopleContext(id, [{ id: 'ada', accountId: account.id }]);
  assert.equal(context.ada.openRoles, 3);
  assert.equal(context.ada.newRoles7d, 1);
});

test('a newly tracked company counts only recently posted roles as new', async () => {
  const id = 'tenant-baseline-new';
  const { store, account } = await workspace(id, { companyName: 'Faire', atsType: 'greenhouse', boardId: 'faire' });
  let postings = [
    { id: 1, title: 'Old role', location: { name: 'Toronto, ON' }, absolute_url: 'https://job-boards.greenhouse.io/faire/jobs/1', first_published: iso(40) },
    { id: 2, title: 'Recent role', location: { name: 'Toronto, ON' }, absolute_url: 'https://job-boards.greenhouse.io/faire/jobs/2', first_published: iso(3) },
  ];
  const board = async () => json({ jobs: postings });
  await withFetch(board, () => store.importLiveJobs(id, { plan, autoDiscover: false }));
  let jobs = await jobsOf(store, id);
  assert.deepEqual(jobs.filter((job) => job.isNew).map((job) => job.title), ['Recent role']);

  postings = [...postings, { id: 3, title: 'Posted today', location: { name: 'Toronto, ON' }, absolute_url: 'https://job-boards.greenhouse.io/faire/jobs/3', first_published: iso(0) }];
  await withFetch(board, () => store.importLiveJobs(id, { plan, autoDiscover: false }));
  jobs = await jobsOf(store, id);
  assert.deepEqual(jobs.filter((job) => job.isNew).map((job) => job.title).sort(), ['Posted today', 'Recent role']);

  const context = await store.getPeopleContext(id, [{ id: 'p1', accountId: account.id }]);
  assert.equal(context.p1.openRoles, 3);
  assert.equal(context.p1.newRoles7d, 2);
  const [company] = (await store.findAccounts(id, { page: 1, pageSize: 5 })).items.filter((item) => item.id === account.id);
  assert.equal(company.lastJobPostedAt.slice(0, 10), iso(0).slice(0, 10), 'freshest role is the newest posting, not the first in the list');
});

test('a Workday maintenance window is reported as maintenance and keeps existing roles', async () => {
  const id = 'tenant-workday-maintenance';
  const { store } = await workspace(id, { companyName: 'Sun Life', atsType: 'workday', boardId: 'sunlife/Experienced-Jobs', apiUrl: 'https://sunlife.wd3.myworkdayjobs.com/wday/cxs/sunlife/Experienced-Jobs/jobs' });
  await withFetch(async () => json({ total: 1, jobPostings: [{ title: 'Advisor', externalPath: '/job/Toronto/Advisor_R1', locationsText: 'Toronto, ON', postedOn: 'Posted Today' }] }),
    () => store.importLiveJobs(id, { plan, autoDiscover: false }));
  const result = await withFetch(async () => new Response('', { status: 303, headers: { location: 'https://community.workday.com/maintenance-page' } }),
    () => store.importLiveJobs(id, { plan, autoDiscover: false }));
  assert.match(result.errors?.[0]?.error || '', /scheduled maintenance/);
  const [job] = await jobsOf(store, id);
  assert.equal(job.active, true);
});
