import test from 'node:test';
import assert from 'node:assert/strict';

test('discovery uses one authenticated renderer fallback for the primary careers URL', async () => {
  const previousUrl = process.env.BD_ATS_RENDER_SERVICE_URL;
  const previousToken = process.env.BD_ATS_RENDER_SERVICE_TOKEN;
  process.env.BD_ATS_RENDER_SERVICE_URL = 'https://renderer.example/render';
  process.env.BD_ATS_RENDER_SERVICE_TOKEN = 'renderer-test-token';
  const { createStore } = await import(`../src/store.js?renderer-test=${Date.now()}`);

  const store = createStore();
  const tenantId = 'tenant-rendered-discovery';
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner`, name: 'Owner' });
  const account = await store.addAccount(tenantId, {
    displayName: 'Rendered Careers Labs',
    domain: 'rendered-careers.example',
    careersUrl: 'https://rendered-careers.example/careers',
  });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Rendered Careers Labs',
    domain: 'rendered-careers.example',
    careersUrl: 'https://rendered-careers.example/careers',
    atsType: 'unknown',
    discoveryStatus: 'needs_review',
    reviewStatus: 'pending',
    active: false,
  });

  let renderRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    if (value === 'https://renderer.example/render') {
      renderRequests++;
      assert.equal(init.headers.authorization, 'Bearer renderer-test-token');
      assert.equal(JSON.parse(init.body).url, 'https://rendered-careers.example/careers');
      return Response.json({
        finalUrl: 'https://rendered-careers.example/careers',
        html: '<a href="https://jobs.ashbyhq.com/rendered-careers/job-1">Open role</a>',
      });
    }
    if (value.includes('api.ashbyhq.com/posting-api/job-board/rendered-careers')) {
      return Response.json({ jobs: [{ id: 'job-1', title: 'Rendered Sales Lead', location: 'Toronto, ON', jobUrl: 'https://jobs.ashbyhq.com/rendered-careers/job-1' }] });
    }
    if (value === 'https://rendered-careers.example/careers') {
      return new Response('<main id="jobs"></main>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const result = await store.runAtsDiscovery(tenantId, {
      limit: 1,
      discoveryConcurrency: 1,
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
    });
    assert.equal(result.stats.mapped, 1);
    assert.equal(renderRequests, 1);
    const config = (await store.findConfigs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(config.atsType, 'ashby');
    assert.equal(config.boardId, 'rendered-careers');
    assert.equal(config.discoveryStatus, 'resolved');
    assert.equal(config.discoveryMethod, 'rendered_careers_page');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.BD_ATS_RENDER_SERVICE_URL;
    else process.env.BD_ATS_RENDER_SERVICE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.BD_ATS_RENDER_SERVICE_TOKEN;
    else process.env.BD_ATS_RENDER_SERVICE_TOKEN = previousToken;
  }
});

test('discovery renders the strongest careers page that actually loads', async () => {
  const previousUrl = process.env.BD_ATS_RENDER_SERVICE_URL;
  const previousToken = process.env.BD_ATS_RENDER_SERVICE_TOKEN;
  process.env.BD_ATS_RENDER_SERVICE_URL = 'https://renderer.example/render';
  process.env.BD_ATS_RENDER_SERVICE_TOKEN = 'renderer-test-token';
  const { createStore } = await import(`../src/store.js?renderer-fallback-test=${Date.now()}`);

  const store = createStore();
  const tenantId = 'tenant-rendered-fallback-discovery';
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner`, name: 'Owner' });
  const account = await store.addAccount(tenantId, {
    displayName: 'Fallback Careers Labs',
    domain: 'fallback-careers.example',
  });
  store.addConfig(tenantId, {
    accountId: account.id,
    companyName: 'Fallback Careers Labs',
    domain: 'fallback-careers.example',
    atsType: 'unknown',
    discoveryStatus: 'needs_review',
    reviewStatus: 'pending',
    active: false,
  });

  let renderRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    if (value === 'https://renderer.example/render') {
      renderRequests++;
      assert.equal(JSON.parse(init.body).url, 'https://fallback-careers.example/careers');
      return Response.json({
        finalUrl: 'https://fallback-careers.example/careers',
        html: '<a href="https://jobs.ashbyhq.com/fallback-careers/job-1">Open role</a>',
      });
    }
    if (value.includes('api.ashbyhq.com/posting-api/job-board/fallback-careers')) {
      return Response.json({ jobs: [{ id: 'job-1', title: 'Revenue Operations Lead', location: 'Remote', jobUrl: 'https://jobs.ashbyhq.com/fallback-careers/job-1' }] });
    }
    if (value === 'https://fallback-careers.example/careers') {
      return new Response('<main><h1>Careers</h1><div id="jobs"></div></main>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const result = await store.runAtsDiscovery(tenantId, {
      limit: 1,
      discoveryConcurrency: 1,
      plan: { displayName: 'Test', limits: { jobBoards: -1 } },
    });
    assert.equal(result.stats.mapped, 1);
    assert.equal(renderRequests, 1);
    const config = (await store.findConfigs(tenantId, { page: 1, pageSize: 20 })).items[0];
    assert.equal(config.atsType, 'ashby');
    assert.equal(config.boardId, 'fallback-careers');
    assert.equal(config.discoveryMethod, 'rendered_careers_page');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.BD_ATS_RENDER_SERVICE_URL;
    else process.env.BD_ATS_RENDER_SERVICE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.BD_ATS_RENDER_SERVICE_TOKEN;
    else process.env.BD_ATS_RENDER_SERVICE_TOKEN = previousToken;
  }
});
