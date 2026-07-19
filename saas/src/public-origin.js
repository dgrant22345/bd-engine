function isProduction(env) {
  return env.BD_CLOUD_ENV === 'production'
    || env.NODE_ENV === 'production'
    || Boolean(env.RAILWAY_ENVIRONMENT);
}

export function normalizePublicOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function resolvePublicOrigin(env = process.env, port = 8787) {
  for (const candidate of [env.BD_CLOUD_BASE_URL, env.RAILWAY_STATIC_URL, env.RAILWAY_PUBLIC_DOMAIN]) {
    const origin = normalizePublicOrigin(candidate);
    if (origin) return origin;
  }
  return isProduction(env) ? '' : `http://127.0.0.1:${port}`;
}
