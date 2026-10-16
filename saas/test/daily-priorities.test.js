import test from 'node:test';
import assert from 'node:assert/strict';
import { rankDailyAccounts } from '../src/daily-priorities.js';
import { createStore } from '../src/store.js';

const now = new Date('2026-10-16T12:00:00Z');
const account = (id, extra = {}) => ({ id, displayName: id, targetScore: 50, ...extra });
const job = (accountId, extra = {}) => ({ accountId, active: true, postedAt: '2026-10-15T00:00:00Z', ...extra });

test('daily priorities rank urgent follow-ups before fresh hiring, active hiring and research', () => {
  const accounts = [account('research', { targetScore: 100 }), account('active'), account('fresh'), account('today'), account('overdue')];
  const jobs = [job('fresh'), job('active', { postedAt: '2026-09-01' })];
  const tasks = [
    { accountId: 'today', status: 'pending', dueDate: '2026-10-16', summary: 'Call today' },
    { accountId: 'overdue', status: 'pending', dueDate: '2026-10-01', summary: 'Older follow-up' },
  ];
  const ranked = rankDailyAccounts(accounts, { jobs, tasks, now });
  assert.deepEqual(ranked.map(item => item.id), ['overdue', 'today', 'fresh', 'active', 'research']);
  assert.equal(ranked[0].dailyPriority.taskSummary, 'Older follow-up');
  assert.equal(ranked[2].dailyPriority.reason, '1 active role posted in the last 7 days');
  assert.equal(accounts[0].dailyPriority, undefined);
});

test('closed, dismissed, mismatched and unknown-date jobs never create fresh hiring evidence', () => {
  const accounts = ['closed', 'dismissed', 'mismatched', 'unknown', 'future', 'low', 'confirmed'].map(id => account(id));
  const jobs = [job('closed', { active: false }), job('dismissed', { relevanceFeedback: { vote: 'not_relevant' } }),
    job('mismatched', { relevanceScore: 5, matchesSearchFocus: false }),
    job('unknown', { postedAt: '', importedAt: now.toISOString() }), job('future', { postedAt: '2026-10-17' }),
    job('low', { relevanceBand: 'low' }), job('confirmed', { relevanceBand: 'low', relevanceFeedback: { vote: 'relevant' } })];
  const ranked = rankDailyAccounts(accounts, { jobs, now });
  assert.equal(ranked[0].id, 'confirmed');
  for (const item of ranked.filter(item => item.id !== 'confirmed')) assert.equal(item.dailyPriority.freshRoles, 0);
  for (const id of ['closed', 'dismissed', 'mismatched', 'low']) assert.equal(ranked.find(item => item.id === id).dailyPriority.activeRoles, 0);
});

test('network-only and paused accounts stay out; pending due tasks and scheduled next steps count', () => {
  const accounts = [account('network', { tracked: false }), account('paused', { status: 'paused' }), account('scheduled', { nextActionAt: '2026-10-15', nextAction: 'Check timing' }), account('future'), account('done'), account('invalid')];
  const tasks = [
    { accountId: 'network', status: 'pending', dueDate: '2026-10-01' },
    { accountId: 'future', status: 'pending', dueDate: '2026-10-17' },
    { accountId: 'done', status: 'completed', dueDate: '2026-10-01' },
    { accountId: 'done', status: 'cancelled', dueDate: '2026-10-01' },
    { accountId: 'invalid', status: 'pending', dueDate: 'invalid' },
  ];
  const ranked = rankDailyAccounts(accounts, { tasks, now });
  assert.equal(ranked[0].id, 'scheduled');
  assert.equal(ranked[0].dailyPriority.taskSummary, 'Check timing');
  assert.equal(ranked.filter(item => item.dailyPriority.lane === 'follow_up').length, 1);
  assert.ok(!ranked.some(item => ['network', 'paused'].includes(item.id)));
});

test('mapped contacts break lane ties before target score, with stable ordering and no invented contacts', () => {
  const accounts = [account('high', { targetScore: 100 }), account('b', { targetScore: 20 }), account('a', { targetScore: 20 })];
  const contacts = [{ accountId: 'a', id: 'contact-a', fullName: 'Alex', priorityScore: 80 }, { accountId: 'b', id: 'contact-b', fullName: 'Bea' }];
  const ranked = rankDailyAccounts(accounts, { contacts, now });
  assert.deepEqual(ranked.map(item => item.id), ['a', 'b', 'high']);
  assert.equal(ranked[0].dailyPriority.contactName, 'Alex');
  assert.equal(ranked[2].dailyPriority.contactName, '');
  assert.deepEqual(rankDailyAccounts([...accounts].reverse(), { contacts, now }), ranked);
});

test('dashboard queue, playbook and recommendations agree and completion removes task urgency', async () => {
  const store = createStore(); const tenantId = 'daily-priorities-integration';
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: 'priority-owner' });
  const first = await store.addAccount(tenantId, { displayName: 'Research first' });
  const urgent = await store.addAccount(tenantId, { displayName: 'Urgent follow-up' });
  await store.addAccount(tenantId, { displayName: 'Network only', tracked: false });
  await store.addAccount(tenantId, { displayName: 'Paused lead', status: 'paused' });
  const task = await store.createTask(tenantId, { accountId: urgent.id, summary: 'Call about hiring', dueDate: '2020-01-01' });
  const dashboard = await store.getDashboard(tenantId);
  const extended = await store.getDashboardExtended(tenantId);
  assert.equal(dashboard.todayQueue[0].id, urgent.id);
  assert.equal(dashboard.actionPlan.primaryAccountId, urgent.id);
  assert.deepEqual(extended.playbook.map(item => item.id), dashboard.todayQueue.map(item => item.id));
  assert.deepEqual(dashboard.recommendedActions.map(item => item.accountId), dashboard.todayQueue.map(item => item.id));
  assert.equal(dashboard.followUpAccounts[0].nextAction, 'Call about hiring');
  assert.equal(dashboard.todayQueue.length, 2);
  assert.ok(dashboard.todayQueue.some(item => item.id === first.id));
  assert.equal(dashboard.summary.accountCount, 4);
  await store.completeTask(tenantId, task.id);
  const after = await store.getDashboard(tenantId);
  assert.equal(after.followUpAccounts.length, 0);
  assert.equal(after.todayQueue.find(item => item.id === urgent.id).dailyPriority.lane, 'research');
});
