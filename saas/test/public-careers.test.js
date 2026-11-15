import test from 'node:test';
import assert from 'node:assert/strict';
import { avatureBoardUrl, parseAvaturePage, parseJibePage, readAvatureBoard, readJibeBoard } from '../src/public-careers.js';
import { createStore, quarantineStaticBrowseJobs } from '../src/store.js';

const board = 'https://example.avature.net/en_US/careers';
function avaturePage(offset = 0, total = 12, next = true) {
  const count = Math.min(5, total - offset);
  return `${offset + 1} - ${offset + count} of ${total} results${Array.from({ length: count }, (_, i) => `<article class="article article--result"><h3><a href="${board}/JobDetail/Software-Engineer/${offset + i + 1}">Software &amp; Engineer</a></h3><p><span>City:</span> Toronto</p><p><span>State/Province:</span> Ontario</p><p><span>Country:</span> Canada</p><a href="${board}/Login?jobId=123">Apply</a></article>`).join('')}${next && offset + count < total ? `<a href="${board}/SearchJobs/?jobRecordsPerPage=5&amp;jobOffset=${offset + count}">Next</a>` : ''}`;
}
function jibePage(page = 1, total = 12) {
  const offset = (page - 1) * 10;
  return { totalCount: total, jobs: Array.from({ length: Math.min(10, total - offset) }, (_, i) => ({ data: {
    slug: String(offset + i + 1), title: 'Software Engineer', language: 'en-us', full_location: 'Toronto, Ontario, Canada',
    posted_date: '2020-01-01T00:00:00Z', employment_type: 'FULL_TIME', apply_url: 'https://example.icims.com/jobs/1/login',
  } })) };
}

test('Avature reads only job-detail cards, resolves locations, and normalizes board URLs', () => {
  assert.equal(avatureBoardUrl(`${board}/SearchJobs/?jobOffset=5`), board);
  assert.equal(avatureBoardUrl('https://example.avature.net.attacker.test/careers'), '');
  const parsed = parseAvaturePage(avaturePage(), board);
  assert.equal(parsed.total, 12); assert.equal(parsed.jobs.length, 5);
  assert.equal(parsed.jobs[0].title, 'Software & Engineer');
  assert.equal(parsed.jobs[0].location, 'Toronto, Ontario, Canada');
  assert.equal(new URL(parsed.nextUrl).searchParams.get('jobOffset'), '5');
  assert.equal(parseAvaturePage('<h3><a href="/careers/Login">Returning user</a></h3>', board).jobs.length, 0);
});

test('Avature follows observed pagination and rechecks the first page before permitting closures', async () => {
  const requests = [];
  const result = await readAvatureBoard(board, { getText: async url => {
    const offset = Number(new URL(url).searchParams.get('jobOffset')) || 0;
    requests.push(offset); return avaturePage(offset);
  } });
  assert.equal(result.complete, true); assert.equal(result.jobs.length, 12);
  assert.deepEqual(requests, [0, 5, 10, 0]);
});

test('Avature missing pagination and repeated pages are partial, and unrecognized HTML fails safely', async () => {
  const missing = await readAvatureBoard(board, { getText: async () => avaturePage(0, 12, false) });
  assert.equal(missing.complete, false); assert.ok(missing.pagination.reasons.includes('pagination_not_followed'));
  const repeated = await readAvatureBoard(board, { getText: async () => avaturePage() });
  assert.equal(repeated.complete, false); assert.ok(repeated.pagination.reasons.includes('duplicate_jobs'));
  await assert.rejects(readAvatureBoard(board, { getText: async () => '<h1>Sign in</h1>' }), /count missing/);
});

test('Jibe reads the external paginated feed and uses public details rather than application login URLs', async () => {
  const requests = [];
  const result = await readJibeBoard('https://careers.example.test/careers-home/jobs', { getJson: async url => {
    const parsed = new URL(url); requests.push(parsed.searchParams.get('page'));
    assert.equal(parsed.pathname, '/api/jobs'); assert.equal(parsed.searchParams.get('internal'), 'false');
    assert.equal(parsed.searchParams.get('limit'), '10');
    return jibePage(Number(parsed.searchParams.get('page')));
  } });
  assert.equal(result.complete, true); assert.equal(result.jobs.length, 12);
  assert.deepEqual(requests, ['1', '2', '1']);
  assert.equal(result.jobs[0].url, 'https://careers.example.test/careers-home/jobs/1?lang=en-us');
  assert.equal(result.jobs[0].employmentType, 'FULL_TIME');
  assert.throws(() => parseJibePage({ jobs: [] }, board), /count missing/);
  assert.throws(() => parseJibePage({ totalCount: 1 }, board), /invalid results/);
});

test('Jibe failed later pages and invalid identities cannot establish complete coverage', async () => {
  const failed = await readJibeBoard('https://careers.example.test/jobs', { getJson: async url => {
    if (new URL(url).searchParams.get('page') === '2') throw new Error('HTTP 503'); return jibePage();
  } });
  assert.equal(failed.complete, false); assert.equal(failed.jobs.length, 10);
  assert.ok(failed.pagination.reasons.includes('page_failed'));
  const invalid = await readJibeBoard('https://careers.example.test/jobs', { getJson: async () => ({ totalCount: 1, jobs: [{ data: { slug: '../login', title: 'bad' } }] }) });
  assert.equal(invalid.complete, false); assert.ok(invalid.pagination.reasons.includes('invalid_rows'));
});

