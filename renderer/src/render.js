import { chromium } from 'playwright-core';
import { publicError, validatePublicUrl } from './security.js';

const MAX_HTML_BYTES = readPositiveInteger(process.env.RENDER_MAX_HTML_BYTES, 5 * 1024 * 1024);
const MAX_TIMEOUT_MS = readPositiveInteger(process.env.RENDER_MAX_TIMEOUT_MS, 25000);
const CHROMIUM_SANDBOX = String(process.env.RENDER_CHROMIUM_SANDBOX || '').toLowerCase() === 'true';
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);
let browserPromise = null;

export async function renderCareerPage({ url, timeoutMs }) {
  const boundedTimeout = Math.min(MAX_TIMEOUT_MS, Math.max(3000, Number(timeoutMs) || 20000));
  const target = await validatePublicUrl(url);
  const browser = await getBrowser();
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: 'block',
    viewport: { width: 1365, height: 900 },
    userAgent: 'Mozilla/5.0 (compatible; BD-Engine-Renderer/1.0; +https://bd-engine-production.up.railway.app/)',
  });

  try {
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) return route.abort('blockedbyclient');
      const requestUrl = request.url();
      if (!/^https?:/i.test(requestUrl)) return route.continue();
      try {
        await validatePublicUrl(requestUrl);
        return route.continue();
      } catch {
        return route.abort('blockedbyclient');
      }
    });

    const page = await context.newPage();
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
    page.on('popup', (popup) => popup.close().catch(() => {}));
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: boundedTimeout });
    await page.waitForLoadState('networkidle', { timeout: Math.min(8000, boundedTimeout) }).catch(() => {});
    await page.waitForTimeout(750);
    const finalUrl = await validatePublicUrl(page.url());
    const html = await page.content();
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw publicError(413, 'Rendered page exceeded the response limit.');
    return { html, finalUrl };
  } finally {
    await context.close().catch(() => {});
  }
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      chromiumSandbox: CHROMIUM_SANDBOX,
      args: ['--disable-dev-shm-usage', '--disable-background-networking'],
    }).then((browser) => {
      browser.on('disconnected', () => { browserPromise = null; });
      return browser;
    }).catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => {});
}

function readPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
