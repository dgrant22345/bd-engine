import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { extractSession, createSession, destroySession, setSessionCookie, clearSessionCookie } from './auth.js';
import { createUser, authenticateUser, findUserById, findTenantsForUser, findTenantById, getMembership, safeUser, createTenant } from './users.js';
import { getPlan, getTrialDaysRemaining, getUsageSummary, PLANS } from './billing.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const appDir = existsSync(join(rootDir, 'app')) ? join(rootDir, 'app') : join(rootDir, '..', 'app');
const publicDir = join(rootDir, 'public');
const port = Number(process.env.BD_CLOUD_PORT || 8787);
const host = process.env.BD_CLOUD_HOST || '0.0.0.0';
const store = createStore();

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

createServer(async (req, res) => {
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
    await route(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || 'Unexpected server error',
    });
  } finally {
    const elapsedMs = Math.round(performance.now() - startedAt);
    console.log(`${req.method} ${req.url} ${res.statusCode || 200} ${elapsedMs}ms`);
  }
}).listen(port, host, () => {
  console.log(`BD Engine Cloud running at http://${host}:${port}`);
  console.log(`  Demo login: demo@bdengine.io / demo1234`);
});

// ── Routing ─────────────────────────────────────────────────────────────────

async function route(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const pathname = url.pathname;

  // Health check
  if (pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      app: 'bd-engine-cloud',
      mode: process.env.BD_CLOUD_ENV || 'development',
    });
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

  const tenantId = sessionData.tenantId;
  const tenant = findTenantById(tenantId);
  if (!tenant) {
    return sendJson(res, 404, { error: 'Workspace not found.' });
  }

  const membership = getMembership(tenantId, user.id);
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
    return sendJson(res, 200, {
      plan,
      trialDaysRemaining,
      usage,
      tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status },
    });
  }

  // ── Existing app API routes (tenant-scoped) ───────────────────────────────

  if (pathname === '/api/session') {
    return sendJson(res, 200, session);
  }

  if (pathname === '/api/setup/status') {
    return sendJson(res, 200, store.getSetupStatus(tenantId));
  }

  if (pathname === '/api/runtime/status') {
    return sendJson(res, 200, store.getRuntimeStatus());
  }

  if (pathname === '/api/bootstrap') {
    return sendJson(res, 200, store.getBootstrap(tenantId, {
      includeFilters: isTruthy(url.searchParams.get('includeFilters')),
      session,
    }));
  }

  if (pathname === '/api/admin/bootstrap') {
    return sendJson(res, 200, {
      bootstrap: store.getBootstrap(tenantId, { includeFilters: true, session }),
      runtime: store.getRuntimeStatus(),
      targetScoreRollout: store.getTargetScoreRollout(tenantId),
      resolverReport: store.getResolverReport(tenantId),
      enrichmentReport: store.getEnrichmentReport(tenantId),
      unresolvedQueue: store.getResolverQueue(tenantId, 'unresolved'),
      mediumQueue: store.getResolverQueue(tenantId, 'medium'),
      enrichmentQueue: store.getEnrichmentQueue(tenantId, Object.fromEntries(url.searchParams)),
      configs: store.findConfigs(tenantId, Object.fromEntries(url.searchParams)),
    });
  }

  if (pathname === '/api/owners') {
    return sendJson(res, 200, { owners: store.getBootstrap(tenantId, { session }).ownerRoster });
  }

  if (pathname === '/api/dashboard') {
    return sendJson(res, 200, store.getDashboard(tenantId));
  }

  if (pathname === '/api/dashboard/extended') {
    return sendJson(res, 200, store.getDashboardExtended(tenantId));
  }

  if (pathname === '/api/accounts') {
    return sendJson(res, 200, store.findAccounts(tenantId, Object.fromEntries(url.searchParams)));
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
      const detail = store.getAccountDetail(tenantId, accountMatch[1]);
      if (!detail) return sendJson(res, 404, { error: 'Account not found' });
      return sendJson(res, 200, detail);
    }
    if (req.method === 'PATCH') {
      const account = store.patchAccount(tenantId, accountMatch[1], await readJson(req));
      if (!account) return sendJson(res, 404, { error: 'Account not found' });
      return sendJson(res, 200, account);
    }
  }

  if (pathname === '/api/contacts') {
    return sendJson(res, 200, store.findContacts(tenantId, Object.fromEntries(url.searchParams)));
  }

  const contactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
  if (contactMatch && req.method === 'PATCH') {
    const contact = store.patchContact(tenantId, contactMatch[1], await readJson(req));
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

  if (pathname === '/api/activity') {
    if (req.method === 'GET') {
      return sendJson(res, 200, store.getActivity(tenantId, Object.fromEntries(url.searchParams)));
    }
    if (req.method === 'POST') {
      return sendJson(res, 201, store.addActivity(tenantId, user.id, await readJson(req)));
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

// ── Auth handlers ───────────────────────────────────────────────────────────

async function handleSignup(req, res) {
  const { email, password, name, workspaceName } = await readJson(req);

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
  const workspaceDisplayName = workspaceName || `${userResult.user.name}'s Workspace`;
  const tenantResult = createTenant({
    name: workspaceDisplayName,
    slug: `${workspaceDisplayName}-${userResult.user.id.slice(-4)}`,
    plan: 'trial',
    ownerUserId: userResult.user.id,
  });

  if (tenantResult.error) {
    return sendJson(res, 409, { error: tenantResult.error });
  }

  const tenantId = tenantResult.tenant.id;
  const { cookie } = createSession(userResult.user.id, tenantId);
  setSessionCookie(res, cookie);

  return sendJson(res, 201, {
    user: safeUser(userResult.user),
    tenant: tenantResult.tenant || null,
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

  // Find user's tenants
  const userTenants = findTenantsForUser(result.user.id);
  const primaryTenant = userTenants[0];

  if (!primaryTenant) {
    return sendJson(res, 500, { error: 'No workspace found for this account.' });
  }

  const { cookie } = createSession(result.user.id, primaryTenant.id);
  setSessionCookie(res, cookie);

  return sendJson(res, 200, {
    user: safeUser(result.user),
    tenant: primaryTenant,
    tenants: userTenants,
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

  const tenant = findTenantById(sessionData.tenantId);
  const userTenants = findTenantsForUser(user.id);
  const membership = tenant ? getMembership(tenant.id, user.id) : null;
  const plan = tenant ? getPlan(tenant.plan) : null;
  const trialDaysRemaining = tenant ? getTrialDaysRemaining(tenant) : null;

  return sendJson(res, 200, {
    authenticated: true,
    user: safeUser(user),
    tenant,
    tenants: userTenants,
    membership: membership ? { role: membership.role } : null,
    plan: plan ? { id: plan.id, name: plan.name, displayName: plan.displayName } : null,
    trialDaysRemaining,
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
    .replace(/<script>\s*if \('serviceWorker' in navigator\) \{[\s\S]*?navigator\.serviceWorker\.register\('\/sw\.js'\)[\s\S]*?\}\s*<\/script>/, '');
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
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}
