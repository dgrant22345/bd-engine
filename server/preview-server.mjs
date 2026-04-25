// Lightweight dev server for preview tooling.
// Serves static files from app/ and proxies /api/* to the PowerShell backend.
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP_DIR = join(__dirname, '..', 'app');
const PORT = parseInt(process.argv[2] || '8173', 10);
const BACKEND_PORT = 18173; // High port to avoid TIME_WAIT conflicts

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Start the PowerShell backend in the background
const ps = spawn('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', join(__dirname, 'Server.ps1'),
  '-Port', String(BACKEND_PORT),
], { stdio: ['ignore', 'pipe', 'pipe'] });

ps.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
ps.stderr.on('data', (d) => process.stderr.write(`[backend:err] ${d}`));
ps.on('exit', (code) => console.log(`[backend] exited with code ${code}`));

// Give backend time to warm up, but don't block the HTTP server start
let backendReady = false;
const backendCheck = setInterval(async () => {
  try {
    await new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: BACKEND_PORT, path: '/api/bootstrap', timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(); });
      req.end();
    });
    backendReady = true;
    clearInterval(backendCheck);
    console.log(`[backend] Ready on port ${BACKEND_PORT}`);
  } catch { /* still warming up */ }
}, 2000);

function proxy(req, res) {
  if (!backendReady) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Backend is still starting up. Please wait a moment and retry.' }));
    return;
  }
  const opts = {
    hostname: '127.0.0.1',
    port: BACKEND_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` },
  };
  const proxyReq = httpRequest(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Backend unavailable' }));
  });
  req.pipe(proxyReq, { end: true });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Proxy API requests to PowerShell backend
  if (url.pathname.startsWith('/api/')) {
    proxy(req, res);
    return;
  }

  // Static file serving
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const fullPath = join(APP_DIR, filePath);

  // Prevent path traversal
  if (!fullPath.startsWith(APP_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(fullPath);
    const ext = extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Preview server listening on http://localhost:${PORT}`);
  console.log(`Backend proxied from port ${BACKEND_PORT} (warming up...)`);
});

// Cleanup on exit
function cleanup() {
  try { ps.kill(); } catch {}
  process.exit();
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => { try { ps.kill(); } catch {} });
