import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initDb, closeDb, dbQuery, dbSaveUser, dbSaveTenant, dbSaveMembership, dbSaveTenantData } from '../src/db.js';
import { syncTenantRelationalChanges } from '../src/relational-writes.js';
import { persistJobFeedback, loadWorkspaceFeedback } from '../src/job-feedback.js';
import { createReminderStore, getNewRoleDigest, ROLE_DIGEST_ID } from '../src/followup-reminders.js';
import { getPeopleContextRelational } from '../src/relational-reads.js';
import { GROWTH_SQL, summarizeGrowthRows } from '../src/growth-outcomes.js';

const target = new URL(process.env.DATABASE_URL || 'postgres://missing');
if (process.env.NODE_ENV !== 'test' || !['localhost','127.0.0.1'].includes(target.hostname) || !['/bd_workflow_fixture','/bd_engine_recovery_source'].includes(target.pathname)) throw new Error('Workflow verification requires an isolated local fixture database in NODE_ENV=test.');
const id = `workflow-fixture-${randomUUID()}`; const userId = `${id}-user`; const now = new Date().toISOString();
if (!await initDb()) throw new Error('Fixture database unavailable');
try {
  await dbSaveUser({ id: userId, email: `${id}@example.test`, name: 'Workflow fixture', passwordHash: 'fixture', status: 'active', emailVerifiedAt: now, createdAt: now, updatedAt: now });
  await dbSaveTenant({ id, slug: id, name: id, plan: 'trial', status: 'active', createdAt: now, updatedAt: now });
  await dbSaveMembership({ tenantId: id, userId, role: 'owner', createdAt: now });
  const job = { id: `${id}-role`, tenantId: id, title: 'Recruiter', active: true, createdAt: now, updatedAt: now };
  await dbSaveTenantData(id, { accounts: [], contacts: [], jobs: [job], configs: [], activities: [], tasks: [], settings: {} }, { throwOnError: true });
  await syncTenantRelationalChanges(id, { jobs: [job] });
  const feedback = { vote: 'not_relevant', updatedAt: now, reason: '' };
  await persistJobFeedback(id, job.id, feedback, '');
  await assert.rejects(persistJobFeedback(id, job.id, { vote: 'relevant', updatedAt: now }, ''), error => error.status === 409);
  await assert.rejects(persistJobFeedback('foreign-workspace', job.id, feedback, ''), error => error.status === 404);
  await dbSaveTenantData(id, { jobs: [{ ...job, title: 'Recruiter updated' }] }, { throwOnError: true });
  await syncTenantRelationalChanges(id, { jobs: [{ ...job, title: 'Recruiter updated', updatedAt: new Date().toISOString() }] });
  assert.equal((await dbQuery("SELECT raw->'relevanceFeedback' AS feedback FROM jobs WHERE tenant_id=$1", [id])).rows[0].feedback.vote, 'not_relevant');
  assert.equal((await dbQuery("SELECT jobs->0->'relevanceFeedback' AS feedback FROM tenant_data WHERE tenant_id=$1", [id])).rows[0].feedback.vote, 'not_relevant');
  assert.equal((await loadWorkspaceFeedback(id))[0].feedback.vote, 'not_relevant');
  const reminders = createReminderStore();
  await reminders.put(id, userId, { version: 0, emailEnabled: true, timezone: 'UTC', hour: 0 });
  assert.ok((await reminders.candidates()).some(row => row.tenant_id === id));
  let sent = 0;
  const options = { getRecipient: async () => ({ eligible: true }), getTasks: async () => ({ items: [{ summary: 'Call' }], total: 1 }), send: async () => { sent++; return { sent: true }; } };
  const deliveries = await Promise.all([reminders.deliver(id, userId, options), reminders.deliver(id, userId, options)]);
  assert.equal(sent, 1); assert.equal(deliveries.filter(result => result.sent).length, 1);
  assert.equal((await reminders.get(id, userId)).version, 1);
  await assert.rejects(reminders.put(id, userId, { version: 0, emailEnabled: false, timezone: 'UTC', hour: 9 }), error => error.status === 409);
  // Weekly role digest: a separate opt-in in the same table, and the real new-role SQL.
  const digests = createReminderStore({ id: ROLE_DIGEST_ID, title: 'Weekly role digest', viewType: 'jobs', cadence: 'weekly' });
  await digests.put(id, userId, { version: 0, emailEnabled: true, timezone: 'UTC', hour: 0 }, { now: new Date('2026-11-12T12:00:00Z') });
  assert.ok((await digests.candidates()).some(row => row.tenant_id === id));
  assert.equal((await reminders.get(id, userId)).version, 1);
  assert.equal((await dbQuery("SELECT title FROM saved_work WHERE tenant_id=$1 AND id=$2", [id, ROLE_DIGEST_ID])).rows[0].title, 'Weekly role digest');
  const digestNow = new Date('2026-11-16T09:00:00Z');
  const seen = days => new Date(digestNow.getTime() - days * 86400000).toISOString();
  const roles = [['a', 'Controls Engineer', 'Northstar', 1, true], ['b', 'PLC Programmer', 'Northstar', 2, true], ['c', 'Automation Lead', 'Northstar', 3, true], ['d', 'Recruiter', 'Luma', 6, true], ['e', 'Old role', 'Old Co', 9, true], ['f', 'Closed role', 'Closed Co', 1, false]];
  for (const [suffix, title, company, days, active] of roles) {
    await dbQuery("INSERT INTO jobs (id,tenant_id,title,company_name,active,created_at,first_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$6)", [`${id}-digest-${suffix}`, id, title, company, active, seen(days)]);
  }
  const digest = await getNewRoleDigest(id, { now: digestNow });
  assert.deepEqual(digest, { items: [{ companyName: 'Northstar', newRoles: 3, titles: ['Controls Engineer', 'PLC Programmer', 'Automation Lead'] }, { companyName: 'Luma', newRoles: 1, titles: ['Recruiter'] }], total: 4, summary: { companyCount: 2 } });
  assert.equal((await getNewRoleDigest('foreign-workspace', { now: digestNow })).total, 0);
  // newSince (in raw) decides newness when present: a role already on a board at
  // its first import is not new, nor is an old posting first seen this week.
  const newSinceRoles = [['g', 'Baseline role', '', 1], ['h', 'Old posting', seen(40), 1], ['i', 'Fresh posting', seen(2), 1]];
  for (const [suffix, title, newSince, days] of newSinceRoles) {
    await dbQuery("INSERT INTO jobs (id,tenant_id,account_id,title,company_name,active,created_at,first_seen_at,raw) VALUES ($1,$2,$3,$4,'Baseline Co',true,$5,$5,$6)", [`${id}-digest-${suffix}`, id, `${id}-baseline-account`, title, seen(days), JSON.stringify({ newSince })]);
  }
  const withBaseline = await getNewRoleDigest(id, { now: digestNow });
  assert.deepEqual(withBaseline.items.find(item => item.companyName === 'Baseline Co'), { companyName: 'Baseline Co', newRoles: 1, titles: ['Fresh posting'] });
  assert.equal(withBaseline.total, 5);
  const baselineContext = await getPeopleContextRelational(id, { accountIds: [`${id}-baseline-account`], since: seen(7) });
  assert.deepEqual(baselineContext.roles.get(`${id}-baseline-account`), { openRoles: 3, newRoles7d: 1 });
  let digestSent = 0;
  const digestOptions = { now: digestNow, getRecipient: async () => ({ eligible: true }), getTasks: tenant => getNewRoleDigest(tenant, { now: digestNow }), send: async () => { digestSent++; return { sent: true }; } };
  await Promise.all([digests.deliver(id, userId, digestOptions), digests.deliver(id, userId, digestOptions)]);
  assert.equal(digestSent, 1);
  assert.equal((await digests.deliver(id, userId, { ...digestOptions, now: new Date('2026-11-18T09:00:00Z') })).reason, 'not_due');
  assert.equal((await digests.get(id, userId)).version, 1);
  // Evaluate the real cohort SQL against CTE fixtures, without touching analytics.
  const events = [];
  const event = (tenant, type, day, metadata = {}) => ({ tenant_id: tenant, user_id: `${tenant}-user`, event_type: type, day: day.slice(0,10), created_at: day, metadata });
  for (const tenant of ['customer', 'duplicate', 'pending', 'test', 'demo', 'internal', 'reserved']) {
    events.push(event(tenant, 'signup_completed', tenant === 'pending' ? '2026-10-05T12:00:00Z' : '2026-09-15T12:00:00Z', { firstTouchSource: 'linkedin', firstTouchCampaign: 'audit', persona: 'bd', ...(tenant === 'test' ? { trafficClass: 'test' } : {}) }));
    events.push(event(tenant, 'subscription_started', '2026-10-06T12:00:00Z'));
    events.push(event(tenant, 'workspace_visited', '2026-09-23T12:00:00Z'));
  }
  events.push(event('duplicate', 'subscription_started', '2026-10-07T12:00:00Z'));
  // Activation steps count once per workspace, only after signup, and never for excluded traffic.
  for (const tenant of ['customer', 'duplicate', 'pending', 'test', 'demo', 'internal', 'reserved']) {
    events.push(event(tenant, 'setup_completed', '2026-10-06T13:00:00Z', tenant === 'test' ? { trafficClass: 'test' } : {}));
  }
  for (const type of ['target_created', 'people_added', 'outreach_draft_saved']) events.push(event('customer', type, '2026-09-16T12:00:00Z'));
  events.push(event('duplicate', 'target_created', '2026-09-16T12:00:00Z'), event('duplicate', 'target_created', '2026-09-17T12:00:00Z'));
  events.push(event('duplicate', 'outreach_generated', '2026-09-16T12:00:00Z'), event('duplicate', 'outreach_draft_saved', '2026-09-16T13:00:00Z'));
  events.push(event('pending', 'people_added', '2026-10-01T12:00:00Z'), event('pending', 'target_created', '2026-10-09T12:00:00Z'));
  events.push(event('customer', 'people_added', '2026-09-16T12:00:00Z', { trafficClass: 'test' }));
  const users = ['customer','duplicate','pending','test','demo','internal','reserved'].map(tenant => ({ id: `${tenant}-user`, email: tenant === 'reserved' ? 'qa@example.com' : `${tenant}@company.io` }));
  const tenants = users.map(user => ({ id: user.id.replace('-user',''), slug: user.id === 'demo-user' ? 'bd-engine-demo' : user.id }));
  const prefix = `WITH analytics_events AS (SELECT * FROM jsonb_to_recordset($4::jsonb) AS e(tenant_id text,user_id text,event_type text,day text,created_at text,metadata jsonb)),users AS (SELECT * FROM jsonb_to_recordset($5::jsonb) AS u(id text,email text)),tenants AS (SELECT * FROM jsonb_to_recordset($6::jsonb) AS t(id text,slug text)), `;
  const result = await dbQuery(prefix + GROWTH_SQL.replace(/^WITH /,''), ['2026-09-09', ['internal@company.io'], '2026-10-08T14:00:00Z', JSON.stringify(events), JSON.stringify(users), JSON.stringify(tenants)]);
  // 'pending' signed up on Oct 5: its people_added (Oct 1) precedes signup and its
  // target_created (Oct 9) is after the report time, so neither counts.
  assert.deepEqual(summarizeGrowthRows(result.rows).totals, { signups: 3, paid: 3, eligible: 2, returned: 2, pending: 1, activation: { setupCompleted: 3, targetAdded: 2, peopleAdded: 1, outreachDrafted: 2 } });
  console.log('PostgreSQL workflow tools: scoped feedback, stale snapshots, reminder concurrency, weekly digest delivery, growth cohort exclusions, and activation steps passed.');
} finally {
  for (const table of ['saved_work','tasks','activities','board_configs','jobs','contacts','accounts','tenant_data','memberships']) await dbQuery(`DELETE FROM ${table} WHERE tenant_id=$1`, [id]);
  await dbQuery('DELETE FROM tenants WHERE id=$1', [id]); await dbQuery('DELETE FROM users WHERE id=$1', [userId]);
  await closeDb();
}
