const EXPENSIVE_OPERATION_PATTERNS = [
  /^\/api\/import\//,
  /^\/api\/discovery\/run$/,
  /^\/api\/admin\/(pipeline\/start|run-workflow)$/,
  /^\/api\/google-sheets\/run-engine$/,
  /^\/api\/configs\/sync$/,
  /^\/api\/configs\/[^/]+\/resolve$/,
  /^\/api\/accounts\/[^/]+\/(resolve-now|deep-verify)$/,
  /^\/api\/enrichment\/[^/]+\/rerun-resolution$/,
];

export function isEmailVerificationRequired(env = process.env) {
  return String(env.BD_REQUIRE_EMAIL_VERIFICATION || '').toLowerCase() === 'true';
}

export function requiresVerifiedEmail(pathname, method = 'GET') {
  if (String(method).toUpperCase() !== 'POST') return false;
  return EXPENSIVE_OPERATION_PATTERNS.some((pattern) => pattern.test(String(pathname || '')));
}
