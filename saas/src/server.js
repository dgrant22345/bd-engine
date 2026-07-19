import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { gzip, createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createStore, getRelationalPrimaryTenantIds, registerRelationalPrimaryTenant } from './store.js';
import { extractSession, createSession, destroySession, forgetUserSessions, isRecentAuthentication, markSessionStepUp, setSessionCookie, clearSessionCookie, loadSessionsFromDb, createPasswordResetSecret, hashPasswordResetToken, verifyPassword } from './auth.js';
import { createUser, authenticateUser, setUserPassword, markUserEmailVerified, findUserByEmail, findUserById, findTenantsForUser, findTenantById, findTenantBySlug, findTenantByStripeCustomerId, findTenantByReferralCode, findTenantsReferredBy, listTenants, listMemberships, getMembership, addMember, forgetClosedAccount, safeUser, createTenant, ensureTenantForUser, persistUserWorkspace, updateTenant, updateTenantPersisted, loadFromDb as loadUsersFromDb, normalizeReferralCode } from './users.js';
import { getPlan, getPlanByStripePriceId, getTrialDaysRemaining, getUsageSummary, getEntitlementDecision, PLANS, handleWebhookEvent, createCheckoutSession, createBillingPortalSession, cancelSubscriptionForAccountClosure, createReferralCredit, isStripeConfigured, getStripeConfigStatus, isTrialExpired, createBillingGraceDeadline, getBillingAccessStatus } from './billing.js';
import { initDb, closeDb, isDbEnabled, isDbReady, dbCheckRelationalContentParity, dbCheckRelationalCountParity, dbLoadRelationalPrimaryTenantIds, dbPruneExpiredOperationalData, dbRecordAnalyticsVisit, dbRecordProductEvent, dbRecordAuditLog, dbGetAnalyticsSummary, dbGetImportUsageCount, dbClaimStripeWebhook, dbCompleteStripeWebhook, dbFailStripeWebhook, dbConsumeRateLimit, dbRecordAccountClosure, dbCloseUserAccount, dbSavePasswordResetToken, dbFindPasswordResetToken, dbMarkPasswordResetTokenUsed, dbSaveEmailVerificationToken, dbFindEmailVerificationToken, dbMarkEmailVerificationTokenUsed, dbCreateSupportTicket, dbListSupportTickets, dbGetSupportTicket, dbAddSupportTicketMessage, dbUpdateSupportTicket } from './db.js';
import { isEmailConfigured, sendPasswordResetEmail, sendEmailVerificationEmail, sendSupportOperatorEmail, sendSupportCustomerReplyEmail } from './email.js';
import { getReadinessDecision, shouldLogReadinessFailure } from './readiness.js';
import { buildMutationAuditEntry } from './request-audit.js';
import { validateSupportTicketInput, validateSupportReplyInput, validateSupportAdminUpdate, publicSupportTicket, SUPPORT_STATUSES } from './support.js';
import { canDeleteWorkspaceData, canManageBilling, canMutateWorkspace } from './authorization.js';
import { consumeMemoryRateLimitBucket, hashRateLimitKey } from './rate-limit.js';
import { isEmailVerificationRequired, requiresVerifiedEmail } from './verification-policy.js';
import { accountClosureSubjectHash, buildAccountClosurePlan } from './account-closure.js';
import { buildProductEvent } from './product-analytics.js';
import { safeErrorSummary, safeRequestPath } from './operational-logging.js';
import { contentSecurityPolicy, injectScriptNonce } from './security-headers.js';
import { normalizePublicOrigin, resolvePublicOrigin } from './public-origin.js';
import { clientAddress } from './request-client.js';
import { isUnsafeCrossSiteRequest } from './request-security.js';
import { assertDeclaredBodyWithinLimit, configureHttpServer, requestBodyTooLargeError, resolveRequestLimits } from './request-limits.js';

const PUBLIC_SUPPORT_EMAIL = 'dgfinance15@gmail.com';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const appDir = existsSync(join(rootDir, 'app')) ? join(rootDir, 'app') : join(rootDir, '..', 'app');
const publicDir = join(rootDir, 'public');
const port = Number(process.env.BD_CLOUD_PORT || 8787);
const host = process.env.BD_CLOUD_HOST || '0.0.0.0';
const store = createStore();
const MIN_PASSWORD_LENGTH = 10;
const serverStartedAt = new Date();
const referralCreditAmountCents = Number(process.env.BD_REFERRAL_CREDIT_CENTS || 500);
const internalOwnerEmails = new Set(parseEmailList([
  process.env.BD_INTERNAL_OWNER_EMAILS,
  process.env.BD_OWNER_EMAILS,
].join(',')));
const configuredAnalyticsAdminEmails = parseEmailList(process.env.BD_ANALYTICS_ADMIN_EMAILS);
const analyticsAdminEmails = new Set(parseEmailList([
  ...configuredAnalyticsAdminEmails,
  ...internalOwnerEmails,
].join(',')));
const configuredSupportAdminEmails = parseEmailList(process.env.BD_SUPPORT_ADMIN_EMAILS);
const supportAdminEmails = new Set(parseEmailList([
  ...configuredSupportAdminEmails,
  ...internalOwnerEmails,
].join(',')));
const ownerPlanId = 'owner';

// ── Abuse / DoS guards ───────────────────────────────────────────────────────
// Cap request bodies so one large upload cannot exhaust the single process.
const requestLimits = resolveRequestLimits();
const LOGIN_MAX = Number(process.env.BD_LOGIN_MAX) > 0 ? Number(process.env.BD_LOGIN_MAX) : 20;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNUP_MAX = Number(process.env.BD_SIGNUP_MAX) > 0 ? Number(process.env.BD_SIGNUP_MAX) : 10;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_MAX = Number(process.env.BD_PASSWORD_RESET_MAX) > 0 ? Number(process.env.BD_PASSWORD_RESET_MAX) : 5;
const PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const SUPPORT_CREATE_MAX = Number(process.env.BD_SUPPORT_CREATE_MAX) > 0 ? Number(process.env.BD_SUPPORT_CREATE_MAX) : 10;
const SUPPORT_REPLY_MAX = Number(process.env.BD_SUPPORT_REPLY_MAX) > 0 ? Number(process.env.BD_SUPPORT_REPLY_MAX) : 30;
const SUPPORT_WINDOW_MS = 60 * 60 * 1000;
const PRIVILEGED_STEP_UP_MAX = 10;
const PRIVILEGED_STEP_UP_WINDOW_MS = 15 * 60 * 1000;
const PRIVILEGED_SESSION_MAX_AGE_MS = Number(process.env.BD_PRIVILEGED_SESSION_MAX_AGE_MS) > 0
  ? Number(process.env.BD_PRIVILEGED_SESSION_MAX_AGE_MS)
  : 15 * 60 * 1000;
