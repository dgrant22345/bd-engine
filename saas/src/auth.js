/**
 * BD Engine Cloud — Authentication module.
 *
 * Development stub that uses signed cookies for sessions.
 * In production this would verify JWTs or use an auth provider (Clerk, Auth0, etc.).
 */

import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || 'bd-engine-dev-secret-do-not-use-in-production';

// In-memory session store (replace with Redis/Postgres in production)
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

export function createSession(userId, tenantId, extra = {}) {
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
  return { sessionId, cookie: createSignedCookie(sessionId) };
}

export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function destroySession(sessionId) {
  sessions.delete(sessionId);
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

export function setSessionCookie(res, cookie) {
  const maxAge = 7 * 24 * 60 * 60; // 7 days
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ── Password hashing (dev stub — use bcrypt/argon2 in production) ───────────

export function hashPassword(password) {
  return createHmac('sha256', SECRET).update(password).digest('hex');
}

export function verifyPassword(password, hash) {
  const computed = hashPassword(password);
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
  } catch {
    return false;
  }
}
