import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildInvitationEmail, canChangeRole, canInvite, canRemoveMember, canRevokeInvitation, createInvitationStore,
  hashInvitationToken, invitationStatus, isValidInviteEmail, seatSummary, INVITATION_TTL_MS,
} from '../src/team.js';
import { startLocalServer } from './fixtures/local-server.mjs';

const LEGAL = /const COMMERCIAL_LEGAL_VERSION = '([^']+)'/.exec(readFileSync(new URL('../src/server.js', import.meta.url), 'utf8'))[1];
const legalAcceptance = { accepted: true, termsVersion: LEGAL, privacyVersion: LEGAL };
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test('who may invite, change roles and remove members', () => {
  const owner = { userId: 'o', role: 'owner' };
  const admin = { userId: 'a', role: 'admin' };
  const admin2 = { userId: 'a2', role: 'admin' };
  const member = { userId: 'm', role: 'member' };
  assert.deepEqual([canInvite('owner', 'admin'), canInvite('owner', 'member'), canInvite('admin', 'member'), canInvite('admin', 'admin'), canInvite('member', 'member'), canInvite('viewer', 'member'), canInvite('owner', 'owner')],
    [true, true, true, false, false, false, false]);
  assert.equal(canRevokeInvitation('admin', { role: 'admin' }), false);
  assert.equal(canRevokeInvitation('admin', { role: 'member' }), true);
  assert.equal(canChangeRole(owner, member, 'admin'), true);
  assert.equal(canChangeRole(owner, owner, 'member'), false, 'not your own role');
  assert.equal(canChangeRole(owner, member, 'owner'), false, 'ownership does not move this way');
  assert.equal(canChangeRole(admin, member, 'admin'), false, 'only the owner changes roles');
  assert.equal(canRemoveMember(owner, admin), true);
  assert.equal(canRemoveMember(admin, member), true);
  assert.equal(canRemoveMember(admin, admin2), false);
  assert.equal(canRemoveMember(member, admin), false);
  assert.equal(canRemoveMember(member, member), true, 'anyone but the owner may leave');
  assert.equal(canRemoveMember(owner, owner), false, 'the owner cannot leave or be removed');
  assert.deepEqual(seatSummary({ members: 2, pending: 1, limit: 3 }), { members: 2, pending: 1, limit: 3, available: 0 });
  assert.deepEqual(seatSummary({ members: 9, pending: 0, limit: -1 }), { members: 9, pending: 0, limit: 'unlimited', available: null });
  for (const email of ['ana@example.com', 'A.B+c@sub.example.ca']) assert.equal(isValidInviteEmail(email), true, email);
  for (const email of ['', 'ana', 'ana@', 'ana@example', 'a b@example.com', '<x>@example.com', `${'a'.repeat(250)}@example.com`]) assert.equal(isValidInviteEmail(email), false, email);
});

test('an invitation is stored as a hash, replaces the previous one, and is used once', async () => {
  let clock = new Date('2026-11-15T12:00:00Z');
  const store = createInvitationStore({ enabled: () => false, now: () => clock });
  const first = await store.create({ tenantId: 't1', email: 'Ana@Example.com', role: 'member', invitedByUserId: 'o' });
  assert.equal(first.invitation.email, 'ana@example.com');
  assert.equal(first.invitation.tokenHash, hashInvitationToken(first.token));
  assert.ok(!JSON.stringify(first.invitation).includes(first.token), 'the token itself is not kept');
  const second = await store.create({ tenantId: 't1', email: 'ana@example.com', role: 'admin', invitedByUserId: 'o' });
  assert.deepEqual((await store.listPending('t1')).map((item) => item.id), [second.invitation.id], 'a new invitation replaces the pending one');
  assert.equal(invitationStatus(await store.findByToken(first.token), clock), 'revoked');
  assert.equal(await store.get('t2', second.invitation.id), null, 'another workspace cannot read it');
  assert.equal(await store.revoke('t2', second.invitation.id), false, 'or withdraw it');
  assert.equal(await store.consume(second.invitation.id, 'u1'), true);
  assert.equal(await store.consume(second.invitation.id, 'u2'), false, 'single use');
  await store.restore(second.invitation.id);
  assert.equal(invitationStatus(await store.findByToken(second.token), clock), 'pending');

  const third = await store.create({ tenantId: 't1', email: 'bo@example.com', role: 'member', invitedByUserId: 'o' });
  clock = new Date(clock.getTime() + INVITATION_TTL_MS + 1);
  assert.equal(invitationStatus(await store.findByToken(third.token), clock), 'expired');
  assert.equal(await store.consume(third.invitation.id, 'u3'), false, 'an expired invitation cannot be used');
  assert.equal(await store.findByToken('not-a-token'), null);
});

