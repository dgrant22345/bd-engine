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

test('Workable boards import jobs from the documented public careers endpoint', async () => {
  const store = createStore();
  const tenantId = 'tenant-workable-import';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Example Works' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Example Works',
    atsType: 'workable',
    careersUrl: 'https://apply.workable.com/example-works/',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({
      jobs: [{
        title: 'Product Designer',
        shortcode: 'ABC123',
        employment_type: 'Full-time',
        department: 'Product',
        url: 'https://apply.workable.com/j/ABC123',
        published_on: new Date().toISOString().slice(0, 10),
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(result.stats.newJobs, 1);
    assert.deepEqual(requestedUrls, ['https://www.workable.com/api/accounts/example-works?details=true']);
    const imported = (await store.findJobs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(imported.source, 'Workable');
    assert.equal(imported.title, 'Product Designer');
    assert.equal(imported.location, 'Toronto, Ontario, Canada');
    assert.equal(imported.jobUrl, 'https://apply.workable.com/j/ABC123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('live imports discover inactive unresolved board configs', async () => {
  const store = createStore();
  const tenantId = 'tenant-import-auto-discovery';
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
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscoveryLimit: 1,
      discoveryConcurrency: 1,
    });
    assert.equal(result.stats.autoDiscoveryChecked, 1);
    const suggestion = (await store.findConfigs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(suggestion.atsType, 'ashby');
    assert.equal(suggestion.reviewStatus, 'pending');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled imports keep discovering after the ready-board minimum is met', async () => {
  const store = createStore();
  const tenantId = 'tenant-scheduled-discovery';
  addTenant(store, tenantId);
  const readyAccount = await store.addAccount(tenantId, { displayName: 'Ready Systems' });
  store.addConfig(tenantId, {
    accountId: readyAccount.id,
    companyName: 'Ready Systems',
    atsType: 'greenhouse',
    boardId: 'ready-systems',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });
  const unresolvedAccount = await store.addAccount(tenantId, { displayName: 'Future Rocket Labs' });
  store.addConfig(tenantId, {
    accountId: unresolvedAccount.id,
    companyName: 'Future Rocket Labs',
    atsType: 'unknown',
    discoveryStatus: 'needs_review',
    reviewStatus: 'pending',
    active: false,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('boards-api.greenhouse.io/v1/boards/ready-systems/jobs')) {
      return new Response(JSON.stringify({ jobs: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (value.includes('api.ashbyhq.com/posting-api/job-board/futurerocketlabs')) {
      return new Response(JSON.stringify({ jobs: [{ id: 'job-1', title: 'Engineer' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('', { status: 404 });
  };

  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      scheduled: true,
      autoDiscoveryLimit: 1,
      autoDiscoveryMinReady: 1,
      discoveryConcurrency: 1,
    });
    assert.equal(result.stats.activeConfigs, 1);
    assert.equal(result.stats.autoDiscoveryChecked, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ATS discovery prioritizes and links high-value legacy configs by company name', async () => {
  const store = createStore();
  const tenantId = 'tenant-discovery-priority';
  addTenant(store, tenantId);
  const lowValue = await store.addAccount(tenantId, { displayName: 'Low Value Works', targetScore: 5 });
  const highValue = await store.addAccount(tenantId, { displayName: 'Priority Systems', targetScore: 95 });
  store.addConfig(tenantId, {
    companyName: lowValue.displayName,
    atsType: 'unknown',
    discoveryStatus: 'needs_review',
    reviewStatus: 'pending',
    active: false,
  });
  store.addConfig(tenantId, {
    companyName: highValue.displayName,
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
    assert.equal(result.stats.linkedAccountConfigs, 1);
    assert.ok(requestedUrls.some((url) => url.includes('prioritysystems')));
    assert.equal(requestedUrls.some((url) => url.includes('lowvalueworks')), false);
    const priorityConfig = (await store.findConfigs(tenantId, { q: 'Priority Systems', page: 1, pageSize: 20 })).items[0];
    assert.equal(priorityConfig.accountId, highValue.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Workday imports retry transient HTML challenge responses', async () => {
  const store = createStore();
  const tenantId = 'tenant-workday-retry';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Workday Example' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Workday Example',
    atsType: 'workday',
    boardId: 'Example_Careers',
    apiUrl: 'https://example.wd10.myworkdayjobs.com/wday/cxs/example/Example_Careers/jobs',
    resolvedBoardUrl: 'https://example.wd10.myworkdayjobs.com/Example_Careers',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount++;
    if (fetchCount === 1) {
      return new Response('<!doctype html><title>Please wait</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response(JSON.stringify({
      total: 1,
      jobPostings: [{
        title: 'Account Executive',
        externalPath: '/job/Toronto/Account-Executive_R1001',
        locationsText: 'Toronto, ON',
        postedOn: 'Posted Today',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(fetchCount, 2);
    assert.equal(result.stats.fetched, 1);
    assert.equal(result.stats.newJobs, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Rippling boards import structured jobs from the public careers page', async () => {
  const store = createStore();
  const tenantId = 'tenant-rippling-import';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Pace' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Pace',
    atsType: 'rippling',
    boardId: 'pace',
    resolvedBoardUrl: 'https://ats.rippling.com/pace/jobs',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const nextData = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [{
            state: {
              data: {
                items: [{
                  id: 'rippling-job-1',
                  name: 'Enterprise Account Executive',
                  url: 'https://ats.rippling.com/pace/jobs/rippling-job-1',
                  department: { name: 'Sales' },
                  locations: [{ name: 'Toronto, ON' }],
                }],
              },
            },
          }],
        },
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`,
    { status: 200, headers: { 'content-type': 'text/html' } }
  );

  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(result.stats.fetched, 1);
    assert.equal(result.stats.newJobs, 1);
    const job = (await store.findJobs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(job.source, 'Rippling');
    assert.equal(job.location, 'Toronto, ON');
    assert.equal(job.department, 'Sales');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Recruitee boards import published offers from the public careers API', async () => {
  const store = createStore();
  const tenantId = 'tenant-recruitee-import';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Example Recruitee' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Example Recruitee',
    careersUrl: 'https://example-team.recruitee.com/',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(JSON.stringify({
      offers: [{
        id: 724,
        slug: 'sales-engineer',
        title: 'Sales Engineer',
        department: 'Sales',
        employment_type: 'full_time',
        locations: [{ city: 'Toronto', state: 'Ontario', country: 'Canada' }],
        careers_url: 'https://example-team.recruitee.com/o/sales-engineer',
        published_at: new Date().toISOString(),
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(result.stats.newJobs, 1);
    assert.deepEqual(requestedUrls, ['https://example-team.recruitee.com/api/offers/']);
    const imported = (await store.findJobs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(imported.source, 'Recruitee');
    assert.equal(imported.location, 'Toronto, Ontario, Canada');
    assert.equal(imported.jobUrl, 'https://example-team.recruitee.com/o/sales-engineer');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Personio boards import the public XML positions feed', async () => {
  const store = createStore();
  const tenantId = 'tenant-personio-import';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Example Personio' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Example Personio',
    careersUrl: 'https://example-team.jobs.personio.de/',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const requestedUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
      <workzag-jobs><position><id>4103</id><office>Toronto, ON</office>
      <department>Customer Success</department><name>Implementation Manager</name>
      <employmentType>permanent</employmentType><schedule>full-time</schedule>
      <createdAt>2026-07-12T12:14:07+0000</createdAt></position></workzag-jobs>`, {
      status: 200,
      headers: { 'content-type': 'application/xml' },
    });
  };

  try {
    const result = await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    assert.equal(result.stats.newJobs, 1);
    assert.deepEqual(requestedUrls, ['https://example-team.jobs.personio.de/xml?language=en']);
    const imported = (await store.findJobs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(imported.source, 'Personio');
    assert.equal(imported.title, 'Implementation Manager');
    assert.equal(imported.employmentType, 'permanent, full-time');
    assert.equal(imported.jobUrl, 'https://example-team.jobs.personio.de/job/4103');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('outreach drafts use verified role context and return real alternate angles', async () => {
  const store = createStore();
  const tenantId = 'tenant-outreach-quality';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Acme Systems' });
  store.addConfig(tenantId, {
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
      id: 202,
      title: 'Senior Data Engineer',
      location: { name: 'Toronto, ON' },
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/202',
      updated_at: new Date().toISOString(),
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    const draft = await store.createOutreachDraft(tenantId, account.id, {
      contactName: 'Dana Chen',
      contactTitle: 'VP Talent',
      template: 'talent_partner',
      includeVariants: true,
    });
    assert.match(draft.message_body, /Senior Data Engineer/);
    assert.match(draft.message_body, /VP Talent/);
    assert.doesNotMatch(draft.message_body, /recent growth|10 minutes next week|compare notes/i);
    assert.equal(draft.variants.length, 2);
    assert.deepEqual(draft.variants.map((item) => item.template_key), ['hiring_manager', 'executive']);
    assert.ok(draft.linkedin_message.length < 400);
    assert.equal(draft.grounding.label, 'Strong grounding');
    assert.ok(draft.grounding.score >= 75);
    assert.ok(draft.grounding.evidence.some((item) => item.label === 'Visible openings' && /Senior Data Engineer/.test(item.value)));
    assert.ok(draft.grounding.evidence.some((item) => item.label === 'Contact role' && item.value === 'VP Talent'));
    assert.deepEqual(draft.grounding.warnings, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sales outreach keeps multi-role first touches concise and non-repetitive', async () => {
  const store = createStore();
  const tenantId = 'tenant-outreach-multiple-roles';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Northstar Robotics' });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Northstar Robotics',
    atsType: 'greenhouse',
    boardId: 'northstar',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    jobs: [
      { id: 301, title: 'Senior Controls Engineer', location: { name: 'Toronto, ON' }, absolute_url: 'https://boards.greenhouse.io/northstar/jobs/301', updated_at: new Date().toISOString() },
      { id: 302, title: 'Embedded Robotics Developer', location: { name: 'Toronto, ON' }, absolute_url: 'https://boards.greenhouse.io/northstar/jobs/302', updated_at: new Date().toISOString() },
      { id: 303, title: 'Platform Engineer', location: { name: 'Remote' }, absolute_url: 'https://boards.greenhouse.io/northstar/jobs/303', updated_at: new Date().toISOString() },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    await store.importLiveJobs(tenantId, {
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
      autoDiscover: false,
    });
    const jobs = await store.findJobs(tenantId, { q: 'Senior Controls Engineer', page: 1, pageSize: 10 });
    const draft = await store.createOutreachDraft(tenantId, account.id, {
      contactName: 'Priya Shah',
      contactTitle: 'Director of Talent',
      template: 'talent_partner',
      jobId: jobs.items[0].id,
    });
    assert.match(draft.linkedin_message, /and 2 other open roles/);
    assert.equal((draft.linkedin_message.match(/Senior Controls Engineer/g) || []).length, 1);
    assert.doesNotMatch(draft.linkedin_message, /Toronto.*Toronto|visible openings/i);
    assert.ok(draft.linkedin_message.length <= 260, draft.linkedin_message);
    assert.match(draft.message_body, /Given your role as Director of Talent/);
    assert.doesNotMatch(draft.message_body, /Your role as .* made you/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('outreach drafts expose limited context instead of inventing a hiring problem', async () => {
  const store = createStore();
  const tenantId = 'tenant-outreach-limited';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Quiet Company' });

  const draft = await store.createOutreachDraft(tenantId, account.id, { template: 'cold' });
  assert.equal(draft.grounding.label, 'Limited context');
  assert.ok(draft.grounding.score < 50);
  assert.ok(draft.grounding.warnings.some((item) => /No verified opening/.test(item)));
  assert.ok(draft.grounding.warnings.some((item) => /contact title is missing/i.test(item)));
  assert.match(draft.message_body, /do not have a verified open role/i);
  assert.doesNotMatch(draft.message_body, /pipeline is thin|delivery risk|recent growth/i);
});

test('logging outreach creates a durable follow-up task', async () => {
  const store = createStore();
  const tenantId = 'tenant-outreach-followup';
  addTenant(store, tenantId);
  const account = await store.addAccount(tenantId, { displayName: 'Followup Systems' });

  await store.addActivity(tenantId, `${tenantId}-owner`, {
    accountId: account.id,
    type: 'outreach',
    summary: 'Sent email outreach to Dana',
    contactName: 'Dana',
    followUpDays: 7,
    metadata: { channels: ['email'] },
  });

  const tasks = await store.findTasks(tenantId, { page: 1, pageSize: 20 });
  assert.equal(tasks.total, 1);
  assert.equal(tasks.items[0].accountId, account.id);
  assert.equal(tasks.items[0].type, 'follow_up');
  assert.match(tasks.items[0].summary, /Dana/);
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
