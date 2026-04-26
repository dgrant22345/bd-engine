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

export function createTenant({ name, slug, plan = 'trial', ownerUserId, persona = 'bd' }) {
  const id = `tenant-${randomUUID().slice(0, 8)}`;
  const normalizedSlug = String(slug || name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || id;

  // Check slug uniqueness
  for (const t of tenants.values()) {
    if (t.slug === normalizedSlug) {
      return { error: 'A workspace with this name already exists.' };
    }
  }

  const tenant = {
    id,
    slug: normalizedSlug,
    name: String(name || '').trim() || 'My Workspace',
    plan,
    status: plan === 'trial' ? 'trialing' : 'active',
    persona: persona || 'bd',
    stripeCustomerId: '',
    stripeSubscriptionId: '',
    createdAt: now(),
    updatedAt: now(),
  };
  tenants.set(id, tenant);
  // Persist to DB
  dbSaveTenant(tenant).catch(() => {});

  // Add owner membership
  if (ownerUserId) {
    const membership = {
      tenantId: id,
      userId: ownerUserId,
      role: 'owner',
      createdAt: now(),
    };
    memberships.push(membership);
    dbSaveMembership(membership).catch(() => {});
  }

  return { tenant };
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