test('the invitation email escapes names and keeps the subject on one line', () => {
  const email = buildInvitationEmail({ workspaceName: 'Acme <script>', inviterName: 'Eve\r\nBcc: x@example.com', role: 'admin', acceptUrl: 'https://bd.example/?invite=abc', expiresAt: '2026-11-22T12:00:00Z' });
  assert.equal(email.subject, 'Eve Bcc: x@example.com invited you to Acme <script> on BD Engine');
  assert.doesNotMatch(email.subject, /[\r\n]/);
  assert.match(email.html, /Acme &lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.text, /as an admin/);
  assert.match(email.text, /expires on November 22, 2026/);
  assert.match(email.html, /href="https:\/\/bd\.example\/\?invite=abc"/);
});

// A fetch helper that carries one person's session cookie.
function client(origin) {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length) cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* status is enough */ }
    return { status: response.status, json };
  };
}

async function signUp(call, { email, name, invitationToken } = {}) {
  return call('/api/auth/signup', {
    method: 'POST',
    body: { name, email, password: 'team-password-1', workspaceName: `${name} Workspace`, persona: 'bd', legalAcceptance, ...(invitationToken ? { invitationToken } : {}) },
  });
}

const tokenOf = (acceptUrl) => new URL(acceptUrl).searchParams.get('invite');

