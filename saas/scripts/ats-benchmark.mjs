import { pathToFileURL } from 'node:url';
import { createStore } from '../src/store.js';

const PROVIDERS = [
  { atsType: 'greenhouse', boardId: 'greenhouse-fixture', apiUrl: 'https://boards-api.greenhouse.io/v1/boards/greenhouse-fixture/jobs?content=true' },
  { atsType: 'lever', boardId: 'lever-fixture', apiUrl: 'https://api.lever.co/v0/postings/lever-fixture?mode=json' },
  { atsType: 'ashby', boardId: 'ashby-fixture', apiUrl: 'https://api.ashbyhq.com/posting-api/job-board/ashby-fixture' },
  { atsType: 'smartrecruiters', boardId: 'smart-fixture', apiUrl: 'https://api.smartrecruiters.com/v1/companies/smart-fixture/postings' },
  { atsType: 'jobvite', boardId: 'jobvite-fixture', apiUrl: 'https://jobs.jobvite.com/api/job-list?company=jobvite-fixture' },
  {
    atsType: 'workday',
    boardId: 'Fixture_Careers',
    apiUrl: 'https://fixture.wd10.myworkdayjobs.com/wday/cxs/fixture/Fixture_Careers/jobs',
    resolvedBoardUrl: 'https://fixture.wd10.myworkdayjobs.com/Fixture_Careers',
  },
  { atsType: 'bamboohr', boardId: 'bamboo-fixture', apiUrl: 'https://bamboo-fixture.bamboohr.com/careers/list' },
  { atsType: 'workable', boardId: 'workable-fixture', apiUrl: 'https://www.workable.com/api/accounts/workable-fixture?details=true' },
  { atsType: 'recruitee', boardId: 'recruitee-fixture', apiUrl: 'https://recruitee-fixture.recruitee.com/api/offers/' },
  { atsType: 'personio', boardId: 'personio-fixture', careersUrl: 'https://personio-fixture.jobs.personio.de/' },
  { atsType: 'rippling', boardId: 'rippling-fixture', resolvedBoardUrl: 'https://ats.rippling.com/rippling-fixture/jobs' },
  { atsType: 'custom_static', boardId: 'static-fixture', apiUrl: 'https://fixtures.example/careers' },
];

