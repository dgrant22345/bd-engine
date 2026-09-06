import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createStore } from '../src/store.js';

const app = await readFile(new URL('../../app/app.js', import.meta.url), 'utf8');
function implementation(name, context = {}) {
  let start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (app.slice(start - 6, start) === 'async ') start -= 6;
  const end = app.indexOf('\n}', start) + 2;
  return vm.runInNewContext(`(${app.slice(start, end)})`, context);
}

test('candidate templates never invent people, compensation or achievements', () => {
  const generate = implementation('generateCandidateSlate');
  const slate = generate({ title: 'Recruiter', companyName: 'Example' });
  assert.equal(slate.candidates.length, 2);
  for (const candidate of slate.candidates) {
    assert.match(candidate.specimenCode, /not a real candidate/);
    assert.match(candidate.salaryExpectation, /^\[Confirm/);
    assert.ok(candidate.achievements.every((item) => item.startsWith('[')));
  }
});

test('dashboard data status preserves true zeroes and never implies ROI', () => {
  const render = implementation('renderDashboardRoiHero', {
    formatNumber: String, escapeHtml: String, formatDate: String,
    getDashboardActiveJobCount: (summary) => Number(summary.activeJobCount || 0),
  });
  const html = render({ summary: { activeJobCount: 0, readyBoardCount: 0, incompleteBoardCount: 2 } });
  assert.match(html, /2 sources need attention/);
  assert.match(html, /<strong>0<\/strong> active roles/);
  assert.match(html, /No completed refresh recorded/);
  assert.doesNotMatch(html, /42%|8\.5|45,000|referral.*rate|Upgrade/);
});

test('draft assistant does not manufacture jobs or recipients', () => {
  const generate = implementation('generateAutopilotQueue', { isJobSeekerPersona: () => true, performance,
    rankContactsForJob: (job, contacts) => contacts, extractTechStack: () => [], calculateResponseLikelihood: () => ({}) });
  const account = { id: 'a', displayName: 'Example', jobCount: 5 };
  assert.equal(generate([account], [], []).length, 0);
  assert.equal(generate([account], [{ id: 'j', accountId: 'a', title: 'Recruiter' }], []).length, 0);
  assert.equal(generate([account], [{ id: 'j', accountId: 'a', title: 'Recruiter' }], [{ id: 'c', accountId: 'a', fullName: 'Alex Example' }]).length, 1);
  assert.doesNotMatch(app.slice(app.indexOf('async function executeAutopilotQueue()'), app.indexOf('function renderAutopilotModal()')), /launched|executed|api\(/);
});

test('pipeline filters run before pagination, survive refresh, and cannot cross workspaces', async (t) => {
  const store = createStore();
  const tenant = 'quality-pipeline';
  store.ensureTenant({ id: tenant, name: tenant }, { id: `${tenant}-owner` });
  store.ensureTenant({ id: 'other-pipeline', name: 'Other' }, { id: 'other-owner' });
  const account = await store.addAccount(tenant, { displayName: 'Example' });
  store.addConfig(tenant, { accountId: account.id, companyName: 'Example', atsType: 'greenhouse', boardId: 'example', discoveryStatus: 'resolved', reviewStatus: 'approved', active: true });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ jobs: Array.from({ length: 35 }, (_, index) => ({ id: index + 1, title: 'Recruiter', location: { name: 'Toronto, ON' }, absolute_url: `https://example.test/${index}` })) }));
  await store.importLiveJobs(tenant, { plan: { limits: { jobBoards: -1 } }, autoDiscover: false });
  const all = await store.findJobs(tenant, { pageSize: 100 });
  const selected = all.items.slice(25, 28);
  for (const job of selected) await store.patchJobPipeline(tenant, job.id, 'saved');
  const result = await store.findJobs(tenant, { pipelineOnly: true, pageSize: 2 });
  assert.equal(result.total, 3);
  assert.equal(result.items.length, 2);
  assert.equal(result.summary.pipelineTotal, 3);
  assert.equal(await store.patchJobPipeline('other-pipeline', selected[0].id, 'offer'), null);
  await assert.rejects(store.patchJobPipeline(tenant, selected[0].id, 'bad-stage'), /Invalid/);
  await store.importLiveJobs(tenant, { plan: { limits: { jobBoards: -1 } }, autoDiscover: false });
  assert.equal((await store.findJobs(tenant, { pipelineOnly: true })).total, 3);
  await store.patchJobPipeline(tenant, selected[0].id, '');
  assert.equal((await store.findJobs(tenant, { pipelineOnly: true })).total, 2);
});

test('public marketing does not invent reviews, performance results, or refunds', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /aggregateRating|ratingValue|reviewCount|42%|8\.5 hrs|2,300\+|money-back guarantee|verified live jobs/);
  assert.match(html, /Illustrative data/);
  assert.match(html, /It does not search every employer or guarantee every opening/);
  assert.match(html, /does not send it/);
});

test('batch drafts use provided context without invented candidate or personal claims', () => {
  const generate = implementation('generateBatchDraftCopy', { appState: { bootstrap: { user: { name: 'Alex' } } } });
  for (const template of ['sales_candidate_teaser', 'sales_hard_to_fill', 'sales_talent_leader', 'sales_executive', 'job_referral', 'job_hiring_leader', 're_engage', 'sales_hiring_manager']) {
    for (const tone of ['casual', 'direct', 'formal']) {
      for (const touch of [1, 2, 3]) {
        const draft = generate({ name: 'Jordan Example', companyName: 'Example Company', jobTitle: 'Recruiter' }, template, tone, touch);
        assert.match(draft.subject, /Example Company/);
        assert.ok(draft.body.length > 20);
        assert.ok(draft.linkedinNote.length <= 300);
        assert.doesNotMatch(draft.body, /we have|we currently represent|zero upfront|6\+ yrs|ready to interview|my qualifications align|proven domain expertise/i);
        if (touch > 1) assert.match(draft.body, /Confirm the earlier message was sent/);
      }
    }
  }
});

test('referral sharing uses the workspace-issued link and actual credit, not a fabricated user code', async () => {
  const backdrop = { innerHTML: '', classList: { remove() {} }, setAttribute() {} };
  const render = implementation('openReferralShareModal', { referralShareModalBackdrop: backdrop,
    api: async () => ({ referral: { link: 'https://example.test/?ref=workspace-issued', creditAmountCents: 500 } }),
    isJobSeekerPersona: () => true, escapeAttr: String, escapeHtml: String, showToast: assert.fail });
  await render();
  assert.match(backdrop.innerHTML, /workspace-issued/);
  assert.match(backdrop.innerHTML, /Earn \$5\.00 USD invoice credit/);
  assert.doesNotMatch(backdrop.innerHTML, /BDPRO|REF-|Give 1 Month Free|Found 18\+/);
});

test('referral copy reports clipboard failure without a success toast', async () => {
  const notices = [];
  const copy = implementation('copyReferralLink', { document: { getElementById: () => null },
    writeClipboardText: async () => { throw new Error('denied'); }, showToast: (text, kind) => notices.push({ text, kind }) });
  await copy('https://example.test/?ref=workspace-issued');
  assert.deepEqual(notices.map((notice) => notice.kind), ['error']);
});
