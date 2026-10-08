import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initDb, closeDb, dbQuery, dbSaveUser, dbSaveTenant, dbSaveMembership, dbSaveTenantData } from '../src/db.js';
import { syncTenantRelationalChanges } from '../src/relational-writes.js';
import { persistJobFeedback, loadWorkspaceFeedback } from '../src/job-feedback.js';
import { createReminderStore } from '../src/followup-reminders.js';
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
  // Evaluate the real cohort SQL against CTE fixtures, without touching analytics.
  const events = [];
  const event = (tenant, type, day, metadata = {}) => ({ tenant_id: tenant, user_id: `${tenant}-user`, event_type: type, day: day.slice(0,10), created_at: day, metadata });
  for (const tenant of ['customer', 'duplicate', 'pending', 'test', 'demo', 'internal', 'reserved']) {
    events.push(event(tenant, 'signup_completed', tenant === 'pending' ? '2026-10-05T12:00:00Z' : '2026-09-15T12:00:00Z', { firstTouchSource: 'linkedin', firstTouchCampaign: 'audit', persona: 'bd', ...(tenant === 'test' ? { trafficClass: 'test' } : {}) }));
    events.push(event(tenant, 'subscription_started', '2026-10-06T12:00:00Z'));
    events.push(event(tenant, 'workspace_visited', '2026-09-23T12:00:00Z'));
  }
  events.push(event('duplicate', 'subscription_started', '2026-10-07T12:00:00Z'));
  const users = ['customer','duplicate','pending','test','demo','internal','reserved'].map(tenant => ({ id: `${tenant}-user`, email: tenant === 'reserved' ? 'qa@example.com' : `${tenant}@company.io` }));
  const tenants = users.map(user => ({ id: user.id.replace('-user',''), slug: user.id === 'demo-user' ? 'bd-engine-demo' : user.id }));
  const prefix = `WITH analytics_events AS (SELECT * FROM jsonb_to_recordset($4::jsonb) AS e(tenant_id text,user_id text,event_type text,day text,created_at text,metadata jsonb)),users AS (SELECT * FROM jsonb_to_recordset($5::jsonb) AS u(id text,email text)),tenants AS (SELECT * FROM jsonb_to_recordset($6::jsonb) AS t(id text,slug text)), `;
  const result = await dbQuery(prefix + GROWTH_SQL.replace(/^WITH /,''), ['2026-09-09', ['internal@company.io'], '2026-10-08T14:00:00Z', JSON.stringify(events), JSON.stringify(users), JSON.stringify(tenants)]);
  assert.deepEqual(summarizeGrowthRows(result.rows).totals, { signups: 3, paid: 3, eligible: 2, returned: 2, pending: 1 });
  console.log('PostgreSQL workflow tools: scoped feedback, stale snapshots, reminder concurrency, and growth cohort exclusions passed.');
} finally {
  for (const table of ['saved_work','tasks','activities','board_configs','jobs','contacts','accounts','tenant_data','memberships']) await dbQuery(`DELETE FROM ${table} WHERE tenant_id=$1`, [id]);
  await dbQuery('DELETE FROM tenants WHERE id=$1', [id]); await dbQuery('DELETE FROM users WHERE id=$1', [userId]);
  await closeDb();
}
