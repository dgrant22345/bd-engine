import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const plan = { displayName: 'Unlimited', limits: { jobBoards: -1 } };

function addTenant(store, tenantId, persona = 'bd') {
  store.ensureTenant({ id: tenantId, name: tenantId, persona }, { id: `${tenantId}-owner`, name: 'Owner' });
}

test('search focus scores, sorts, filters, and rescores imported jobs', async () => {
  const store = createStore();
  const tenantId = 'tenant-search-focus-jobs';
  addTenant(store, tenantId, 'jobseeker');
  await store.patchSettings(tenantId, {
    searchFocus: {
      targetRoles: 'financial analyst, strategy manager',
      excludedRoles: 'retail sales',
      targetIndustries: 'financial services',
      workStyle: 'remote',
      minimumRelevanceScore: 45,
    },
  });
  const account = await store.addAccount(tenantId, {
    displayName: 'Focused Finance',
    industry: 'Financial Services',
  });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: account.displayName,
    atsType: 'greenhouse',
    boardId: 'focused-finance',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const postedAt = new Date().toISOString();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ jobs: [
    { id: 'fit', title: 'Senior Financial Analyst', location: { name: 'Remote - Canada' }, absolute_url: 'https://example.test/fit', updated_at: postedAt },
    { id: 'excluded', title: 'Retail Sales Associate', location: { name: 'Remote - Canada' }, absolute_url: 'https://example.test/excluded', updated_at: postedAt },
    { id: 'other', title: 'Software Engineer', location: { name: 'Toronto, ON' }, absolute_url: 'https://example.test/other', updated_at: postedAt },
  ] });

  try {
    const imported = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(imported.stats.newJobs, 3);
    assert.equal(imported.stats.relevantJobs, 1);

    const ranked = await store.findJobs(tenantId, { sortBy: 'relevance', page: 1, pageSize: 20 });
    assert.equal(ranked.items[0].title, 'Senior Financial Analyst');
    assert.equal(ranked.items[0].relevanceBand, 'strong');
    assert.ok(ranked.items[0].relevanceReasons.some((reason) => /role match/i.test(reason)));
    assert.equal(ranked.items.find((item) => item.title === 'Retail Sales Associate').relevanceScore, 5);

    const relevant = await store.findJobs(tenantId, { minRelevance: 45, page: 1, pageSize: 20 });
    assert.equal(relevant.total, 1);
    assert.equal(relevant.items[0].title, 'Senior Financial Analyst');

    const rescored = await store.patchSettings(tenantId, {
      searchFocus: { targetRoles: 'product manager', workStyle: 'any', minimumRelevanceScore: 45 },
    });
    assert.equal(rescored.rescoredJobs, 3);
    assert.equal(rescored.activeJobs, 3);
    assert.equal(rescored.matchingJobs, 0);
    const after = await store.findJobs(tenantId, { minRelevance: 45, page: 1, pageSize: 20 });
    assert.equal(after.total, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('detailed talent acquisition titles include the recruiting role family', async () => {
  const store = createStore();
  const tenantId = 'tenant-talent-acquisition-focus';
  addTenant(store, tenantId, 'jobseeker');
  await store.patchSettings(tenantId, {
    geographyFocus: 'Canada',
    searchFocus: {
      targetRoles: 'Talent Acquisition Manager, Talent Acquisition Partner, Recruitment Manager, Recruiting Operations Manager, Talent Operations',
      excludedRoles: '',
      targetIndustries: '',
      workStyle: 'any',
      minimumRelevanceScore: 40,
    },
  });
  const account = await store.addAccount(tenantId, { displayName: 'Canadian Employer' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: account.displayName,
    atsType: 'greenhouse',
    boardId: 'canadian-employer',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const postedAt = new Date().toISOString();
  const sourceJobs = [
    ['ta-manager', 'Talent Acquisition Manager', 'Toronto, ON'],
    ['recruiter', 'Senior Recruiter', 'Vancouver, BC'],
    ['recruiting-lead', 'Recruiting Lead', 'Remote - Canada'],
    ['sourcer', 'Talent Sourcer', 'Montreal, QC'],
    ['talent-partner', 'Talent Partner', 'Calgary, AB'],
    ['people-ops', 'People Operations Manager', 'Ottawa, ON'],
    ['engineer', 'Software Engineer', 'Winnipeg, MB'],
    ['us-ta', 'Talent Acquisition Partner', 'New York, NY'],
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ jobs: sourceJobs.map(([id, title, location]) => ({
    id,
    title,
    location: { name: location },
    absolute_url: `https://example.test/${id}`,
    updated_at: postedAt,
  })) });

  try {
    const imported = await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    assert.equal(imported.stats.fetched, 8);
    assert.equal(imported.stats.kept, 7);
    assert.equal(imported.stats.filteredOutNonCanada, 1);
    assert.equal(imported.stats.relevantJobs, 5);

    const matches = await store.findJobs(tenantId, {
      geography: 'canada',
      minRelevance: 40,
      sortBy: 'relevance',
      page: 1,
      pageSize: 20,
    });
    assert.equal(matches.total, 5);
    assert.deepEqual(new Set(matches.items.map((item) => item.title)), new Set([
      'Talent Acquisition Manager',
      'Senior Recruiter',
      'Recruiting Lead',
      'Talent Sourcer',
      'Talent Partner',
    ]));
    assert.ok(matches.items.find((item) => item.title === 'Senior Recruiter').relevanceScore >= 40);
    assert.ok(matches.items.find((item) => item.title === 'Recruiting Lead').relevanceReasons.some((reason) => /role match/i.test(reason)));

    const allCanada = await store.findJobs(tenantId, { geography: 'canada', page: 1, pageSize: 20 });
    assert.equal(allCanada.total, 7);
    assert.equal(allCanada.items.find((item) => item.title === 'People Operations Manager').relevanceBand, 'low');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('combined Canada and target-role filters count every match before pagination', async () => {
  const store = createStore();
  const tenantId = 'tenant-search-focus-pagination';
  addTenant(store, tenantId, 'jobseeker');
  await store.patchSettings(tenantId, {
    geographyFocus: 'Canada',
    searchFocus: {
      targetRoles: 'talent acquisition manager',
      workStyle: 'any',
      minimumRelevanceScore: 45,
    },
  });
  const account = await store.addAccount(tenantId, { displayName: 'Pagination Employer' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: account.displayName,
    atsType: 'greenhouse',
    boardId: 'pagination-employer',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const postedAt = new Date().toISOString();
  const jobs = [
    ...Array.from({ length: 35 }, (_, index) => ({
      id: `canada-recruiter-${index}`,
      title: `Senior Recruiter ${index + 1}`,
      location: { name: index % 2 ? 'Toronto, ON' : 'Remote - Canada' },
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `canada-engineer-${index}`,
      title: `Software Engineer ${index + 1}`,
      location: { name: 'Vancouver, BC' },
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `us-recruiter-${index}`,
      title: `Senior Recruiter US ${index + 1}`,
      location: { name: 'New York, NY' },
    })),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ jobs: jobs.map((job) => ({
    ...job,
    absolute_url: `https://example.test/${job.id}`,
    updated_at: postedAt,
  })) });

  try {
    await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    const firstPage = await store.findJobs(tenantId, {
      geography: 'canada',
      minRelevance: 45,
      sortBy: 'relevance',
      page: 1,
      pageSize: 10,
    });
    const secondPage = await store.findJobs(tenantId, {
      geography: 'canada',
      minRelevance: 45,
      sortBy: 'relevance',
      page: 2,
      pageSize: 10,
    });

    assert.equal(firstPage.total, 35);
    assert.equal(firstPage.items.length, 10);
    assert.equal(secondPage.total, 35);
    assert.equal(secondPage.items.length, 10);
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size, 20);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('switching personas restores that persona search focus and rescored shortlist', async () => {
  const store = createStore();
  const tenantId = 'tenant-persona-search-focus';
  addTenant(store, tenantId, 'bd');
  await store.patchSettings(tenantId, {
    searchFocus: {
      targetRoles: 'sales engineer',
      excludedRoles: '',
      targetIndustries: '',
      workStyle: 'any',
      minimumRelevanceScore: 45,
    },
  });
  const account = await store.addAccount(tenantId, { displayName: 'Dual Mode Employer' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: account.displayName,
    atsType: 'greenhouse',
    boardId: 'dual-mode-employer',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const postedAt = new Date().toISOString();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ jobs: [
    { id: 'sales', title: 'Sales Engineer', location: { name: 'Toronto, ON' }, absolute_url: 'https://example.test/sales', updated_at: postedAt },
    { id: 'recruiter', title: 'Senior Recruiter', location: { name: 'Toronto, ON' }, absolute_url: 'https://example.test/recruiter', updated_at: postedAt },
  ] });

  try {
    await store.importLiveJobs(tenantId, { plan, autoDiscover: false });
    let matches = await store.findJobs(tenantId, { minRelevance: 45, sortBy: 'relevance', page: 1, pageSize: 20 });
    assert.deepEqual(matches.items.map((item) => item.title), ['Sales Engineer']);

    await store.switchPersona(tenantId, 'jobseeker');
    const jobSeekerSave = await store.patchSettings(tenantId, {
      searchFocus: {
        targetRoles: 'talent acquisition manager',
        excludedRoles: '',
        targetIndustries: '',
        workStyle: 'any',
        minimumRelevanceScore: 45,
      },
    });
    assert.equal(jobSeekerSave.matchingJobs, 1);
    matches = await store.findJobs(tenantId, { minRelevance: 45, sortBy: 'relevance', page: 1, pageSize: 20 });
    assert.deepEqual(matches.items.map((item) => item.title), ['Senior Recruiter']);

    const switchedBack = await store.switchPersona(tenantId, 'bd');
    assert.equal(switchedBack.matchingJobs, 1);
    matches = await store.findJobs(tenantId, { minRelevance: 45, sortBy: 'relevance', page: 1, pageSize: 20 });
    assert.deepEqual(matches.items.map((item) => item.title), ['Sales Engineer']);

    const bootstrap = await store.getBootstrap(tenantId);
    assert.equal(bootstrap.persona, 'bd');
    assert.equal(bootstrap.settings.searchFocusByPersona.bd.targetRoles, 'sales engineer');
    assert.equal(bootstrap.settings.searchFocusByPersona.jobseeker.targetRoles, 'talent acquisition manager');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('target industries move the most relevant unresolved company to the front of discovery', async () => {
  const store = createStore();
  const tenantId = 'tenant-search-focus-discovery';
  addTenant(store, tenantId, 'bd');
  await store.patchSettings(tenantId, {
    searchFocus: { targetIndustries: 'manufacturing', minimumRelevanceScore: 45 },
  });
  const target = await store.addAccount(tenantId, {
    displayName: 'Priority Manufacturing',
    industry: 'Advanced Manufacturing',
    domain: 'priority-manufacturing.example',
  });
  const other = await store.addAccount(tenantId, {
    displayName: 'Other Software',
    industry: 'Software',
    domain: 'other-software.example',
  });
  for (const account of [target, other]) {
    store.addConfig(tenantId, {
      accountId: account.id,
      companyName: account.displayName,
      domain: account.domain,
      atsType: 'unknown',
      discoveryStatus: 'unresolved',
      reviewStatus: 'pending',
      active: false,
    });
  }

  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response('', { status: 404 });
  };
  try {
    const result = await store.runAtsDiscovery(tenantId, {
      limit: 1,
      discoveryConcurrency: 1,
      plan,
    });
    assert.equal(result.stats.checked, 1);
    assert.ok(requestedUrls.some((url) => url.includes('priority-manufacturing.example')));
    assert.equal(requestedUrls.some((url) => url.includes('other-software.example')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('target industries move the most relevant ready board into a limited refresh batch', async () => {
  const store = createStore();
  const tenantId = 'tenant-search-focus-refresh';
  addTenant(store, tenantId, 'jobseeker');
  await store.patchSettings(tenantId, {
    searchFocus: { targetIndustries: 'manufacturing', minimumRelevanceScore: 45 },
  });
  const target = await store.addAccount(tenantId, {
    displayName: 'Priority Manufacturing',
    industry: 'Advanced Manufacturing',
  });
  const other = await store.addAccount(tenantId, {
    displayName: 'Other Software',
    industry: 'Software',
  });
  store.addConfig(tenantId, {
    accountId: target.id,
    companyName: target.displayName,
    atsType: 'greenhouse',
    boardId: 'priority-manufacturing',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });
  store.addConfig(tenantId, {
    accountId: other.id,
    companyName: other.displayName,
    atsType: 'greenhouse',
    boardId: 'other-software',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return Response.json({ jobs: [] });
  };
  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'One board', limits: { jobBoards: 1 } },
      autoDiscover: false,
      fetchConcurrency: 1,
    });
    assert.equal(result.stats.supportedConfigs, 1);
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /priority-manufacturing/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('name-only discovery tries a bounded company acronym domain', async () => {
  const store = createStore();
  const tenantId = 'tenant-acronym-domain-discovery';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Royal Bank of Canada' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: account.displayName,
    atsType: 'unknown',
    discoveryStatus: 'unresolved',
    reviewStatus: 'pending',
    active: false,
  });

  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response('', { status: 404 });
  };
  try {
    await store.runAtsDiscovery(tenantId, { limit: 1, discoveryConcurrency: 1, plan });
    assert.ok(requestedUrls.some((url) => url.includes('rbc.com')));
    assert.ok(requestedUrls.some((url) => url.includes('royalbankcanada.com')));
    assert.equal(requestedUrls.some((url) => url.includes('royalbankcanada.io')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
