import test from 'node:test';
import assert from 'node:assert/strict';
import { readUkgBoard, ukgBoard, ukgProPage, ukgReadyPage } from '../src/ukg-careers.js';
import { applyCareerSourceCorrection } from '../src/career-source-corrections.js';
import { createStore } from '../src/store.js';

const pro = 'https://recruiting.ultipro.com/HAY1004HAUS/JobBoard/bebb31cb-327e-46b6-80a7-e0033ffa4653';
const ready = 'https://secure7.saashr.com/ta/6219063.careers?CareersSearch&lang=en-US';
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const proPage = (offset, total) => ({ totalCount: total, opportunities: Array.from({ length: Math.min(50, total - offset) }, (_, i) => ({
  Id: uuid(offset + i), Title: 'Recruitment Consultant', FullTime: true, PostedDate: '2020-01-01T00:00:00Z',
  Locations: [{ Address: { City: 'Toronto', State: { Name: 'Ontario' }, Country: { Name: 'Canada' } } }],
})) });
const readyPage = (offset, total) => ({ _paging: { offset, size: 20, total }, job_requisitions: Array.from({ length: Math.min(20, total - offset) }, (_, i) => ({
  id: offset + i + 1, job_title: 'Business Development Specialist', location: { city: 'Florham Park', state: 'NJ', country: 'USA' }, employee_type: { name: 'Regular Full-Time' },
})) });

test('UKG board identities are restricted to real public portal hosts and stable board paths', () => {
  assert.equal(ukgBoard(`${pro}/OpportunityDetail?opportunityId=${uuid(1)}`).url, pro);
  assert.equal(ukgBoard(ready).company, '6219063');
  assert.equal(ukgBoard(pro.replace('.com/', '.com.attacker.test/')), null);
  assert.equal(ukgBoard('https://secure7.saashr.com/ta/admin'), null);
});

test('UKG Pro paginates its public POST search and verifies head identities', async () => {
  const offsets = [];
  const result = await readUkgBoard(pro, { postJson: async (url, body) => {
    assert.equal(url, `${pro}/JobBoardView/LoadSearchResults`);
    const { Top, Skip, QueryString, Filters } = body.opportunitySearch;
    assert.equal(Top, 50); assert.equal(QueryString, ''); assert.deepEqual(Filters, []); offsets.push(Skip);
    return proPage(Skip, 53);
  } });
  assert.equal(result.complete, true); assert.equal(result.jobs.length, 53); assert.deepEqual(offsets, [0, 50, 0]);
  assert.equal(result.jobs[0].location, 'Toronto, Ontario, Canada'); assert.equal(result.jobs[0].postedAt, '2020-01-01T00:00:00Z');
  assert.match(result.jobs[0].url, /OpportunityDetail\?opportunityId=/);
});

test('UKG Ready paginates all rows with direct public detail links and country normalization', async () => {
  const offsets = [];
  const result = await readUkgBoard(ready, { getJson: async url => {
    const parsed = new URL(url); assert.match(parsed.pathname, /\/ta\/rest\/ui\/recruitment\/companies\/%7C6219063\/job-requisitions$/);
    assert.equal(parsed.searchParams.get('size'), '20'); assert.equal(parsed.searchParams.get('lang'), 'en-US');
    const page = Number(parsed.searchParams.get('offset')); offsets.push(page); return readyPage((page - 1) * 20, 35);
  } });
  assert.equal(result.complete, true); assert.equal(result.jobs.length, 35); assert.deepEqual(offsets, [1, 2, 1]);
  assert.equal(result.jobs[0].location, 'Florham Park, NJ, United States');
  assert.equal(new URL(result.jobs[0].url).searchParams.get('ShowJob'), '1'); assert.equal(result.jobs[0].postedAt, '');
});

test('missing pages, invalid identities and malformed UKG payloads never establish complete coverage', async () => {
  const failed = await readUkgBoard(ready, { getJson: async url => { if (new URL(url).searchParams.get('offset') === '2') throw new Error('HTTP 429'); return readyPage(0, 35); } });
  assert.equal(failed.complete, false); assert.equal(failed.jobs.length, 20);
  assert.ok(failed.pagination.reasons.includes('page_failed'));
  assert.throws(() => ukgProPage({ opportunities: [] }, pro), /count missing/);
  assert.throws(() => ukgReadyPage({ _paging: { total: 0 } }, ukgBoard(ready)), /invalid requisitions/);
  const invalid = await readUkgBoard(pro, { postJson: async () => ({ totalCount: 1, opportunities: [{ Id: 'bad', Title: 'Bad row' }] }) });
  assert.equal(invalid.complete, false); assert.ok(invalid.pagination.reasons.includes('invalid_rows'));
});

