/**
 * BD Engine Cloud — User & tenant management store.
 *
 * Manages user accounts, tenants, and memberships in memory,
 * with write-through persistence to PostgreSQL when available.
 */

import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from './auth.js';
import { dbSaveUser, dbSaveTenant, dbSaveMembership, dbLoadAllUsers, dbLoadAllTenants, dbLoadAllMemberships } from './db.js';

const now = () => new Date().toISOString();

// ── In-memory collections ───────────────────────────────────────────────────

const users = new Map();
const tenants = new Map();
const memberships = []; // { tenantId, userId, role }



// ── Load from database on startup ───────────────────────────────────────────

export async function loadFromDb() {
  const dbUsers = await dbLoadAllUsers();
  const dbTenants = await dbLoadAllTenants();
  const dbMemberships = await dbLoadAllMemberships();

  for (const u of dbUsers) {
    users.set(u.id, u);
  }
  for (const t of dbTenants) {
    if (!t.referralCode && !t.referral_code) {
      t.referralCode = makeUniqueReferralCode();
      dbSaveTenant(t).catch(() => {});
    }
    tenants.set(t.id, t);
  }
  for (const m of dbMemberships) {
    // Avoid duplicate memberships
    if (!memberships.some(x => x.tenantId === m.tenantId && x.userId === m.userId)) {
      memberships.push(m);
    }
  }

  console.log(`  DB: Loaded ${dbUsers.length} users, ${dbTenants.length} tenants, ${dbMemberships.length} memberships`);
}



// ── User CRUD ───────────────────────────────────────────────────────────────

export function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  for (const user of users.values()) {
    if (user.email.toLowerCase() === normalized) return user;
  }
  return null;
}

export function findUserById(userId) {
  return users.get(userId) || null;
}

export function createUser({ email, name, password }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (findUserByEmail(normalized)) {
    return { error: 'An account with this email already exists.' };
  }
  const id = `user-${randomUUID().slice(0, 8)}`;
  const user = {
    id,
    email: normalized,
    name: String(name || '').trim() || normalized.split('@')[0],
    passwordHash: hashPassword(password),
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };
  users.set(id, user);
  // Persist to DB (fire-and-forget)
  dbSaveUser(user).catch(() => {});
  return { user };
}

export function authenticateUser(email, password) {
  const user = findUserByEmail(email);
  if (!user) return { error: 'Invalid email or password.' };
  if (!verifyPassword(password, user.passwordHash)) {
    return { error: 'Invalid email or password.' };
  }
  return { user };
}

// ── Tenant CRUD ─────────────────────────────────────────────────────────────

export function createTenant({ name, slug, plan = 'trial', ownerUserId, persona = 'bd', referredByTenantId = '' }) {
  const id = `tenant-${randomUUID().slice(0, 8)}`;
  const normalizedSlug = makeUniqueTenantSlug(slug || name || id, id);

  const tenant = {
    id,
    slug: normalizedSlug,
    name: String(name || '').trim() || 'My Workspace',
    plan,
    status: plan === 'trial' ? 'trialing' : 'active',
    persona: persona || 'bd',
    stripeCustomerId: '',
    stripeSubscriptionId: '',
    referralCode: makeUniqueReferralCode(),
    referredByTenantId: String(referredByTenantId || ''),
    referralCreditedAt: '',
    referralCreditTransactionId: '',
    createdAt: now(),
    updatedAt: now(),
  };
  tenants.set(id, tenant);

  // Add owner membership
  let membership = null;
  if (ownerUserId) {
    membership = {
      tenantId: id,
      userId: ownerUserId,
      role: 'owner',
      createdAt: now(),
    };
    memberships.push(membership);
  }

  persistTenantWithMembership(tenant, membership).catch(() => {});

  return { tenant };
}

export function ensureTenantForUser(user, { workspaceName = '', persona = 'bd', plan = 'trial', referredByTenantId = '' } = {}) {
  if (!user?.id) return { error: 'User not found.' };

  const userTenants = findTenantsForUser(user.id);
  if (userTenants.length) {
    return { tenant: userTenants[0], tenants: userTenants, recovered: false };
  }

  const unclaimedTenant = findUnclaimedTenantForUser(user);
  if (unclaimedTenant) {
    const membership = addMember(unclaimedTenant.id, user.id, 'owner');
    const attachedTenants = findTenantsForUser(user.id);
    return {
      tenant: attachedTenants[0] || { ...unclaimedTenant, role: membership.role },
      tenants: attachedTenants,
      recovered: true,
      attachedExisting: true,
    };
  }

  const displayName = String(workspaceName || `${user.name || user.email?.split('@')[0] || 'My'}'s Workspace`).trim() || 'My Workspace';
  const result = createTenant({
    name: displayName,
    slug: `${displayName}-${user.id}`,
    plan,
    ownerUserId: user.id,
    persona,
    referredByTenantId,
  });
  if (result.error) return result;

  const createdTenants = findTenantsForUser(user.id);
  return {
    tenant: createdTenants[0] || { ...result.tenant, role: 'owner' },
    tenants: createdTenants,
    recovered: true,
    attachedExisting: false,
  };
}