const DEMO_MAX = Number(process.env.BD_DEMO_MAX) > 0 ? Number(process.env.BD_DEMO_MAX) : 30;
const DEMO_WINDOW_MS = 60 * 60 * 1000;
const PUBLIC_DEMO_SLUG = 'bd-engine-demo';
const PUBLIC_DEMO_EMAIL = 'demo@bdengine.local';
const PUBLIC_DEMO_USER_NAME = 'BD Engine Demo';
const PUBLIC_DEMO_WORKSPACE = 'BD Engine Demo Workspace';
const RELATIONAL_WRITE_NEW_TENANTS = process.env.BD_RELATIONAL_WRITE_NEW_TENANTS === 'true';
const relationalDeepCheckValues = String(process.env.BD_RELATIONAL_DEEP_CHECK_TENANTS || process.env.BD_RELATIONAL_READ_TENANTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const RELATIONAL_DEEP_CHECK_TENANTS = relationalDeepCheckValues.includes('*') ? [] : relationalDeepCheckValues;
const RELATIONAL_DEEP_CHECK_CONFIGURED = relationalDeepCheckValues.length > 0;
const passwordResetTokens = new Map();
const emailVerificationTokens = new Map();
const MAX_RATE_BUCKETS = Math.max(1000, Number(process.env.BD_MAX_RATE_BUCKETS) || 10000);
const MAX_RESET_TOKEN_CACHE = Math.max(100, Number(process.env.BD_MAX_RESET_TOKEN_CACHE) || 5000);
const PUBLIC_ORIGIN = resolvePublicOrigin(process.env, port);
if (!PUBLIC_ORIGIN) {
  throw new Error('BD_CLOUD_BASE_URL or a Railway public domain is required in production.');
}

// Restrict CORS to known origins instead of "*" (which also can't carry the
// session cookie). Same-origin app requests are unaffected.
const allowedOrigins = new Set([PUBLIC_ORIGIN]);
for (const origin of String(process.env.BD_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const normalized = normalizePublicOrigin(origin);
  if (normalized) allowedOrigins.add(normalized);
}
allowedOrigins.add(`http://localhost:${port}`);
allowedOrigins.add(`http://127.0.0.1:${port}`);

const rateBuckets = new Map(); // key -> { count, resetAt }

function clientIp(req) {
  return clientAddress(req);
}

// Fixed-window limiter shared through PostgreSQL in production. Memory remains
// a deterministic fallback for local development and transient DB failures.
async function rateLimitExceeded(key, max, windowMs) {
  const nowMs = Date.now();
  if (rateBuckets.size >= MAX_RATE_BUCKETS) pruneEphemeralMemory(nowMs);
  if (isDbReady()) {
    try {
      const decision = await dbConsumeRateLimit(hashRateLimitKey(key), max, windowMs, nowMs);
      if (decision) return decision.exceeded;
    } catch (error) {
      console.error('Shared rate limiter failed; using process fallback:', safeErrorSummary(error));
    }
  }
  return consumeMemoryRateLimitBucket(rateBuckets, key, max, windowMs, nowMs);
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
  for (const [tokenHash, record] of emailVerificationTokens) {
    if (record.usedAt || new Date(record.expiresAt || 0).getTime() <= nowMs) emailVerificationTokens.delete(tokenHash);
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
    await dbPruneExpiredOperationalData({
      backgroundJobRetentionDays: retentionDays('BD_BACKGROUND_JOB_RETENTION_DAYS', 14),
      importHistoryRetentionDays: retentionDays('BD_IMPORT_HISTORY_RETENTION_DAYS', 180),
      analyticsRetentionDays: retentionDays('BD_ANALYTICS_RETENTION_DAYS', 395),
      auditRetentionDays: retentionDays('BD_AUDIT_RETENTION_DAYS', 730),
      stripeWebhookRetentionDays: retentionDays('BD_STRIPE_WEBHOOK_RETENTION_DAYS', 90),
    });
  } catch (error) {
    console.error('Operational cleanup failed:', safeErrorSummary(error));
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
  if (pathname === '/api/auth/logout') return true;
  // Draft generation is read-only: it derives copy from existing sample data
  // and does not persist activity, tasks, or account changes.
  return /^\/api\/accounts\/[^/]+\/generate-outreach$/.test(pathname)
    && String(method || '').toUpperCase() === 'POST';
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
const relationalContentHealth = {
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
// Release identifier for correlating an alert with the deployed commit.
const RELEASE = String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BD_RELEASE || 'dev').slice(0, 12);
const STRUCTURED_LOGS = (process.env.BD_CLOUD_ENV || process.env.NODE_ENV) === 'production';
let lastErrorAlertAt = 0;
const ERROR_ALERT_MIN_INTERVAL_MS = 60 * 1000;

function reportServerError(status, req, error, { kind = 'SERVER' } = {}) {
  if (!ERROR_WEBHOOK) return;
  const nowMs = Date.now();
  if (nowMs - lastErrorAlertAt < ERROR_ALERT_MIN_INTERVAL_MS) return;
  lastErrorAlertAt = nowMs;
  const route = safeRequestPath(req.url);
  const context = [
    `release ${RELEASE}`,
    req.requestId ? `request ${req.requestId}` : '',
  ].filter(Boolean).join(', ');
  const text = `[ALERT] BD Engine ${kind} ${status} on ${req.method} ${route} (${context})`;
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
    const result = await dbCheckRelationalCountParity(getRelationalPrimaryTenantIds());
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
    console.error('Relational mirror health check failed:', safeErrorSummary(error));
  }
}

function startRelationalMirrorMonitor(startupPromise) {
  startupPromise.then(() => refreshRelationalMirrorHealth()).catch(() => {});
  const timer = setInterval(refreshRelationalMirrorHealth, 5 * 60 * 1000);
  timer.unref?.();
}

async function refreshRelationalContentHealth() {
  if (!isDbReady() || !RELATIONAL_DEEP_CHECK_CONFIGURED) return;
  const wasHealthy = relationalContentHealth.healthy;
  try {
    const result = await dbCheckRelationalContentParity(RELATIONAL_DEEP_CHECK_TENANTS, getRelationalPrimaryTenantIds());
    if (!result) return;
    Object.assign(relationalContentHealth, result, { error: '' });
    if (!result.healthy) {
      console.error(`Relational mirror content drift: ${result.mismatchCount}/${result.workspaceCount} canary workspaces mismatched.`);
      if (wasHealthy !== false) {
        reportServerError(503, { method: 'MONITOR', url: '/relational-content-parity' }, new Error('Relational mirror content drift detected'));
      }
    }
  } catch (error) {
    relationalContentHealth.healthy = false;
    relationalContentHealth.checkedAt = new Date().toISOString();
    relationalContentHealth.error = 'Deep parity check unavailable';
    console.error('Relational content health check failed:', safeErrorSummary(error));
  }
}

function startRelationalContentMonitor(startupPromise) {
  startupPromise.then(() => refreshRelationalContentHealth()).catch(() => {});
  const timer = setInterval(refreshRelationalContentHealth, 60 * 60 * 1000);
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
  startRelationalContentMonitor(startupPromise);
  startOperationalCleanup(startupPromise);

  const server = createServer(async (req, res) => {
    const startedAt = performance.now();
    res.bdScriptNonce = randomBytes(16).toString('base64');
    res.bdAcceptsGzip = acceptsGzip(req);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(res.bdScriptNonce));
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if ((process.env.BD_CLOUD_ENV || process.env.NODE_ENV) === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
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
    // Correlates a customer report, the server log line, and the alert (CG-013).
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    try {
      if (isUnsafeCrossSiteRequest(req, allowedOrigins)) {
        return sendJson(res, 403, { error: 'Cross-site request blocked.' });
      }
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
        url: safeRequestPath(req.url),
        requestId: req.requestId,
        message: safeErrorSummary(error),
      };
      // Never leak internal error text to clients on 5xx; 4xx messages are
      // intentional (validation, not-found) so keep those.
      if (status >= 500) {
        logRequestError(status, req, error);
        reportServerError(status, req, error);
        sendJson(res, status, {
          error: 'Something went wrong on our end. Please try again.',
          requestId: req.requestId,
        });
      } else {
        sendJson(res, status, { error: error.message || 'Request failed' });
      }
    } finally {
      const elapsedMs = Math.round(performance.now() - startedAt);
      recordRequestMetric(req, res, elapsedMs);
      const auditEntry = buildMutationAuditEntry({
        method: req.method,
        statusCode: res.statusCode,
        tenantId: req.tenantId,
        userId: req.actorUserId,
        url: safeRequestPath(req.url),
        requestId: req.requestId,
      });
      if (auditEntry) await dbRecordAuditLog(auditEntry);
      logRequestCompletion(req, res, elapsedMs);
    }
  });

  configureHttpServer(server, requestLimits);

  server.listen(port, host, () => {
    console.log(`BD Engine Cloud running at http://${host}:${port}`);
    startPeriodicPipelineRunner(startupPromise);
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
        console.error('  Shutdown flush error:', safeErrorSummary(err));
      }
      try {
        await closeDb();
      } catch (err) {
        console.error('  DB close error:', safeErrorSummary(err));
      }
      process.exit(0);
    });
  }
}

function logRequestCompletion(req, res, elapsedMs) {
  const entry = {
    level: 'info',
    event: 'http_request',
    method: String(req.method || ''),
    path: safeRequestPath(req.url),
    status: Number(res.statusCode || 200),
    elapsedMs: Number(elapsedMs || 0),
    requestId: String(req.requestId || ''),
    release: RELEASE,
  };
  console.log(STRUCTURED_LOGS
    ? JSON.stringify(entry)
    : `${entry.method} ${entry.path} ${entry.status} ${entry.elapsedMs}ms [${entry.requestId}]`);
}

function logRequestError(status, req, error) {
  const entry = {
    level: 'error',
    event: 'http_error',
    method: String(req.method || ''),
    path: safeRequestPath(req.url),
    status: Number(status || 500),
    requestId: String(req.requestId || ''),
    release: RELEASE,
    error: safeErrorSummary(error),
  };
  console.error(STRUCTURED_LOGS
    ? JSON.stringify(entry)
    : `${entry.status} on ${entry.method} ${entry.path} [${entry.requestId}]: ${entry.error}`);
}

