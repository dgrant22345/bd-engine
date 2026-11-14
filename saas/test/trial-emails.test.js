import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrialEmail, createTrialEmailStore, dueTrialEmail, trialEndDate } from '../src/trial-emails.js';

const DAY = 86_400_000;
const created = '2026-11-02T15:00:00.000Z';
const at = (days) => new Date(Date.parse(created) + days * DAY);
const links = {
  appUrl: 'https://bd.example/app/#/dashboard',
  companiesUrl: 'https://bd.example/app/#/accounts',
  billingUrl: 'https://bd.example/app/#/admin/billing',
  settingsUrl: 'https://bd.example/app/#/admin/billing',
};

test('one email at a time, each at its point in the trial', () => {
  const due = (days, sent = {}, companyCount = 0) => dueTrialEmail({ createdAt: created, now: at(days), sent, companyCount });
  assert.equal(due(0.01), 'welcome');
  assert.equal(due(1, { welcome: 'x' }), '');
  // A trial that started before these emails existed is not welcomed late.
  assert.equal(due(2.5), '');
  assert.equal(due(3.1, { welcome: 'x' }), 'add_companies');
  assert.equal(due(3.1, { welcome: 'x' }, 4), '');
  assert.equal(due(10.9, { welcome: 'x', add_companies: 'x' }), '');
  assert.equal(due(11.1, { welcome: 'x', add_companies: 'x' }), 'trial_ending');
  // The reminder to add companies gives way to the trial note in the last days.
  assert.equal(due(11.5, { welcome: 'x' }), 'trial_ending');
  assert.equal(due(12, { welcome: 'x', add_companies: 'x', trial_ending: 'x' }), '');
  assert.equal(due(14.01), '');
  assert.equal(dueTrialEmail({ createdAt: 'not a date', now: at(1) }), '');
  assert.equal(trialEndDate(created).toISOString(), '2026-11-16T15:00:00.000Z');
});

test('each message says what to do, when the trial ends, why it was sent and how to stop it', () => {
  const welcome = buildTrialEmail('welcome', { name: 'Riley <Recruiter>', createdAt: created, ...links });
  assert.equal(welcome.subject, 'Welcome to BD Engine: your first call list in three steps');
  assert.match(welcome.text, /^Hi Riley,/);
  assert.match(welcome.text, /1\. Add five companies/);
  assert.match(welcome.text, /Your trial runs until Monday, November 16\./);
  assert.match(welcome.text, /Open your workspace: https:\/\/bd\.example\/app\/#\/dashboard/);
  assert.match(welcome.html, /Hi Riley,/);
  assert.doesNotMatch(welcome.html, /<Recruiter>/);

  const nudge = buildTrialEmail('add_companies', { name: '', createdAt: created, ...links });
  assert.match(nudge.text, /^Hi there,/);
  assert.match(nudge.text, /Add companies: https:\/\/bd\.example\/app\/#\/accounts/);

  const ending = buildTrialEmail('trial_ending', { name: 'Riley', createdAt: created, ...links });
  assert.equal(ending.subject, 'Your BD Engine trial ends on Monday, November 16');
  assert.match(ending.text, /Recruiter Pro is \$10 USD a month\./);
  assert.match(buildTrialEmail('trial_ending', { createdAt: created, persona: 'jobseeker', ...links }).text, /Job Seeker is \$5 USD a month\./);
  assert.match(buildTrialEmail('welcome', { createdAt: created, persona: 'jobseeker', ...links }).text, /Hiring activity/);

  for (const message of [welcome, nudge, ending]) {
    assert.match(message.text, /You are receiving this because you started a BD Engine trial\.\nStop trial emails: https:\/\/bd\.example\/app\/#\/admin\/billing$/);
    assert.match(message.html, /<a href="https:\/\/bd\.example\/app\/#\/admin\/billing">Stop trial emails<\/a>/);
  }
  assert.throws(() => buildTrialEmail('surprise', { createdAt: created, ...links }), /Unknown trial email/);
});

test('delivery sends each email once, counts companies once, and honours the opt-out', async () => {
  const store = createTrialEmailStore({ enabled: () => false });
  const sends = []; let counts = 0;
  const options = (days, companyCount = 0, eligible = true) => ({
    now: at(days),
    getRecipient: async () => ({ eligible, to: 'owner@example.test', tenantCreatedAt: created }),
    getCompanyCount: async () => { counts += 1; return companyCount; },
    send: async ({ kind, idempotencyKey }) => { sends.push([kind, idempotencyKey.length]); return { sent: true }; },
  });
  assert.equal((await store.deliver('t1', 'u1', options(0.1, 0, false))).reason, 'ineligible');
  assert.deepEqual(await store.deliver('t1', 'u1', options(0.1)), { sent: true, kind: 'welcome' });
  assert.equal((await store.deliver('t1', 'u1', options(0.2))).reason, 'not_due');
  assert.equal(counts, 0, 'companies are counted only when the reminder is due');
  // A workspace with companies never gets the reminder, and is not recounted.
  assert.equal((await store.deliver('t1', 'u1', options(3.5, 6))).reason, 'not_due');
  assert.equal((await store.deliver('t1', 'u1', options(4.5, 6))).reason, 'not_due');
  assert.equal(counts, 1);
  assert.deepEqual(await store.deliver('t1', 'u1', options(11.2, 6)), { sent: true, kind: 'trial_ending' });
  assert.deepEqual(sends, [['welcome', 64], ['trial_ending', 64]]);

  // A provider failure leaves the email due for the next scan.
  const failing = { ...options(0.1), send: async () => ({ sent: false, reason: 'email_not_configured' }) };
  assert.equal((await store.deliver('t2', 'u2', failing)).reason, 'email_not_configured');
  assert.deepEqual(await store.deliver('t2', 'u2', options(0.2)), { sent: true, kind: 'welcome' });

  // Opting out stops everything; the choice keeps its own version.
  const settings = await store.get('t3', 'u3');
  assert.deepEqual(settings, { version: 0, optedOut: false, sent: {} });
  assert.equal((await store.put('t3', 'u3', { version: 0, optedOut: true })).optedOut, true);
  assert.equal((await store.deliver('t3', 'u3', options(0.1))).reason, 'opted_out');
  await assert.rejects(store.put('t3', 'u3', { version: 0, optedOut: false }), (error) => error.status === 409);
  await assert.rejects(store.put('t3', 'u3', { version: 1, optedOut: 'no' }), (error) => error.status === 400);
});
