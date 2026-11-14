// Team workspaces on PostgreSQL: invitations are single-use across servers,
// replaced and withdrawn per workspace, and an invited signup is all-or-nothing
// with the invitation; the owner's membership never changes through team edits.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initDb, closeDb, dbQuery, dbTransaction, isDbEnabled, dbPersistSignupWithLegalConsent, dbUpdateMembershipRole, dbDeleteMembership } from '../src/db.js';
import { createInvitationStore, invitationStatus, INVITATION_TTL_MS } from '../src/team.js';

const target = new URL(process.env.DATABASE_URL || 'postgres://missing');
if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1'].includes(target.hostname) || !['/bd_workflow_fixture', '/bd_engine_recovery_source'].includes(target.pathname)) throw new Error('Team workspace verification requires an isolated local fixture database in NODE_ENV=test.');
if (!await initDb()) throw new Error('Fixture database unavailable');

const run = randomUUID().slice(0, 8);
const tenantId = `tenant-team-verify-${run}`;
const ownerId = `user-team-owner-${run}`;
const at = new Date().toISOString();
const userIds = [ownerId];
try {
  await dbQuery(`INSERT INTO users (id, email, name, password_hash, status, email_verified_at, created_at, updated_at) VALUES ($1,$2,'Owner','x','active',$3,$3,$3)`, [ownerId, `owner-${run}@example.com`, at]);
  await dbQuery(`INSERT INTO tenants (id, slug, name, plan, status, created_at, updated_at) VALUES ($1,$2,'Team verify','trial','active',$3,$3)`, [tenantId, `team-verify-${run}`, at]);
  await dbQuery(`INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES ($1,$2,'owner',$3)`, [tenantId, ownerId, at]);

  let clock = new Date();
  const store = createInvitationStore({ query: (...args) => dbQuery(...args), transaction: dbTransaction, enabled: isDbEnabled, now: () => clock });
  const other = createInvitationStore({ query: (...args) => dbQuery(...args), transaction: dbTransaction, enabled: isDbEnabled, now: () => clock });

  // Replace, read by token, withdraw only within the workspace.
  const first = await store.create({ tenantId, email: `ana-${run}@example.com`, role: 'member', invitedByUserId: ownerId });
  const second = await store.create({ tenantId, email: `ANA-${run}@example.com`, role: 'admin', invitedByUserId: ownerId });
  assert.deepEqual((await store.listPending(tenantId)).map((item) => item.id), [second.invitation.id], 'one pending invitation per address');
  assert.equal(invitationStatus(await store.findByToken(first.token), clock), 'revoked');
  const stored = (await dbQuery('SELECT * FROM workspace_invitations WHERE id = $1', [second.invitation.id])).rows[0];
  assert.notEqual(stored.token_hash, second.token, 'only the hash is stored');
  assert.equal(await store.revoke('tenant-someone-else', second.invitation.id), false);

  // Two servers accept the same invitation: one wins.
  const wins = await Promise.all([store.consume(second.invitation.id, 'u1'), other.consume(second.invitation.id, 'u2')]);
  assert.deepEqual(wins.sort(), [false, true]);
  await store.restore(second.invitation.id);
  assert.equal(invitationStatus(await store.findByToken(second.token), clock), 'pending');

  // An invited signup commits the user, membership, consent and invitation together.
  const newUser = (email) => ({ id: `user-team-${randomUUID()}`, email, name: 'Ana', passwordHash: 'x', status: 'active', emailVerifiedAt: at, createdAt: at, updatedAt: at });
  const ana = newUser(`ana-${run}@example.com`);
  userIds.push(ana.id);
  const consume = (user) => async (tx) => {
    if (!(await store.consume(second.invitation.id, user.id, tx))) throw Object.assign(new Error('used'), { code: 'invitation_used' });
  };
  await dbPersistSignupWithLegalConsent({
    user: ana, tenant: { id: tenantId }, membership: { tenantId, userId: ana.id, role: 'admin', createdAt: at },
    termsVersion: 'v-test', privacyVersion: 'v-test', joinExistingTenant: true, withinTransaction: consume(ana),
  });
  assert.equal((await dbQuery('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2', [tenantId, ana.id])).rows[0]?.role, 'admin');
  assert.equal(invitationStatus(await store.findByToken(second.token), clock), 'accepted');

  // A second signup with the used invitation leaves nothing behind.
  const late = newUser(`late-${run}@example.com`);
  userIds.push(late.id);
  await assert.rejects(dbPersistSignupWithLegalConsent({
    user: late, tenant: { id: tenantId }, membership: { tenantId, userId: late.id, role: 'admin', createdAt: at },
    termsVersion: 'v-test', privacyVersion: 'v-test', joinExistingTenant: true, withinTransaction: consume(late),
  }), { code: 'invitation_used' });
  assert.equal((await dbQuery('SELECT count(*)::int AS n FROM users WHERE id=$1', [late.id])).rows[0].n, 0, 'rolled back');
  assert.equal((await dbQuery('SELECT count(*)::int AS n FROM memberships WHERE user_id=$1', [late.id])).rows[0].n, 0);

  // Team edits never touch the owner row.
  assert.equal(await dbUpdateMembershipRole(tenantId, ownerId, 'member'), false);
  assert.equal(await dbDeleteMembership(tenantId, ownerId), false);
  assert.equal(await dbUpdateMembershipRole(tenantId, ana.id, 'member'), true);
  assert.equal(await dbDeleteMembership(tenantId, ana.id), true);

  // Expired invitations are neither listed nor usable.
  const third = await store.create({ tenantId, email: `bo-${run}@example.com`, role: 'member', invitedByUserId: ownerId });
  clock = new Date(clock.getTime() + INVITATION_TTL_MS + 1000);
  assert.deepEqual(await store.listPending(tenantId), []);
  assert.equal(await store.consume(third.invitation.id, 'u3'), false);
  assert.equal(await store.revoke(tenantId, third.invitation.id), false);

  // Deleting the workspace removes its invitations.
  await dbQuery('DELETE FROM legal_consents WHERE tenant_id=$1', [tenantId]);
  await dbQuery('DELETE FROM memberships WHERE tenant_id=$1', [tenantId]);
  await dbQuery('DELETE FROM tenants WHERE id=$1', [tenantId]);
  assert.equal((await dbQuery('SELECT count(*)::int AS n FROM workspace_invitations WHERE tenant_id=$1', [tenantId])).rows[0].n, 0);
  console.log('Team workspaces verified on PostgreSQL: hashed single-use invitations, replace and withdraw, atomic invited signup, owner row protected, expiry, cascade.');
} finally {
  await dbQuery('DELETE FROM legal_consents WHERE tenant_id=$1', [tenantId]).catch(() => {});
  await dbQuery('DELETE FROM memberships WHERE tenant_id=$1', [tenantId]).catch(() => {});
  await dbQuery('DELETE FROM workspace_invitations WHERE tenant_id=$1', [tenantId]).catch(() => {});
  await dbQuery('DELETE FROM tenants WHERE id=$1', [tenantId]).catch(() => {});
  await dbQuery('DELETE FROM users WHERE id = ANY($1::text[])', [userIds]).catch(() => {});
  await closeDb();
}