function startPeriodicPipelineRunner(startupPromise) {
  const pipelineIntervalMs = 24 * 60 * 60 * 1000;
  const retryDelayMs = 60 * 60 * 1000;
  const scanIntervalMs = Math.max(60_000, Number(process.env.BD_SCHEDULER_SCAN_MS) || 15 * 60 * 1000);
  const maxTenantsPerScan = Math.max(1, Math.min(25, Number(process.env.BD_SCHEDULER_MAX_TENANTS) || 3));
  let scanRunning = false;

  const scan = async () => {
    if (scanRunning) return;
    scanRunning = true;
    try {
      await startupPromise;
      if (!startupComplete || startupError) return;
      const tenants = store.getAllTenants?.() || [];
      let started = 0;
      for (const tenant of tenants) {
        if (started >= maxTenantsPerScan) break;
        if (tenant.status !== 'active' || tenant.slug === PUBLIC_DEMO_SLUG) continue;
        try {
          const claim = await store.claimScheduledPipeline(tenant.id, {
            intervalMs: pipelineIntervalMs,
            retryDelayMs,
          });
          if (!claim.claimed) continue;
          await store.startLiveJobImport(tenant.id, { plan: getPlan(tenant.plan), scheduled: true });
          started += 1;
          console.log(`[Scheduler] Started overdue pipeline for ${tenant.id}.`);
        } catch (err) {
          console.error('[Scheduler] Failed to schedule workspace pipeline:', safeErrorSummary(err));
        }
      }
      if (started) console.log(`[Scheduler] Started ${started} overdue pipeline${started === 1 ? '' : 's'}.`);
    } finally {
      scanRunning = false;
    }
  };

  console.log(`[Scheduler] Scanning every ${Math.round(scanIntervalMs / 60000)} minute(s), up to ${maxTenantsPerScan} workspace(s) per scan.`);
  const startupTimer = setTimeout(() => void scan(), 10_000);
  const intervalTimer = setInterval(() => void scan(), scanIntervalMs);
  startupTimer.unref?.();
  intervalTimer.unref?.();
}

function retentionDays(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(1, Math.min(3650, Math.floor(value))) : fallback;
}

let startupComplete = false;
let startupError = '';

function getCurrentReadiness() {
  return getReadinessDecision({
    isProduction: (process.env.BD_CLOUD_ENV || process.env.NODE_ENV || 'development') === 'production',
    startupComplete,
    startupError,
    dbEnabled: isDbEnabled(),
    dbReady: isDbReady(),
  });
}

async function initializeData() {
  try {
    const dbConnected = await initDb();
    if (dbConnected) {
      await loadUsersFromDb();
      for (const tenant of listTenants()) store.ensureTenant(tenant);
      for (const tenantId of await dbLoadRelationalPrimaryTenantIds()) registerRelationalPrimaryTenant(tenantId);
      await loadSessionsFromDb();
      await store.loadFromDb();
    }
    startupComplete = true;
  } catch (error) {
    // Keep the process alive so /livez responds, but readiness stays 503 —
    // the deployment must not go active without durable persistence (CG-011).
    startupError = String(error.message || error);
    console.error('Startup data initialization failed:', startupError);
  }
}

