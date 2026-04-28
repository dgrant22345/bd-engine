import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { extractSession, createSession, destroySession, setSessionCookie, clearSessionCookie } from './auth.js';
import { createUser, authenticateUser, findUserById, findTenantsForUser, findTenantById, findTenantByStripeCustomerId, findTenantByReferralCode, findTenantsReferredBy, getMembership, safeUser, createTenant, ensureTenantForUser, persistUserWorkspace, updateTenant, loadFromDb as loadUsersFromDb, normalizeReferralCode } from './users.js';
import { getPlan, getPlanByStripePriceId, getTrialDaysRemaining, getUsageSummary, PLANS, handleWebhookEvent, createCheckoutSession, createBillingPortalSession, createReferralCredit, isStripeConfigured, getStripeConfigStatus, isTrialExpired } from './billing.js';
import { initDb, closeDb, isDbEnabled, isDbReady, dbRecordAnalyticsVisit, dbGetAnalyticsSummary } from './db.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const appDir = existsSync(join(rootDir, 'app')) ? join(rootDir, 'app') : join(rootDir, '..', 'app');
const publicDir = join(rootDir, 'public');
const port = Number(process.env.BD_CLOUD_PORT || 8787);
const host = process.env.BD_CLOUD_HOST || '0.0.0.0';
const store = createStore();
const serverStartedAt = new Date();
const referralCreditAmountCents = Number(process.env.BD_REFERRAL_CREDIT_CENTS || 500);
const serverStats = {
  requestCount: 0,
  errorCount: 0,
  statusCounts: {},
  totalDurationMs: 0,
  slowestRequest: null,
  lastError: null,
};

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

  const server = createServer(async (req, res) => {
    const startedAt = performance.now();
    // CORS for dev
    res.setHeader('Access-Control-Allow-Origin', '*');
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
      serverStats.errorCount += 1;
      serverStats.lastError = {
        at: new Date().toISOString(),
        method: req.method,
        url: req.url,
        message: error.message || 'Unexpected server error',
      };
      sendJson(res, error.status || 500, {
        error: error.message || 'Unexpected server error',
      });
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

  // Graceful shutdown
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      console.log(`\n  Received ${signal}, shutting down...`);
      server.close();
      await closeDb();
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
        store.startRevenuePipeline(tenant.id);
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
      await store.loadFromDb();
    }
  } catch (error) {
    console.error('Startup data initialization failed:', error.message || error);
  }
}

function isHealthRequest(req) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
    return url.pathname === '/health' || url.pathname === '/api/health' || url.pathname === '/api/status';
  } catch {
    return false;
  }
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

function isTenantBillingBlocked(tenant) {
  if (!tenant) return false;
  if (tenant.plan === 'trial') return isTrialExpired(tenant);
  const status = String(tenant.status || '').toLowerCase();
  return !['active', 'trialing'].includes(status);
}