const REQUIRED_JOB_FIELDS = [
  'companyName',
  'title',
  'jobUrl',
  'source',
  'jobId',
  'naturalKey',
  'postedAt',
  'retrievedAt',
];

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function fixtureFetch(url) {
  const value = String(url);
  const postedAt = '2026-07-15T12:00:00Z';
  if (value.includes('boards-api.greenhouse.io')) return json({ jobs: [{ id: 'gh-1', title: 'Greenhouse Sales Lead', location: { name: 'Toronto, ON' }, absolute_url: 'https://job.example/gh-1', first_published: postedAt }] });
  if (value.includes('api.lever.co')) return json([{ id: 'lever-1', text: 'Lever Sales Lead', categories: { location: 'Toronto, ON', team: 'Sales' }, hostedUrl: 'https://job.example/lever-1', createdAt: Date.parse(postedAt) }]);
  if (value.includes('api.ashbyhq.com')) return json({ jobs: [{ id: 'ashby-1', title: 'Ashby Sales Lead', location: 'Toronto, ON', department: 'Sales', jobUrl: 'https://job.example/ashby-1', publishedAt: postedAt }] });
  if (value.includes('api.smartrecruiters.com')) return json({ totalFound: 1, content: [{ id: 'smart-1', name: 'SmartRecruiters Sales Lead', location: { city: 'Toronto', region: 'ON', country: 'Canada' }, ref: 'https://job.example/smart-1', releasedDate: postedAt }] });
  if (value.includes('jobs.jobvite.com')) return json({ jobs: [{ id: 'jobvite-1', title: 'Jobvite Sales Lead', location: 'Toronto, ON', jobUrl: 'https://job.example/jobvite-1', postedDate: postedAt }] });
  if (value.includes('myworkdayjobs.com')) return json({ total: 1, jobPostings: [{ id: 'workday-1', title: 'Workday Sales Lead', locationsText: 'Toronto, ON', externalPath: '/job/Toronto/workday-1', postedOnDate: postedAt }] });
  if (value.includes('bamboohr.com')) return json({ result: [{ id: 'bamboo-1', jobOpeningName: 'BambooHR Sales Lead', location: { city: 'Toronto', state: 'Ontario', country: 'Canada' }, postedDate: postedAt }] });
  if (value.includes('workable.com')) return json({ jobs: [{ shortcode: 'workable-1', title: 'Workable Sales Lead', city: 'Toronto', state: 'Ontario', country: 'Canada', url: 'https://job.example/workable-1', published_on: postedAt }] });
  if (value.includes('recruitee.com')) return json({ offers: [{ id: 'recruitee-1', title: 'Recruitee Sales Lead', locations: [{ city: 'Toronto', state: 'Ontario', country: 'Canada' }], careers_url: 'https://job.example/recruitee-1', published_at: postedAt }] });
  if (value.includes('personio.de')) {
    return new Response(`<?xml version="1.0"?><workzag-jobs><position><id>personio-1</id><name>Personio Sales Lead</name><office>Toronto, ON</office><department>Sales</department><createdAt>${postedAt}</createdAt></position></workzag-jobs>`, { status: 200, headers: { 'content-type': 'application/xml' } });
  }
  if (value.includes('ats.rippling.com')) {
    const nextData = { props: { pageProps: { dehydratedState: { queries: [{ state: { data: { items: [{ id: 'rippling-1', name: 'Rippling Sales Lead', url: 'https://job.example/rippling-1', locations: [{ name: 'Toronto, ON' }], department: { name: 'Sales' }, createdAt: postedAt }] } } }] } } } };
    return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (value.includes('fixtures.example')) {
    const jobPosting = { '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Careers Page Sales Lead', url: 'https://job.example/static-1', datePosted: postedAt, jobLocation: { address: { addressLocality: 'Toronto', addressRegion: 'ON', addressCountry: 'Canada' } } };
    return new Response(`<script type="application/ld+json">${JSON.stringify(jobPosting)}</script>`, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  return new Response('fixture not found', { status: 404 });
}

export async function runAtsBenchmark({ logger = console } = {}) {
  const store = createStore();
  const tenantId = `tenant-ats-benchmark-${Date.now()}`;
  store.ensureTenant({ id: tenantId, name: 'ATS benchmark' }, { id: `${tenantId}-owner`, name: 'Benchmark owner' });

  for (const provider of PROVIDERS) {
    const companyName = `${provider.atsType} Fixture Company`;
    const account = await store.addAccount(tenantId, { displayName: companyName });
    store.addConfig(tenantId, {
      ...provider,
      accountId: account.id,
      companyName,
      discoveryStatus: 'resolved',
      reviewStatus: 'approved',
      active: true,
    });
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixtureFetch;
  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Benchmark', limits: { jobBoards: -1 } },
      autoDiscover: false,
      fetchConcurrency: 4,
    });
    const imported = await store.findJobs(tenantId, { page: 1, pageSize: 100 });
    const rows = PROVIDERS.map((provider) => {
      const jobs = imported.items.filter((job) => job.atsType === provider.atsType);
      const job = jobs[0];
      const missing = job
        ? REQUIRED_JOB_FIELDS.filter((field) => !String(job[field] || '').trim())
        : ['normalized job'];
      if (job?.active !== true) missing.push('active state');
      return {
        provider: provider.atsType,
        jobs: jobs.length,
        status: jobs.length === 1 && missing.length === 0 ? 'PASS' : 'FAIL',
        missing: missing.join(', '),
      };
    });
    const failed = rows.filter((row) => row.status !== 'PASS');
    const ok = failed.length === 0 && result.stats.errors === 0;
    logger.table?.(rows);
    logger.log?.(`ATS benchmark: ${rows.length - failed.length}/${rows.length} providers passed; ${imported.total} jobs normalized; ${result.stats.errors} import errors.`);
    return { ok, rows, jobs: imported.items, importResult: result };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = await runAtsBenchmark();
  if (!result.ok) process.exitCode = 1;
}
