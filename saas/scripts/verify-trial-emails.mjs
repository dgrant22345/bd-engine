// Trial emails against PostgreSQL: who is picked, one send per email under
// concurrency, the sequence over a trial, and the owner's opt-out.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initDb, closeDb, dbQuery, dbSaveUser, dbSaveTenant, dbSaveMembership } from '../src/db.js';
import { createTrialEmailStore, TRIAL_EMAILS_ID } from '../src/trial-emails.js';

const target = new URL(process.env.DATABASE_URL || 'postgres://missing');
if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1'].includes(target.hostname) || !['/bd_workflow_fixture', '/bd_engine_recovery_source'].includes(target.pathname)) throw new Error('Trial email verification requires an isolated local fixture database in NODE_ENV=test.');
const run = `trial-fixture-${randomUUID()}`;
const DAY = 86_400_000;
const start = new Date();
const iso = (date) => date.toISOString();
if (!await initDb()) throw new Error('Fixture database unavailable');
const tenants = [];
async function workspace(name, { createdAt = start, plan = 'trial', verified = true, role = 'owner' } = {}) {
  const id = `${run}-${name}`; const userId = `${id}-user`;
  await dbSaveUser({ id: userId, email: `${id}@example.test`, name: 'Riley Recruiter', passwordHash: 'fixture', status: 'active', emailVerifiedAt: verified ? iso(start) : '', createdAt: iso(createdAt), updatedAt: iso(createdAt) });
  await dbSaveTenant({ id, slug: id, name: id, plan, status: 'trialing', createdAt: iso(createdAt), updatedAt: iso(createdAt) });
  await dbSaveMembership({ tenantId: id, userId, role, createdAt: iso(createdAt) });
  tenants.push(id);
  return { id, userId };
}
async function allCandidates(store, now) {
  const rows = []; let cursor = '';
  do {
    const page = await store.candidates(cursor, { now });
    rows.push(...page.filter(row => row.tenant_id.startsWith(run)));
    cursor = page.length === 20 ? `${page.at(-1).tenant_id}:${page.at(-1).user_id}` : '';
  } while (cursor);
  return rows.map(row => row.tenant_id.slice(run.length + 1)).sort();
}
try {
  const store = createTrialEmailStore();
  const fresh = await workspace('fresh');
  await workspace('expired', { createdAt: new Date(start.getTime() - 20 * DAY) });
  await workspace('paid', { plan: 'sales' });
  await workspace('unverified', { verified: false });
  await workspace('member', { role: 'member' });
  const optedOut = await workspace('opted-out');
  await store.put(optedOut.id, optedOut.userId, { version: 0, optedOut: true });
  assert.deepEqual(await allCandidates(store, start), ['fresh']);

  const sends = [];
  const options = (now, companyCount = 0) => ({
    now,
    getRecipient: async () => ({ eligible: true, to: 'owner@example.test', tenantCreatedAt: iso(start) }),
    getCompanyCount: async () => companyCount,
    send: async ({ kind }) => { sends.push(kind); return { sent: true }; },
  });
  // Two servers scanning at once send the welcome once.
  const both = await Promise.all([store.deliver(fresh.id, fresh.userId, options(start)), store.deliver(fresh.id, fresh.userId, options(start))]);
  assert.deepEqual(sends, ['welcome']);
  assert.equal(both.filter(result => result.sent).length, 1);
  assert.equal((await store.deliver(fresh.id, fresh.userId, options(new Date(start.getTime() + DAY)))).reason, 'not_due');
  // Day 3 with no companies: the reminder; the last three days: the trial note.
  assert.equal((await store.deliver(fresh.id, fresh.userId, options(new Date(start.getTime() + 3.2 * DAY)))).kind, 'add_companies');
  assert.equal((await store.deliver(fresh.id, fresh.userId, options(new Date(start.getTime() + 11.5 * DAY)))).kind, 'trial_ending');
  assert.deepEqual(sends, ['welcome', 'add_companies', 'trial_ending']);
  // A finished sequence is no longer scanned.
  assert.deepEqual(await allCandidates(store, new Date(start.getTime() + 11.6 * DAY)), []);
  const saved = (await dbQuery("SELECT title, body FROM saved_work WHERE tenant_id=$1 AND id=$2", [fresh.id, TRIAL_EMAILS_ID])).rows[0];
  assert.equal(saved.title, 'Trial emails');
  assert.deepEqual(Object.keys(saved.body.sent).sort(), ['add_companies', 'trial_ending', 'welcome']);
  // The owner's choice survives delivery bookkeeping; a stale version is refused.
  const settings = await store.get(fresh.id, fresh.userId);
  assert.equal(settings.optedOut, false);
  const off = await store.put(fresh.id, fresh.userId, { version: settings.version, optedOut: true });
  assert.equal(off.optedOut, true);
  await assert.rejects(store.put(fresh.id, fresh.userId, { version: settings.version, optedOut: false }), error => error.status === 409);
  console.log('Trial emails verified on PostgreSQL: candidates, single send under concurrency, sequence, opt-out.');
} finally {
  for (const id of tenants) {
    for (const table of ['saved_work', 'memberships']) await dbQuery(`DELETE FROM ${table} WHERE tenant_id=$1`, [id]);
    await dbQuery('DELETE FROM tenants WHERE id=$1', [id]);
    await dbQuery('DELETE FROM users WHERE id=$1', [`${id}-user`]);
  }
  await closeDb();
}
