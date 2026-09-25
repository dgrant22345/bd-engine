import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('slow discovery is bounded per company, aborts outstanding requests, and preserves successful matches', async () => {
  const store = createStore(); const tenant = 'bounded-discovery';
  store.ensureTenant({ id: tenant, name: tenant }, { id: `${tenant}-owner` });
  await store.addAccount(tenant, { displayName: 'Fast Discovery', domain: 'fast.example', careersUrl: 'https://fast.example/careers' });
  await store.addAccount(tenant, { displayName: 'Slow Discovery', domain: 'slow.example', careersUrl: 'https://slow.example/careers' });
  const originalFetch = globalThis.fetch;
  let pending = 0; let aborted = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('fast.example')) return new Response('<a href="https://jobs.ashbyhq.com/fast-discovery">Careers</a>');
    if (String(url).includes('api.ashbyhq.com/posting-api/job-board/fast-discovery')) return Response.json({ jobs: [{ id: 'fast-job', title: 'Recruiter' }] });
    return new Promise((resolve, reject) => {
      pending++;
      const onAbort = () => { pending--; aborted++; reject(new DOMException('Aborted', 'AbortError')); };
      if (init.signal.aborted) onAbort(); else init.signal.addEventListener('abort', onAbort, { once: true });
    });
  };
  try {
    const startedAt = performance.now();
    const updates = [];
    const result = await store.runAtsDiscovery(tenant, { limit: 2, discoveryTimeBudgetMs: 150, onProgress: progress => updates.push(progress) });
    const elapsedMs = Math.round(performance.now() - startedAt);
    assert.equal(result.stats.mapped, 1);
    assert.equal(updates[0].checked, 0);
    assert.equal(updates[1].checked, 1);
    assert.equal(updates[1].found, 1, 'successful sources are visible before the slow check finishes');
    assert.equal(updates[1].failed, 0);
    assert.equal(updates.at(-1).checked, 2);
    assert.equal(updates.at(-1).failed, 1);
    assert.equal(updates.at(-1).unmatched, 0, 'timeouts are not reported as unmatched sources');
    assert.ok(result.timings.progressCallbackMs >= 0);
    assert.equal(result.stats.timedOut, 1);
    assert.equal(result.errors[0].code, 'discovery_timeout');
    assert.match(result.warnings.join(' '), /does not mean there are no jobs/);
    assert.equal(pending, 0); assert.ok(aborted > 0);
    assert.ok(elapsedMs < 1500, `Discovery fixture exceeded tolerance: ${elapsedMs}ms`);
    const configs = (await store.findConfigs(tenant, { pageSize: 20 })).items;
    assert.equal(configs.find(config => config.companyName === 'Fast Discovery').discoveryStatus, 'resolved');
    assert.match(configs.find(config => config.companyName === 'Slow Discovery').lastDiscoveryError, /time limit/);
    console.log(`saas/src/store.js::runAtsDiscovery bounded fixture: ${elapsedMs}ms; active requests after return: ${pending}`);
  } finally { globalThis.fetch = originalFetch; }
});

test('unsuccessful but complete discovery remains unresolved, not a timeout', async () => {
  const store = createStore(); const tenant = 'no-discovery-match';
  store.ensureTenant({ id: tenant, name: tenant }, { id: `${tenant}-owner` });
  await store.addAccount(tenant, { displayName: 'No Board Example' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not found', { status: 404 });
  try {
    const result = await store.runAtsDiscovery(tenant, { limit: 1 });
    assert.equal(result.stats.timedOut, 0);
    assert.equal(result.stats.errors, 0);
    assert.equal(result.stats.unresolved, 1);
  } finally { globalThis.fetch = originalFetch; }
});
