// HTTP semantics for static files: caching policy, validators, and byte
// ranges. Kept free of server state so it can be unit tested directly.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const ONE_YEAR_SECONDS = 31536000;
const ONE_DAY_SECONDS = 86400;

// Text formats are gzip-compressed on the fly; everything else is sent as
// stored and can therefore be served with byte ranges.
export const COMPRESSIBLE_MIME = /^(text\/|application\/(json|javascript|xml|manifest\+json))|image\/svg\+xml/;

// Deploys replace files in place under stable URLs, so only a content-addressed
// request (its ?v= token equals the file's current hash) may be cached without
// revalidation. Self-hosted font files are vendored release artifacts whose
// bytes never change in place. Other text assets revalidate on every use, and
// other binary media may be reused for a day before revalidating.
export function staticCacheControl({ versionMatches, contentType }) {
  const type = String(contentType || '');
  if (versionMatches || /^font\//.test(type)) return `public, max-age=${ONE_YEAR_SECONDS}, immutable`;
  if (COMPRESSIBLE_MIME.test(type)) return 'no-cache';
  return `public, max-age=${ONE_DAY_SECONDS}`;
}

// The version token for a file is its validator without the surrounding quotes.
export function versionTokenFromEtag(etag) {
  return String(etag || '').replace(/^W\//, '').replace(/^"|"$/g, '');
}

// Rewrites local stylesheet and script references in an HTML document so each
// carries the current content hash. Hand-maintained ?v= tokens in the source
// files are replaced, which removes the need to bump them on every edit.
export function versionAssetUrls(html, resolveVersion) {
  return String(html || '').replace(
    /\b(href|src)="(\/[A-Za-z0-9_./-]+\.(?:css|js))(?:\?v=[^"#]*)?"/g,
    (match, attribute, assetPath) => {
      const version = resolveVersion(assetPath);
      return version ? `${attribute}="${assetPath}?v=${version}"` : match;
    }
  );
}

const validatorCache = new Map();

// Content-hash validator, computed once per file version. A content hash stays
// stable across redeploys of unchanged files, unlike a modification time.
export function getFileValidator(filePath) {
  const stat = statSync(filePath);
  const cached = validatorCache.get(filePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached;
  const digest = createHash('sha256').update(readFileSync(filePath)).digest('base64url').slice(0, 22);
  const entry = { size: stat.size, mtimeMs: stat.mtimeMs, etag: `"${digest}"` };
  validatorCache.set(filePath, entry);
  return entry;
}

// Weak comparison (RFC 9110 section 8.8.3.2): W/ prefixes are ignored.
export function etagMatches(ifNoneMatch, etag) {
  const header = String(ifNoneMatch || '').trim();
  if (!header || !etag) return false;
  if (header === '*') return true;
  const normalize = (value) => value.trim().replace(/^W\//, '');
  const target = normalize(etag);
  return header.split(',').some((candidate) => normalize(candidate) === target);
}

// Parses a single-range "bytes=" header. Returns null when the header is
// absent, malformed, or multi-range (the caller then sends the whole file),
// { unsatisfiable: true } when it lies outside the file, or { start, end }.
export function parseByteRange(rangeHeader, size) {
  const header = String(rangeHeader || '').trim();
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (!Number.isSafeInteger(size) || size <= 0) return { unsatisfiable: true };
  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength)) return null;
    if (suffixLength === 0) return { unsatisfiable: true };
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] === '' ? size - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) return null;
  if (start >= size) return { unsatisfiable: true };
  if (requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

// A request path that names a file (has an extension) and matched nothing is
// answered with a short plain 404 instead of the HTML not-found page.
export function looksLikeAssetPath(pathname) {
  const lastSegment = String(pathname || '').split('/').pop() || '';
  return /\.[A-Za-z0-9]{1,8}$/.test(lastSegment);
}