test('verified stale-source corrections are exact, idempotent and preserve prior source evidence', () => {
  const config = { companyName: 'PCS Wireless', atsType: 'bamboohr', boardId: 'old', apiUrl: 'https://pcsglobal.bamboohr.com/js/embed.js', lastImportedAt: '2020-01-01', importRetryCount: 4 };
  assert.equal(applyCareerSourceCorrection(config, '2026-11-15T00:00:00Z'), true);
  assert.equal(config.atsType, 'ukg_ready'); assert.equal(config.sourceBaselinePending, true);
  assert.equal(config.previousCareerSource.url, 'https://pcsglobal.bamboohr.com/js/embed.js'); assert.equal(config.lastImportedAt, '2020-01-01');
  assert.equal(applyCareerSourceCorrection(config), false);
  const changed = { companyName: 'PCS Wireless', atsType: 'greenhouse', resolvedBoardUrl: 'https://job-boards.greenhouse.io/new-board' };
  assert.equal(applyCareerSourceCorrection(changed), false);
  const rejected = { companyName: 'Hays', apiUrl: 'https://hays.com/jobs', reviewStatus: 'rejected', active: false };
  assert.equal(applyCareerSourceCorrection(rejected), false, 'explicit review decisions are preserved');
});

test('unavailable and unrelated sources remain explicit holds, without claiming zero vacancies', () => {
  for (const [companyName, apiUrl, hold] of [['LinkedIn', 'https://linkedin.ca/careers', 'manual'], ['Easy Hiring Solutions Services', 'https://easyhiringsolutions.com/', 'identity_review'], ['Maple Leaf Foods Inc', 'https://careers.mapleleaffoods.com/', 'unavailable']]) {
    const config = { companyName, apiUrl, atsType: 'custom_static', active: true, lastImportStatus: 'failed' };
    assert.equal(applyCareerSourceCorrection(config), true); assert.equal(config.sourceHold, hold); assert.equal(config.active, false);
    assert.notEqual(config.lastImportStatus, 'empty'); assert.ok(config.sourceHoldReason);
  }
});

test('actual importer upgrades Hays and PCS, leaves held and network sources untouched, and establishes a baseline', async t => {
  const store = createStore(); const id = 'ukg-import'; store.ensureTenant({ id }, { id: 'owner' });
  const source = (companyName, apiUrl, atsType = 'custom_static') => ({ companyName, apiUrl, atsType, resolvedBoardUrl: apiUrl, boardId: 'old', active: true, discoveryStatus: 'resolved', reviewStatus: 'approved', lastImportedAt: '2020-01-01' });
  const configs = [];
  for (const row of [source('Hays', 'https://hays.com/jobs'), source('PCS Wireless', 'https://pcsglobal.bamboohr.com/js/embed.js', 'bamboohr'), source('Easy Hiring Solutions Services', 'https://easyhiringsolutions.com/'), source('LinkedIn', 'https://linkedin.ca/careers'), source('Maple Leaf Foods Inc', 'https://careers.mapleleaffoods.com/')]) {
    const account = await store.addAccount(id, { displayName: row.companyName }); configs.push(store.addConfig(id, { ...row, accountId: account.id }));
  }
  const network = await store.addAccount(id, { displayName: 'Hays', tracked: false });
  const untouched = store.addConfig(id, { ...source('Hays', 'https://hays.com/jobs'), accountId: network.id });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('ultipro.com')) return Response.json(proPage(JSON.parse(init.body).opportunitySearch.Skip, 1));
    assert.match(String(url), /saashr.com/); return Response.json(readyPage(0, 1));
  });
  const result = await store.importLiveJobs(id, { plan: { limits: { jobBoards: -1 } }, autoDiscover: false });
  assert.equal(result.stats.errors, 0, JSON.stringify(result.errors)); assert.equal(result.stats.partialBoards, 0); assert.equal(result.stats.configs, 2);
  assert.ok(result.warnings.some(warning => /unrelated shopping content/.test(warning)));
  assert.equal((await store.getConfig(id, configs[0].id)).atsType, 'ukg_pro'); assert.equal((await store.getConfig(id, configs[1].id)).atsType, 'ukg_ready');
  assert.equal((await store.getConfig(id, untouched.id)).atsType, 'custom_static');
  const jobs = (await store.findJobs(id, {})).items; assert.equal(jobs.length, 2); assert.ok(jobs.every(x => !x.isNew));
  const held = await store.getConfig(id, configs[2].id); assert.equal(held.sourceHold, 'identity_review');
  const diagnostics = await store.getIngestionDiagnostics(id);
  assert.equal(diagnostics.coverageCategories.tracking_only, 1);
  assert.equal(diagnostics.coverageCategories.needs_review, 1);
  assert.equal(diagnostics.coverageCategories.careers_page_only, 1);
  const discovery = await store.runAtsDiscovery(id, { onlyMissing: true, plan: { limits: { jobBoards: -1 } } });
  assert.equal(discovery.stats.checked, 0, 'held sources never trigger a blind board search');
  await store.patchConfig(id, held.id, { careersUrl: 'https://new.example.test/careers', active: true });
  assert.equal((await store.getConfig(id, held.id)).sourceHold, '');
  assert.equal(held.apiUrl, ''); assert.equal(held.resolvedBoardUrl, 'https://new.example.test/careers');
  await store.reviewConfig(id, configs[4].id, { action: 'reject' });
  assert.equal((await store.getIngestionDiagnostics(id)).coverageCategories.rejected, 1);
  await store.reviewConfig(id, configs[4].id, { action: 'promote' });
  assert.equal((await store.getConfig(id, configs[4].id)).sourceHold, '', 'explicit approval can resume a held source');
});
