import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const publicDir = existsSync(join(rootDir, 'app')) ? join(rootDir, 'app') : join(rootDir, '..', 'app');
const port = Number(process.env.BD_CLOUD_PORT || 8787);
const store = createStore();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const startedAt = performance.now();
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
}).listen(port, '127.0.0.1', () => {
  console.log(`BD Engine Cloud prototype running at http://127.0.0.1:${port}`);
});

async function route(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`);
  const session = store.getSession();

  if (url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      app: 'bd-engine-cloud',
      mode: process.env.BD_CLOUD_ENV || 'development',
    });
  }

  if (url.pathname === '/api/session') {
    return sendJson(res, 200, session);
  }

  if (url.pathname === '/api/setup/status') {
    return sendJson(res, 200, store.getSetupStatus(session.tenant.id));
  }

  if (url.pathname === '/api/runtime/status') {
    return sendJson(res, 200, store.getRuntimeStatus());
  }

  if (url.pathname === '/api/bootstrap') {
    return sendJson(res, 200, store.getBootstrap(session.tenant.id, {
      includeFilters: isTruthy(url.searchParams.get('includeFilters')),
    }));
  }

  if (url.pathname === '/api/admin/bootstrap') {
    return sendJson(res, 200, {
      bootstrap: store.getBootstrap(session.tenant.id, { includeFilters: true }),
      runtime: store.getRuntimeStatus(),
      targetScoreRollout: store.getTargetScoreRollout(session.tenant.id),
      resolverReport: store.getResolverReport(session.tenant.id),
      enrichmentReport: store.getEnrichmentReport(session.tenant.id),
      unresolvedQueue: store.getResolverQueue(session.tenant.id, 'unresolved'),
      mediumQueue: store.getResolverQueue(session.tenant.id, 'medium'),
      enrichmentQueue: store.getEnrichmentQueue(session.tenant.id, Object.fromEntries(url.searchParams)),
      configs: store.findConfigs(session.tenant.id, Object.fromEntries(url.searchParams)),
    });
  }

  if (url.pathname === '/api/owners') {
    return sendJson(res, 200, { owners: store.getBootstrap(session.tenant.id).ownerRoster });
  }

  if (url.pathname === '/api/dashboard') {
    return sendJson(res, 200, store.getDashboard(session.tenant.id));
  }

  if (url.pathname === '/api/dashboard/extended') {
    return sendJson(res, 200, store.getDashboardExtended(session.tenant.id));
  }

  if (url.pathname === '/api/accounts') {
    return sendJson(res, 200, store.findAccounts(session.tenant.id, Object.fromEntries(url.searchParams)));
  }

  const accountOutreachMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/generate-outreach$/);
  if (accountOutreachMatch && req.method === 'POST') {
    const payload = await readJson(req);
    const draft = store.createOutreachDraft(session.tenant.id, accountOutreachMatch[1], payload);
    if (!draft) return sendJson(res, 404, { error: 'Account not found' });
    return sendJson(res, 201, draft);
  }

  const hiringVelocityMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/hiring-velocity$/);
  if (hiringVelocityMatch && req.method === 'GET') {
    const velocity = store.getHiringVelocity(session.tenant.id, hiringVelocityMatch[1]);
    if (!velocity) return sendJson(res, 404, { error: 'Account not found' });
    return sendJson(res, 200, velocity);
  }

  const accountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (accountMatch) {
    if (req.method === 'GET') {
      const detail = store.getAccountDetail(session.tenant.id, accountMatch[1]);
      if (!detail) return sendJson(res, 404, { error: 'Account not found' });
      return sendJson(res, 200, detail);
    }
    if (req.method === 'PATCH') {
      const account = store.patchAccount(session.tenant.id, accountMatch[1], await readJson(req));
      if (!account) return sendJson(res, 404, { error: 'Account not found' });
      return sendJson(res, 200, account);
    }
  }

  if (url.pathname === '/api/contacts') {
    return sendJson(res, 200, store.findContacts(session.tenant.id, Object.fromEntries(url.searchParams)));
  }

  const contactMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)$/);
  if (contactMatch && req.method === 'PATCH') {
    const contact = store.patchContact(session.tenant.id, contactMatch[1], await readJson(req));
    if (!contact) return sendJson(res, 404, { error: 'Contact not found' });
    return sendJson(res, 200, contact);
  }

  if (url.pathname === '/api/jobs') {
    return sendJson(res, 200, store.findJobs(session.tenant.id, Object.fromEntries(url.searchParams)));
  }

  if (url.pathname === '/api/configs') {
    if (req.method === 'GET') {
      return sendJson(res, 200, store.findConfigs(session.tenant.id, Object.fromEntries(url.searchParams)));
    }
    if (req.method === 'POST') {
      return sendJson(res, 201, store.addConfig(session.tenant.id, await readJson(req)));
    }
  }

  const configMatch = url.pathname.match(/^\/api\/configs\/([^/]+)$/);
  if (configMatch && req.method === 'PATCH') {
    const config = store.patchConfig(session.tenant.id, configMatch[1], await readJson(req));
    if (!config) return sendJson(res, 404, { error: 'Config not found' });
    return sendJson(res, 200, config);
  }

  if (url.pathname === '/api/settings' && req.method === 'POST') {
    return sendJson(res, 200, store.patchSettings(session.tenant.id, await readJson(req)));
  }

  if (url.pathname === '/api/activity') {
    if (req.method === 'GET') {
      return sendJson(res, 200, store.getActivity(session.tenant.id, Object.fromEntries(url.searchParams)));
    }
    if (req.method === 'POST') {
      return sendJson(res, 201, store.addActivity(session.tenant.id, session.user.id, await readJson(req)));
    }
  }

  if (url.pathname === '/api/search') {
    return sendJson(res, 200, store.search(session.tenant.id, Object.fromEntries(url.searchParams)));
  }

  if (url.pathname === '/api/enrichment/queue') {
    return sendJson(res, 200, store.getEnrichmentQueue(session.tenant.id, Object.fromEntries(url.searchParams)));
  }

  const accountJobActionMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/(quick-enrich|resolve-now|deep-verify|quick-update)$/);
  if (accountJobActionMatch && req.method === 'POST') {
    return sendJson(res, 202, store.createCompletedJob(`${accountJobActionMatch[2]}-${accountJobActionMatch[1]}`, {
      stats: { totalUpdated: 1, checked: 1, verified: 1 },
      timings: { enrichmentMs: 1 },
      durationMs: 1,
    }));
  }

  const configActionMatch = url.pathname.match(/^\/api\/configs\/([^/]+)\/(resolve|review)$/);
  if (configActionMatch && req.method === 'POST') {
    if (configActionMatch[2] === 'review') {
      const config = store.reviewConfig(session.tenant.id, configActionMatch[1], await readJson(req));
      if (!config) return sendJson(res, 404, { error: 'Config not found' });
      return sendJson(res, 200, config);
    }
    return sendJson(res, 202, store.createCompletedJob(`config-resolution-${configActionMatch[1]}`));
  }

  if ((url.pathname === '/api/configs/sync' || url.pathname === '/api/admin/target-score-rollout') && req.method === 'POST') {
    return sendJson(res, 202, store.createCompletedJob(url.pathname.split('/').pop(), {
      count: boardCountHint(),
      accountCount: boardCountHint(),
      batchCount: 1,
      remainingCount: 0,
      timings: { deriveMs: 1, scopeLoadMs: 1, persistMs: 1 },
    }));
  }

  if (url.pathname.startsWith('/api/import/') || url.pathname.startsWith('/api/enrichment/') || url.pathname.startsWith('/api/discovery/') || url.pathname.startsWith('/api/google-sheets/')) {
    return sendJson(res, 202, store.createCompletedJob('cloud-stub-job'));
  }

  const backgroundJobMatch = url.pathname.match(/^\/api\/background-jobs\/([^/]+)$/);
  if (backgroundJobMatch) {
    return sendJson(res, 200, store.getBackgroundJob(backgroundJobMatch[1]));
  }

  const draftMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)\/outreach-draft$/);
  if (draftMatch && req.method === 'POST') {
    const draft = store.createOutreachDraft(session.tenant.id, draftMatch[1]);
    if (!draft) return sendJson(res, 404, { error: 'Contact not found' });
    return sendJson(res, 201, draft);
  }

  const logMatch = url.pathname.match(/^\/api\/contacts\/([^/]+)\/log-outreach$/);
  if (logMatch && req.method === 'POST') {
    const payload = await readJson(req);
    const result = store.logOutreach(session.tenant.id, session.user.id, {
      ...payload,
      contactId: logMatch[1],
    });
    if (!result) return sendJson(res, 404, { error: 'Contact not found' });
    return sendJson(res, 201, result);
  }

  return serveStatic(url.pathname, res);
}

function serveStatic(pathname, res) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  res.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
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

function boardCountHint() {
  return 2;
}
