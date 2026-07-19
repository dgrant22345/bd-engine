import { normalizePublicOrigin } from './public-origin.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isUnsafeCrossSiteRequest(req, allowedOrigins) {
  if (SAFE_METHODS.has(String(req?.method || 'GET').toUpperCase())) return false;

  const fetchSite = String(req?.headers?.['sec-fetch-site'] || '').trim().toLowerCase();
  if (fetchSite === 'cross-site') return true;

  const rawOrigin = String(req?.headers?.origin || '').trim();
  if (!rawOrigin) return false;
  const origin = normalizePublicOrigin(rawOrigin);
  return !origin || !allowedOrigins.has(origin);
}