test('a team: invite, join by signup or sign-in, share data, change roles, seats, leave', { timeout: 60000 }, async (t) => {
  const { origin } = await startLocalServer(t);
  const id = unique();
  const owner = client(origin);
  const ownerEmail = `owner-${id}@example.com`;
  assert.equal((await signUp(owner, { email: ownerEmail, name: 'Olive Owner' })).status, 201);
  const ownerTenant = (await owner('/api/auth/me')).json.tenant.id;

  // The owner adds a company before anyone joins.
  assert.equal((await owner('/api/accounts', { method: 'POST', body: { displayName: 'Northwind Health' } })).status, 201);

  // Invite a new person.
  const anaEmail = `ana-${id}@example.com`;
  const invite = await owner('/api/team/invitations', { method: 'POST', body: { email: anaEmail.toUpperCase(), role: 'member' } });
  assert.equal(invite.status, 201, JSON.stringify(invite.json));
  assert.equal(invite.json.invitation.email, anaEmail);
  assert.equal(invite.json.emailSent, false);
  assert.ok(invite.json.acceptUrl, 'local development shows the link');
  assert.equal(invite.json.invitation.tokenHash, undefined);
  const anaToken = tokenOf(invite.json.acceptUrl);

  // Anyone with the link sees who invited them, without signing in.
  const visitor = client(origin);
  const preview = await visitor('/api/invitations/preview', { method: 'POST', body: { token: anaToken } });
  assert.deepEqual([preview.json.status, preview.json.workspaceName, preview.json.inviterName, preview.json.role, preview.json.email, preview.json.accountExists],
    ['pending', 'Olive Owner Workspace', 'Olive Owner', 'member', anaEmail, false]);
  assert.deepEqual((await visitor('/api/invitations/preview', { method: 'POST', body: { token: 'x'.repeat(43) } })).json, { status: 'invalid' });

  // The invited address only.
  const wrong = await signUp(client(origin), { email: `other-${id}@example.com`, name: 'Mallory', invitationToken: anaToken });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.code, 'invitation_email_mismatch');

  const ana = client(origin);
  const joined = await signUp(ana, { email: anaEmail, name: 'Ana Member', invitationToken: anaToken });
  assert.equal(joined.status, 201, JSON.stringify(joined.json));
  assert.deepEqual([joined.json.tenant.id, joined.json.membership.role, joined.json.invitationAccepted, Boolean(joined.json.user.emailVerifiedAt)], [ownerTenant, 'member', true, true]);
  assert.equal(joined.json.tenants.length, 1, 'no extra workspace is created for an invited signup');
  assert.equal((await signUp(client(origin), { email: anaEmail, name: 'Again', invitationToken: anaToken })).status, 410, 'the link works once');

  // Shared data: Ana sees the owner's company and her additions are the owner's too.
  const anaAccounts = (await ana('/api/accounts?page=1&pageSize=20')).json;
  assert.ok(JSON.stringify(anaAccounts).includes('Northwind Health'));
  assert.equal((await ana('/api/accounts', { method: 'POST', body: { displayName: 'Quill Labs' } })).status, 201);
  assert.ok(JSON.stringify((await owner('/api/accounts?page=1&pageSize=20')).json).includes('Quill Labs'));

  // A member cannot manage the team.
  const memberView = await ana('/api/team');
  assert.deepEqual([memberView.json.canManage, memberView.json.invitations.length, memberView.json.members.length], [false, 0, 2]);
  assert.equal((await ana('/api/team/invitations', { method: 'POST', body: { email: `x-${id}@example.com` } })).status, 403);
  const ownerId = memberView.json.members.find((item) => item.role === 'owner').userId;
  const anaId = memberView.json.members.find((item) => item.you).userId;
  assert.equal((await ana(`/api/team/members/${ownerId}`, { method: 'DELETE' })).status, 403);
  assert.equal((await ana(`/api/team/members/${anaId}`, { method: 'PATCH', body: { role: 'admin' } })).status, 403, 'no self-promotion');

  // An existing account accepts by signing in.
  const bo = client(origin);
  const boEmail = `bo-${id}@example.com`;
  assert.equal((await signUp(bo, { email: boEmail, name: 'Bo Elsewhere' })).status, 201);
  const boOwn = (await bo('/api/auth/me')).json.tenant.id;
  const boInvite = await owner('/api/team/invitations', { method: 'POST', body: { email: boEmail, role: 'admin' } });
  assert.equal(boInvite.status, 201);
  const boToken = tokenOf(boInvite.json.acceptUrl);
  assert.equal((await ana('/api/invitations/accept', { method: 'POST', body: { token: boToken } })).json.code, 'invitation_email_mismatch', 'someone else cannot use it');
  const accepted = await bo('/api/invitations/accept', { method: 'POST', body: { token: boToken } });
  assert.deepEqual([accepted.status, accepted.json.tenant.id, accepted.json.role], [200, ownerTenant, 'admin']);
  assert.equal((await bo('/api/auth/me')).json.tenant.id, ownerTenant, 'the session moved to the team workspace');
  const boTenants = (await bo('/api/tenants')).json.tenants.map((item) => item.id).sort();
  assert.deepEqual(boTenants, [boOwn, ownerTenant].sort());
  assert.equal((await bo('/api/session/workspace', { method: 'POST', body: { tenantId: boOwn } })).status, 200);
  assert.equal((await bo('/api/auth/me')).json.tenant.id, boOwn);
  assert.equal((await bo('/api/session/workspace', { method: 'POST', body: { tenantId: 'tenant-not-mine' } })).status, 404);
  assert.equal((await ana('/api/session/workspace', { method: 'POST', body: { tenantId: boOwn } })).status, 404, 'only your own workspaces');
  await bo('/api/session/workspace', { method: 'POST', body: { tenantId: ownerTenant } });

  // Seats: Trial includes 3 users and pending invitations count.
  const full = await owner('/api/team/invitations', { method: 'POST', body: { email: `cy-${id}@example.com` } });
  assert.equal(full.status, 402);
  assert.equal(full.json.code, 'team_seats_full');
  const team = (await owner('/api/team')).json;
  assert.deepEqual(team.seats, { members: 3, pending: 0, limit: 3, available: 0 });

  // An admin removes members but not admins; only the owner changes roles.
  const boId = team.members.find((item) => item.email === boEmail).userId;
  assert.equal((await bo(`/api/team/members/${anaId}`, { method: 'PATCH', body: { role: 'admin' } })).status, 403);
  assert.equal((await owner(`/api/team/members/${anaId}`, { method: 'PATCH', body: { role: 'admin' } })).json.member.role, 'admin');
  assert.equal((await bo(`/api/team/members/${anaId}`, { method: 'DELETE' })).status, 403, 'an admin cannot remove an admin');
  assert.equal((await owner(`/api/team/members/${anaId}`, { method: 'PATCH', body: { role: 'member' } })).status, 200);
  assert.equal((await owner(`/api/team/members/${ownerId}`, { method: 'PATCH', body: { role: 'member' } })).status, 403);
  assert.equal((await bo(`/api/team/members/${anaId}`, { method: 'DELETE' })).json.removed, true);
  const anaAfter = await ana('/api/auth/me');
  assert.notEqual(anaAfter.json.tenant?.id, ownerTenant, 'a removed member no longer opens the workspace');

  // A seat is free again; an admin invites a member and withdraws it.
  const cy = await bo('/api/team/invitations', { method: 'POST', body: { email: `cy-${id}@example.com`, role: 'member' } });
  assert.equal(cy.status, 201);
  assert.equal((await bo('/api/team/invitations', { method: 'POST', body: { email: `dee-${id}@example.com`, role: 'admin' } })).status, 403, 'admins invite members only');
  assert.equal((await bo(`/api/team/invitations/${cy.json.invitation.id}`, { method: 'DELETE' })).json.revoked, true);
  assert.equal((await visitor('/api/invitations/preview', { method: 'POST', body: { token: tokenOf(cy.json.acceptUrl) } })).json.status, 'revoked');

  // Leaving moves the session to the person's own workspace.
  const left = await bo(`/api/team/members/${boId}`, { method: 'DELETE' });
  assert.deepEqual([left.status, left.json.left, left.json.tenant.id], [200, true, boOwn]);
  assert.equal((await bo('/api/auth/me')).json.tenant.id, boOwn);
  assert.deepEqual((await owner('/api/team')).json.members.map((item) => item.role), ['owner']);

  // The public demo shows no team and invites no one.
  const demo = client(origin);
  assert.ok([200, 201].includes((await demo('/api/demo/start', { method: 'POST', body: {} })).status));
  assert.equal((await demo('/api/team')).json.code, 'demo_read_only');
  assert.equal((await demo('/api/team/invitations', { method: 'POST', body: { email: `z-${id}@example.com` } })).status, 403);
});

