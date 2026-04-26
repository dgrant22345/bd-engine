import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(rootDir, 'public');
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

  if (url.pathname === '/api/bootstrap') {
    return sendJson(res, 200, {
      session,
      data: store.getBootstrap(session.tenant.id),
    });
  }

  if (url.pathname === '/api/accounts') {
    return sendJson(res, 200, { items: store.getAccounts(session.tenant.id) });
  }

  if (url.pathname === '/api/contacts') {
    return sendJson(res, 200, { items: store.getContacts(session.tenant.id) });
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
