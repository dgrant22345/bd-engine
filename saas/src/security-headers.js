const CONTENT_SECURITY_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
];

export function contentSecurityPolicy(scriptNonce = '') {
  const nonce = normalizeScriptNonce(scriptNonce);
  const scriptDirective = `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}`;
  return [CONTENT_SECURITY_DIRECTIVES[0], scriptDirective, ...CONTENT_SECURITY_DIRECTIVES.slice(1)].join('; ');
}

export function injectScriptNonce(html, scriptNonce) {
  const nonce = normalizeScriptNonce(scriptNonce);
  if (!nonce) return String(html || '');
  return String(html || '').replace(/<script(?![^>]*\bnonce=)(?=[\s>])/gu, `<script nonce="${nonce}"`);
}

function normalizeScriptNonce(value) {
  const nonce = String(value || '');
  return /^[A-Za-z0-9+/_=-]{16,128}$/.test(nonce) ? nonce : '';
}