function isHealthRequest(req) {
  try {
    const url = new URL(req.url || '/', 'http://bd-engine.local');
    // Probe endpoints must answer during startup instead of blocking on it:
    // /livez proves the event loop; /readyz reports "startup incomplete" (503).
    return url.pathname === '/health' || url.pathname === '/api/health'
      || url.pathname === '/livez' || url.pathname === '/readyz';
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

function canManageSupport(user) {
  const isProduction = (process.env.BD_CLOUD_ENV || process.env.NODE_ENV || 'development') === 'production';
  if (!isProduction && configuredSupportAdminEmails.length === 0) return true;
  return supportAdminEmails.has(String(user?.email || '').trim().toLowerCase());
}

function requirePrivilegedStepUp(res, sessionData) {
  if (isRecentAuthentication(sessionData, PRIVILEGED_SESSION_MAX_AGE_MS)) return true;
  sendJson(res, 428, {
    error: 'Confirm your password to continue with privileged access.',
    code: 'step_up_required',
  });
  return false;
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

function getRequestOrigin() {
  return PUBLIC_ORIGIN;
}

async function notifySupportOperators(req, { ticket, requester, tenant, message }) {
  if (!isEmailConfigured() || supportAdminEmails.size === 0) return;
  try {
    await sendSupportOperatorEmail({
      to: [...supportAdminEmails],
      requesterName: requester?.name,
      requesterEmail: requester?.email,
      workspaceName: tenant?.name,
      ticket,
      message,
      supportUrl: getRequestOrigin(req),
    });
  } catch (error) {
    console.warn('Support operator notification failed:', safeErrorSummary(error));
  }
}

async function notifySupportCustomer(req, { ticket, message }) {
  if (!isEmailConfigured() || !ticket?.createdByUserId) return;
  const requester = findUserById(ticket.createdByUserId);
  if (!requester?.email) return;
  try {
    await sendSupportCustomerReplyEmail({
      to: requester.email,
      name: requester.name,
      ticket,
      message,
      supportUrl: getRequestOrigin(req),
    });
  } catch (error) {
    console.warn('Support customer notification failed:', safeErrorSummary(error));
  }
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
  const url = new URL(req.url || '/', 'http://bd-engine.local');
  const pathname = url.pathname;

  // Health checks stay public for Railway. Detailed status is authenticated
  // below because it can expose runtime metrics and recent error context.
  // CG-016: the public health surface is availability-only. Configuration,
  // environment, and infrastructure detail live behind auth on /api/status.
  if (pathname === '/health' || pathname === '/api/health') {
    const decision = getCurrentReadiness();
    return sendJson(res, 200, { ok: decision.ready, status: decision.ready ? 'operational' : 'degraded' });
  }

  // CG-011: liveness proves only that the event loop responds.
  if (pathname === '/livez') {
    return sendJson(res, 200, { ok: true });
  }

  // CG-011/012: readiness is the deploy gate — 503 when production lacks
  // durable persistence or startup failed. Railway's health check points here.
  // The detailed reason is logged, not published (CG-016).
  if (pathname === '/readyz') {
    const decision = getCurrentReadiness();
    if (shouldLogReadinessFailure(decision)) console.error(`Readiness check failed: ${decision.reason}`);
    return sendJson(res, decision.ready ? 200 : 503, { ok: decision.ready });
  }

  // ── Auth endpoints (public, rate-limited) ─────────────────────────────────

  // CG-013: synthetic failure for verifying the alert pipeline end to end.
  // Only exists when BD_ENABLE_SYNTHETIC_ERROR=true (never set in production).
  if (pathname === '/api/debug/synthetic-error' && process.env.BD_ENABLE_SYNTHETIC_ERROR === 'true') {
    throw new Error('Synthetic server error for alert verification');
  }

  // CG-013: client-error intake. The SPA's global error handlers post here so
  // operators learn about broken buttons before customers report them. Public
  // (errors can happen pre-login) but tightly rate limited and truncated.
  if (pathname === '/api/client-error' && req.method === 'POST') {
    if (await rateLimitExceeded(`client-error:${clientIp(req)}`, 10, 60 * 1000)) {
      return sendJson(res, 429, { error: 'Too many error reports.' });
    }
    const payload = await readJson(req);
    const report = {
      message: String(payload.message || 'unknown client error').slice(0, 500),
      route: String(payload.route || '').slice(0, 200),
      action: String(payload.action || '').slice(0, 100),
      stack: String(payload.stack || '').slice(0, 1000),
    };
    const sessionData = extractSession(req);
    if (sessionData?.tenantId) req.tenantId = sessionData.tenantId;
    console.error(`  CLIENT ERROR on ${safeRequestPath(report.route || '/app')} [${req.requestId}]:`,
      safeErrorSummary({ name: 'ClientError', message: report.message }));
    reportServerError('error', {
      method: 'UI',
      url: report.route || '/app',
      requestId: req.requestId,
      tenantId: req.tenantId,
    }, new Error(`${report.message}${report.action ? ` (action: ${report.action})` : ''}`), { kind: 'CLIENT' });
    return sendJson(res, 202, { ok: true, requestId: req.requestId });
  }

  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    if (await rateLimitExceeded(`signup:${clientIp(req)}`, SIGNUP_MAX, SIGNUP_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many sign-ups from this network. Please wait a few minutes and try again.' });
    }
    return handleSignup(req, res);
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (await rateLimitExceeded(`login:${clientIp(req)}`, LOGIN_MAX, LOGIN_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many login attempts. Please wait a few minutes and try again.' });
    }
    return handleLogin(req, res);
  }

  if (pathname === '/api/auth/password-reset/request' && req.method === 'POST') {
    if (await rateLimitExceeded(`password-reset:${clientIp(req)}`, PASSWORD_RESET_MAX, PASSWORD_RESET_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many reset requests from this network. Please wait a few minutes and try again.' });
    }
    return handlePasswordResetRequest(req, res);
  }

  if (pathname === '/api/auth/password-reset/confirm' && req.method === 'POST') {
    if (await rateLimitExceeded(`password-reset-confirm:${clientIp(req)}`, PASSWORD_RESET_MAX * 2, PASSWORD_RESET_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many reset attempts. Please wait a few minutes and try again.' });
    }
    return handlePasswordResetConfirm(req, res);
  }

  if (pathname === '/api/auth/email-verification/confirm' && req.method === 'POST') {
    if (await rateLimitExceeded(`email-verification-confirm:${clientIp(req)}`, PASSWORD_RESET_MAX * 4, PASSWORD_RESET_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many verification attempts. Please wait a few minutes and try again.' });
    }
    return handleEmailVerificationConfirm(req, res);
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    return handleLogout(req, res);
  }

  if (pathname === '/api/plans') {
    return sendJson(res, 200, {
      plans: Object.values(PLANS)
        .filter((p) => p.id !== ownerPlanId)
        .map((p) => ({
          id: p.id,
          name: p.name,
          displayName: p.displayName,
          price: p.price,
          currency: String(process.env.BD_BILLING_CURRENCY || 'usd').toUpperCase(),
          interval: p.interval,
          limits: p.limits,
          features: p.features,
        })),
    });
  }

  if (pathname === '/api/demo/start' && req.method === 'POST') {
    if (await rateLimitExceeded(`demo:${clientIp(req)}`, DEMO_MAX, DEMO_WINDOW_MS)) {
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
    let event;
    try {
      event = handleWebhookEvent(payload, signature);
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid Stripe webhook signature or payload.' });
    }

    try {
      const claim = await dbClaimStripeWebhook(event.id, event.type);
      if (!claim.acquired) {
        return sendJson(res, 200, { received: true, duplicate: true });
      }
      const result = await handleStripeBillingEvent(event);
      await dbCompleteStripeWebhook(event.id);
      console.log('Received Stripe Event:', event.type, result);
      return sendJson(res, 200, { received: true, ...result });
    } catch (err) {
      await dbFailStripeWebhook(event.id, err).catch(() => {});
      reportServerError(500, req, err);
      console.error('Stripe webhook processing failed:', event.type, safeErrorSummary(err));
      return sendJson(res, 500, { error: 'Stripe webhook processing failed and can be retried.' });
    }
  }

  if (pathname === '/api/analytics/visit' && req.method === 'POST') {
    if (await rateLimitExceeded(`analytics:${clientIp(req)}`, 120, 60 * 60 * 1000)) {
      return sendJson(res, 429, { error: 'Too many analytics requests.' });
    }
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

  if (pathname === '/api/auth/step-up' && req.method === 'POST') {
    if (await rateLimitExceeded(`privileged-step-up:${user.id}`, PRIVILEGED_STEP_UP_MAX, PRIVILEGED_STEP_UP_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many confirmation attempts. Wait before trying again.' });
    }
    const body = await readJson(req);
    if (!verifyPassword(String(body.password || ''), user.passwordHash)) {
      return sendJson(res, 401, { error: 'The password you entered is incorrect.', code: 'password_incorrect' });
    }
    const authenticatedAt = new Date().toISOString();
    await markSessionStepUp(sessionData.id, authenticatedAt);
    return sendJson(res, 200, {
      ok: true,
      authenticatedAt,
      expiresAt: new Date(Date.parse(authenticatedAt) + PRIVILEGED_SESSION_MAX_AGE_MS).toISOString(),
    });
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
    const { cookie } = await createSession(user.id, tenantId, {
      demo: Boolean(sessionData.demo),
      readOnly: Boolean(sessionData.readOnly),
    });
    setSessionCookie(res, cookie);
  }

  if (!membership) {
    return sendJson(res, 403, { error: 'You are not a member of this workspace.' });
  }

  // Workspace context for error reports/alerts (CG-013).
  req.tenantId = tenantId;
  req.actorUserId = user.id;

  // Build session object compatible with existing frontend
  tenant = ensureInternalOwnerEntitlement(tenant, user);
  const session = {
    tenant: getEffectiveTenant(tenant, user),
    user: safeUser(user),
    membership: { role: getEffectiveMembershipRole(membership, user) },
    plan: getPublicPlanPayload(getPlan(getEffectivePlanId(tenant, user))),
    demo: isReadOnlyDemoSession(sessionData, tenant),
    readOnly: isReadOnlyDemoSession(sessionData, tenant),
  };
  store.ensureTenant(tenant, session.user);

  if (pathname === '/api/auth/email-verification/request' && req.method === 'POST') {
    if (await rateLimitExceeded(`email-verification:${user.id}`, PASSWORD_RESET_MAX, PASSWORD_RESET_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many verification emails requested. Please wait before trying again.' });
    }
    if (user.emailVerifiedAt) {
      return sendJson(res, 200, { ok: true, verified: true, message: 'Your email address is already verified.' });
    }
    const result = await issueEmailVerification(req, user);
    return sendJson(res, result.sent ? 202 : 503, {
      ok: result.sent,
      verified: false,
      emailConfigured: result.emailConfigured,
      message: result.sent
        ? `Verification email sent to ${user.email}.`
        : isEmailVerificationRequired()
          ? 'Email verification is temporarily unavailable. You can continue using features that do not import data or run job discovery.'
          : 'Email verification is temporarily unavailable. Your workspace remains accessible.',
    });
  }

  if (
    isEmailVerificationRequired()
    && !user.emailVerifiedAt
    && !isReadOnlyDemoSession(sessionData, tenant)
    && requiresVerifiedEmail(pathname, req.method)
  ) {
    return sendJson(res, 403, {
      error: 'Verify your email before importing data or running job discovery.',
      code: 'email_verification_required',
      emailConfigured: isEmailConfigured(),
      nextAction: 'Open Account, send a verification email, and follow the link before trying again.',
    });
  }

  if (pathname === '/api/support/tickets') {
    if (req.method === 'GET') {
      const tickets = await dbListSupportTickets({ tenantId, createdByUserId: user.id, limit: 50 });
      return sendJson(res, 200, { tickets: tickets.map((ticket) => publicSupportTicket(ticket)) });
    }
    if (req.method === 'POST') {
      if (isReadOnlyDemoSession(sessionData, tenant)) return sendDemoReadOnly(res);
      if (await rateLimitExceeded(`support-create:${user.id}`, SUPPORT_CREATE_MAX, SUPPORT_WINDOW_MS)) {
        return sendJson(res, 429, { error: 'You have sent several support requests recently. Reply to an existing request or try again later.' });
      }
      const validation = validateSupportTicketInput(await readJson(req));
      if (validation.error) return sendJson(res, 400, { error: validation.error });
      const createdAt = new Date().toISOString();
      const ticketId = `support-${randomUUID().slice(0, 12)}`;
      const ticket = await dbCreateSupportTicket({
        id: ticketId,
        tenantId,
        createdByUserId: user.id,
        category: validation.value.category,
        subject: validation.value.subject,
        status: 'new',
        priority: 'normal',
        pageUrl: validation.value.pageUrl,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
        createdAt,
        updatedAt: createdAt,
      }, {
        ticketId,
        tenantId,
        authorUserId: user.id,
        authorType: 'customer',
        body: validation.value.body,
        internal: false,
        createdAt,
      });
      await notifySupportOperators(req, {
        ticket,
        requester: user,
        tenant,
        message: validation.value.body,
      });
      return sendJson(res, 201, {
        ticket: publicSupportTicket(ticket),
        message: 'Your request was sent. You can follow its progress here.',
      });
    }
  }

  const supportReplyMatch = pathname.match(/^\/api\/support\/tickets\/([^/]+)\/messages$/);
  if (supportReplyMatch && req.method === 'POST') {
    if (isReadOnlyDemoSession(sessionData, tenant)) return sendDemoReadOnly(res);
    if (await rateLimitExceeded(`support-reply:${user.id}`, SUPPORT_REPLY_MAX, SUPPORT_WINDOW_MS)) {
      return sendJson(res, 429, { error: 'Too many support replies were sent recently. Please wait and try again.' });
    }
    const accessible = await dbGetSupportTicket(supportReplyMatch[1], { tenantId, createdByUserId: user.id });
    if (!accessible) {
      return sendJson(res, 404, { error: 'Support request not found.' });
    }
    const validation = validateSupportReplyInput(await readJson(req));
    if (validation.error) return sendJson(res, 400, { error: validation.error });
    const ticket = await dbAddSupportTicketMessage({
      ticketId: supportReplyMatch[1],
      tenantId,
      authorUserId: user.id,
      authorType: 'customer',
      body: validation.value.body,
    });
    await notifySupportOperators(req, {
      ticket,
      requester: user,
      tenant,
      message: validation.value.body,
    });
    return sendJson(res, 201, { ticket: publicSupportTicket(ticket), message: 'Reply sent.' });
  }

  if (pathname === '/api/support/admin/tickets' && req.method === 'GET') {
    if (!canManageSupport(user)) return sendJson(res, 403, { error: 'Support operator access is required.' });
    if (!requirePrivilegedStepUp(res, sessionData)) return;
    const requestedStatus = String(url.searchParams.get('status') || '');
    const status = SUPPORT_STATUSES.has(requestedStatus) ? requestedStatus : '';
    const tickets = await dbListSupportTickets({ allTenants: true, status, limit: 100 });
    return sendJson(res, 200, {
      tickets: tickets.map((ticket) => ({
        ...publicSupportTicket(ticket, { operator: true }),
        workspaceName: findTenantById(ticket.tenantId)?.name || ticket.tenantId,
        requester: safeUser(findUserById(ticket.createdByUserId)),
      })),
    });
  }

  const supportAdminTicketMatch = pathname.match(/^\/api\/support\/admin\/tickets\/([^/]+)$/);
  if (supportAdminTicketMatch && req.method === 'PATCH') {
    if (!canManageSupport(user)) return sendJson(res, 403, { error: 'Support operator access is required.' });
    if (!requirePrivilegedStepUp(res, sessionData)) return;
    const current = await dbGetSupportTicket(supportAdminTicketMatch[1], { allTenants: true });
    if (!current) return sendJson(res, 404, { error: 'Support request not found.' });
    const validation = validateSupportAdminUpdate(await readJson(req), current);
    if (validation.error) return sendJson(res, 400, { error: validation.error });
    const ticket = await dbUpdateSupportTicket(current.id, validation.value);
    return sendJson(res, 200, { ticket: publicSupportTicket(ticket, { operator: true }), message: 'Support request updated.' });
  }

  const supportAdminReplyMatch = pathname.match(/^\/api\/support\/admin\/tickets\/([^/]+)\/messages$/);
  if (supportAdminReplyMatch && req.method === 'POST') {
    if (!canManageSupport(user)) return sendJson(res, 403, { error: 'Support operator access is required.' });
    if (!requirePrivilegedStepUp(res, sessionData)) return;
    const validation = validateSupportReplyInput(await readJson(req));
    if (validation.error) return sendJson(res, 400, { error: validation.error });
    const ticket = await dbAddSupportTicketMessage({
      ticketId: supportAdminReplyMatch[1],
      authorUserId: user.id,
      authorType: 'support',
      body: validation.value.body,
      internal: validation.value.internal,
      allTenants: true,
    });
    if (!ticket) return sendJson(res, 404, { error: 'Support request not found.' });
    if (!validation.value.internal) {
      await notifySupportCustomer(req, { ticket, message: validation.value.body });
    }
    return sendJson(res, 201, {
      ticket: publicSupportTicket(ticket, { operator: true }),
      message: validation.value.internal ? 'Internal note added.' : 'Reply sent.',
    });
  }

  if (isReadOnlyDemoSession(sessionData, tenant) && !canDemoSessionUsePath(pathname, req.method)) {
    return sendDemoReadOnly(res);
  }

  if (!canMutateWorkspace(session.membership.role, req.method)) {
    return sendJson(res, 403, {
      error: 'This workspace role is read-only. Ask a workspace owner to make this change.',
      code: 'workspace_read_only',
    });
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
    const usage = getUsageSummary(tenantId, effectivePlanId, await getTenantUsage(tenantId));
    const origin = getRequestOrigin(req);
    const billingAccess = getBillingAccessStatus(tenant);
    return sendJson(res, 200, {
      plan,
      trialDaysRemaining,
      usage,
      stripe: getStripeConfigStatus(),
      canManageBilling: Boolean(tenant.stripeCustomerId || tenant.stripe_customer_id),
      canChangeBilling: canManageBilling(session.membership.role),
      tenant: getBillingTenantPayload(tenant, user),
      billingAccess,
      referral: getReferralSummary(tenant, origin),
    });
  }

  if (pathname === '/api/billing/checkout' && req.method === 'POST') {
    if (!canManageBilling(session.membership.role)) {
      return sendJson(res, 403, { error: 'Workspace owner or admin access is required to change billing.' });
    }
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
      await recordProductMilestone({
        eventType: 'checkout_started', tenantId, userId: user.id,
        eventKey: `${tenantId}:${planId}:${new Date().toISOString().slice(0, 10)}`,
        dimensions: { planId, mode: customerId ? 'existing_customer' : 'new_customer' },
      });
      return sendJson(res, 200, { url: sessionUrl, mode: 'checkout' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/billing/portal' && req.method === 'POST') {
    if (!canManageBilling(session.membership.role)) {
      return sendJson(res, 403, { error: 'Workspace owner or admin access is required to manage billing.' });
    }
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
    return sendJson(res, 200, await store.getSetupStatus(tenantId, {
      includeReadiness: url.searchParams.get('includeReadiness') === 'true',
    }));
  }

  if (pathname === '/api/workspace/load-hint') {
    return sendJson(res, 200, await store.getWorkspaceLoadHint(tenantId));
  }

  if (pathname === '/api/ingestion/diagnostics') {
    return sendJson(res, 200, await store.getIngestionDiagnostics(tenantId));
  }

  if (pathname === '/api/runtime/status') {
    return sendJson(res, 200, await store.getRuntimeStatus(tenantId));
  }

  if (pathname === '/api/bootstrap') {
    return sendJson(res, 200, await store.getBootstrap(tenantId, {
      includeFilters: isTruthy(url.searchParams.get('includeFilters')),
      session,
    }));
  }

  if (pathname === '/api/admin/bootstrap') {
    const canViewAnalytics = canViewSiteAnalytics(user);
    const effectivePlanId = getEffectivePlanId(tenant, user);
    const analyticsStartedAt = performance.now();
    const [bootstrapData, runtime, ingestionDiagnostics, analytics] = await Promise.all([
      store.getBootstrap(tenantId, { includeFilters: true, session }),
      store.getRuntimeStatus(tenantId),
      store.getIngestionDiagnostics(tenantId),
      canViewAnalytics ? dbGetAnalyticsSummary(30) : Promise.resolve(null),
    ]);
    const analyticsElapsedMs = Math.round(performance.now() - analyticsStartedAt);
    if (canViewAnalytics && analyticsElapsedMs > 250) {
      console.warn(`Slow analytics summary: saas/src/db.js dbGetAnalyticsSummary ${analyticsElapsedMs}ms`);
    }
    // Diagnostics hydrates the complete workspace used by the synchronous
    // resolver reports below. Independent paged reads can then run together.
    const adminParams = Object.fromEntries(url.searchParams);
    const configQuery = {
      page: adminParams.configPage,
      pageSize: adminParams.configPageSize,
      q: adminParams.configQ,
      ats: adminParams.configAts,
      active: adminParams.configActive,
      discoveryStatus: adminParams.configDiscoveryStatus,
      confidenceBand: adminParams.configConfidenceBand,
      reviewStatus: adminParams.configReviewStatus,
    };
    const enrichmentQuery = {
      page: adminParams.enrichmentPage,
      pageSize: adminParams.enrichmentPageSize,
      confidence: adminParams.enrichmentConfidence,
      missingDomain: adminParams.enrichmentMissingDomain,
      missingCareersUrl: adminParams.enrichmentMissingCareersUrl,
      hasConnections: adminParams.enrichmentHasConnections,
      minTargetScore: adminParams.enrichmentMinTargetScore,
      topN: adminParams.enrichmentTopN,
    };
    const [configs, tenantUsage] = await Promise.all([
      store.findConfigs(tenantId, configQuery),
      getTenantUsage(tenantId),
    ]);
    const origin = getRequestOrigin(req);
    const billingAccess = getBillingAccessStatus(tenant);
    return sendJson(res, 200, {
      bootstrap: bootstrapData,
      runtime,
      ingestionDiagnostics,
      targetScoreRollout: store.getTargetScoreRollout(tenantId),
      resolverReport: store.getResolverReport(tenantId),
      enrichmentReport: store.getEnrichmentReport(tenantId),
      unresolvedQueue: store.getResolverQueue(tenantId, 'unresolved'),
      mediumQueue: store.getResolverQueue(tenantId, 'medium'),
      enrichmentQueue: store.getEnrichmentQueue(tenantId, enrichmentQuery),
      configs,
      analytics,
      canViewSiteAnalytics: canViewAnalytics,
      billing: {
        plan: getPlan(effectivePlanId),
        trialDaysRemaining: effectivePlanId === ownerPlanId ? null : getTrialDaysRemaining(tenant),
        usage: getUsageSummary(tenantId, effectivePlanId, tenantUsage),
        stripe: getStripeConfigStatus(),
        canManageBilling: Boolean(tenant.stripeCustomerId || tenant.stripe_customer_id),
        canChangeBilling: canManageBilling(session.membership.role),
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
    if (!canDeleteWorkspaceData(session.membership.role)) {
      return sendJson(res, 403, { error: 'Only the workspace owner can delete all workspace data.' });
    }
    const body = await readJson(req);
    const expected = `DELETE ${tenant.name}`;
    if (String(body.confirm || '').trim() !== expected) {
      return sendJson(res, 400, {
        error: `Type "${expected}" to delete this workspace's imported data.`,
        code: 'confirmation_required',
      });
    }
    if (!verifyPassword(String(body.password || ''), user.passwordHash)) {
      return sendJson(res, 400, {
        error: 'The password you entered is incorrect.',
        code: 'password_incorrect',
      });
    }
    const result = await store.clearTenantWorkspaceData(tenantId);
    return sendJson(res, 200, {
      ...result,
      message: 'Workspace data deleted. Your account and workspace shell remain available.',
    });
  }

  if (pathname === '/api/privacy/account-closure' && req.method === 'GET') {
    const plan = buildAccountClosurePlan(user.id, listTenants(), listMemberships());
    return sendJson(res, 200, {
      eligible: plan.eligible,
      blockers: plan.blockers,
      deleteWorkspaces: plan.deleteTenants.map((item) => ({ id: item.id, name: item.name })),
      leaveWorkspaces: plan.leaveTenants.map((item) => ({ id: item.id, name: item.name, role: item.role })),
      subscriptionsToCancel: plan.subscriptionIds.length,
      expectedConfirmation: `DELETE ACCOUNT ${user.email}`,
    });
  }

  if (pathname === '/api/privacy/account-closure' && req.method === 'POST') {
    if (isReadOnlyDemoSession(sessionData, tenant)) return sendDemoReadOnly(res);
    const body = await readJson(req);
    const expected = `DELETE ACCOUNT ${user.email}`;
    if (String(body.confirm || '').trim() !== expected) {
      return sendJson(res, 400, { error: `Type "${expected}" to close your account.`, code: 'confirmation_required' });
    }
    if (!body.exportAcknowledged) {
      return sendJson(res, 400, { error: 'Confirm that you downloaded your data or chose to continue without an export.' });
    }
    if (!verifyPassword(String(body.password || ''), user.passwordHash)) {
      return sendJson(res, 400, { error: 'The password you entered is incorrect.', code: 'password_incorrect' });
    }

    const plan = buildAccountClosurePlan(user.id, listTenants(), listMemberships());
    if (!plan.eligible) {
      return sendJson(res, 409, {
        error: 'Your account cannot be closed until workspace ownership is transferred.',
        code: 'ownership_transfer_required',
        blockers: plan.blockers,
      });
    }

    const closureId = `closure-${randomUUID()}`;
    const requestedAt = new Date().toISOString();
    const closureReason = new Set(['not_useful', 'coverage', 'usability', 'price', 'privacy', 'other'])
      .has(String(body.reason || '')) ? String(body.reason) : '';
    const closureRecord = {
      id: closureId,
      subjectHash: accountClosureSubjectHash(user.id),
      status: 'pending',
      deletedTenantCount: plan.deleteTenants.length,
      leftWorkspaceCount: plan.leaveTenants.length,
      subscriptionsCanceledCount: 0,
      requestedAt,
      updatedAt: requestedAt,
      metadata: { reason: closureReason },
    };
    await dbRecordAccountClosure(closureRecord);

    let subscriptionsCanceledCount = 0;
    try {
      for (const subscriptionId of plan.subscriptionIds) {
        const cancellation = await cancelSubscriptionForAccountClosure(subscriptionId);
        if (cancellation.canceled || cancellation.alreadyEnded) subscriptionsCanceledCount += 1;
      }
      await dbRecordAccountClosure({
        ...closureRecord,
        subscriptionsCanceledCount,
        updatedAt: new Date().toISOString(),
      });

      const deletedTenantIds = plan.deleteTenants.map((item) => item.id);
      const result = await dbCloseUserAccount({
        userId: user.id,
        deleteTenantIds: deletedTenantIds,
        closureId,
      });
      store.forgetClosedTenants(deletedTenantIds);
      forgetClosedAccount(user.id, deletedTenantIds);
      forgetUserSessions(user.id);
      clearSessionCookie(res);
      return sendJson(res, 200, {
        ok: true,
        closed: true,
        deletedWorkspaces: deletedTenantIds.length,
        leftWorkspaces: plan.leaveTenants.length,
        subscriptionsCanceled: subscriptionsCanceledCount,
        completedAt: result.completedAt || new Date().toISOString(),
        message: 'Your account has been closed and you have been signed out.',
      });
    } catch (error) {
      await dbRecordAccountClosure({
        ...closureRecord,
        status: 'failed',
        subscriptionsCanceledCount,
        error: 'account_closure_dependency_failed',
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
      reportServerError(500, req, error);
      return sendJson(res, 502, {
        error: 'Account closure could not finish safely. Your account remains available; retry or contact support.',
        code: 'account_closure_incomplete',
        requestId: req.requestId,
      });
    }
  }

  if (pathname === '/api/accounts/legacy-target-curation' && req.method === 'GET') {
    return sendJson(res, 200, await store.curateLegacyTargets(tenantId, {
      targetLimit: url.searchParams.get('targetLimit'),
      apply: false,
    }));
  }

  if (pathname === '/api/accounts/legacy-target-curation' && req.method === 'POST') {
    if (!canDeleteWorkspaceData(session.membership.role)) {
      return sendJson(res, 403, { error: 'Only the workspace owner can classify all legacy companies.' });
    }
    const body = await readJson(req);
    const expected = `CURATE ${tenant.name}`;
    if (String(body.confirm || '').trim() !== expected) {
      return sendJson(res, 400, { error: `Type "${expected}" to classify legacy companies.` });
    }
    const result = await store.curateLegacyTargets(tenantId, {
      targetLimit: body.targetLimit,
      apply: true,
    });
    return sendJson(res, 200, {
      ...result,
      message: `${result.selectedTargets} target companies selected. ${result.networkCompanies} companies remain searchable network context without automatic ATS refresh.`,
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
      if (!await requireEntitlement(res, tenant, user, { feature: 'accounts', resource: 'accounts' })) return;
      const item = await store.addAccount(tenantId, await readJson(req));
      await recordProductMilestone({
        eventType: 'target_created', tenantId, userId: user.id,
        eventKey: tenantId, dimensions: { source: 'manual', persona: tenant.persona, planId: tenant.plan },
      });
      return sendJson(res, 201, item);
    }
    return sendJson(res, 200, await store.findAccounts(tenantId, Object.fromEntries(url.searchParams)));
  }

  // Static account collection actions — must be routed before the /:accountId
  // param matcher below, which would otherwise swallow them as account ids.
  if (pathname === '/api/accounts/bulk' && req.method === 'PATCH') {
    const payload = await readJson(req);
    if (!Array.isArray(payload.ids) || !payload.ids.length) {
      return sendJson(res, 400, { error: 'Provide the account ids to update.' });
    }
    return sendJson(res, 200, await store.bulkUpdateAccounts(tenantId, payload));
  }

  if (pathname === '/api/accounts/import' && req.method === 'POST') {
    const payload = await readJson(req);
    const rows = store.parseAccountImportText(payload.text);
    if (!rows.length) {
      return sendJson(res, 400, { error: 'Paste one company per line, or CSV with a company column.' });
    }
    if (!await requireEntitlement(res, tenant, user, { feature: 'accounts', resource: 'accounts', increment: rows.length })) return;
    return sendJson(res, 200, await store.importAccountsList(tenantId, payload.text));
  }

  const accountOutreachMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/generate-outreach$/);
  if (accountOutreachMatch && req.method === 'POST') {
    if (!await requireEntitlement(res, tenant, user, { feature: 'outreach_drafts' })) return;
    const payload = await readJson(req);
    const draft = await store.createOutreachDraft(tenantId, accountOutreachMatch[1], payload);
    if (!draft) return sendJson(res, 404, { error: 'Account not found' });
    await recordProductMilestone({
      eventType: 'outreach_generated', tenantId, userId: user.id,
      eventKey: tenantId, dimensions: { persona: tenant.persona, planId: tenant.plan },
    });
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
      if (!await requireEntitlement(res, tenant, user, { feature: 'contacts', resource: 'contacts' })) return;
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
      if (!await requireEntitlement(res, tenant, user, { feature: 'jobs', resource: 'jobBoards' })) return;
      return sendJson(res, 201, store.addConfig(tenantId, await readJson(req)));
    }
  }

  const configMatch = pathname.match(/^\/api\/configs\/([^/]+)$/);
  if (configMatch && req.method === 'GET') {
    const config = await store.getConfig(tenantId, configMatch[1]);
    if (!config) return sendJson(res, 404, { error: 'Config not found' });
    return sendJson(res, 200, config);
  }
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
    const trackedCompanies = Array.isArray(fields.trackedCompanies) ? fields.trackedCompanies : [];

    if (csvText) {
      if (!await requireEntitlement(res, tenant, user, { feature: 'csv_import', resource: 'csvImports' })) return;
      const accepted = await store.startLinkedInCsvImport(tenantId, csvText, { plan, trackedCompanies });
      return sendJson(res, 202, {
        ok: true,
        setupComplete: false,
        status: await store.getSetupStatus(tenantId, { includeReadiness: true }),
        ...accepted,
      });
    }

    store.completeSetup(tenantId, fields);
    await recordProductMilestone({
      eventType: 'setup_completed', tenantId, userId: user.id,
      eventKey: tenantId, dimensions: { persona: tenant.persona, planId: tenant.plan, source: 'no_csv' },
    });
    return sendJson(res, 200, {
      ok: true,
      setupComplete: true,
      status: await store.getSetupStatus(tenantId, { includeReadiness: true }),
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
      status: await store.getSetupStatus(tenantId, { includeReadiness: true }),
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
      if (!await requireEntitlement(res, tenant, user, { feature: 'enrichment' })) return;
      const result = await store.accountQuickEnrich(tenantId, actionAccountId);
      if (!result) return sendJson(res, 404, { error: 'Account not found' });
      return sendJson(res, 200, result);
    }
    if (action === 'resolve-now' && req.method === 'POST') {
      return sendJson(res, 202, store.startAccountResolution(tenantId, { accountId: actionAccountId, deep: false, label: 'ATS resolution' }));
    }
    if (action === 'deep-verify' && req.method === 'POST') {
      if (!await requireEntitlement(res, tenant, user, { feature: 'enrichment' })) return;
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
      const config = await store.reviewConfig(tenantId, configActionMatch[1], await readJson(req));
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
    const csvText = payload.files?.connectionsCsv?.content || payload.fields?.csvContent || payload.csvContent || payload.text || '';
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
    const trackedCompanies = [
      ...url.searchParams.getAll('trackedCompany'),
      ...(Array.isArray(fields.trackedCompanies) ? fields.trackedCompanies : []),
    ];
    if (!dryRun) {
      if (!await requireEntitlement(res, tenant, user, { feature: 'csv_import', resource: 'csvImports' })) return;
      return sendJson(res, 202, await store.startLinkedInCsvImport(tenantId, csvText, { plan, trackedCompanies }));
    }

    const result = await store.importLinkedInCSV(tenantId, csvText, {
      dryRun,
      plan,
      trackedCompanies,
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
    const accepted = store.startAtsDiscovery(tenantId, { ...body, plan });
    await recordProductMilestone({
      eventType: 'discovery_started', tenantId, userId: user.id,
      eventKey: tenantId, dimensions: { persona: tenant.persona, planId: tenant.plan },
    });
    return sendJson(res, 202, accepted);
  }

  if (pathname === '/api/import/jobs' && req.method === 'POST') {
    const plan = getPlan(getEffectivePlanId(tenant, user));
    const body = await readJson(req);
    const accepted = await store.startLiveJobImport(tenantId, { ...body, plan });
    await recordProductMilestone({
      eventType: 'job_import_started', tenantId, userId: user.id,
      eventKey: tenantId, dimensions: { persona: tenant.persona, planId: tenant.plan },
    });
    return sendJson(res, 202, accepted);
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
    if (!await requireEntitlement(res, tenant, user, { feature: 'outreach_drafts' })) return;
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
    eventType: 'pageview',
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

async function recordProductMilestone(event) {
  try {
    return await dbRecordProductEvent(buildProductEvent(event));
  } catch (error) {
    console.error('Product milestone recording failed:', safeErrorSummary(error));
    return { recorded: false, reason: error.message };
  }
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
    await recordProductMilestone({
      eventType: 'subscription_started', tenantId,
      eventKey: object.id || getStripeId(object.subscription) || tenantId,
      dimensions: { planId: resolvedPlanId, source: 'stripe_checkout' },
    });
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
    await recordProductMilestone({
      eventType: 'subscription_canceled', tenantId,
      eventKey: object.id || tenantId,
      dimensions: { planId: tenant?.plan || existingTenant?.plan || '', source: 'stripe_webhook' },
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
    await recordProductMilestone({
      eventType: 'payment_failed', tenantId: tenant.id,
      eventKey: object.id || `${tenant.id}:${object.created || Date.now()}`,
      dimensions: { planId: tenant.plan, source: 'stripe_webhook' },
    });
    return { updated: Boolean(updated), tenantId: tenant.id, status: 'past_due' };
  }

  if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
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
    await recordProductMilestone({
      eventType: 'payment_recovered', tenantId: tenant.id,
      eventKey: object.id || `${tenant.id}:${object.created || Date.now()}`,
      dimensions: { planId: tenant.plan, source: 'stripe_webhook' },
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
    console.error('Referral credit failed:', safeErrorSummary(error));
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
  const exposeDevToken = shouldExposeDevResetToken();
  let resetUrl = '';
  let devToken = '';

  // Do not accumulate unusable reset secrets in production when there is no
  // delivery channel. Local development still receives a test token.
  if (user && (emailConfigured || exposeDevToken)) {
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
        console.error('Password reset email failed:', safeErrorSummary(error));
      }
    }
    if (exposeDevToken) devToken = token;
  }

  return sendJson(res, 202, {
    ok: true,
    message: emailConfigured
      ? 'If an account exists for that email, a reset link will be sent shortly.'
      : `Password reset email is temporarily unavailable. Contact ${PUBLIC_SUPPORT_EMAIL} for account recovery.`,
    emailConfigured,
    ...(devToken ? { resetToken: devToken, resetUrl } : {}),
  });
}

const entitlementLabels = {
  accounts: 'accounts',
  contacts: 'contacts',
  jobBoards: 'active job boards',
  csvImports: 'CSV imports',
  enrichment: 'company enrichment',
  outreach_drafts: 'outreach drafts',
};

async function getTenantUsage(tenantId) {
  const usage = await store.getUsageCounts(tenantId);
  return {
    ...usage,
    csvImports: await dbGetImportUsageCount(tenantId),
  };
}

async function requireEntitlement(res, tenant, user, { feature = '', resource = '', increment = 1 } = {}) {
  const planId = getEffectivePlanId(tenant, user);
  const usage = resource ? await getTenantUsage(tenant.id) : {};
  const decision = getEntitlementDecision(planId, {
    feature,
    resource,
    currentCount: resource ? usage[resource] : 0,
    increment,
  });
  if (decision.allowed) return true;

  const label = entitlementLabels[feature || resource] || feature || resource || 'this action';
  sendJson(res, 402, {
    ...decision,
    error: decision.reason === 'limit'
      ? `Your ${decision.planName} plan includes up to ${decision.limit} ${label}. Upgrade to add more.`
      : `${label[0].toUpperCase()}${label.slice(1)} is not included in your ${decision.planName} plan.`,
    upgradeRequired: true,
  });
  return false;
}

async function handlePasswordResetConfirm(req, res) {
  const { token, password } = await readJson(req);
  if (!token || !password) {
    return sendJson(res, 400, { error: 'Reset token and new password are required.' });
  }
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return sendJson(res, 400, { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  const tokenHash = hashPasswordResetToken(token);
  const record = passwordResetTokens.get(tokenHash) || await dbFindPasswordResetToken(tokenHash);
  if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
    return sendJson(res, 400, { error: 'This reset link is invalid or expired.' });
  }

  const result = await setUserPassword(record.userId, password);
  if (result.error) {
    return sendJson(res, 400, { error: 'This reset link is invalid or expired.' });
  }

  passwordResetTokens.delete(tokenHash);
  await dbMarkPasswordResetTokenUsed(tokenHash);
  return sendJson(res, 200, { ok: true, message: 'Password reset. You can now log in.' });
}

async function issueEmailVerification(req, user) {
  const emailConfigured = isEmailConfigured();
  if (!user || user.emailVerifiedAt || !emailConfigured) {
    return { sent: false, emailConfigured, alreadyVerified: Boolean(user?.emailVerifiedAt) };
  }
  const { token, tokenHash } = createPasswordResetSecret();
  const record = {
    tokenHash,
    userId: user.id,
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString(),
    usedAt: '',
    createdAt: new Date().toISOString(),
  };
  emailVerificationTokens.set(tokenHash, record);
  await dbSaveEmailVerificationToken(record);
  const verificationUrl = `${getRequestOrigin(req)}/?verify=${encodeURIComponent(token)}`;
  try {
    const delivery = await sendEmailVerificationEmail({
      to: user.email,
      name: user.name,
      verificationUrl,
    });
    return { sent: Boolean(delivery?.sent), emailConfigured };
  } catch (error) {
    console.error('Email verification delivery failed:', safeErrorSummary(error));
    return { sent: false, emailConfigured };
  }
}

async function handleEmailVerificationConfirm(req, res) {
  const { token } = await readJson(req);
  if (!token) return sendJson(res, 400, { error: 'Verification token is required.' });
  const tokenHash = hashPasswordResetToken(token);
  const record = emailVerificationTokens.get(tokenHash) || await dbFindEmailVerificationToken(tokenHash);
  if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
    return sendJson(res, 400, { error: 'This verification link is invalid or expired.' });
  }
  const result = await markUserEmailVerified(record.userId);
  if (result.error) return sendJson(res, 400, { error: 'This verification link is invalid or expired.' });
  emailVerificationTokens.delete(tokenHash);
  await dbMarkEmailVerificationTokenUsed(tokenHash);
  return sendJson(res, 200, { ok: true, verified: true, message: 'Email verified. Your account is ready.' });
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

  const { cookie } = await createSession(user.id, tenant.id, { demo: true, readOnly: true });
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
    membership: { role: 'viewer' },
    canManageWorkspace: false,
    redirect: '/app/#/dashboard',
  });
}

async function handleSignup(req, res) {
  const { email, password, name, workspaceName, persona, referralCode } = await readJson(req);

  if (!email || !password) {
    return sendJson(res, 400, { error: 'Email and password are required.' });
  }
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return sendJson(res, 400, { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  // Create user
  const userResult = createUser({ email, name, password });
  if (userResult.error) {
    return sendJson(res, 409, { error: userResult.error });
  }

  const userPersona = persona === 'jobseeker' ? 'jobseeker' : 'bd';
  const workspaceDisplayName = workspaceName || `${userResult.user.name}'s Workspace`;
  const referrerTenant = findTenantByReferralCode(referralCode);
  const tenantResult = ensureTenantForUser(userResult.user, {
    workspaceName: workspaceDisplayName,
    persona: userPersona,
    plan: 'trial',
    referredByTenantId: referrerTenant?.id || '',
    storageMode: RELATIONAL_WRITE_NEW_TENANTS ? 'relational' : 'legacy',
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
  const verification = await issueEmailVerification(req, userResult.user);
  const { cookie } = await createSession(userResult.user.id, tenantId);
  setSessionCookie(res, cookie);

  await recordProductMilestone({
    eventType: 'signup_completed', tenantId, userId: userResult.user.id,
    eventKey: userResult.user.id,
    dimensions: { persona: userPersona, planId: getEffectivePlanId(tenantResult.tenant, userResult.user), source: referrerTenant ? 'referral' : 'direct' },
  });

  return sendJson(res, 201, {
    user: safeUser(userResult.user),
    tenant: getEffectiveTenant(tenantResult.tenant, userResult.user) || null,
    tenants: withEffectiveTenantRoles(tenantResult.tenants || [tenantResult.tenant], userResult.user),
    plan: getPublicPlanPayload(getPlan(getEffectivePlanId(tenantResult.tenant, userResult.user))),
    trialDaysRemaining: getTrialDaysRemaining(tenantResult.tenant),
    persona: userPersona,
    membership: { role: 'owner' },
    canManageWorkspace: true,
    referral: getReferralSummary(tenantResult.tenant, getRequestOrigin(req)),
    emailVerificationAvailable: verification.emailConfigured,
    verificationEmailSent: verification.sent,
    canManageSupport: canManageSupport(userResult.user),
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
    workspaceRecovered = true;
  }

  primaryTenant = ensureInternalOwnerEntitlement(primaryTenant, result.user);
  userTenants = findTenantsForUser(result.user.id);
  store.ensureTenant(primaryTenant, result.user);
  await persistUserWorkspace(result.user, primaryTenant);
  const persona = store.getPersona(primaryTenant.id);
  const effectiveRole = getEffectiveMembershipRole(getMembership(primaryTenant.id, result.user.id), result.user);
  const { cookie } = await createSession(result.user.id, primaryTenant.id);
  setSessionCookie(res, cookie);

  return sendJson(res, 200, {
    user: safeUser(result.user),
    tenant: getEffectiveTenant(primaryTenant, result.user),
    tenants: withEffectiveTenantRoles(userTenants, result.user),
    plan: getPublicPlanPayload(getPlan(getEffectivePlanId(primaryTenant, result.user))),
    trialDaysRemaining: getEffectivePlanId(primaryTenant, result.user) !== ownerPlanId ? getTrialDaysRemaining(primaryTenant) : null,
    referral: getReferralSummary(primaryTenant, getRequestOrigin(req)),
    persona,
    membership: { role: effectiveRole },
    canManageWorkspace: canDeleteWorkspaceData(effectiveRole),
    workspaceRecovered,
    emailVerificationAvailable: isEmailConfigured(),
    canManageSupport: canManageSupport(result.user),
  });
}

async function handleLogout(req, res) {
  const sessionData = extractSession(req);
  clearSessionCookie(res);
  if (sessionData) {
    await destroySession(sessionData.id);
  }
  return sendJson(res, 200, { ok: true });
}

async function handleMe(req, res) {
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
      membership = getMembership(tenant.id, user.id);
      tenant = ensureInternalOwnerEntitlement(tenant, user);
      userTenants = findTenantsForUser(user.id);
      store.ensureTenant(tenant, user);
      await persistUserWorkspace(user, tenant);
      const { cookie } = await createSession(user.id, tenant.id);
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
  const effectiveRole = getEffectiveMembershipRole(membership, user);

  return sendJson(res, 200, {
    authenticated: true,
    demo: isReadOnlyDemoSession(sessionData, tenant),
    readOnly: isReadOnlyDemoSession(sessionData, tenant),
    user: safeUser(user),
    tenant: getEffectiveTenant(tenant, user),
    tenants: withEffectiveTenantRoles(userTenants, user),
    membership: membership ? { role: effectiveRole } : null,
    canManageWorkspace: canDeleteWorkspaceData(effectiveRole),
    plan: getPublicPlanPayload(plan),
    trialDaysRemaining,
    billingRequired,
    referral: getReferralSummary(tenant, getRequestOrigin(req)),
    persona,
    emailVerificationAvailable: isEmailConfigured(),
    canManageSupport: canManageSupport(user),
  });
}

async function handleCreateTenant(req, res, user) {
  const { name, slug } = await readJson(req);
  const result = createTenant({
    name,
    slug,
    plan: isInternalOwner(user) ? ownerPlanId : 'trial',
    ownerUserId: user.id,
    storageMode: RELATIONAL_WRITE_NEW_TENANTS ? 'relational' : 'legacy',
  });
  if (result.error) {
    return sendJson(res, 409, { error: result.error });
  }
  const tenant = ensureInternalOwnerEntitlement(result.tenant, user);
  store.ensureTenant(tenant, user);
  await persistUserWorkspace(user, tenant);
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
  if (pathname === '/' || pathname === '/index.html') {
    return sendHtml(res, getCloudIndexHtml(res.bdScriptNonce));
  }
  const cloudPath = tryStaticFile(publicDir, pathname);
  if (cloudPath) return streamFile(cloudPath, res);

  // Fall through to app dir for root-level asset requests (styles.css, app.js, etc.)
  const appFallbackPath = tryStaticFile(appDir, pathname);
  if (appFallbackPath) return streamFile(appFallbackPath, res);

  // SPA fallback: serve cloud index.html for unmatched routes
  const cloudIndex = join(publicDir, 'index.html');
  if (existsSync(cloudIndex)) return sendHtml(res, getCloudIndexHtml(res.bdScriptNonce));

  return sendJson(res, 404, { error: 'Not found' });
}

let cachedAppIndexHtml = null;
let cachedCloudIndexHtml = null;

function getCloudIndexHtml(scriptNonce) {
  if (!cachedCloudIndexHtml) {
    cachedCloudIndexHtml = readFileSync(join(publicDir, 'index.html'), 'utf8');
  }
  return injectScriptNonce(cachedCloudIndexHtml, scriptNonce);
}

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
  // Persona language is rendered directly by the shared app, so no DOM label
  // overlay is injected into the cloud shell.
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
      path: safeRequestPath(req.url),
      statusCode: Number(statusCode),
      elapsedMs,
      at: new Date().toISOString(),
    };
  }
}

function getHealthPayload(includeDetails = false) {
  const release = RELEASE;
  const uptimeSeconds = Math.round((Date.now() - serverStartedAt.getTime()) / 1000);
  const averageDurationMs = serverStats.requestCount
    ? Math.round(serverStats.totalDurationMs / serverStats.requestCount)
    : 0;
  const stripeStatus = getStripeConfigStatus();
  const operational = store.getOperationalMetrics();
  const errorRatePercent = serverStats.requestCount
    ? Math.round((serverStats.errorCount / serverStats.requestCount) * 10000) / 100
    : 0;
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
    supportNotificationsConfigured: isEmailConfigured() && supportAdminEmails.size > 0,
    errorAlertsConfigured: Boolean(ERROR_WEBHOOK),
    relationalMirrorConfigured: isDbEnabled(),
    relationalMirrorHealthy: relationalMirrorHealth.healthy,
    relationalMirrorWorkspaceCount: relationalMirrorHealth.workspaceCount,
    relationalMirrorMismatchCount: relationalMirrorHealth.mismatchCount,
    relationalMirrorCheckedAt: relationalMirrorHealth.checkedAt,
    relationalContentConfigured: RELATIONAL_DEEP_CHECK_CONFIGURED,
    relationalContentHealthy: relationalContentHealth.healthy,
    relationalContentWorkspaceCount: relationalContentHealth.workspaceCount,
    relationalContentMismatchCount: relationalContentHealth.mismatchCount,
    relationalContentCheckedAt: relationalContentHealth.checkedAt,
    relationalPrimaryWorkspaceCount: getRelationalPrimaryTenantIds().length,
    relationalNewWorkspaceDefault: RELATIONAL_WRITE_NEW_TENANTS,
    backgroundQueueHealthy: operational.healthy,
  };
  const payload = {
    ok: true,
    app: 'bd-engine-cloud',
    mode: process.env.BD_CLOUD_ENV || process.env.NODE_ENV || 'development',
    release,
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
      errorRatePercent,
      background: operational,
    };
    payload.slo = {
      targets: {
        http5xxRatePercentMax: 1,
        backgroundJobMaxAgeMs: operational.staleAfterMs,
        ingestionSuccessRatePercentMin: 95,
      },
      observed: {
        http5xxRatePercent: errorRatePercent,
        backgroundJobMaxAgeMs: operational.oldestActiveAgeMs,
        ingestionSuccessRatePercent24h: operational.ingestionSuccessRate24h,
      },
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
  assertDeclaredBodyWithinLimit(req, requestLimits.maxBodyBytes);
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > requestLimits.maxBodyBytes) throw requestBodyTooLargeError();
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