test('informational vacancies become inactive while IDs, saved workflow and history remain intact', () => {
  const rows = ['/jobs/login', '/en-us/jobs/alumni', '/en-us/jobs/employee-benefits', '/en-us/jobs/employee-profiles/testimonials', '/jobs/benefits-manager-123', '/jobs/search-engineer-456', '/jobs/benefits/senior-benefits-manager-123'].map((path, i) => ({
    id: String(i), configId: 'source', jobUrl: `https://example.test${path}`, active: true, pipelineStage: 'saved', notes: 'Keep me', history: [{ action: 'saved' }],
  }));
  const changed = quarantineStaticBrowseJobs(rows, [{ id: 'source', atsType: 'custom_static' }], '2026-11-15T00:00:00Z');
  assert.equal(changed.length, 4); assert.equal(rows.length, 7);
  for (const row of changed) { assert.equal(row.pipelineStage, 'saved'); assert.equal(row.notes, 'Keep me'); assert.equal(row.history.length, 1); assert.equal(row.closureReason, 'invalid_information_page'); }
  assert.equal(rows[4].active, true); assert.equal(rows[5].active, true); assert.equal(rows[6].active, true);
});

async function workspace(id) {
  const store = createStore(); store.ensureTenant({ id, name: id }, { id: `${id}-owner` });
  const account = await store.addAccount(id, { displayName: 'Example' });
  const config = store.addConfig(id, { accountId: account.id, companyName: 'Example', atsType: 'custom_static', boardId: 'old-slug', apiUrl: 'https://example.test/jobs', resolvedBoardUrl: 'https://example.test/jobs', active: true, reviewStatus: 'approved', discoveryStatus: 'resolved' });
  return { store, config };
}
const options = { plan: { limits: { jobBoards: -1 } }, autoDiscover: false };

test('static import rejects information links and follows one Avature board despite its separate login link', async t => {
  const id = 'avature-upgrade'; const { store, config } = await workspace(id); let upgraded = false;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('example.test')) return new Response(upgraded
      ? `<a href="${board}">Search jobs</a><a href="https://example.avature.net/careers/Login">Returning users</a>`
      : '<a href="/jobs/benefits-manager-123">Benefits Manager</a><a href="/jobs/login">Returning User Login</a><a href="/jobs/alumni">Former employees</a><a href="/jobs/employee-benefits">Benefits</a>');
    return new Response(avaturePage(0, 1));
  });
  const first = await store.importLiveJobs(id, options); assert.equal(first.stats.newJobs, 1);
  upgraded = true;
  const result = await store.importLiveJobs(id, options);
  assert.equal(result.stats.errors, 0); assert.equal(result.stats.partialBoards, 0);
  const saved = await store.getConfig(id, config.id);
  assert.equal(saved.atsType, 'avature'); assert.equal(saved.boardId, 'example.avature.net/en_US/careers'); assert.equal(saved.apiUrl, '');
  const active = (await store.findJobs(id, { active: true })).items;
  assert.equal(active.length, 1); assert.equal(active[0].source, 'Avature'); assert.equal(active[0].newSince, '', 'undated feed migration establishes a baseline');
});

test('Jibe handoff preserves a saved role identity and old posting dates across the migration', async t => {
  const id = 'jibe-upgrade'; const { store, config } = await workspace(id); let upgraded = false;
  const roleUrl = 'https://example.test/jobs/1?lang=en-us';
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/api/jobs')) return Response.json(jibePage(1, 1));
    return new Response(upgraded ? '<script src="https://app.jibecdn.com/prod/search/main.js"></script>' : `<a href="${roleUrl}">Software Engineer</a>`);
  });
  await store.importLiveJobs(id, options);
  const original = (await store.findJobs(id, {})).items[0]; await store.patchJobPipeline(id, original.id, 'saved');
  upgraded = true;
  const result = await store.importLiveJobs(id, options);
  assert.equal(result.stats.newJobs, 0); assert.equal(result.stats.closedJobs, 0);
  assert.equal((await store.getConfig(id, config.id)).atsType, 'jibe');
  const jobs = (await store.findJobs(id, {})).items;
  assert.equal(jobs.length, 1); assert.equal(jobs[0].id, original.id); assert.equal(jobs[0].pipelineStage, 'saved');
  assert.equal(jobs[0].isNew, false); assert.equal(jobs[0].source, 'iCIMS Jibe');
});

test('discovery resolves Jibe and Avature from the employer page without reusing an old board slug', async t => {
  for (const provider of ['avature', 'jibe']) {
    const id = `discover-${provider}`; const { store, config } = await workspace(id);
    await store.patchConfig(id, config.id, { atsType: 'unknown', active: false, discoveryStatus: 'unresolved' });
    t.mock.method(globalThis, 'fetch', async url => {
      if (String(url).includes('/api/jobs')) return Response.json(jibePage(1, 1));
      if (String(url).includes('avature.net')) return new Response(avaturePage(0, 1));
      return new Response(provider === 'jibe' ? '<script src="https://app.jibecdn.com/prod/search/main.js"></script>' : `<a href="${board}">Search jobs</a>`);
    });
    await store.runAtsDiscovery(id, { limit: 1, plan: options.plan });
    const saved = await store.getConfig(id, config.id);
    assert.equal(saved.atsType, provider);
    assert.notEqual(saved.boardId, 'old-slug');
    t.mock.restoreAll();
  }
});
