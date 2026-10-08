import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { buildTaskCalendar } from '../src/task-calendar.js';
import { createReminderStore, reminderClock } from '../src/followup-reminders.js';
import { getGrowthOutcomes, summarizeGrowthRows } from '../src/growth-outcomes.js';
const plan = { limits: { jobBoards: -1 } };

test('completed sources publish roles while another board is in flight; workspace feedback survives reimports', async t => {
  const store = createStore(); const id = 'incremental-tools';
  store.ensureTenant({ id, name: id, persona: 'jobseeker' }, { id: `${id}-owner` });
  await store.patchSettings(id, { geographyFocus: 'Global' });
  for (const boardId of ['fast', 'slow']) {
    const account = await store.addAccount(id, { displayName: boardId });
    store.addConfig(id, { accountId: account.id, companyName: boardId, boardId, atsType: 'greenhouse', active: true, discoveryStatus: 'resolved', reviewStatus: 'approved' });
  }
  let release; const gate = new Promise(resolve => { release = resolve; });
  let available; const published = new Promise(resolve => { available = resolve; });
  t.after(() => release());
  t.mock.method(globalThis, 'fetch', async url => {
    const slow = String(url).includes('/slow/'); if (slow) await gate;
    return Response.json({ jobs: [{ id: slow ? 2 : 1, title: 'Recruiter', location: { name: 'Toronto, ON' }, absolute_url: `https://example.test/jobs/${slow ? 2 : 1}` }] });
  });
  let finished = false;
  const running = store.importLiveJobs(id, { plan, autoDiscover: false, fetchConcurrency: 2, onProgress: progress => { if (progress.available) available(progress); } }).finally(() => { finished = true; });
  const progress = await Promise.race([published, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Fast source was not published')), 2000); timer.unref(); })]);
  assert.equal(progress.checked, 1); assert.equal(finished, false);
  const early = await store.findJobs(id); assert.equal(early.total, 1);
  const feedback = await store.patchJobFeedback(id, early.items[0].id, { vote: 'not_relevant', expectedUpdatedAt: '' });
  await assert.rejects(store.patchJobFeedback(id, early.items[0].id, { vote: 'relevant', expectedUpdatedAt: '' }), error => error.status === 409);
  release(); const imported = await running; assert.equal(imported.stats.newJobs, 2);
  assert.equal((await store.findJobs(id, { feedback: 'not_relevant' })).total, 1);
  assert.equal((await store.findJobs(id, { feedback: 'unreviewed' })).total, 1);
  await store.importLiveJobs(id, { plan, autoDiscover: false });
  assert.equal((await store.findJobs(id, { feedback: 'not_relevant' })).items[0].relevanceFeedback.updatedAt, feedback.relevanceFeedback.updatedAt);
  await store.patchJobFeedback(id, early.items[0].id, { vote: '', expectedUpdatedAt: feedback.relevanceFeedback.updatedAt });
  assert.equal((await store.findJobs(id, { feedback: 'unreviewed' })).total, 2);
});

test('calendar escapes injection, folds UTF-8 and exports stable tenant-scoped all-day events', () => {
  const tasks = [{ id: 'one', summary: 'Call, review; follow up\rBEGIN:VEVENT\n' + 'é'.repeat(100), status: 'pending', dueDate: '2026-12-31T00:00:00.000Z' }, { id: 'done', status: 'completed', dueDate: '2026-12-31' }, { id: 'no-date', status: 'pending' }, { id: 'invalid', status: 'pending', dueDate: '2026-02-30' }];
  const options = { origin: 'https://bd.example', now: new Date('2026-10-08T12:00:00Z') };
  const ics = buildTaskCalendar('one', tasks, options);
  assert.equal(ics.match(/^BEGIN:VEVENT/gm).length, 1); assert.match(ics, /DTEND;VALUE=DATE:20270101/);
  assert.match(ics, /Call\\, review\\; follow up\\nBEGIN:VEVENT\\n/);
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  const uid = ics.match(/UID:(.+)/)[1];
  assert.equal(buildTaskCalendar('one', tasks, { ...options, now: new Date() }).match(/UID:(.+)/)[1], uid);
  assert.notEqual(buildTaskCalendar('another', tasks, options).match(/UID:(.+)/)[1], uid);
});

test('reminders respect verified identity, retry with a stable key, deduplicate daily and reject stale preferences', async () => {
  const store = createReminderStore({ enabled: () => false }); const now = new Date('2026-10-08T14:00:00Z');
  assert.deepEqual(reminderClock('America/Toronto', now), { date: '2026-10-08', hour: 10 });
  const first = await store.put('t', 'u', { version: 0, emailEnabled: true, timezone: 'America/Toronto', hour: 9 });
  await assert.rejects(store.put('t', 'u', { version: 0, emailEnabled: false, timezone: 'UTC', hour: 9 }), error => error.status === 409);
  let sends = 0; let fail = true; let eligible = false; const keys = [];
  const options = { now, getRecipient: async () => ({ eligible, to: 'reminder@example.test' }), getTasks: async () => ({ items: [{ id: 'task', summary: 'Call' }], total: 1 }), send: async payload => { sends++; keys.push(payload.idempotencyKey); if (fail) throw new Error('Transient provider failure'); return { sent: true }; } };
  assert.equal((await store.deliver('t', 'u', options)).reason, 'ineligible'); eligible = true;
  await assert.rejects(store.deliver('t', 'u', options), /Transient/); fail = false;
  assert.equal((await store.deliver('t', 'u', options)).sent, true);
  assert.equal((await store.deliver('t', 'u', options)).reason, 'not_due');
  assert.equal(sends, 2); assert.equal(keys[0], keys[1]);
  assert.equal((await store.get('t', 'u')).version, first.version);
  await store.put('t', 'u', { ...first, emailEnabled: false });
  assert.equal((await store.deliver('t', 'u', options)).reason, 'disabled');
  assert.equal((await store.get('foreign', 'u')).emailEnabled, false);
});

test('growth reports separate pending cohorts and never expose excluded inboxes', async () => {
  const rows = [{ is_total: 1, signups: 5, paid: 2, eligible: 3, returned: 1 }, { is_total: 0, source: 'linkedin', campaign: 'audit', persona: 'bd', signups: 4, paid: 2, eligible: 2, returned: 1 }];
  const summary = summarizeGrowthRows(rows); assert.deepEqual(summary.totals, { signups: 5, paid: 2, eligible: 3, returned: 1, pending: 2 });
  const output = await getGrowthOutcomes({ excludedEmails: ['OWNER@EXAMPLE.TEST'], now: new Date('2026-10-08T14:00:00Z'), ready: () => true, query: async (sql, params) => { assert.match(sql, /GROUPING SETS/); assert.equal(params[0], '2026-09-09'); assert.deepEqual(params[1], ['owner@example.test']); return { rows }; } });
  assert.doesNotMatch(JSON.stringify(output), /OWNER|owner@example/);
});
