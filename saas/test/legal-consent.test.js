import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  dbCloseUserAccount,
  dbListLegalConsents,
  dbPersistSignupWithLegalConsent,
} from '../src/db.js';
import { createStore } from '../src/store.js';
import {
  createUser,
  ensureTenantForUser,
  forgetClosedAccount,
  getMembership,
} from '../src/users.js';

function createInMemorySignup(label) {
  const userResult = createUser({
    email: `${label}-${Date.now()}@example.com`,
    name: 'Consent Test User',
    password: 'consent-test-password',
  }, { persist: false });
  assert.ok(userResult.user);
  const tenantResult = ensureTenantForUser(userResult.user, {
    workspaceName: `${label} Workspace`,
    persona: 'bd',
    persist: false,
  });
  assert.ok(tenantResult.tenant);
  const membership = getMembership(tenantResult.tenant.id, userResult.user.id);
  assert.ok(membership);
  return { user: userResult.user, tenant: tenantResult.tenant, membership };
}

test('signup consent is server-stamped, versioned, and idempotent', async (t) => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  const signup = createInMemorySignup('consent-ledger');
  t.after(() => forgetClosedAccount(signup.user.id, [signup.tenant.id]));
  const before = Date.now();
  const first = await dbPersistSignupWithLegalConsent({
    ...signup,
    termsVersion: '2026-08-21',
    privacyVersion: '2026-08-21',
  });
  const after = Date.now();

  assert.equal(first.storage, 'memory');
  assert.equal(first.duplicate, false);
  assert.ok(Date.parse(first.acceptedAt) >= before && Date.parse(first.acceptedAt) <= after);
  assert.equal(first.acceptedAt, first.createdAt);

  const duplicate = await dbPersistSignupWithLegalConsent({
    ...signup,
    termsVersion: '2026-08-21',
    privacyVersion: '2026-08-21',
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.acceptedAt, first.acceptedAt);

  const listed = await dbListLegalConsents({ tenantId: signup.tenant.id, userId: signup.user.id });
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], {
    tenantId: signup.tenant.id,
    userId: signup.user.id,
    termsVersion: '2026-08-21',
    privacyVersion: '2026-08-21',
    acceptedAt: first.acceptedAt,
    createdAt: first.createdAt,
  });
  assert.deepEqual(await dbListLegalConsents({ tenantId: signup.tenant.id, userId: 'another-user' }), []);
});

test('configured database outages never fall back to volatile consent storage', async (t) => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://configured-but-not-ready.invalid/bd-engine';
  t.after(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  const signup = createInMemorySignup('consent-db-outage');
  t.after(() => forgetClosedAccount(signup.user.id, [signup.tenant.id]));
  await assert.rejects(
    dbPersistSignupWithLegalConsent({
      ...signup,
      termsVersion: '2026-08-21',
      privacyVersion: '2026-08-21',
    }),
    /Database is not ready to record legal consent/
  );
});

test('privacy export includes current-user consent, workspace clearing preserves it, and account closure removes it', async (t) => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  const signup = createInMemorySignup('consent-privacy');
  t.after(() => forgetClosedAccount(signup.user.id, [signup.tenant.id]));
  await dbPersistSignupWithLegalConsent({
    ...signup,
    termsVersion: '2026-08-21',
    privacyVersion: '2026-08-21',
  });
  const store = createStore();
  store.ensureTenant(signup.tenant, signup.user);

  const exported = await store.exportTenantData(signup.tenant.id, {
    tenant: signup.tenant,
    user: { id: signup.user.id, email: signup.user.email },
    membership: signup.membership,
  });
  assert.equal(exported.legalConsents.length, 1);
  assert.equal(exported.legalConsents[0].termsVersion, '2026-08-21');

  await store.clearTenantWorkspaceData(signup.tenant.id);
  assert.equal((await dbListLegalConsents({ tenantId: signup.tenant.id, userId: signup.user.id })).length, 1);

  await dbCloseUserAccount({ userId: signup.user.id, deleteTenantIds: [signup.tenant.id] });
  assert.deepEqual(await dbListLegalConsents({ tenantId: signup.tenant.id, userId: signup.user.id }), []);
});

test('signup fails closed before session creation when durable consent persistence fails', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const start = server.indexOf('async function handleSignup');
  const end = server.indexOf('\nasync function handleLogin', start);
  assert.ok(start >= 0 && end > start, 'signup handler not found');
  const signup = server.slice(start, end);

  assert.match(signup, /createUser\([\s\S]*?\{ persist: false \}\)/);
  assert.match(signup, /ensureTenantForUser\([\s\S]*?persist: false/);
  assert.match(signup, /await dbPersistSignupWithLegalConsent/);
  assert.match(signup, /forgetClosedAccount\(userResult\.user\.id, createdTenantIds\)/);
  assert.match(signup, /code: 'signup_persistence_unavailable'/);
  assert.ok(
    signup.indexOf('await dbPersistSignupWithLegalConsent') < signup.indexOf('await createSession'),
    'a session must not be issued before consent evidence is durable'
  );
});
