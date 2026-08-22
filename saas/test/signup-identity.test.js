import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createTenant,
  createUser,
  findTenantById,
  findUserByEmail,
  findUserById,
  forgetClosedAccount,
} from '../src/users.js';

const COLLIDING_UUID = '00000000-0000-4000-8000-000000000001';
const NEXT_UUID = '00000000-0000-4000-8000-000000000002';

function sequenceGenerator(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test('default account and workspace identifiers retain the full UUID entropy', (t) => {
  const created = createUser({
    email: `identity-full-${Date.now()}@example.test`,
    name: 'Full Identity User',
    password: 'identity-password-0',
  }, { persist: false });
  assert.ok(created.user);
  const workspace = createTenant({ name: 'Full Identity Workspace', ownerUserId: created.user.id }, { persist: false });
  assert.ok(workspace.tenant);
  t.after(() => forgetClosedAccount(created.user.id, [workspace.tenant.id]));

  const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  assert.match(created.user.id, new RegExp(`^user-${uuidPattern}$`));
  assert.match(workspace.tenant.id, new RegExp(`^tenant-${uuidPattern}$`));
});

test('user identity allocation retries collisions without overwriting the existing account', (t) => {
  const firstEmail = `identity-first-${Date.now()}@example.test`;
  const secondEmail = `identity-second-${Date.now()}@example.test`;
  const first = createUser({
    email: firstEmail,
    name: 'Existing User',
    password: 'identity-password-1',
  }, { persist: false, generateId: () => COLLIDING_UUID });
  assert.ok(first.user);

  const second = createUser({
    email: secondEmail,
    name: 'New User',
    password: 'identity-password-2',
  }, {
    persist: false,
    generateId: sequenceGenerator([COLLIDING_UUID, NEXT_UUID]),
  });
  assert.ok(second.user);
  t.after(() => {
    forgetClosedAccount(first.user.id, []);
    forgetClosedAccount(second.user.id, []);
  });

  assert.equal(first.user.id, `user-${COLLIDING_UUID}`);
  assert.equal(second.user.id, `user-${NEXT_UUID}`);
  assert.equal(findUserById(first.user.id)?.email, firstEmail);
  assert.equal(findUserByEmail(secondEmail)?.id, second.user.id);
});

test('identity allocation fails closed after repeated collisions', (t) => {
  const firstEmail = `identity-owner-${Date.now()}@example.test`;
  const rejectedEmail = `identity-rejected-${Date.now()}@example.test`;
  const first = createUser({
    email: firstEmail,
    name: 'Original User',
    password: 'identity-password-3',
  }, { persist: false, generateId: () => COLLIDING_UUID });
  assert.ok(first.user);
  t.after(() => forgetClosedAccount(first.user.id, []));

  const rejected = createUser({
    email: rejectedEmail,
    name: 'Rejected User',
    password: 'identity-password-4',
  }, { persist: false, generateId: () => COLLIDING_UUID });

  assert.match(rejected.error, /unique account identifier/i);
  assert.equal(findUserByEmail(rejectedEmail), null);
  assert.equal(findUserById(first.user.id)?.email, firstEmail);
});

test('workspace identity allocation retries collisions without replacing the existing workspace', (t) => {
  const first = createTenant({ name: 'Existing Workspace' }, {
    persist: false,
    generateId: () => COLLIDING_UUID,
  });
  assert.ok(first.tenant);
  const second = createTenant({ name: 'New Workspace' }, {
    persist: false,
    generateId: sequenceGenerator([COLLIDING_UUID, NEXT_UUID]),
  });
  assert.ok(second.tenant);
  t.after(() => forgetClosedAccount('identity-test-cleanup', [first.tenant.id, second.tenant.id]));

  assert.equal(first.tenant.id, `tenant-${COLLIDING_UUID}`);
  assert.equal(second.tenant.id, `tenant-${NEXT_UUID}`);
  assert.equal(findTenantById(first.tenant.id)?.name, 'Existing Workspace');
  assert.equal(findTenantById(second.tenant.id)?.name, 'New Workspace');
});

test('atomic signup inserts identities and membership while keeping consent idempotent', async () => {
  const source = await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
  const start = source.indexOf('export async function dbPersistSignupWithLegalConsent');
  const end = source.indexOf('export async function dbListLegalConsents', start);
  assert.ok(start >= 0 && end > start, 'signup persistence boundary not found');
  const signup = source.slice(start, end);
  const identityWrites = signup.slice(0, signup.indexOf('const result = await query'));
  const consentWrite = signup.slice(signup.indexOf('const result = await query'));

  assert.match(identityWrites, /INSERT INTO users/);
  assert.match(identityWrites, /INSERT INTO tenants/);
  assert.match(identityWrites, /INSERT INTO memberships/);
  assert.doesNotMatch(identityWrites, /ON CONFLICT/);
  assert.match(consentWrite, /INSERT INTO legal_consents/);
  assert.match(consentWrite, /ON CONFLICT \(tenant_id, user_id, terms_version, privacy_version\)/);
});