export function findTenantById(tenantId) {
  return tenants.get(tenantId) || null;
}

export function findTenantByStripeCustomerId(customerId) {
  const normalized = String(customerId || '').trim();
  if (!normalized) return null;
  for (const tenant of tenants.values()) {
    if (tenant.stripeCustomerId === normalized || tenant.stripe_customer_id === normalized) return tenant;
  }
  return null;
}

export function findTenantByReferralCode(code) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  for (const tenant of tenants.values()) {
    if (normalizeReferralCode(tenant.referralCode || tenant.referral_code) === normalized) return tenant;
  }
  return null;
}

export function findTenantsReferredBy(tenantId) {
  const normalized = String(tenantId || '');
  if (!normalized) return [];
  return Array.from(tenants.values()).filter((tenant) => {
    return (tenant.referredByTenantId || tenant.referred_by_tenant_id || '') === normalized;
  });
}

export function updateTenant(tenantId, updates) {
  const tenant = tenants.get(tenantId);
  if (!tenant) return null;
  Object.assign(tenant, updates, { updatedAt: new Date().toISOString() });
  dbSaveTenant(tenant).catch(() => {});
  return tenant;
}

export function findTenantsForUser(userId) {
  const userMemberships = memberships.filter((m) => m.userId === userId);
  return userMemberships
    .map((m) => {
      const tenant = tenants.get(m.tenantId);
      return tenant ? { ...tenant, role: m.role } : null;
    })
    .filter(Boolean);
}

export function getMembership(tenantId, userId) {
  return memberships.find((m) => m.tenantId === tenantId && m.userId === userId) || null;
}

export function addMember(tenantId, userId, role = 'member') {
  const existing = getMembership(tenantId, userId);
  if (existing) return existing;
  const membership = { tenantId, userId, role, createdAt: now() };
  memberships.push(membership);
  dbSaveMembership(membership).catch(() => {});
  return membership;
}

// ── Public user object (strip sensitive fields) ─────────────────────────────

export function safeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getUserCount() {
  return users.size;
}

export function getTenantCount() {
  return tenants.size;
}

export async function persistUserWorkspace(user, tenant) {
  if (!user || !tenant) return;
  const membership = getMembership(tenant.id, user.id);
  await dbSaveUser(user);
  await persistTenantWithMembership(tenant, membership);
}

async function persistTenantWithMembership(tenant, membership = null) {
  if (!tenant) return;
  await dbSaveTenant(tenant);
  if (membership) await dbSaveMembership(membership);
}

function makeUniqueTenantSlug(input, fallback) {
  const base = normalizeTenantSlug(input, fallback);
  if (!tenantSlugExists(base)) return base;

  const idSuffix = normalizeTenantSlug(fallback, randomUUID().slice(0, 8));
  let candidate = `${base}-${idSuffix}`;
  if (!tenantSlugExists(candidate)) return candidate;

  for (let i = 2; i < 1000; i += 1) {
    candidate = `${base}-${i}`;
    if (!tenantSlugExists(candidate)) return candidate;
  }

  return `${base}-${randomUUID().slice(0, 8)}`;
}

function normalizeTenantSlug(input, fallback = 'workspace') {
  return String(input || fallback || 'workspace')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || String(fallback || 'workspace');
}

function tenantSlugExists(slug) {
  for (const tenant of tenants.values()) {
    if (tenant.slug === slug) return true;
  }
  return false;
}

function makeUniqueReferralCode() {
  for (let i = 0; i < 1000; i += 1) {
    const code = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    if (!findTenantByReferralCode(code)) return code;
  }
  return randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
}

export function normalizeReferralCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 24);
}

function findUnclaimedTenantForUser(user) {
  const userSuffix = String(user.id || '').slice(-4).toLowerCase();
  const userCreatedAt = Date.parse(user.createdAt || '') || 0;
  const candidates = [];

  for (const tenant of tenants.values()) {
    if (memberships.some((membership) => membership.tenantId === tenant.id)) continue;
    const slug = String(tenant.slug || '').toLowerCase();
    const createdAt = Date.parse(tenant.createdAt || '') || 0;
    const hasUserSuffix = userSuffix && slug.endsWith(`-${userSuffix}`);
    const wasCreatedNearUser = userCreatedAt && createdAt && Math.abs(createdAt - userCreatedAt) < 10 * 60 * 1000;
    if (hasUserSuffix || wasCreatedNearUser) {
      candidates.push({
        tenant,
        score: (hasUserSuffix ? 10 : 0) + (wasCreatedNearUser ? 5 : 0),
        distance: Math.abs(createdAt - userCreatedAt),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.distance - b.distance);
  return candidates[0]?.tenant || null;
}