function sendBillingRequired(res, tenant) {
  return sendJson(res, 402, {
    error: 'Your trial has ended. Choose a plan to continue using BD Engine.',
    code: 'billing_required',
    billingRequired: true,
    plan: tenant?.plan || 'trial',
    status: tenant?.status || '',
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

  // Health and public status checks.
  if (pathname === '/health' || pathname === '/api/health' || pathname === '/api/status') {
    return sendJson(res, 200, getHealthPayload(pathname === '/api/status'));
  }

  // ── Auth endpoints (public) ───────────────────────────────────────────────

  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    return handleSignup(req, res);
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    return handleLogin(req, res);
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    return handleLogout(req, res);
  }

  if (pathname === '/api/plans') {
    return sendJson(res, 200, {
      plans: Object.values(PLANS).map((p) => ({
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
    store.ensureTenant(tenant, user);
    await persistUserWorkspace(user, tenant);
    const { cookie } = createSession(user.id, tenantId);
    setSessionCookie(res, cookie);
  }

  if (!membership) {
    return sendJson(res, 403, { error: 'You are not a member of this workspace.' });
  }

  // Build session object compatible with existing frontend
  const session = {
    tenant: { ...tenant },
    user: safeUser(user),
    membership: { role: membership.role },
  };
  store.ensureTenant(tenant, session.user);

  if (isTenantBillingBlocked(tenant) && !isBillingExemptPath(pathname)) {
    return sendBillingRequired(res, tenant);
  }

  // ── Tenant management ─────────────────────────────────────────────────────

  if (pathname === '/api/tenants' && req.method === 'POST') {
    return handleCreateTenant(req, res, user);
  }

  if (pathname === '/api/tenants') {
    const userTenants = findTenantsForUser(user.id);
    return sendJson(res, 200, { tenants: userTenants });
  }

  // ── Billing ───────────────────────────────────────────────────────────────

  if (pathname === '/api/billing') {
    const plan = getPlan(tenant.plan);
    const trialDaysRemaining = getTrialDaysRemaining(tenant);
    const usage = getUsageSummary(tenantId, tenant.plan);
    const origin = getRequestOrigin(req);
    return sendJson(res, 200, {
      plan,
      trialDaysRemaining,
      usage,
      stripe: getStripeConfigStatus(),
      canManageBilling: Boolean(tenant.stripeCustomerId || tenant.stripe_customer_id),
      tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status },
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
      const sessionUrl = await createCheckoutSession(tenantId, user.email, planId, successUrl, cancelUrl, {
        referredByTenantId: tenant.referredByTenantId || tenant.referred_by_tenant_id || '',
        referralCode: tenant.referralCode || tenant.referral_code || '',
      });
      return sendJson(res, 200, { url: sessionUrl });
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

  if (pathname === '/api/setup/status') {
    return sendJson(res, 200, await store.getSetupStatus(tenantId));
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
    const analyticsStartedAt = performance.now();
    const analytics = await dbGetAnalyticsSummary(30);
    const analyticsElapsedMs = Math.round(performance.now() - analyticsStartedAt);
    if (analyticsElapsedMs > 250) {
      console.warn(`Slow analytics summary: saas/src/db.js dbGetAnalyticsSummary ${analyticsElapsedMs}ms`);
    }
    const origin = getRequestOrigin(req);
    return sendJson(res, 200, {
      bootstrap: bootstrapData,
      runtime: store.getRuntimeStatus(),
      targetScoreRollout: store.getTargetScoreRollout(tenantId),
      resolverReport: store.getResolverReport(tenantId),
      enrichmentReport: store.getEnrichmentReport(tenantId),
      unresolvedQueue: store.getResolverQueue(tenantId, 'unresolved'),
      mediumQueue: store.getResolverQueue(tenantId, 'medium'),
      enrichmentQueue: store.getEnrichmentQueue(tenantId, Object.fromEntries(url.searchParams)),
      configs: store.findConfigs(tenantId, Object.fromEntries(url.searchParams)),
      analytics,
      billing: {
        plan: getPlan(tenant.plan),
        trialDaysRemaining: getTrialDaysRemaining(tenant),
        usage: getUsageSummary(tenantId, tenant.plan),
        stripe: getStripeConfigStatus(),
        canManageBilling: Boolean(tenant.stripeCustomerId || tenant.stripe_customer_id),
        tenant: { plan: tenant.plan, status: tenant.status },
        referral: getReferralSummary(tenant, origin),
      },
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
    const draft = store.createOutreachDraft(tenantId, accountOutreachMatch[1], payload);
    if (!draft) return sendJson(res, 404, { error: 'Account not found' });
    return sendJson(res, 201, draft);
  }

  const hiringVelocityMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/hiring-velocity$/);
  if (hiringVelocityMatch && req.method === 'GET') {
    const velocity = store.getHiringVelocity(tenantId, hiringVelocityMatch[1]);
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
    return sendJson(res, 200, store.findJobs(tenantId, Object.fromEntries(url.searchParams)));
  }

  if (pathname === '/api/configs') {
    if (req.method === 'GET') {
      return sendJson(res, 200, store.findConfigs(tenantId, Object.fromEntries(url.searchParams)));
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
    return sendJson(res, 200, store.patchSettings(tenantId, await readJson(req)));
  }

  if (pathname === '/api/setup/complete' && req.method === 'POST') {
    const payload = await readFormOrJson(req);
    const fields = payload.fields || payload;
    const csvText = payload.files?.connectionsCsv?.content || fields.csvContent || '';
    const plan = getPlan(tenant.plan);

    if (csvText) {
      const accepted = store.startLinkedInCsvImport(tenantId, csvText, { plan });
      return sendJson(res, 202, {
        ok: true,
        setupComplete: false,
        status: await store.getSetupStatus(tenantId),
        ...accepted,
      });
    }

    store.completeSetup(tenantId);
    return sendJson(res, 200, {
      ok: true,
      setupComplete: true,
      status: await store.getSetupStatus(tenantId),
    });
  }

  if (pathname === '/api/activity') {
    if (req.method === 'GET') {
      return sendJson(res, 200, store.getActivity(tenantId, Object.fromEntries(url.searchParams)));
    }
    if (req.method === 'POST') {
      return sendJson(res, 201, store.addActivity(tenantId, user.id, await readJson(req)));
    }
  }

  if (pathname.startsWith('/api/tasks')) {
    if (req.method === 'GET') {
      return sendJson(res, 200, store.findTasks(tenantId, Object.fromEntries(url.searchParams)));
    }
    const match = pathname.match(/^\/api\/tasks\/([^/]+)\/complete$/);
    if (match && req.method === 'POST') {
      return sendJson(res, 200, store.completeTask(tenantId, match[1]));
    }
  }

  if (pathname === '/api/search') {
    return sendJson(res, 200, store.search(tenantId, Object.fromEntries(url.searchParams)));
  }

  if (pathname === '/api/enrichment/queue') {
    return sendJson(res, 200, store.getEnrichmentQueue(tenantId, Object.fromEntries(url.searchParams)));
  }

  const accountJobActionMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/(quick-enrich|resolve-now|deep-verify|quick-update)$/);
  if (accountJobActionMatch && req.method === 'POST') {
    return sendJson(res, 202, store.createCompletedJob(`${accountJobActionMatch[2]}-${accountJobActionMatch[1]}`, {
      stats: { totalUpdated: 1, checked: 1, verified: 1 },
      timings: { enrichmentMs: 1 },
      durationMs: 1,
    }));
  }

  const configActionMatch = pathname.match(/^\/api\/configs\/([^/]+)\/(resolve|review)$/);
  if (configActionMatch && req.method === 'POST') {
    if (configActionMatch[2] === 'review') {
      const config = store.reviewConfig(tenantId, configActionMatch[1], await readJson(req));
      if (!config) return sendJson(res, 404, { error: 'Config not found' });
      return sendJson(res, 200, config);
    }
    return sendJson(res, 202, store.createCompletedJob(`config-resolution-${configActionMatch[1]}`));
  }

  if ((pathname === '/api/configs/sync' || pathname === '/api/admin/target-score-rollout') && req.method === 'POST') {
    return sendJson(res, 202, store.createCompletedJob(pathname.split('/').pop(), {
      count: 2,
      accountCount: 2,
      batchCount: 1,
      remainingCount: 0,
      timings: { deriveMs: 1, scopeLoadMs: 1, persistMs: 1 },
    }));
  }

  // ── LinkedIn CSV import (real) ─────────────────────────────────────────
  if (pathname === '/api/import/connections-csv/preview' && req.method === 'POST') {
    const payload = await readFormOrJson(req);
    const csvText = payload.files?.connectionsCsv?.content || payload.fields?.csvContent || payload.csvContent || '';
    const plan = getPlan(tenant.plan);
    const result = await store.importLinkedInCSV(tenantId, csvText, {
      dryRun: true,
      plan,
    });
    if (result.error) return sendJson(res, 400, result);
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/import/linkedin-csv' && req.method === 'POST') {
    const payload = await readFormOrJson(req);
    const fields = payload.fields || payload;
    const csvText = payload.files?.connectionsCsv?.content || fields.csvContent || payload.text || '';

    const plan = getPlan(tenant.plan);
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
    const plan = getPlan(tenant.plan);
    const result = store.runLaunchWorkflow(tenantId, { plan });
    const job = store.createCompletedJob('launch-workflow', result);
    return sendJson(res, 202, { ...job, ...result });
  }

  if (pathname === '/api/admin/pipeline/start' && req.method === 'POST') {
    const job = store.startRevenuePipeline(tenantId);
    return sendJson(res, 202, job);
  }

  const pipelineStatusMatch = pathname.match(/^\/api\/admin\/pipeline\/status\/([^/]+)$/);
  if (pipelineStatusMatch && req.method === 'GET') {
    const job = store.getBackgroundJob(pipelineStatusMatch[1]);
    return sendJson(res, 200, job);
  }

  // Stub remaining import/enrichment/discovery endpoints
  if (pathname.startsWith('/api/import/') || pathname.startsWith('/api/enrichment/') || pathname.startsWith('/api/discovery/') || pathname.startsWith('/api/google-sheets/')) {
    return sendJson(res, 202, store.createCompletedJob('cloud-stub-job'));
  }

  const backgroundJobMatch = pathname.match(/^\/api\/background-jobs\/([^/]+)$/);
  if (backgroundJobMatch) {
    return sendJson(res, 200, store.getBackgroundJob(backgroundJobMatch[1]));
  }

  const draftMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/outreach-draft$/);
  if (draftMatch && req.method === 'POST') {
    const draft = store.createOutreachDraft(tenantId, draftMatch[1]);
    if (!draft) return sendJson(res, 404, { error: 'Contact not found' });
    return sendJson(res, 201, draft);
  }

  const logMatch = pathname.match(/^\/api\/contacts\/([^/]+)\/log-outreach$/);
  if (logMatch && req.method === 'POST') {
    const payload = await readJson(req);
    const result = store.logOutreach(tenantId, user.id, {
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
    const tenant = updateTenant(tenantId, {
      plan: planId,
      status: 'active',
      stripeCustomerId: getStripeId(object.customer),
      stripeSubscriptionId: getStripeId(object.subscription),
    });
    const referral = await maybeGrantReferralCredit(tenant, object);
    const pendingReferralCredits = tenant ? await grantPendingReferralCreditsForReferrer(tenant) : [];
    return { updated: Boolean(tenant), tenantId, planId, referral, pendingReferralCredits };
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const customerId = getStripeId(object.customer);
    const tenantId = object.metadata?.tenantId || findTenantByStripeCustomerId(customerId)?.id || '';
    const priceId = object.items?.data?.[0]?.price?.id || '';
    const planId = object.metadata?.planId || getPlanByStripePriceId(priceId)?.id || '';
    if (!tenantId) return { updated: false, reason: 'workspace not found for subscription' };
    const updates = {
      status: object.status || 'active',
      stripeCustomerId: customerId,
      stripeSubscriptionId: object.id || '',
    };
    if (planId) updates.plan = planId;
    const tenant = updateTenant(tenantId, updates);
    return { updated: Boolean(tenant), tenantId, planId: planId || tenant?.plan || '' };
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = getStripeId(object.customer);
    const tenantId = object.metadata?.tenantId || findTenantByStripeCustomerId(customerId)?.id || '';
    if (!tenantId) return { updated: false, reason: 'workspace not found for canceled subscription' };
    const tenant = updateTenant(tenantId, {
      status: 'canceled',
      stripeCustomerId: customerId,
      stripeSubscriptionId: object.id || '',
    });
    return { updated: Boolean(tenant), tenantId, status: 'canceled' };
  }

  return { updated: false, ignored: true };
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
    updateTenant(referredTenant.id, {
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

  // Create default workspace
  const userPersona = persona === 'jobseeker' ? 'jobseeker' : 'bd';
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

  const tenantId = tenantResult.tenant.id;
  // Ensure the store also knows the persona
  store.ensureTenant(tenantResult.tenant, userResult.user);
  store.setPersona(tenantId, userPersona);
  await persistUserWorkspace(userResult.user, tenantResult.tenant);
  const { cookie } = createSession(userResult.user.id, tenantId);
  setSessionCookie(res, cookie);

  return sendJson(res, 201, {
    user: safeUser(userResult.user),
    tenant: tenantResult.tenant || null,
    tenants: tenantResult.tenants || [tenantResult.tenant],
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

  store.ensureTenant(primaryTenant, result.user);
  await persistUserWorkspace(result.user, primaryTenant);
  const persona = store.getPersona(primaryTenant.id);
  const { cookie } = createSession(result.user.id, primaryTenant.id);
  setSessionCookie(res, cookie);

  return sendJson(res, 200, {
    user: safeUser(result.user),
    tenant: primaryTenant,
    tenants: userTenants,
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
      store.ensureTenant(tenant, user);
      persistUserWorkspace(user, tenant).catch(() => {});
      const { cookie } = createSession(user.id, tenant.id);
      setSessionCookie(res, cookie);
    }
  } else {
    store.ensureTenant(tenant, user);
  }

  const plan = tenant ? getPlan(tenant.plan) : null;
  const trialDaysRemaining = tenant ? getTrialDaysRemaining(tenant) : null;
  const persona = tenant ? store.getPersona(tenant.id) : 'bd';
  const billingRequired = tenant ? isTenantBillingBlocked(tenant) : false;

  return sendJson(res, 200, {
    authenticated: true,
    user: safeUser(user),
    tenant,
    tenants: userTenants,
    membership: membership ? { role: membership.role } : null,
    plan: plan ? { id: plan.id, name: plan.name, displayName: plan.displayName } : null,
    trialDaysRemaining,
    billingRequired,
    referral: getReferralSummary(tenant, getRequestOrigin(req)),
    persona,
  });
}

async function handleCreateTenant(req, res, user) {
  const { name, slug } = await readJson(req);
  const result = createTenant({ name, slug, plan: 'trial', ownerUserId: user.id });
  if (result.error) {
    return sendJson(res, 409, { error: result.error });
  }
  return sendJson(res, 201, { tenant: result.tenant });
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

function getAppIndexHtml() {
  const appIndex = join(appDir, 'index.html');
  const html = readFileSync(appIndex, 'utf8');
  return html
    .replace(/href="\/styles\.css/g, 'href="/app/styles.css')
    .replace(/href="\/manifest\.json/g, 'href="/app/manifest.json')
    .replace(/href="\/icons\//g, 'href="/app/icons/')
    .replace(/href="\/app\.js/g, 'href="/app/app.js')
    .replace(/src="\/local-api\.js/g, 'src="/app/local-api.js')
    .replace(/src="\/app\.js/g, 'src="/app/app.js')
    .replace(/<script>\s*if \('serviceWorker' in navigator\) \{[\s\S]*?navigator\.serviceWorker\.register\('\/sw\.js'\)[\s\S]*?\}\s*<\/script>/, '')
    .replace(/<script src="\/app\/local-api\.js/g, '<script src="/persona-labels.js"></script>\n  <script src="/app/local-api.js');
}

function tryStaticFile(baseDir, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.[\\/])+/, '');
  const filePath = join(baseDir, safePath);
  if (!filePath.startsWith(baseDir)) return null;
  if (!existsSync(filePath)) return null;
  return filePath;
}

function streamFile(filePath, res) {
  res.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
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
    };
    payload.lastError = serverStats.lastError;
  }
  return payload;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sendHtml(res, body) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJavaScript(res, body) {
  res.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
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
  for await (const chunk of req) {
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
