import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { gzip, createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { extractSession, createSession, destroySession, setSessionCookie, clearSessionCookie, loadSessionsFromDb, createPasswordResetSecret, hashPasswordResetToken } from './auth.js';
import { createUser, authenticateUser, setUserPassword, findUserByEmail, findUserById, findTenantsForUser, findTenantById, findTenantBySlug, findTenantByStripeCustomerId, findTenantByReferralCode, findTenantsReferredBy, getMembership, addMember, safeUser, createTenant, ensureTenantForUser, persistUserWorkspace, updateTenant, updateTenantPersisted, loadFromDb as loadUsersFromDb, normalizeReferralCode } from './users.js';
import { getPlan, getPlanByStripePriceId, getTrialDaysRemaining, getUsageSummary, PLANS, handleWebhookEvent, createCheckoutSession, createBillingPortalSession, createReferralCredit, isStripeConfigured, getStripeConfigStatus, isTrialExpired, createBillingGraceDeadline, getBillingAccessStatus } from './billing.js';
import { initDb, closeDb, isDbEnabled, isDbReady, dbCheckRelationalCountParity, dbPruneExpiredOperationalData, dbRecordAnalyticsVisit, dbGetAnalyticsSummary, dbSavePasswordResetToken, dbFindPasswordResetToken, dbMarkPasswordResetTokenUsed } from './db.js';
import { isEmailConfigured, sendPasswordResetEmail } from './email.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const appDir = existsSync(join(rootDir, 'app')) ? join(rootDir, 'app') : join(rootDir, '..', 'app');
const publicDir = join(rootDir, 'public');
const port = Number(process.env.BD_CLOUD_PORT || 8787);
const host = process.env.BD_CLOUD_HOST || '0.0.0.0';
const store = createStore();
const serverStartedAt = new Date();
const referralCreditAmountCents = Number(process.env.BD_REFERRAL_CREDIT_CENTS || 500);
const internalOwnerEmails = new Set(parseEmailList([
  process.env.BD_INTERNAL_OWNER_EMAILS,
  process.env.BD_OWNER_EMAILS,
  'dgrant22@gmail.com',
].join(',')));
const configuredAnalyticsAdminEmails = parseEmailList(process.env.BD_ANALYTICS_ADMIN_EMAILS);
const analyticsAdminEmails = new Set(parseEmailList([
  ...configuredAnalyticsAdminEmails,
  ...internalOwnerEmails,
].join(',')));
const ownerPlanId = 'owner';

// ── Abuse / DoS guards ───────────────────────────────────────────────────────
// Cap request bodies so one large upload can't OOM the single process. The
// LinkedIn CSV for a 20k-contact network is a few MB, so 50MB is generous.
const MAX_BODY_BYTES = Number(process.env.BD_MAX_BODY_BYTES) > 0
  ? Number(process.env.BD_MAX_BODY_BYTES)
  : 50 * 1024 * 1024;
const LOGIN_MAX = Number(process.env.BD_LOGIN_MAX) > 0 ? Number(process.env.BD_LOGIN_MAX) : 20;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNUP_MAX = Number(process.env.BD_SIGNUP_MAX) > 0 ? Number(process.env.BD_SIGNUP_MAX) : 10;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_MAX = Number(process.env.BD_PASSWORD_RESET_MAX) > 0 ? Number(process.env.BD_PASSWORD_RESET_MAX) : 5;
const PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const DEMO_MAX = Number(process.env.BD_DEMO_MAX) > 0 ? Number(process.env.BD_DEMO_MAX) : 30;
const DEMO_WINDOW_MS = 60 * 60 * 1000;
const PUBLIC_DEMO_SLUG = 'bd-engine-demo';
const PUBLIC_DEMO_EMAIL = 'demo@bdengine.local';
const PUBLIC_DEMO_USER_NAME = 'BD Engine Demo';
const PUBLIC_DEMO_WORKSPACE = 'BD Engine Demo Workspace';
const passwordResetTokens = new Map();
const MAX_RATE_BUCKETS = Math.max(1000, Number(process.env.BD_MAX_RATE_BUCKETS) || 10000);
const MAX_RESET_TOKEN_CACHE = Math.max(100, Number(process.env.BD_MAX_RESET_TOKEN_CACHE) || 5000);

// Restrict CORS to known origins instead of "*" (which also can't carry the
// session cookie). Same-origin app requests are unaffected.
const allowedOrigins = new Set();
for (const domain of [process.env.RAILWAY_PUBLIC_DOMAIN, process.env.RAILWAY_STATIC_URL].filter(Boolean)) {
  allowedOrigins.add(`https://${domain}`);
}
for (const origin of String(process.env.BD_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  allowedOrigins.add(origin);
}
allowedOrigins.add(`http://localhost:${port}`);
allowedOrigins.add(`http://127.0.0.1:${port}`);

const rateBuckets = new Map(); // key -> { count, resetAt }

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

// Fixed-window limiter. Returns true when the caller is OVER the limit.
function rateLimitExceeded(key, max, windowMs) {
  const nowMs = Date.now();
  if (rateBuckets.size >= MAX_RATE_BUCKETS) pruneEphemeralMemory(nowMs);
  const bucket = rateBuckets.get(key);
  if (!bucket || nowMs >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

function pruneEphemeralMemory(nowMs = Date.now()) {
  for (const [key, bucket] of rateBuckets) {
    if (nowMs >= Number(bucket.resetAt || 0)) rateBuckets.delete(key);
  }
  if (rateBuckets.size > MAX_RATE_BUCKETS) {
    const overflow = [...rateBuckets.entries()]
      .sort((a, b) => Number(a[1].resetAt || 0) - Number(b[1].resetAt || 0))
      .slice(0, rateBuckets.size - MAX_RATE_BUCKETS);
    for (const [key] of overflow) rateBuckets.delete(key);
  }
  for (const [tokenHash, record] of passwordResetTokens) {
    if (record.usedAt || new Date(record.expiresAt || 0).getTime() <= nowMs) passwordResetTokens.delete(tokenHash);
  }
  if (passwordResetTokens.size > MAX_RESET_TOKEN_CACHE) {
    const overflow = [...passwordResetTokens.entries()]
      .sort((a, b) => new Date(a[1].createdAt || 0).getTime() - new Date(b[1].createdAt || 0).getTime())
      .slice(0, passwordResetTokens.size - MAX_RESET_TOKEN_CACHE);
    for (const [tokenHash] of overflow) passwordResetTokens.delete(tokenHash);
  }
}

async function runOperationalCleanup() {
  pruneEphemeralMemory();
  if (!isDbReady()) return;
  try {
    await dbPruneExpiredOperationalData();
  } catch (error) {
    console.error('Operational cleanup failed:', error.message);
  }
}

function startOperationalCleanup(startupPromise) {
  startupPromise.then(() => runOperationalCleanup()).catch(() => {});
  const memoryTimer = setInterval(pruneEphemeralMemory, 10 * 60 * 1000);
  const databaseTimer = setInterval(runOperationalCleanup, 60 * 60 * 1000);
  memoryTimer.unref?.();
  databaseTimer.unref?.();
}

function isReadOnlyDemoSession(sessionData, tenant) {
  return Boolean(sessionData?.readOnly || sessionData?.demo || tenant?.slug === PUBLIC_DEMO_SLUG);
}

function isMutationMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
}

function canDemoSessionUsePath(pathname, method) {
  if (!isMutationMethod(method)) return true;
  return pathname === '/api/auth/logout';
}

function sendDemoReadOnly(res) {
  return sendJson(res, 403, {
    error: 'This is a read-only demo workspace. Create a free trial to import data, edit records, or run jobs.',
    code: 'demo_read_only',
    demo: true,
    readOnly: true,
  });
}

function parseEmailList(value) {
  return String(value || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

const serverStats = {
  requestCount: 0,
  errorCount: 0,
  statusCounts: {},
  totalDurationMs: 0,
  slowestRequest: null,
  lastError: null,
};
const relationalMirrorHealth = {
  healthy: null,
  workspaceCount: 0,
  mismatchCount: 0,
  checkedAt: '',
  queryMs: 0,
  error: '',
};

// ── Error alerting ───────────────────────────────────────────────────────────
// Optional: set BD_ERROR_WEBHOOK to a Slack/Discord/generic incoming-webhook URL
// to get real-time alerts on 5xx errors. No dependency, no paid service; a no-op
// when unset. Throttled so a burst can't spam the channel.
const ERROR_WEBHOOK = String(process.env.BD_ERROR_WEBHOOK || '').trim();
let lastErrorAlertAt = 0;
const ERROR_ALERT_MIN_INTERVAL_MS = 60 * 1000;

function reportServerError(status, req, error) {
  if (!ERROR_WEBHOOK) return;
  const nowMs = Date.now();
  if (nowMs - lastErrorAlertAt < ERROR_ALERT_MIN_INTERVAL_MS) return;
  lastErrorAlertAt = nowMs;
  const text = `🚨 BD Engine ${status} on ${req.method} ${(req.url || '').split('?')[0]} — ${error?.message || 'error'}`;
  fetch(ERROR_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

async function refreshRelationalMirrorHealth() {
  if (!isDbReady()) return;
  const wasHealthy = relationalMirrorHealth.healthy;
  try {
    const result = await dbCheckRelationalCountParity();
    if (!result) return;
    Object.assign(relationalMirrorHealth, result, { error: '' });
    if (!result.healthy) {
      console.error(`Relational mirror count drift: ${result.mismatchCount}/${result.workspaceCount} workspaces mismatched.`);
      if (wasHealthy !== false) {
        reportServerError(503, { method: 'MONITOR', url: '/relational-parity' }, new Error('Relational mirror count drift detected'));
      }
    }
  } catch (error) {
    relationalMirrorHealth.healthy = false;
    relationalMirrorHealth.checkedAt = new Date().toISOString();
    relationalMirrorHealth.error = 'Parity check unavailable';
    console.error('Relational mirror health check failed:', error.message);
  }
}

function startRelationalMirrorMonitor(startupPromise) {
  startupPromise.then(() => refreshRelationalMirrorHealth()).catch(() => {});
  const timer = setInterval(refreshRelationalMirrorHealth, 5 * 60 * 1000);
  timer.unref?.();
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

// ── Server ──────────────────────────────────────────────────────────────────

async function startServer() {
  const startupPromise = initializeData();
  startRelationalMirrorMonitor(startupPromise);
  startOperationalCleanup(startupPromise);

  const server = createServer(async (req, res) => {
    const startedAt = performance.now();
    res.bdAcceptsGzip = acceptsGzip(req);
    // CORS: only reflect known origins, and allow credentials so the session
    // cookie works. Same-origin app traffic needs none of this.
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      if (!isHealthRequest(req)) {
        await startupPromise;
      }
      await route(req, res);
    } catch (error) {
      const status = error.status || 500;
      serverStats.errorCount += 1;
      serverStats.lastError = {
        at: new Date().toISOString(),
        method: req.method,
        url: req.url,
        message: error.message || 'Unexpected server error',
      };
      // Never leak internal error text to clients on 5xx; 4xx messages are
      // intentional (validation, not-found) so keep those.
      if (status >= 500) {
        console.error(`  ${status} on ${req.method} ${req.url}:`, error.message);
        reportServerError(status, req, error);
        sendJson(res, status, { error: 'Something went wrong on our end. Please try again.' });
      } else {
        sendJson(res, status, { error: error.message || 'Request failed' });
      }
    } finally {
      const elapsedMs = Math.round(performance.now() - startedAt);
      recordRequestMetric(req, res, elapsedMs);
      console.log(`${req.method} ${req.url} ${res.statusCode || 200} ${elapsedMs}ms`);
    }
  });

  server.listen(port, host, () => {
    console.log(`BD Engine Cloud running at http://${host}:${port}`);
    startPeriodicPipelineRunner();
  });

  // Graceful shutdown. Order matters: wait for in-flight requests to finish
  // BEFORE flushing, or a mutation completing after the flush re-queues a
  // debounced save that never fires. Re-entrancy guard so a second signal
  // can't double-close the pool or exit mid-flush.
  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n  Received ${signal}, shutting down...`);
      try {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 8000);
          server.close(() => { clearTimeout(timer); resolve(); });
          server.closeIdleConnections?.();
        });
        const flushed = await store.flushPendingSaves();
        if (flushed) console.log(`  Flushed ${flushed} pending tenant save(s) before shutdown`);
      } catch (err) {
        console.error('  Shutdown flush error:', err.message);
      }
      try {
        await closeDb();
      } catch (err) {
        console.error('  DB close error:', err.message);
      }
      process.exit(0);
    });
  }
}

function startPeriodicPipelineRunner() {
  const interval = 24 * 60 * 60 * 1000; // 24 hours
  console.log('[Scheduler] Starting 24-hour periodic pipeline runner...');
  
  setInterval(() => {
    console.log('[Scheduler] Running scheduled pipelines for all tenants...');
    const tenants = store.getAllTenants?.() || [];
    tenants.forEach(tenant => {
      try {
        console.log(`[Scheduler] Auto-starting pipeline for ${tenant.id}`);
        store.startRevenuePipeline(tenant.id, { plan: getPlan(tenant.plan) });
      } catch (err) {
        console.error(`[Scheduler] Failed to auto-start pipeline for ${tenant.id}:`, err.message);
      }
    });
  }, interval);
}

async function initializeData() {
  try {
    const dbConnected = await initDb();
    if (dbConnected) {
      await loadUsersFromDb();
      await loadSessionsFromDb();
      await store.loadFromDb();
    }
  } catch (error) {
    console.error('Startup data initialization failed:', error.message || error);
  }
}

function isHealthRequest(req) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
    return url.pathname === '/health' || url.pathname === '/api/health';
  } catch {
    return false;
  }
}

function canViewSiteAnalytics(user) {
  const isProduction = (process.env.BD_CLOUD_ENV || process.env.NODE_ENV || 'development') === 'production';
  if (!isProduction && configuredAnalyticsAdminEmails.length === 0) {
    return (process.env.BD_CLOUD_ENV || process.env.NODE_ENV || 'development') !== 'production';
  }
  return analyticsAdminEmails.has(String(user?.email || '').trim().toLowerCase());
}

function isInternalOwner(user) {
  return internalOwnerEmails.has(String(user?.email || '').trim().toLowerCase());
}

function getEffectivePlanId(tenant, user) {
  return isInternalOwner(user) ? ownerPlanId : (tenant?.plan || 'trial');
}

function ensureInternalOwnerEntitlement(tenant, user) {
  if (!tenant || !isInternalOwner(user)) return tenant;
  if (tenant.plan === ownerPlanId && tenant.status === 'active') return tenant;
  const updated = updateTenant(tenant.id, {
    plan: ownerPlanId,
    status: 'active',
  }) || { ...tenant, plan: ownerPlanId, status: 'active' };
  console.log(`Owner entitlement applied: ${user.email} -> ${tenant.id}`);
  return updated;
}

function getEffectiveTenant(tenant, user) {
  if (!tenant) return tenant;
  if (!isInternalOwner(user)) return tenant;
  return {
    ...tenant,
    plan: ownerPlanId,
    status: 'active',
    effectivePlan: ownerPlanId,
  };
}

function getBillingTenantPayload(tenant, user) {
  const effectiveTenant = getEffectiveTenant(tenant, user);
  return {
    id: effectiveTenant?.id || '',
    name: effectiveTenant?.name || '',
    plan: effectiveTenant?.plan || 'trial',
    status: effectiveTenant?.status || '',
  };
}

function getPublicPlanPayload(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    displayName: plan.displayName,
    price: plan.price,
    interval: plan.interval,
    trialDays: plan.trialDays,
    limits: plan.limits,
    features: plan.features,
  };
}

function getEffectiveMembershipRole(membership, user) {
  return isInternalOwner(user) ? 'owner' : (membership?.role || 'member');
}

function withEffectiveTenantRoles(tenants, user) {
  if (!isInternalOwner(user)) return tenants;
  return (tenants || []).map((tenant) => ({ ...getEffectiveTenant(tenant, user), role: 'owner' }));
}

function getRequestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || `127.0.0.1:${port}`;
  const hostValue = Array.isArray(hostHeader) ? hostHeader[0] : String(hostHeader).split(',')[0].trim();
  let protoValue = Array.isArray(proto) ? proto[0] : String(proto).split(',')[0].trim();
  if (protoValue === 'http' && !/^(localhost|127\.0\.0\.1)(:|$)/i.test(hostValue)) {
    protoValue = 'https';
  }
  return `${protoValue || 'https'}://${hostValue}`;
}

function shouldExposeDevResetToken() {
  return process.env.BD_EXPOSE_RESET_TOKEN === 'true'
    || process.env.NODE_ENV === 'test'
    || (!process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== 'production');
}

const billingExemptApiPaths = new Set([
  '/api/auth/me',
  '/api/auth/logout',
  '/api/billing',
  '/api/billing/checkout',
  '/api/billing/portal',
  '/api/plans',
  '/api/session',
]);

function isBillingExemptPath(pathname) {
  return billingExemptApiPaths.has(pathname);
}

function isTenantBillingBlocked(tenant, user = null) {
  if (!tenant) return false;
  if (isInternalOwner(user)) return false;
  if (tenant.plan === 'trial') return isTrialExpired(tenant);
  const status = String(tenant.status || '').toLowerCase();
  if (status === 'past_due') return getBillingAccessStatus(tenant).accessBlocked;
  return !['active', 'trialing'].includes(status);
}

function sendBillingRequired(res, tenant) {
  const status = String(tenant?.status || '').toLowerCase();
  const billingAccess = getBillingAccessStatus(tenant);
  return sendJson(res, 402, {
    error: status === 'past_due'
      ? 'The payment recovery period has ended. Update your payment method to restore workspace access.'
      : status === 'canceled' || status === 'unpaid'
      ? 'Billing needs attention before this workspace can continue.'
      : 'Your trial has ended. Choose a plan to continue using BD Engine.',
    code: 'billing_required',
    billingRequired: true,
    plan: tenant?.plan || 'trial',
    status: tenant?.status || '',
    billingGraceEndsAt: billingAccess.graceEndsAt,
    trialDaysRemaining: tenant ? getTrialDaysRemaining(tenant) : null,
  });
}

function getReferralSummary(tenant, origin = '') {
  const code = normalizeReferralCode(tenant?.referralCode || tenant?.referral_code || '');
  return {
    code,
    link: code && origin ? `${origin}/?ref=${encodeURIComponent(code)}` : '',
    creditAmountCents: referralCreditAmountCents,
    referredByTenantId: tenant?.referredByTenantId || tenant?.referred_by_tenant_id || '',
    creditedAt: tenant?.referralCreditedAt || tenant?.referral_credited_at || '',
  };
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// ── Routing ─────────────────────────────────────────────────────────────────

async function route(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const pathname = url.pathname;

  // Health checks stay public for Railway. Detailed status is authenticated
  // below because it can expose runtime metrics and recent error context.
  if (pathname === '/health' || pathname === '/api/health') {
    return sendJson(res, 200, getHealthPayload(false));
  }

  // ── Auth endpoints (public, rate-limited) ─────────────────────────────────

  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    if (rateLimitExceeded(`signup:${clientIp(req)}`, SIGNUP_MAX, SIGNUP_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many sign-ups from this network. Please wait a few minutes and try again.' });
    }
    return handleSignup(req, res);
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (rateLimitExceeded(`login:${clientIp(req)}`, LOGIN_MAX, LOGIN_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many login attempts. Please wait a few minutes and try again.' });
    }
    return handleLogin(req, res);
  }

  if (pathname === '/api/auth/password-reset/request' && req.method === 'POST') {
    if (rateLimitExceeded(`password-reset:${clientIp(req)}`, PASSWORD_RESET_MAX, PASSWORD_RESET_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many reset requests from this network. Please wait a few minutes and try again.' });
    }
    return handlePasswordResetRequest(req, res);
  }

  if (pathname === '/api/auth/password-reset/confirm' && req.method === 'POST') {
    if (rateLimitExceeded(`password-reset-confirm:${clientIp(req)}`, PASSWORD_RESET_MAX * 2, PASSWORD_RESET_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many reset attempts. Please wait a few minutes and try again.' });
    }
    return handlePasswordResetConfirm(req, res);
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    return handleLogout(req, res);
  }

  if (pathname === '/api/plans') {
    return sendJson(res, 200, {
      plans: Object.values(PLANS)
        // Recruiting/BD only (#13): don't surface the frozen jobseeker plan.
        .filter((p) => p.id !== ownerPlanId && p.id !== 'jobseeker')
        .map((p) => ({
          id: p.id,
          name: p.name,
          displayName: p.displayName,
          price: p.price,
          interval: p.interval,
          limits: p.limits,
          features: p.features,
        })),
    });
  }

  if (pathname === '/api/demo/start' && req.method === 'POST') {
    if (rateLimitExceeded(`demo:${clientIp(req)}`, DEMO_MAX, DEMO_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many demo starts from this network. Please wait a few minutes and try again.' });
    }
    return handleStartDemo(req, res);
  }

  // ── Session check ─────────────────────────────────────────────────────────

  if (pathname === '/api/auth/me') {
    return handleMe(req, res);
  }

  if (pathname === '/sw.js') {
    return sendJavaScript(res, `
self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('bd-engine-')).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
`);
  }

  // Static file serving — check cloud public dir first, then app dir
  if (!pathname.startsWith('/api/')) {
    return serveStaticOrSPA(pathname, req, res);
  }

  // Stripe Webhook (needs raw body, no auth)
  if (pathname === '/api/billing/webhook' && req.method === 'POST') {
    const signature = req.headers['stripe-signature'];
    const payload = await readBody(req);
    try {
      const event = handleWebhookEvent(payload, signature);
      const result = await handleStripeBillingEvent(event);
      console.log('Received Stripe Event:', event.type, result);
      return sendJson(res, 200, { received: true, ...result });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/analytics/visit' && req.method === 'POST') {
    return handleAnalyticsVisit(req, res);
  }

  // ── All /api/ routes below require authentication ─────────────────────────

  const sessionData = extractSession(req);
  if (!sessionData) {
    return sendJson(res, 401, { error: 'Authentication required. Please log in.' });
  }

  const user = findUserById(sessionData.userId);
  if (!user) {
    clearSessionCookie(res);
    return sendJson(res, 401, { error: 'Session expired. Please log in again.' });
  }

  let tenantId = sessionData.tenantId;
  let tenant = findTenantById(tenantId);
  let membership = tenant ? getMembership(tenantId, user.id) : null;

  if (!tenant || !membership) {
    const repair = ensureTenantForUser(user);
    if (repair.error || !repair.tenant) {
      return sendJson(res, 404, { error: 'Workspace not found.' });
    }
    tenant = repair.tenant;
    tenantId = tenant.id;
    membership = getMembership(tenantId, user.id);
    tenant = ensureInternalOwnerEntitlement(tenant, user);
    store.ensureTenant(tenant, user);
    await persistUserWorkspace(user, tenant);
    const { cookie } = createSession(user.id, tenantId, {
      demo: Boolean(sessionData.demo),
      readOnly: Boolean(sessionData.readOnly),
    });
    setSessionCookie(res, cookie);
  }

  if (!membership) {
    return sendJson(res, 403, { error: 'You are not a member of this workspace.' });
  }

  // Build session object compatible with existing frontend
  tenant = ensureInternalOwnerEntitlement(tenant, user);
  const session = {
    tenant: getEffectiveTenant(tenant, user),
    user: safeUser(user),
    membership: { role: getEffectiveMembershipRole(membership, user) },
    demo: isReadOnlyDemoSession(sessionData, tenant),
    readOnly: isReadOnlyDemoSession(sessionData, tenant),
  };
  store.ensureTenant(tenant, session.user);

  if (isReadOnlyDemoSession(sessionData, tenant) && !canDemoSessionUsePath(pathname, req.method)) {
    return sendDemoReadOnly(res);
  }

  if (isTenantBillingBlocked(tenant, user) && !isBillingExemptPath(pathname)) {
    return sendBillingRequired(res, tenant);
  }

  // ── Tenant management ─────────────────────────────────────────────────────

  if (pathname === '/api/tenants' && req.method === 'POST') {
    return handleCreateTenant(req, res, user);
  }

  if (pathname === '/api/tenants') {
    const userTenants = findTenantsForUser(user.id);
    return sendJson(res, 200, { tenants: withEffectiveTenantRoles(userTenants, user) });
  }

  // ── Billing ───────────────────────────────────────────────────────────────

  if (pathname === '/api/billing') {
    const effectivePlanId = getEffectivePlanId(tenant, user);
    const plan = getPlan(effectivePlanId);
    const trialDaysRemaining = effectivePlanId === ownerPlanId ? null : getTrialDaysRemaining(tenant);
    const usage = getUsageSummary(tenantId, effectivePlanId, await store.getUsageCounts(tenantId));
    const origin = getRequestOrigin(req);
    const billingAccess = getBillingAccessStatus(tenant);
    return sendJson(res, 200, {
      plan,
      trialDaysRemaining,
      usage,
      stripe: getStripeConfigStatus(),
      canManageBilling: Boolean(tenant.stripeCustomerId || tenant.stripe_customer_id),
      tenant: getBillingTenantPayload(tenant, user),
      billingAccess,
      referral: getReferralSummary(tenant, origin),
    });
  }

  if (pathname === '/api/billing/checkout' && req.method === 'POST') {
    const body = await readJson(req);
    const planId = body.planId;
    try {
      const origin = getRequestOrigin(req);
      const successUrl = `${origin}/app/#/admin`;
      const cancelUrl = `${origin}/app/#/admin`;
      const customerId = tenant.stripeCustomerId || tenant.stripe_customer_id || '';
      const subscriptionId = tenant.stripeSubscriptionId || tenant.stripe_subscription_id || '';
      if (customerId && subscriptionId) {
        const portalUrl = await createBillingPortalSession(customerId, `${origin}/app/#/admin`);
        return sendJson(res, 200, {
          url: portalUrl,
          mode: 'portal',
          message: 'This workspace already has a Stripe subscription. Manage plan changes in the billing portal.',
        });
      }
      const sessionUrl = await createCheckoutSession(tenantId, user.email, planId, successUrl, cancelUrl, {
        referredByTenantId: tenant.referredByTenantId || tenant.referred_by_tenant_id || '',
        referralCode: tenant.referralCode || tenant.referral_code || '',
      }, {
        customerId,
      });
      return sendJson(res, 200, { url: sessionUrl, mode: 'checkout' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/billing/portal' && req.method === 'POST') {
    const customerId = tenant.stripeCustomerId || tenant.stripe_customer_id || '';
    if (!customerId) {
      return sendJson(res, 400, { error: 'No Stripe customer is attached to this workspace yet. Complete checkout first.' });
    }
    try {
      const portalUrl = await createBillingPortalSession(customerId, `${getRequestOrigin(req)}/app/#/admin`);
      return sendJson(res, 200, { url: portalUrl });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // ── Existing app API routes (tenant-scoped) ───────────────────────────────

  if (pathname === '/api/session') {
    return sendJson(res, 200, session);
  }

  if (pathname === '/api/status') {
    return sendJson(res, 200, getHealthPayload(true));
  }

  if (pathname === '/api/setup/status') {
    return sendJson(res, 200, await store.getSetupStatus(tenantId));
  }

  if (pathname === '/api/workspace/load-hint') {
    return sendJson(res, 200, await store.getWorkspaceLoadHint(tenantId));
  }

  if (pathname === '/api/ingestion/diagnostics') {
    return sendJson(res, 200, await store.getIngestionDiagnostics(tenantId));
  }

  if (pathname === '/api/runtime/status') {
    return sendJson(res, 200, store.getRuntimeStatus());
  }

  if (pathname === '/api/bootstrap') {
    return sendJson(res, 200, await store.getBootstrap(tenantId, {
      includeFilters: isTruthy(url.searchParams.get('includeFilters')),
      session,
    }));
  }

  if (pathname === '/api/admin/bootstrap') {
    const bootstrapData = await store.getBootstrap(tenantId, { includeFilters: true, session });
    const canViewAnalytics = canViewSiteAnalytics(user);
    const effectivePlanId = getEffectivePlanId(tenant, user);
    let analytics = null;
    if (canViewAnalytics) {
      const analyticsStartedAt = performance.now();
      analytics = await dbGetAnalyticsSummary(30);
      const analyticsElapsedMs = Math.round(performance.now() - analyticsStartedAt);
      if (analyticsElapsedMs > 250) {
        console.warn(`Slow analytics summary: saas/src/db.js dbGetAnalyticsSummary ${analyticsElapsedMs}ms`);
      }
    }
    const origin = getRequestOrigin(req);
    const billingAccess = getBillingAccessStatus(tenant);
    return sendJson(res, 200, {
      bootstrap: bootstrapData,
      runtime: store.getRuntimeStatus(),
      targetScoreRollout: store.getTargetScoreRollout(tenantId),
      resolverReport: store.getResolverReport(tenantId),
      enrichmentReport: store.getEnrichmentReport(tenantId),
      unresolvedQueue: store.getResolverQueue(tenantId, 'unresolved'),
      mediumQueue: store.getResolverQueue(tenantId, 'medium'),
      enrichmentQueue: store.getEnrichmentQueue(tenantId, Object.fromEntries(url.searchParams)),
      configs: await store.findConfigs(tenantId, Object.fromEntries(url.searchParams)),
      analytics,
      canViewSiteAnalytics: canViewAnalytics,
      billing: {
        plan: getPlan(effectivePlanId),
        trialDaysRemaining: effectivePlanId === ownerPlanId ? null : getTrialDaysRemaining(tenant),
        usage: getUsageSummary(tenantId, effectivePlanId, await store.getUsageCounts(tenantId)),
        stripe: getStripeConfigStatus(),
        canManageBilling: Boolean(tenant.stripeCustomerId || tenant.stripe_customer_id),
        tenant: getBillingTenantPayload(tenant, user),
        billingAccess,
        referral: getReferralSummary(tenant, origin),
      },
    });
  }

  if (pathname === '/api/privacy/export' && req.method === 'GET') {
    const payload = await store.exportTenantData(tenantId, {
      tenant: getEffectiveTenant(tenant, user),
      user: safeUser(user),
      membership: session.membership,
    });
    const slug = String(tenant.slug || tenant.name || tenant.id || 'workspace')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace';
    return sendDownloadJson(res, 200, payload, `bd-engine-${slug}-export.json`);
  }

  if (pathname === '/api/privacy/delete-workspace' && req.method === 'POST') {
    const body = await readJson(req);
    const expected = `DELETE ${tenant.name}`;
    if (String(body.confirm || '').trim() !== expected) {
      return sendJson(res, 400, {
        error: `Type "${expected}" to delete this workspace's imported data.`,
        code: 'confirmation_required',
      });
    }
    const result = await store.clearTenantWorkspaceData(tenantId);
    return sendJson(res, 200, {
      ...result,
      message: 'Workspace data deleted. Your account and workspace shell remain available.',
    });
  }

  if (pathname === '/api/owners') {
    const bootstrapData = await store.getBootstrap(tenantId, { session });
    return sendJson(res, 200, { owners: bootstrapData.ownerRoster });
  }

  if (pathname === '/api/dashboard') {
    return sendJson(res, 200, await store.getDashboard(tenantId));
  }

  if (pathname === '/api/dashboard/extended') {
    return sendJson(res, 200, await store.getDashboardExtended(tenantId));
  }

  if (pathname === '/api/accounts') {
    if (req.method === 'POST') {
      const item = await store.addAccount(tenantId, await readJson(req));
      return sendJson(res, 201, item);
    }
    return sendJson(res, 200, await store.findAccounts(tenantId, Object.fromEntries(url.searchParams)));
  }

  const accountOutreachMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/generate-outreach$/);
  if (accountOutreachMatch && req.method === 'POST') {
    const payload = await readJson(req);
    const draft = await store.createOutreachDraft(tenantId, accountOutreachMatch[1], payload);
    if (!draft) return sendJson(res, 404, { error: 'Account not found' });
    return sendJson(res, 201, draft);
  }

  const hiringVelocityMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/hiring-velocity$/);
  if (hiringVelocityMatch && req.method === 'GET') {
    const velocity = await store.getHiringVelocity(tenantId, hiringVelocityMatch[1]);
    if (!velocity) return sendJson(res, 404, { error: 'Account not found' });
    return sendJson(res, 200, velocity);
  }

  const accountMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (accountMatch) {
    if (req.method === 'GET') {
      const detail = await store.getAccountDetail(tenantId, accountMatch[1]);
      if (!detail) return sendJson(res, 404, { error: 'Account not found' });
      return sendJson(res, 200, detail);
    }
    if (req.method === 'PATCH') {
      const account = await store.patchAccount(tenantId, accountMatch[1], await readJson(req));
      if (!account) return sendJson(res, 404, { error: 'Account not found' });
      return sendJson(res, 200, account);
    }
  }

  if (pathname === '/api/contacts') {
    if (req.method === 'POST') {
      const item = await store.addContact(tenantId, await readJson(req));
      return sendJson(res, 201, item);
    }
    return sendJson(res, 200, await store.findContacts(tenantId, Object.fromEntries(url.searchParams)));
  }

  const contactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
  if (contactMatch && req.method === 'PATCH') {
    const contact = await store.patchContact(tenantId, contactMatch[1], await readJson(req));
    if (!contact) return sendJson(res, 404, { error: 'Contact not found' });
    return sendJson(res, 200, contact);
  }

  if (pathname === '/api/jobs') {
    return sendJson(res, 200, await store.findJobs(tenantId, Object.fromEntries(url.searchParams)));
  }

  if (pathname === '/api/configs') {
    if (req.method === 'GET') {
      return sendJson(res, 200, await store.findConfigs(tenantId, Object.fromEntries(url.searchParams)));
    }
    if (req.method === 'POST') {
      return sendJson(res, 201, store.addConfig(tenantId, await readJson(req)));
    }
  }

  const configMatch = pathname.match(/^\/api\/configs\/([^/]+)$/);
  if (configMatch && req.method === 'PATCH') {
    const config = store.patchConfig(tenantId, configMatch[1], await readJson(req));
    if (!config) return sendJson(res, 404, { error: 'Config not found' });
    return sendJson(res, 200, config);
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    return sendJson(res, 200, await store.patchSettings(tenantId, await readJson(req)));
  }

  if (pathname === '/api/workspace/preferences') {
    if (req.method === 'GET') {
      return sendJson(res, 200, await store.getWorkspacePreferences(tenantId));
    }
    if (req.method === 'PATCH') {
      return sendJson(res, 200, await store.patchWorkspacePreferences(tenantId, await readJson(req)));
    }
  }

  if (pathname === '/api/setup/complete' && req.method === 'POST') {
    const payload = await readFormOrJson(req);
    const fields = payload.fields || payload;
    const csvText = payload.files?.connectionsCsv?.content || fields.csvContent || '';
    const plan = getPlan(getEffectivePlanId(tenant, user));

    if (csvText) {
      const accepted = store.startLinkedInCsvImport(tenantId, csvText, { plan });
      return sendJson(res, 202, {
        ok: true,
        setupComplete: false,
        status: await store.getSetupStatus(tenantId),
        ...accepted,
      });
    }

    store.completeSetup(tenantId, fields);
    return sendJson(res, 200, {
      ok: true,
      setupComplete: true,
      status: await store.getSetupStatus(tenantId),
    });
  }

  if (pathname === '/api/setup/sample-data' && req.method === 'POST') {
    const body = await readJson(req);
    const result = await store.loadSampleWorkspace(tenantId, {
      persona: body.persona,
      setup: {
        workspaceName: body.workspaceName,
        userName: body.userName,
        userEmail: body.userEmail,
        owners: Array.isArray(body.owners) ? body.owners : [],
      },
    });
    if (result.error) return sendJson(res, 409, result);
    return sendJson(res, 201, {
      ...result,
      setupComplete: true,
      status: await store.getSetupStatus(tenantId),
    });
  }

  if (pathname === '/api/activity') {
    if (req.method === 'GET') {
      return sendJson(res, 200, store.getActivity(tenantId, Object.fromEntries(url.searchParams)));
    }
    if (req.method === 'POST') {
      return sendJson(res, 201, await store.addActivity(tenantId, user.id, await readJson(req)));
    }
  }

  if (pathname.startsWith('/api/tasks')) {
    if (pathname === '/api/tasks' && req.method === 'GET') {
      return sendJson(res, 200, await store.findTasks(tenantId, Object.fromEntries(url.searchParams)));
    }
    if (pathname === '/api/tasks' && req.method === 'POST') {
      return sendJson(res, 201, await store.createTask(tenantId, await readJson(req)));
    }
    const match = pathname.match(/^\/api\/tasks\/([^/]+)\/complete$/);
    if (match && req.method === 'POST') {
      const task = await store.completeTask(tenantId, match[1]);
      if (!task) return sendJson(res, 404, { error: 'Task not found' });
      return sendJson(res, 200, task);
    }
  }

  if (pathname === '/api/search') {
    return sendJson(res, 200, store.search(tenantId, Object.fromEntries(url.searchParams)));
  }

  if (pathname === '/api/enrichment/queue') {
    return sendJson(res, 200, store.getEnrichmentQueue(tenantId, Object.fromEntries(url.searchParams)));
  }

  const accountJobActionMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/(quick-enrich|resolve-now|deep-verify|quick-update)$/);
  if (accountJobActionMatch) {
    const [, actionAccountId, action] = accountJobActionMatch;
    if (action === 'quick-enrich' && req.method === 'POST') {
      const result = await store.accountQuickEnrich(tenantId, actionAccountId);
      if (!result) return sendJson(res, 404, { error: 'Account not found' });
      return sendJson(res, 200, result);
    }
    if (action === 'resolve-now' && req.method === 'POST') {
      return sendJson(res, 202, store.startAccountResolution(tenantId, { accountId: actionAccountId, deep: false, label: 'ATS resolution' }));
    }
    if (action === 'deep-verify' && req.method === 'POST') {
      return sendJson(res, 202, store.startAccountResolution(tenantId, { accountId: actionAccountId, deep: true, label: 'Deep verification' }));
    }
    if (action === 'quick-update' && (req.method === 'PATCH' || req.method === 'POST')) {
      const item = await store.patchAccount(tenantId, actionAccountId, await readJson(req));
      if (!item) return sendJson(res, 404, { error: 'Account not found' });
      return sendJson(res, 200, item);
    }
  }

  const configActionMatch = pathname.match(/^\/api\/configs\/([^/]+)\/(resolve|review)$/);
  if (configActionMatch && req.method === 'POST') {
    if (configActionMatch[2] === 'review') {
      const config = store.reviewConfig(tenantId, configActionMatch[1], await readJson(req));
      if (!config) return sendJson(res, 404, { error: 'Config not found' });
      return sendJson(res, 200, config);
    }
    return sendJson(res, 202, store.startAccountResolution(tenantId, { configId: configActionMatch[1], deep: false, label: 'Config resolution' }));
  }

  if (pathname === '/api/configs/sync' && req.method === 'POST') {
    return sendJson(res, 202, store.startConfigsSync(tenantId));
  }

  if (pathname === '/api/admin/target-score-rollout' && req.method === 'POST') {
    return sendJson(res, 202, store.startTargetScoreRollout(tenantId, await readJson(req)));
  }

  // ── LinkedIn CSV import (real) ─────────────────────────────────────────
  if (pathname === '/api/import/connections-csv/preview' && req.method === 'POST') {
    const payload = await readFormOrJson(req);
    const csvText = payload.files?.connectionsCsv?.content || payload.fields?.csvContent || payload.csvContent || '';
    const plan = getPlan(getEffectivePlanId(tenant, user));
    const result = await store.importLinkedInCSV(tenantId, csvText, {
      dryRun: true,
      plan,
    });
    if (result.error) return sendJson(res, 400, result);
    return sendJson(res, 200, result);
  }

  if ((pathname === '/api/import/linkedin-csv' || pathname === '/api/import/connections-csv') && req.method === 'POST') {
    const payload = await readFormOrJson(req);
    const fields = payload.fields || payload;
    const csvText = payload.files?.connectionsCsv?.content || fields.csvContent || payload.text || '';

    const plan = getPlan(getEffectivePlanId(tenant, user));
    const dryRun = isTruthy(fields.dryRun);
    if (!dryRun) {
      return sendJson(res, 202, store.startLinkedInCsvImport(tenantId, csvText, { plan }));
    }

    const result = await store.importLinkedInCSV(tenantId, csvText, {
      dryRun,
      plan,
    });
    if (result.error) return sendJson(res, 400, result);
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/admin/run-workflow' && req.method === 'POST') {
    const plan = getPlan(getEffectivePlanId(tenant, user));
    return sendJson(res, 202, store.startLaunchWorkflow(tenantId, { plan }));
  }

  if (pathname === '/api/discovery/run' && req.method === 'POST') {
    const plan = getPlan(getEffectivePlanId(tenant, user));
    const body = await readJson(req);
    return sendJson(res, 202, store.startAtsDiscovery(tenantId, { ...body, plan }));
  }

  if (pathname === '/api/import/jobs' && req.method === 'POST') {
    const plan = getPlan(getEffectivePlanId(tenant, user));
    const body = await readJson(req);
    return sendJson(res, 202, store.startLiveJobImport(tenantId, { ...body, plan }));
  }

  if (pathname === '/api/admin/pipeline/start' && req.method === 'POST') {
    const plan = getPlan(getEffectivePlanId(tenant, user));
    const job = store.startRevenuePipeline(tenantId, { plan });
    return sendJson(res, 202, job);
  }

  const pipelineStatusMatch = pathname.match(/^\/api\/admin\/pipeline\/status\/([^/]+)$/);
  if (pipelineStatusMatch && req.method === 'GET') {
    const job = await store.getBackgroundJob(tenantId, pipelineStatusMatch[1]);
    return sendJson(res, 200, job);
  }

  // "Run Full Engine" maps to the real launch workflow in the cloud app.
  if (pathname === '/api/google-sheets/run-engine' && req.method === 'POST') {
    const plan = getPlan(getEffectivePlanId(tenant, user));
    return sendJson(res, 202, store.startLaunchWorkflow(tenantId, { plan }));
  }

  const rerunResolutionMatch = pathname.match(/^\/api\/enrichment\/([^/]+)\/rerun-resolution$/);
  if (rerunResolutionMatch && req.method === 'POST') {
    const body = await readJson(req);
    const deep = isTruthy(body.deepVerify);
    return sendJson(res, 202, store.startAccountResolution(tenantId, {
      accountId: rerunResolutionMatch[1],
      deep,
      label: deep ? 'Deep ATS resolution' : 'ATS resolution',
    }));
  }

  if (pathname.startsWith('/api/google-sheets/')) {
    return sendJson(res, 501, { error: 'Google Sheets sync is part of the desktop edition and is not available in the cloud app.' });
  }

  // Anything else under these prefixes is not implemented — say so honestly
  // instead of fabricating a completed job.
  if (pathname.startsWith('/api/import/') || pathname.startsWith('/api/enrichment/') || pathname.startsWith('/api/discovery/')) {
    return sendJson(res, 501, { error: 'This action is not available in the cloud app yet.' });
  }

  const backgroundJobMatch = pathname.match(/^\/api\/background-jobs\/([^/]+)$/);
  if (backgroundJobMatch && req.method === 'GET') {
    return sendJson(res, 200, await store.getBackgroundJob(tenantId, backgroundJobMatch[1]));
  }

  const draftMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/outreach-draft$/);
  if (draftMatch && req.method === 'POST') {
    const draft = await store.createContactOutreachDraft(tenantId, draftMatch[1]);
    if (!draft) return sendJson(res, 404, { error: 'Contact not found' });
    return sendJson(res, 201, draft);
  }

  const logMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/log-outreach$/);
  if (logMatch && req.method === 'POST') {
    const payload = await readJson(req);
    const result = await store.addActivity(tenantId, user.id, {
      ...payload,
      contactId: logMatch[1],
    });
    if (!result) return sendJson(res, 404, { error: 'Contact not found' });
    return sendJson(res, 201, result);
  }

  return sendJson(res, 404, { error: 'Not found' });
}

async function handleAnalyticsVisit(req, res) {
  const body = await readJson(req);
  const sessionData = extractSession(req);
  const startedAt = performance.now();
  const result = await dbRecordAnalyticsVisit({
    visitorId: body.visitorId,
    eventType: body.eventType || 'pageview',
    path: body.path || '/',
    referrer: body.referrer || '',
    source: body.source || '',
    tenantId: sessionData?.tenantId || '',
    userId: sessionData?.userId || '',
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (elapsedMs > 150) {
    console.warn(`Slow analytics write: saas/src/db.js dbRecordAnalyticsVisit ${elapsedMs}ms`);
  }
  return sendJson(res, result.recorded ? 202 : 400, result);
}

async function handleStripeBillingEvent(event) {
  const object = event?.data?.object || {};
  if (event.type === 'checkout.session.completed') {
    const tenantId = object.client_reference_id || object.metadata?.tenantId || '';
    const planId = object.metadata?.planId || '';
    if (!tenantId || !planId) return { updated: false, reason: 'missing checkout metadata' };
    const existingTenant = findTenantById(tenantId);
    const resolvedPlanId = existingTenant?.plan === ownerPlanId ? ownerPlanId : planId;
    const tenant = await updateTenantPersisted(tenantId, {
      plan: resolvedPlanId,
      status: 'active',
      stripeCustomerId: getStripeId(object.customer),
      stripeSubscriptionId: getStripeId(object.subscription),
      billingGraceEndsAt: '',
      billingLastPaymentFailedAt: '',
    });
    const referral = await maybeGrantReferralCredit(tenant, object);
    const pendingReferralCredits = tenant ? await grantPendingReferralCreditsForReferrer(tenant) : [];
    return { updated: Boolean(tenant), tenantId, planId: resolvedPlanId, referral, pendingReferralCredits };
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const customerId = getStripeId(object.customer);
    const tenantId = object.metadata?.tenantId || findTenantByStripeCustomerId(customerId)?.id || '';
    const priceId = object.items?.data?.[0]?.price?.id || '';
    const planId = object.metadata?.planId || getPlanByStripePriceId(priceId)?.id || '';
    if (!tenantId) return { updated: false, reason: 'workspace not found for subscription' };
    const existingTenant = findTenantById(tenantId);
    const updates = {
      status: existingTenant?.plan === ownerPlanId ? 'active' : (object.status || 'active'),
      stripeCustomerId: customerId,
      stripeSubscriptionId: object.id || '',
    };
    if (updates.status === 'past_due') {
      updates.billingGraceEndsAt = existingTenant?.billingGraceEndsAt || createBillingGraceDeadline();
      updates.billingLastPaymentFailedAt = existingTenant?.billingLastPaymentFailedAt || new Date().toISOString();
    } else if (['active', 'trialing'].includes(updates.status)) {
      updates.billingGraceEndsAt = '';
      updates.billingLastPaymentFailedAt = '';
    }
    if (existingTenant?.plan === ownerPlanId) {
      updates.plan = ownerPlanId;
    } else if (planId) {
      updates.plan = planId;
    }
    const tenant = await updateTenantPersisted(tenantId, updates);
    return { updated: Boolean(tenant), tenantId, planId: planId || tenant?.plan || '' };
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = getStripeId(object.customer);
    const tenantId = object.metadata?.tenantId || findTenantByStripeCustomerId(customerId)?.id || '';
    if (!tenantId) return { updated: false, reason: 'workspace not found for canceled subscription' };
    const existingTenant = findTenantById(tenantId);
    if (existingTenant?.plan === ownerPlanId) {
      const tenant = await updateTenantPersisted(tenantId, {
        status: 'active',
        plan: ownerPlanId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: object.id || '',
        billingGraceEndsAt: '',
        billingLastPaymentFailedAt: '',
      });
      return { updated: Boolean(tenant), tenantId, status: 'active', planId: ownerPlanId, ownerProtected: true };
    }
    const tenant = await updateTenantPersisted(tenantId, {
      status: 'canceled',
      stripeCustomerId: customerId,
      stripeSubscriptionId: object.id || '',
      billingGraceEndsAt: '',
    });
    return { updated: Boolean(tenant), tenantId, status: 'canceled' };
  }

  if (event.type === 'invoice.payment_failed') {
    const tenant = resolveTenantFromStripeInvoice(object);
    if (!tenant) return { updated: false, reason: 'workspace not found for failed invoice' };
    if (tenant.plan === ownerPlanId) return { updated: false, ownerProtected: true };
    const updated = await updateTenantPersisted(tenant.id, {
      status: 'past_due',
      stripeCustomerId: getStripeId(object.customer) || tenant.stripeCustomerId || tenant.stripe_customer_id || '',
      stripeSubscriptionId: getStripeId(object.subscription) || tenant.stripeSubscriptionId || tenant.stripe_subscription_id || '',
      billingGraceEndsAt: createBillingGraceDeadline(object),
      billingLastPaymentFailedAt: new Date().toISOString(),
    });
    return { updated: Boolean(updated), tenantId: tenant.id, status: 'past_due' };
  }

  if (event.type === 'invoice.payment_succeeded') {
    const tenant = resolveTenantFromStripeInvoice(object);
    if (!tenant) return { updated: false, reason: 'workspace not found for paid invoice' };
    if (tenant.plan === ownerPlanId) return { updated: false, ownerProtected: true };
    const status = tenant.plan === 'trial' ? tenant.status : 'active';
    const updated = await updateTenantPersisted(tenant.id, {
      status,
      stripeCustomerId: getStripeId(object.customer) || tenant.stripeCustomerId || tenant.stripe_customer_id || '',
      stripeSubscriptionId: getStripeId(object.subscription) || tenant.stripeSubscriptionId || tenant.stripe_subscription_id || '',
      billingGraceEndsAt: '',
      billingLastPaymentFailedAt: '',
    });
    return { updated: Boolean(updated), tenantId: tenant.id, status };
  }

  return { updated: false, ignored: true };
}

function resolveTenantFromStripeInvoice(invoice = {}) {
  const customerId = getStripeId(invoice.customer);
  if (customerId) {
    const tenant = findTenantByStripeCustomerId(customerId);
    if (tenant) return tenant;
  }
  const tenantId = invoice.metadata?.tenantId || invoice.subscription_details?.metadata?.tenantId || '';
  return tenantId ? findTenantById(tenantId) : null;
}

async function maybeGrantReferralCredit(referredTenant, stripeObject = {}) {
  if (!referredTenant) return { credited: false, reason: 'referred workspace not found' };
  if (referredTenant.referralCreditedAt || referredTenant.referral_credited_at) {
    return { credited: false, reason: 'already credited' };
  }

  const referrerTenantId = referredTenant.referredByTenantId || referredTenant.referred_by_tenant_id || stripeObject.metadata?.referredByTenantId || '';
  if (!referrerTenantId || referrerTenantId === referredTenant.id) {
    return { credited: false, reason: 'no eligible referrer' };
  }

  const referrerTenant = findTenantById(referrerTenantId);
  if (!referrerTenant) return { credited: false, reason: 'referrer not found' };

  const customerId = referrerTenant.stripeCustomerId || referrerTenant.stripe_customer_id || '';
  if (!customerId) {
    return { credited: false, reason: 'referrer has no Stripe customer yet' };
  }

  try {
    const transaction = await createReferralCredit(customerId, {
      amountCents: referralCreditAmountCents,
      currency: 'usd',
      referredTenantId: referredTenant.id,
      referrerTenantId,
    });
    await updateTenantPersisted(referredTenant.id, {
      referralCreditedAt: new Date().toISOString(),
      referralCreditTransactionId: transaction?.id || '',
    });
    return { credited: true, referrerTenantId, amountCents: referralCreditAmountCents, transactionId: transaction?.id || '' };
  } catch (error) {
    console.error('Referral credit failed:', error.message || error);
    return { credited: false, reason: error.message || 'credit failed' };
  }
}

async function grantPendingReferralCreditsForReferrer(referrerTenant) {
  const customerId = referrerTenant?.stripeCustomerId || referrerTenant?.stripe_customer_id || '';
  if (!referrerTenant?.id || !customerId) return [];
  const paidReferredTenants = findTenantsReferredBy(referrerTenant.id).filter((tenant) => {
    const status = String(tenant.status || '').toLowerCase();
    return !tenant.referralCreditedAt && !tenant.referral_credited_at && tenant.id !== referrerTenant.id && ['active', 'trialing'].includes(status) && tenant.plan !== 'trial';
  });
  const results = [];
  for (const referredTenant of paidReferredTenants) {
    results.push(await maybeGrantReferralCredit(referredTenant));
  }
  return results;
}

function getStripeId(value) {
  if (!value) return '';
  return typeof value === 'string' ? value : value.id || '';
}

// ── Auth handlers ───────────────────────────────────────────────────────────

async function handlePasswordResetRequest(req, res) {
  const { email } = await readJson(req);
  const user = findUserByEmail(email);
  const emailConfigured = isEmailConfigured();
  let resetUrl = '';
  let devToken = '';

  if (user) {
    const { token, tokenHash } = createPasswordResetSecret();
    const record = {
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString(),
      usedAt: '',
      createdAt: new Date().toISOString(),
    };
    passwordResetTokens.set(tokenHash, record);
    await dbSavePasswordResetToken(record);
    resetUrl = `${getRequestOrigin(req)}/?reset=${encodeURIComponent(token)}`;
    if (emailConfigured) {
      try {
        await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });
      } catch (error) {
        console.error('Password reset email failed:', error.message || error);
      }
    }
    if (shouldExposeDevResetToken()) devToken = token;
  }

  return sendJson(res, 202, {
    ok: true,
    message: 'If an account exists for that email, a reset link will be sent shortly.',
    emailConfigured,
    ...(devToken ? { resetToken: devToken, resetUrl } : {}),
  });
}

async function handlePasswordResetConfirm(req, res) {
  const { token, password } = await readJson(req);
  if (!token || !password) {
    return sendJson(res, 400, { error: 'Reset token and new password are required.' });
  }
  if (String(password).length < 6) {
    return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
  }

  const tokenHash = hashPasswordResetToken(token);
  const record = passwordResetTokens.get(tokenHash) || await dbFindPasswordResetToken(tokenHash);
  if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
    return sendJson(res, 400, { error: 'This reset link is invalid or expired.' });
  }

  const result = setUserPassword(record.userId, password);
  if (result.error) {
    return sendJson(res, 400, { error: 'This reset link is invalid or expired.' });
  }

  passwordResetTokens.delete(tokenHash);
  await dbMarkPasswordResetTokenUsed(tokenHash);
  return sendJson(res, 200, { ok: true, message: 'Password reset. You can now log in.' });
}

async function handleStartDemo(req, res) {
  let user = findUserByEmail(PUBLIC_DEMO_EMAIL);
  if (!user) {
    const created = createUser({
      email: PUBLIC_DEMO_EMAIL,
      name: PUBLIC_DEMO_USER_NAME,
      password: `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    if (created.error) {
      user = findUserByEmail(PUBLIC_DEMO_EMAIL);
    } else {
      user = created.user;
    }
  }
  if (!user) return sendJson(res, 500, { error: 'Demo workspace is unavailable right now.' });

  let tenant = findTenantBySlug(PUBLIC_DEMO_SLUG);
  if (!tenant) {
    const createdTenant = createTenant({
      name: PUBLIC_DEMO_WORKSPACE,
      slug: PUBLIC_DEMO_SLUG,
      plan: 'sales',
      ownerUserId: user.id,
      persona: 'bd',
    });
    if (createdTenant.error) return sendJson(res, 500, { error: 'Demo workspace is unavailable right now.' });
    tenant = createdTenant.tenant;
  }

  let membership = getMembership(tenant.id, user.id);
  if (!membership) membership = addMember(tenant.id, user.id, 'viewer');

  tenant = updateTenant(tenant.id, {
    name: PUBLIC_DEMO_WORKSPACE,
    slug: PUBLIC_DEMO_SLUG,
    plan: 'sales',
    status: 'active',
    persona: 'bd',
  }) || { ...tenant, name: PUBLIC_DEMO_WORKSPACE, slug: PUBLIC_DEMO_SLUG, plan: 'sales', status: 'active', persona: 'bd' };

  store.ensureTenant(tenant, user);
  store.setPersona(tenant.id, 'bd');
  await store.loadSampleWorkspace(tenant.id, {
    force: true,
    persona: 'bd',
    setup: {
      workspaceName: PUBLIC_DEMO_WORKSPACE,
      userName: PUBLIC_DEMO_USER_NAME,
      userEmail: PUBLIC_DEMO_EMAIL,
      owners: [{ displayName: PUBLIC_DEMO_USER_NAME, email: PUBLIC_DEMO_EMAIL, role: 'Demo' }],
    },
  });
  await persistUserWorkspace(user, tenant);

  const { cookie } = createSession(user.id, tenant.id, { demo: true, readOnly: true });
  setSessionCookie(res, cookie);
  return sendJson(res, 201, {
    demo: true,
    readOnly: true,
    user: safeUser(user),
    tenant,
    tenants: [{ ...tenant, role: membership.role }],
    plan: getPublicPlanPayload(getPlan('sales')),
    trialDaysRemaining: null,
    persona: 'bd',
    redirect: '/app/#/dashboard',
  });
}

async function handleSignup(req, res) {
  const { email, password, name, workspaceName, persona, referralCode } = await readJson(req);

  if (!email || !password) {
    return sendJson(res, 400, { error: 'Email and password are required.' });
  }
  if (String(password).length < 6) {
    return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
  }

  // Create user
  const userResult = createUser({ email, name, password });
  if (userResult.error) {
    return sendJson(res, 409, { error: userResult.error });
  }

  // Create default workspace. Recruiting/BD is the only supported persona now
  // (#13); the jobseeker path is frozen, so all new workspaces are 'bd'.
  const userPersona = 'bd';
  const workspaceDisplayName = workspaceName || `${userResult.user.name}'s Workspace`;
  const referrerTenant = findTenantByReferralCode(referralCode);
  const tenantResult = ensureTenantForUser(userResult.user, {
    workspaceName: workspaceDisplayName,
    persona: userPersona,
    plan: 'trial',
    referredByTenantId: referrerTenant?.id || '',
  });

  if (tenantResult.error) {
    return sendJson(res, 409, { error: tenantResult.error });
  }

  tenantResult.tenant = ensureInternalOwnerEntitlement(tenantResult.tenant, userResult.user);
  const tenantId = tenantResult.tenant.id;
  // Ensure the store also knows the persona
  store.ensureTenant(tenantResult.tenant, userResult.user);
  store.setPersona(tenantId, userPersona);
  await persistUserWorkspace(userResult.user, tenantResult.tenant);
  const { cookie } = createSession(userResult.user.id, tenantId);
  setSessionCookie(res, cookie);

  return sendJson(res, 201, {
    user: safeUser(userResult.user),
    tenant: getEffectiveTenant(tenantResult.tenant, userResult.user) || null,
    tenants: withEffectiveTenantRoles(tenantResult.tenants || [tenantResult.tenant], userResult.user),
    plan: getPublicPlanPayload(getPlan(getEffectivePlanId(tenantResult.tenant, userResult.user))),
    trialDaysRemaining: getTrialDaysRemaining(tenantResult.tenant),
    persona: userPersona,
    referral: getReferralSummary(tenantResult.tenant, getRequestOrigin(req)),
  });
}

async function handleLogin(req, res) {
  const { email, password } = await readJson(req);

  if (!email || !password) {
    return sendJson(res, 400, { error: 'Email and password are required.' });
  }

  const result = authenticateUser(email, password);
  if (result.error) {
    return sendJson(res, 401, { error: result.error });
  }

  let userTenants = findTenantsForUser(result.user.id);
  let primaryTenant = userTenants[0];
  let workspaceRecovered = false;

  if (!primaryTenant) {
    const repair = ensureTenantForUser(result.user);
    if (repair.error || !repair.tenant) {
      return sendJson(res, 500, { error: 'No workspace found for this account.' });
    }
    primaryTenant = repair.tenant;
    userTenants = repair.tenants || [primaryTenant];
    workspaceRecovered = true;
  }

  primaryTenant = ensureInternalOwnerEntitlement(primaryTenant, result.user);
  userTenants = findTenantsForUser(result.user.id);
  store.ensureTenant(primaryTenant, result.user);
  await persistUserWorkspace(result.user, primaryTenant);
  const persona = store.getPersona(primaryTenant.id);
  const { cookie } = createSession(result.user.id, primaryTenant.id);
  setSessionCookie(res, cookie);

  return sendJson(res, 200, {
    user: safeUser(result.user),
    tenant: getEffectiveTenant(primaryTenant, result.user),
    tenants: withEffectiveTenantRoles(userTenants, result.user),
    plan: getPublicPlanPayload(getPlan(getEffectivePlanId(primaryTenant, result.user))),
    trialDaysRemaining: getEffectivePlanId(primaryTenant, result.user) !== ownerPlanId ? getTrialDaysRemaining(primaryTenant) : null,
    referral: getReferralSummary(primaryTenant, getRequestOrigin(req)),
    persona,
    workspaceRecovered,
  });
}

async function handleLogout(req, res) {
  const sessionData = extractSession(req);
  if (sessionData) {
    destroySession(sessionData.id);
  }
  clearSessionCookie(res);
  return sendJson(res, 200, { ok: true });
}

function handleMe(req, res) {
  const sessionData = extractSession(req);
  if (!sessionData) {
    return sendJson(res, 200, { authenticated: false });
  }

  const user = findUserById(sessionData.userId);
  if (!user) {
    clearSessionCookie(res);
    return sendJson(res, 200, { authenticated: false });
  }

  let tenant = findTenantById(sessionData.tenantId);
  let userTenants = findTenantsForUser(user.id);
  let membership = tenant ? getMembership(tenant.id, user.id) : null;

  if (!tenant || !membership) {
    const repair = ensureTenantForUser(user);
    if (repair.tenant) {
      tenant = repair.tenant;
      userTenants = repair.tenants || [tenant];
      membership = getMembership(tenant.id, user.id);
      tenant = ensureInternalOwnerEntitlement(tenant, user);
      userTenants = findTenantsForUser(user.id);
      store.ensureTenant(tenant, user);
      persistUserWorkspace(user, tenant).catch(() => {});
      const { cookie } = createSession(user.id, tenant.id);
      setSessionCookie(res, cookie);
    }
  } else {
    tenant = ensureInternalOwnerEntitlement(tenant, user);
    userTenants = findTenantsForUser(user.id);
    store.ensureTenant(tenant, user);
  }

  const effectivePlanId = tenant ? getEffectivePlanId(tenant, user) : null;
  const plan = effectivePlanId ? getPlan(effectivePlanId) : null;
  const trialDaysRemaining = tenant && effectivePlanId !== ownerPlanId ? getTrialDaysRemaining(tenant) : null;
  const persona = tenant ? store.getPersona(tenant.id) : 'bd';
  const billingRequired = tenant ? isTenantBillingBlocked(tenant, user) : false;

  return sendJson(res, 200, {
    authenticated: true,
    demo: isReadOnlyDemoSession(sessionData, tenant),
    readOnly: isReadOnlyDemoSession(sessionData, tenant),
    user: safeUser(user),
    tenant: getEffectiveTenant(tenant, user),
    tenants: withEffectiveTenantRoles(userTenants, user),
    membership: membership ? { role: getEffectiveMembershipRole(membership, user) } : null,
    plan: getPublicPlanPayload(plan),
    trialDaysRemaining,
    billingRequired,
    referral: getReferralSummary(tenant, getRequestOrigin(req)),
    persona,
  });
}

async function handleCreateTenant(req, res, user) {
  const { name, slug } = await readJson(req);
  const result = createTenant({ name, slug, plan: isInternalOwner(user) ? ownerPlanId : 'trial', ownerUserId: user.id });
  if (result.error) {
    return sendJson(res, 409, { error: result.error });
  }
  const tenant = ensureInternalOwnerEntitlement(result.tenant, user);
  return sendJson(res, 201, { tenant: getEffectiveTenant(tenant, user) });
}

// ── Static file serving ─────────────────────────────────────────────────────

function serveStaticOrSPA(pathname, req, res) {
  // Handle /app/ prefix — the cloud shell loads the BD Engine app via iframe at /app/
  if (pathname === '/app' || pathname.startsWith('/app/')) {
    const appSubPath = pathname === '/app' ? '/' : pathname.slice(4); // strip '/app'
    if (appSubPath === '/' || appSubPath === '/index.html') {
      return sendHtml(res, getAppIndexHtml());
    }
    const appPath = tryStaticFile(appDir, appSubPath);
    if (appPath) return streamFile(appPath, res);
    // SPA fallback for /app/ routes — serve app's index.html
    const appIndex = join(appDir, 'index.html');
    if (existsSync(appIndex)) return sendHtml(res, getAppIndexHtml());
    return sendJson(res, 404, { error: 'Not found' });
  }

  // Try cloud public dir first (landing page, auth pages, etc.)
  const cloudPath = tryStaticFile(publicDir, pathname);
  if (cloudPath) return streamFile(cloudPath, res);

  // Fall through to app dir for root-level asset requests (styles.css, app.js, etc.)
  const appFallbackPath = tryStaticFile(appDir, pathname);
  if (appFallbackPath) return streamFile(appFallbackPath, res);

  // SPA fallback: serve cloud index.html for unmatched routes
  const cloudIndex = join(publicDir, 'index.html');
  if (existsSync(cloudIndex)) return streamFile(cloudIndex, res);

  return sendJson(res, 404, { error: 'Not found' });
}

let cachedAppIndexHtml = null;

function getAppIndexHtml() {
  // The file only changes on deploy (= process restart), so cache the
  // read + regex rewrite instead of doing it on every /app request.
  if (cachedAppIndexHtml) return cachedAppIndexHtml;
  const appIndex = join(appDir, 'index.html');
  const html = readFileSync(appIndex, 'utf8');
  cachedAppIndexHtml = html
    .replace(/href="\/styles\.css/g, 'href="/app/styles.css')
    .replace(/href="\/manifest\.json/g, 'href="/app/manifest.json')
    .replace(/href="\/icons\//g, 'href="/app/icons/')
    .replace(/href="\/app\.js/g, 'href="/app/app.js')
    .replace(/src="\/local-api\.js/g, 'src="/app/local-api.js')
    .replace(/src="\/app\.js/g, 'src="/app/app.js')
    .replace(/<script>\s*if \('serviceWorker' in navigator\) \{[\s\S]*?<\/script>/, '');
  // (Removed the persona-labels.js injection — the product is recruiting/BD
  // only now, so the fragile jobseeker DOM label-swap overlay is no longer
  // loaded. See #13.)
  return cachedAppIndexHtml;
}

function tryStaticFile(baseDir, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.[\\/])+/, '');
  const filePath = join(baseDir, safePath);
  if (!filePath.startsWith(baseDir)) return null;
  if (!existsSync(filePath)) return null;
  return filePath;
}

const COMPRESSIBLE_MIME = /^(text\/|application\/(json|javascript|xml))|image\/svg\+xml/;

function streamFile(filePath, res) {
  const contentType = mimeTypes[extname(filePath)] || 'application/octet-stream';
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Vary': 'Accept-Encoding',
  };
  if (res.bdAcceptsGzip && COMPRESSIBLE_MIME.test(contentType)) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
    createReadStream(filePath).pipe(createGzip(GZIP_OPTIONS)).pipe(res);
    return;
  }
  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}

function recordRequestMetric(req, res, elapsedMs) {
  const statusCode = String(res.statusCode || 200);
  serverStats.requestCount += 1;
  serverStats.totalDurationMs += elapsedMs;
  serverStats.statusCounts[statusCode] = (serverStats.statusCounts[statusCode] || 0) + 1;
  if (Number(statusCode) >= 500) {
    serverStats.errorCount += 1;
  }
  if (!serverStats.slowestRequest || elapsedMs > serverStats.slowestRequest.elapsedMs) {
    serverStats.slowestRequest = {
      method: req.method,
      path: (req.url || '').split('?')[0],
      statusCode: Number(statusCode),
      elapsedMs,
      at: new Date().toISOString(),
    };
  }
}

function getHealthPayload(includeDetails = false) {
  const uptimeSeconds = Math.round((Date.now() - serverStartedAt.getTime()) / 1000);
  const averageDurationMs = serverStats.requestCount
    ? Math.round(serverStats.totalDurationMs / serverStats.requestCount)
    : 0;
  const stripeStatus = getStripeConfigStatus();
  const checks = {
    server: true,
    databaseConfigured: isDbEnabled(),
    databaseConnected: isDbReady(),
    stripeConfigured: isStripeConfigured(),
    stripeReady: stripeStatus.ready,
    stripeLiveMode: stripeStatus.liveMode,
    stripeCommercialReady: stripeStatus.commercialReady,
    stripeMode: stripeStatus.mode,
    stripeMissing: stripeStatus.missing,
    emailConfigured: isEmailConfigured(),
    errorAlertsConfigured: Boolean(ERROR_WEBHOOK),
    relationalMirrorConfigured: isDbEnabled(),
    relationalMirrorHealthy: relationalMirrorHealth.healthy,
    relationalMirrorWorkspaceCount: relationalMirrorHealth.workspaceCount,
    relationalMirrorMismatchCount: relationalMirrorHealth.mismatchCount,
    relationalMirrorCheckedAt: relationalMirrorHealth.checkedAt,
  };
  const payload = {
    ok: true,
    app: 'bd-engine-cloud',
    mode: process.env.BD_CLOUD_ENV || process.env.NODE_ENV || 'development',
    startedAt: serverStartedAt.toISOString(),
    uptimeSeconds,
    checks,
  };
  if (includeDetails) {
    payload.metrics = {
      requestCount: serverStats.requestCount,
      errorCount: serverStats.errorCount,
      statusCounts: serverStats.statusCounts,
      averageDurationMs,
      slowestRequest: serverStats.slowestRequest,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      rateLimitBuckets: rateBuckets.size,
      resetTokenCacheEntries: passwordResetTokens.size,
    };
    payload.lastError = serverStats.lastError;
  }
  return payload;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const GZIP_MIN_BYTES = 1024;
// Level 1 is ~3x faster than the default on JSON with only a small ratio loss;
// compression runs on the libuv threadpool so it never blocks the event loop.
const GZIP_OPTIONS = { level: 1 };

function acceptsGzip(req) {
  // Honor q-values: "gzip;q=0, identity" explicitly refuses gzip (RFC 9110).
  const header = String(req.headers['accept-encoding'] || '');
  return header.split(',').some((part) => {
    const [encoding, ...params] = part.trim().split(';');
    if (!/^(x-)?gzip$|^\*$/i.test(encoding.trim())) return false;
    return !params.some((p) => /^\s*q\s*=\s*0(\.0{0,3})?\s*$/i.test(p));
  });
}

function sendCompressible(res, status, headers, body) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (res.bdAcceptsGzip && buffer.length >= GZIP_MIN_BYTES) {
    gzip(buffer, GZIP_OPTIONS, (err, compressed) => {
      if (err || res.headersSent) {
        if (!res.headersSent) {
          res.writeHead(status, { ...headers, 'Vary': 'Accept-Encoding' });
          res.end(buffer);
        }
        return;
      }
      res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' });
      res.end(compressed);
    });
    return;
  }
  res.writeHead(status, { ...headers, 'Vary': 'Accept-Encoding' });
  res.end(buffer);
}

function sendHtml(res, body) {
  sendCompressible(res, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  }, body);
}

function sendJavaScript(res, body) {
  sendCompressible(res, 200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
  }, body);
}

function sendJson(res, status, body) {
  sendCompressible(res, status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, JSON.stringify(body));
}

function sendDownloadJson(res, status, body, filename) {
  const safeName = String(filename || 'bd-engine-export.json').replace(/[^a-zA-Z0-9._-]/g, '-');
  sendCompressible(res, status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${safeName}"`,
    'Cache-Control': 'no-store',
  }, JSON.stringify(body, null, 2));
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

async function readBody(req) {
  return (await readRawBody(req)).toString('utf8');
}

async function readRawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('Request body too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readFormOrJson(req) {
  const contentType = String(req.headers['content-type'] || '');
  const body = await readRawBody(req);
  if (!body.length) return { fields: {}, files: {}, text: '' };

  if (/multipart\/form-data/i.test(contentType)) {
    return parseMultipartFormData(body, contentType);
  }

  const text = body.toString('utf8');
  if (/application\/json/i.test(contentType)) {
    return JSON.parse(text || '{}');
  }

  return { fields: {}, files: {}, text };
}

function parseMultipartFormData(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) {
    const error = new Error('Malformed multipart upload: missing boundary.');
    error.status = 400;
    throw error;
  }

  const fields = {};
  const files = {};
  const raw = body.toString('utf8');
  const parts = raw.split(`--${boundary}`);

  for (const part of parts) {
    const normalizedPart = part.replace(/^\r?\n/, '');
    if (!normalizedPart.trim() || normalizedPart.startsWith('--')) continue;

    const separator = normalizedPart.indexOf('\r\n\r\n');
    if (separator < 0) continue;

    const headerText = normalizedPart.slice(0, separator);
    let content = normalizedPart.slice(separator + 4);
    content = content.replace(/\r?\n--$/, '').replace(/\r?\n$/, '');

    const disposition = headerText.match(/content-disposition:[^\n]*/i)?.[0] || '';
    const name = disposition.match(/name="([^"]+)"/i)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
    if (!name) continue;

    if (filename !== undefined) {
      files[name] = {
        filename,
        content,
        size: Buffer.byteLength(content, 'utf8'),
      };
    } else {
      fields[name] = content;
    }
  }

  return { fields, files, text: raw };
}
