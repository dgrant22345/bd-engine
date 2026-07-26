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
    const after = await store.findJobs(tenantId, { minRelevance: 45, page: 1, pageSize: 20 });
    assert.equal(after.total, 0);
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
