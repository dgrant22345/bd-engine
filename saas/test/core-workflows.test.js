import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

const csv = `First Name,Last Name,Company,Position,Email Address,URL
Alice,Ng,Acme Systems,VP Talent,alice@acme.example,https://linkedin.com/in/alice-ng
Alice,Ng,Acme Systems,VP Talent,alice@acme.example,https://linkedin.com/in/alice-ng
Bob,Diaz,Beta Labs,Director Engineering,bob@beta.example,https://linkedin.com/in/bob-diaz`;

function addTenant(store, tenantId) {
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner`, name: 'Owner' });
}

test('LinkedIn import deduplicates repeated rows and repeated imports', async () => {
  const store = createStore();
  const tenantId = 'tenant-import-dedupe';
  const otherTenantId = 'tenant-import-other';
  addTenant(store, tenantId);
  addTenant(store, otherTenantId);

  const first = await store.importLinkedInCSV(tenantId, csv, { plan: { limits: {} } });
  assert.equal(first.ok, true);
  assert.equal(first.stats.accountsCreated, 2);
  assert.equal(first.stats.contactsCreated, 2);
  assert.equal(first.stats.duplicatesSkipped, 1);

  const second = await store.importLinkedInCSV(tenantId, csv, { plan: { limits: {} } });
  assert.equal(second.stats.accountsCreated, 0);
  assert.equal(second.stats.contactsCreated, 0);
  assert.equal(second.stats.duplicatesSkipped, 3);

  assert.equal((await store.findAccounts(tenantId, { page: 1, pageSize: 20 })).total, 2);
  assert.equal((await store.findContacts(tenantId, { page: 1, pageSize: 20 })).total, 2);
  const acme = (await store.findAccounts(tenantId, { q: 'Acme', page: 1, pageSize: 20 })).items[0];
  assert.equal(acme.domain, 'acme.example');
  assert.equal(acme.connectionCount, 1);
  assert.equal(acme.targetScore, 43);
  assert.equal((await store.findAccounts(otherTenantId, { page: 1, pageSize: 20 })).total, 0);
  assert.equal((await store.findContacts(otherTenantId, { page: 1, pageSize: 20 })).total, 0);
});

test('LinkedIn dry run and plan limits do not over-create records', async () => {
  const store = createStore();
  const dryTenantId = 'tenant-import-dry-run';
  const limitedTenantId = 'tenant-import-limited';
  addTenant(store, dryTenantId);
  addTenant(store, limitedTenantId);

  const preview = await store.importLinkedInCSV(dryTenantId, csv, { dryRun: true, plan: { limits: {} } });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.stats.accountsCreated, 2);
  assert.equal((await store.findAccounts(dryTenantId, { page: 1, pageSize: 20 })).total, 0);
  assert.equal((await store.findContacts(dryTenantId, { page: 1, pageSize: 20 })).total, 0);

  const limited = await store.importLinkedInCSV(limitedTenantId, csv, {
    plan: { displayName: 'Limited', limits: { accounts: 1, contacts: 1 } },
  });
  assert.equal(limited.stats.accountsCreated, 1);
  assert.equal(limited.stats.contactsCreated, 1);
  assert.ok(limited.stats.planLimitedSkipped >= 1);
  assert.equal((await store.findAccounts(limitedTenantId, { page: 1, pageSize: 20 })).total, 1);
  assert.equal((await store.findContacts(limitedTenantId, { page: 1, pageSize: 20 })).total, 1);
});

test('manual job-board configurations remain tenant scoped', async () => {
  const store = createStore();
  const tenantId = 'tenant-config-owner';
  const otherTenantId = 'tenant-config-other';
  addTenant(store, tenantId);
  addTenant(store, otherTenantId);

  const created = store.addConfig(tenantId, {
    companyName: 'Acme Systems',
    atsType: 'greenhouse',
    boardId: 'acme',
    active: true,
  });
  assert.equal(created.ats, 'greenhouse');
  assert.equal((await store.findConfigs(tenantId, { page: 1, pageSize: 20 })).total, 1);
  assert.equal((await store.findConfigs(otherTenantId, { page: 1, pageSize: 20 })).total, 0);
});

test('live job import records a run and imports jobs from a ready board', async () => {
  const store = createStore();
  const tenantId = 'tenant-live-job-import';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Acme Systems', domain: 'acme.example' });
  const config = store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Acme Systems',
    atsType: 'greenhouse',
    boardId: 'acme',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    jobs: [{
      id: 101,
      title: 'Controls Engineer',
      location: { name: 'Toronto, ON' },
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/101',
      updated_at: new Date().toISOString(),
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.stats.fetched, 1);
    assert.equal(result.stats.newJobs, 1);
    assert.match(result.importRun.id, /^imp-jobs-/);
    assert.equal((await store.findJobs(tenantId, { page: 1, pageSize: 20 })).total, 1);

    await store.reviewConfig(tenantId, config.id, { action: 'reject' });
    assert.equal((await store.findJobs(tenantId, { active: 'true', page: 1, pageSize: 20 })).total, 0);
    const closedJob = (await store.findJobs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(closedJob.active, false);
    assert.ok(closedJob.closedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ATS discovery ignores personal email domains and guesses the company domain', async () => {
  const store = createStore();
  const tenantId = 'tenant-domain-discovery';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Acme Systems', domain: 'gmail.com' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Acme Systems',
    domain: 'gmail.com',
    careersUrl: 'https://gmail.com/careers',
    atsType: 'unknown',
    discoveryStatus: 'needs_review',
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
    const result = await store.runAtsDiscovery(tenantId, {
      limit: 1,
      discoveryConcurrency: 1,
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
    });
    assert.equal(result.stats.checked, 1);
    assert.ok(requestedUrls.some((url) => url.includes('acme.com')));
    assert.equal(requestedUrls.some((url) => /https?:\/\/(?:careers\.)?gmail\.com/i.test(url)), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BambooHR embed URLs resolve to the JSON careers list', async () => {
  const store = createStore();
  const tenantId = 'tenant-bamboo-import';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'PCS Wireless' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'PCS Wireless',
    atsType: 'bamboohr',
    boardId: 'pcsglobal',
    apiUrl: 'https://pcsglobal.bamboohr.com/js/embed.js',
    resolvedBoardUrl: 'https://pcsglobal.bamboohr.com/js/embed.js',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({
      result: [{
        id: '168',
        jobOpeningName: 'Warehouse Associate',
        departmentLabel: 'Operations',
        employmentStatusLabel: 'Temporary',
        location: { city: 'Toronto', state: 'Ontario', country: 'Canada' },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(result.stats.newJobs, 1);
    assert.deepEqual(requestedUrls, ['https://pcsglobal.bamboohr.com/careers/list']);
    const imported = (await store.findJobs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(imported.title, 'Warehouse Associate');
    assert.equal(imported.source, 'BambooHR');
    assert.match(imported.jobUrl, /pcsglobal\.bamboohr\.com\/careers\/168/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generic company identities do not probe unrelated public ATS slugs', async () => {
  const store = createStore();
  const tenantId = 'tenant-generic-company';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Stealth Startup', domain: 'gmail.com' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Stealth Startup',
    domain: 'gmail.com',
    atsType: 'unknown',
    discoveryStatus: 'needs_review',
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
    const result = await store.runAtsDiscovery(tenantId, {
      limit: 1,
      discoveryConcurrency: 1,
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
    });
    assert.equal(result.stats.mapped, 0);
    assert.deepEqual(requestedUrls, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('name-only ATS matches require review before jobs can import', async () => {
  const store = createStore();
  const tenantId = 'tenant-name-probe-review';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Example Rocket Labs' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Example Rocket Labs',
    atsType: 'unknown',
    discoveryStatus: 'needs_review',
    reviewStatus: 'pending',
    active: false,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.ashbyhq.com/posting-api/job-board/examplerocketlabs')) {
      return new Response(JSON.stringify({ jobs: [{ id: 'job-1', title: 'Engineer' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('', { status: 404 });
  };

  try {
    const result = await store.runAtsDiscovery(tenantId, {
      limit: 1,
      discoveryConcurrency: 1,
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
    });
    assert.equal(result.stats.mapped, 0);
    assert.equal(result.stats.suggested, 1);
    const suggestion = (await store.findConfigs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(suggestion.atsType, 'ashby');
    assert.equal(suggestion.discoveryStatus, 'needs_review');
    assert.equal(suggestion.reviewStatus, 'pending');
    assert.equal(suggestion.active, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('permanently missing ATS boards return to review after import', async () => {
  const store = createStore();
  const tenantId = 'tenant-missing-board';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Closed Board Inc' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Closed Board Inc',
    atsType: 'lever',
    boardId: 'closed-board',
    apiUrl: 'https://api.lever.co/v0/postings/closed-board?mode=json',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    return new Response('', { status: 404 });
  };
  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(result.stats.errors, 1);
    assert.match(result.warnings.join(' '), /moved back to ATS review/i);
    const config = (await store.findConfigs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(config.active, false);
    assert.equal(config.discoveryStatus, 'needs_review');
    assert.equal(config.reviewStatus, 'pending');

    const rerun = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(rerun.stats.errors, 0);
    assert.equal(rerun.stats.supportedConfigs, 0);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('duplicate configs for the same provider board fetch only once', async () => {
  const store = createStore();
  const tenantId = 'tenant-duplicate-board';
  addTenant(store, tenantId);
  const firstAccount = await store.addAccount(tenantId, { displayName: 'Acme Systems' });
  const secondAccount = await store.addAccount(tenantId, { displayName: 'Acme Holdings' });
  for (const account of [firstAccount, secondAccount]) {
    store.addConfig(tenantId, {
      accountId: account.id,
      companyName: account.displayName,
      atsType: 'greenhouse',
      boardId: 'acme',
      discoveryStatus: 'resolved',
      reviewStatus: 'approved',
      active: true,
    });
  }

  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount++;
    return new Response(JSON.stringify({
      jobs: [{ id: 1, title: 'Account Executive', location: { name: 'Toronto, ON' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(fetchCount, 1);
    assert.equal(result.stats.supportedConfigs, 1);
    assert.equal(result.stats.duplicateBoardsSkipped, 1);
    assert.equal(result.stats.newJobs, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('known board corrections never override an explicit rejection', async () => {
  const store = createStore();
  const tenantId = 'tenant-known-board-rejection';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Lightspeed HQ' });
  const config = store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Lightspeed HQ',
    active: true,
  });
  await store.reviewConfig(tenantId, config.id, { action: 'reject' });

  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount++;
    return new Response('', { status: 404 });
  };
  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(result.stats.supportedConfigs, 0);
    assert.equal(fetchCount, 0);
    const rejected = (await store.findConfigs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(rejected.reviewStatus, 'rejected');
    assert.equal(rejected.active, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