test('the operator keeps their own entitlements but joins a customer workspace with the role given', { timeout: 60000 }, async (t) => {
  const id = unique();
  const operatorEmail = `operator-${id}@example.com`;
  const saved = process.env.BD_OWNER_EMAILS;
  process.env.BD_OWNER_EMAILS = operatorEmail;
  t.after(() => { if (saved === undefined) delete process.env.BD_OWNER_EMAILS; else process.env.BD_OWNER_EMAILS = saved; });
  const { origin } = await startLocalServer(t);

  const operator = client(origin);
  assert.equal((await signUp(operator, { email: operatorEmail, name: 'Operator' })).status, 201);
  const own = (await operator('/api/auth/me')).json;
  assert.deepEqual([own.plan.id, own.membership.role], ['owner', 'owner'], 'the operator workspace keeps the owner plan');

  const customer = client(origin);
  assert.equal((await signUp(customer, { email: `customer-${id}@example.com`, name: 'Customer' })).status, 201);
  const customerTenant = (await customer('/api/auth/me')).json.tenant.id;
  const invite = await customer('/api/team/invitations', { method: 'POST', body: { email: operatorEmail, role: 'member' } });
  assert.equal((await operator('/api/invitations/accept', { method: 'POST', body: { token: tokenOf(invite.json.acceptUrl) } })).status, 200);

  const inCustomer = (await operator('/api/auth/me')).json;
  assert.deepEqual([inCustomer.tenant.id, inCustomer.plan.id, inCustomer.membership.role], [customerTenant, 'trial', 'member'], 'no owner plan or owner role in a customer workspace');
  assert.equal((await customer('/api/auth/me')).json.plan.id, 'trial', 'the customer plan is unchanged');
  assert.equal((await operator('/api/privacy/delete-workspace', { method: 'POST', body: {} })).status, 403, 'a member cannot delete the customer workspace');
  assert.equal((await operator('/api/team/invitations', { method: 'POST', body: { email: `x-${id}@example.com` } })).status, 403);
});
