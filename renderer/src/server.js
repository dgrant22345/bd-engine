import crypto from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { closeBrowser, renderCareerPage } from './render.js';
import { publicError, validatePublicUrl } from './security.js';

const MAX_BODY_BYTES = 16 * 1024;

export function createRendererServer(options = {}) {
  const token = String(options.token ?? process.env.RENDERER_TOKEN ?? '');
  const validateUrl = options.validateUrl || validatePublicUrl;
  const limitedRender = createLimiter(options.render || renderCareerPage, {
    concurrency: readPositiveInteger(options.concurrency ?? process.env.RENDER_CONCURRENCY, 1),
    maxQueue: readPositiveInteger(options.maxQueue ?? process.env.RENDER_MAX_QUEUE, 4),
  });

  return http.createServer(async (request, response) => {
    setResponseHeaders(response);
    try {
      const requestUrl = new URL(request.url || '/', 'http://renderer.internal');
      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        return sendJson(response, 200, { ok: true, active: limitedRender.active(), queued: limitedRender.queued() });
      }
      if (request.method !== 'POST' || requestUrl.pathname !== '/render') {
        return sendJson(response, 404, { error: 'Not found.' });
      }
      if (!isAuthorized(request.headers.authorization, token)) {
        return sendJson(response, 401, { error: 'Authentication required.' });
      }
      if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        throw publicError(415, 'Content-Type must be application/json.');
      }

      const payload = JSON.parse(await readRequestBody(request));
      const url = await validateUrl(payload?.url);
      const result = await limitedRender.run({ url, timeoutMs: payload?.timeoutMs });
      return sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof SyntaxError) return sendJson(response, 400, { error: 'Request body must be valid JSON.' });
      const statusCode = Number(error?.statusCode) || 500;
      if (statusCode >= 500) console.error('Renderer request failed', { name: error?.name, message: error?.message });
      return sendJson(response, statusCode, { error: statusCode >= 500 ? 'The page could not be rendered.' : error.message });
    }
  });
}

export function createLimiter(render, { concurrency = 1, maxQueue = 4 } = {}) {
  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < concurrency && queue.length) {
      const item = queue.shift();
      active++;
      Promise.resolve(render(item.payload))
        .then(item.resolve, item.reject)
        .finally(() => {
          active--;
          drain();
        });
    }
  };
  return {
    active: () => active,
    queued: () => queue.length,
    run(payload) {
      if (active >= concurrency && queue.length >= maxQueue) {
        return Promise.reject(publicError(429, 'The renderer is busy. Retry shortly.'));
      }
      return new Promise((resolve, reject) => {
        queue.push({ payload, resolve, reject });
        drain();
      });
    },
  };
}

export function isAuthorized(header, token) {
  if (!token || token.length < 24) return false;
  const supplied = String(header || '').replace(/^Bearer\s+/i, '');
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

async function readRequestBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw publicError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function setResponseHeaders(response) {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'");
  response.setHeader('x-content-type-options', 'nosniff');
}

function sendJson(response, statusCode, body) {
  const content = JSON.stringify(body);
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(content) });
  response.end(content);
}

function readPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const token = String(process.env.RENDERER_TOKEN || '');
  if (token.length < 24) throw new Error('RENDERER_TOKEN must contain at least 24 characters.');
  const port = readPositiveInteger(process.env.PORT, 8790);
  const host = process.env.HOST || '0.0.0.0';
  const server = createRendererServer({ token });
  server.listen(port, host, () => console.log(`ATS renderer listening on ${host}:${port}`));
  const shutdown = async () => {
    server.close();
    await closeBrowser();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
