/**
 * BD Engine Cloud — Authentication module.
 *
 * Signed-cookie authentication with server-side session persistence.
 * In production this would verify JWTs or use an auth provider (Clerk, Auth0, etc.).
 */

import { randomUUID, randomBytes, scryptSync, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { dbSaveSession, dbDeleteSession, dbLoadActiveSessions } from './db.js';

const SECRET = process.env.SESSION_SECRET || 'bd-engine-dev-secret-do-not-use-in-production';
const PRODUCTION_AUTH = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.BD_CLOUD_ENV === 'production' || process.env.NODE_ENV === 'production');
if (!process.env.SESSION_SECRET && PRODUCTION_AUTH) {
  throw new Error('SESSION_SECRET is required in production.');
}
if (PRODUCTION_AUTH && SECRET.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
}

// In-memory session cache, write-through to Postgres so sessions survive
// deploys/restarts instead of logging everyone out. Reads stay synchronous
// (the cache is repopulated from the DB at startup by loadSessionsFromDb).
const sessions = new Map();

// ── Cookie helpers ──────────────────────────────────────────────────────────

function signValue(value) {
  return createHmac('sha256', SECRET).update(value).digest('base64url');
}

function createSignedCookie(value) {
  const sig = signValue(value);
  return `${value}.${sig}`;
}

function verifySignedCookie(cookie) {
  if (!cookie || typeof cookie !== 'string') return null;
  const lastDot = cookie.lastIndexOf('.');
  if (lastDot < 1) return null;
  const value = cookie.slice(0, lastDot);
  const sig = cookie.slice(lastDot + 1);
  const expected = signValue(value);
  try {
    if (timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return value;
    }
  } catch {
    // Length mismatch etc.
  }
  return null;
}

// ── Session management ──────────────────────────────────────────────────────

export async function createSession(userId, tenantId, extra = {}) {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    userId,
    tenantId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...extra,
  };
  sessions.set(sessionId, session);
  try {
    await dbSaveSession(session);
  } catch (error) {
    sessions.delete(sessionId);
    throw error;
  }
  return { sessionId, cookie: createSignedCookie(sessionId) };
}

export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    sessions.delete(sessionId);
    dbDeleteSession(sessionId).catch(() => {});
    return null;
  }
  return session;
}

export async function destroySession(sessionId) {
  sessions.delete(sessionId);
  await dbDeleteSession(sessionId);
}

// Repopulate the in-memory cache from Postgres at startup so a deploy/restart
// no longer logs everyone out. Called from server startup before serving.
export async function loadSessionsFromDb() {
  try {
    const rows = await dbLoadActiveSessions();
    let loaded = 0;
    for (const session of rows) {
      if (session?.id) { sessions.set(session.id, session); loaded += 1; }
    }
    if (loaded) console.log(`  Auth: restored ${loaded} active session(s) from DB`);
  } catch (err) {
    console.error('  Auth: failed to restore sessions:', err.message);
  }
}

// ── Cookie parsing ──────────────────────────────────────────────────────────

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(rest.join('=').trim());
  }
  return cookies;
}

// ── Middleware-style session extraction ──────────────────────────────────────

const COOKIE_NAME = 'bd_session';

export function extractSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  const sessionId = verifySignedCookie(raw);
  if (!sessionId) return null;
  return getSession(sessionId);
}

// Behind Railway's TLS proxy the cookie must not be sent over plain HTTP;
// local dev (no RAILWAY_ENVIRONMENT, non-production) stays on http://localhost.
const SECURE_COOKIE = (process.env.RAILWAY_ENVIRONMENT || process.env.BD_CLOUD_ENV === 'production' || process.env.NODE_ENV === 'production') ? '; Secure' : '';

export function setSessionCookie(res, cookie) {
  const maxAge = 7 * 24 * 60 * 60; // 7 days
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIE}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE_COOKIE}`);
}

// ── Password hashing (salted scrypt, with legacy-hash fallback) ─────────────
// New hashes: "scrypt$<saltHex>$<derivedHex>". Legacy hashes were an unsalted
// keyed HMAC-SHA256 (64 hex chars) — still verifiable, and upgraded to scrypt
// on the next successful login (see authenticateUser).

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyScrypt(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  try {
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function verifyLegacyHmac(password, hash) {
  const computed = createHmac('sha256', SECRET).update(String(password)).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(String(hash)));
  } catch {
    return false;
  }
}

export function verifyPassword(password, hash) {
  if (typeof hash === 'string' && hash.startsWith('scrypt$')) {
    return verifyScrypt(password, hash);
  }
  return verifyLegacyHmac(password, hash);
}

export function passwordNeedsUpgrade(hash) {
  return !(typeof hash === 'string' && hash.startsWith('scrypt$'));
}

export function createPasswordResetSecret() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashPasswordResetToken(token) };
}

export function hashPasswordResetToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}
