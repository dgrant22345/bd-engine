import { parseBackupEncryptionKey } from './backup-format.js';
import { resolvePublicOrigin } from './public-origin.js';

function configured(env, name) {
  return Boolean(String(env[name] || '').trim());
}

function validEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value || '').trim());
}

function senderEmail(value) {
  const raw = String(value || '').trim();
  const bracketed = raw.match(/<([^<>]+)>$/);
  return bracketed ? bracketed[1].trim() : raw;
}

function validUrl(value, protocols) {
  try {
    const parsed = new URL(String(value || '').trim());
    return protocols.includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function assessProductionReadiness(env = process.env) {
  const errors = [];
  const warnings = [];
  const requireValue = (name, purpose) => {
    if (!configured(env, name)) errors.push(`${name}: ${purpose}`);
  };

  requireValue('DATABASE_URL', 'durable PostgreSQL storage is required');
  if (configured(env, 'DATABASE_URL') && !validUrl(env.DATABASE_URL, ['postgres:', 'postgresql:'])) {
    errors.push('DATABASE_URL: must be a PostgreSQL connection URL');
  }
  requireValue('SESSION_SECRET', 'signed sessions require a production secret');
  if (configured(env, 'SESSION_SECRET') && String(env.SESSION_SECRET).length < 32) {
    errors.push('SESSION_SECRET: use at least 32 characters of random material');
  }
  const publicOrigin = env.BD_CLOUD_BASE_URL || env.RAILWAY_STATIC_URL || env.RAILWAY_PUBLIC_DOMAIN;
  if (!publicOrigin) {
    errors.push('BD_CLOUD_BASE_URL: password, verification, support, and billing links need a trusted canonical origin');
  } else if (!resolvePublicOrigin({ ...env, BD_CLOUD_ENV: 'production' })) {
    errors.push('BD_CLOUD_BASE_URL: must be an HTTP(S) origin without credentials');
  }

  for (const [name, purpose] of [
    ['STRIPE_SECRET_KEY', 'paid checkout is unavailable'],
    ['STRIPE_WEBHOOK_SECRET', 'subscription state cannot be verified'],
    ['STRIPE_PRICE_JOBSEEKER', 'the Job Seeker plan cannot be purchased'],
    ['STRIPE_PRICE_SALES', 'the Sales Professional plan cannot be purchased'],
    ['RESEND_API_KEY', 'password reset and customer email are unavailable'],
    ['BD_EMAIL_FROM', 'transactional email needs a verified sender'],
    ['BD_SUPPORT_ADMIN_EMAILS', 'support requests need an accountable recipient'],
    ['BD_ERROR_WEBHOOK', 'server failures need an alert destination'],
    ['BD_BACKUP_ENCRYPTION_KEY', 'production backups require a dedicated 32-byte encryption key'],
  ]) requireValue(name, purpose);

  if (configured(env, 'BD_BACKUP_ENCRYPTION_KEY')) {
    try {
      parseBackupEncryptionKey(env.BD_BACKUP_ENCRYPTION_KEY, { required: true });
    } catch {
      errors.push('BD_BACKUP_ENCRYPTION_KEY: must decode to exactly 32 random bytes');
    }
  }

  if (configured(env, 'STRIPE_SECRET_KEY') && !/^(?:sk|rk)_live_[A-Za-z0-9]+$/.test(String(env.STRIPE_SECRET_KEY))) {
    errors.push('STRIPE_SECRET_KEY: broad paid launch requires a live Stripe secret or restricted key');
  }
  if (configured(env, 'STRIPE_WEBHOOK_SECRET') && !/^whsec_[A-Za-z0-9]+$/.test(String(env.STRIPE_WEBHOOK_SECRET))) {
    errors.push('STRIPE_WEBHOOK_SECRET: must be a Stripe signing secret');
  }
  for (const name of ['STRIPE_PRICE_JOBSEEKER', 'STRIPE_PRICE_SALES']) {
    if (configured(env, name) && !/^price_[A-Za-z0-9]+$/.test(String(env[name]))) {
      errors.push(`${name}: must be a Stripe Price ID`);
    }
  }
  if (configured(env, 'RESEND_API_KEY') && !/^re_[A-Za-z0-9_]+$/.test(String(env.RESEND_API_KEY))) {
    errors.push('RESEND_API_KEY: must be a Resend API key');
  }
  if (configured(env, 'BD_EMAIL_FROM') && !validEmail(senderEmail(env.BD_EMAIL_FROM))) {
    errors.push('BD_EMAIL_FROM: must contain a valid sender email address');
  }
  if (configured(env, 'BD_SUPPORT_ADMIN_EMAILS')) {
    const emails = String(env.BD_SUPPORT_ADMIN_EMAILS).split(',').map((item) => item.trim()).filter(Boolean);
    if (!emails.length || emails.some((email) => !validEmail(email))) {
      errors.push('BD_SUPPORT_ADMIN_EMAILS: must be a comma-separated list of valid email addresses');
    }
  }
  if (configured(env, 'BD_ERROR_WEBHOOK') && !validUrl(env.BD_ERROR_WEBHOOK, ['https:'])) {
    errors.push('BD_ERROR_WEBHOOK: must be an HTTPS URL');
  }

  for (const name of ['BD_EXPOSE_RESET_TOKEN', 'BD_ALLOW_TEST_CHECKOUT', 'BD_ENABLE_SYNTHETIC_ERROR']) {
    if (String(env[name] || '').toLowerCase() === 'true') {
      errors.push(`${name}: must not be enabled in production`);
    }
  }

  if (String(env.BD_REQUIRE_EMAIL_VERIFICATION || '').toLowerCase() !== 'true') {
    errors.push('BD_REQUIRE_EMAIL_VERIFICATION: enable verified-email enforcement for imports and ATS discovery');
  }

  const renderUrl = configured(env, 'BD_ATS_RENDER_SERVICE_URL');
  const renderToken = configured(env, 'BD_ATS_RENDER_SERVICE_TOKEN');
  if (renderUrl !== renderToken) {
    errors.push('BD_ATS_RENDER_SERVICE_URL/BD_ATS_RENDER_SERVICE_TOKEN: configure both together');
  } else if (!renderUrl) {
    warnings.push('ATS renderer is not configured; JavaScript-only careers pages will have lower coverage');
  } else {
    if (!validUrl(env.BD_ATS_RENDER_SERVICE_URL, ['http:', 'https:'])) {
      errors.push('BD_ATS_RENDER_SERVICE_URL: must be an HTTP or HTTPS URL');
    }
    if (String(env.BD_ATS_RENDER_SERVICE_TOKEN).length < 32) {
      errors.push('BD_ATS_RENDER_SERVICE_TOKEN: use at least 32 characters of random material');
    }
  }
  if (String(env.BD_RELATIONAL_WRITE_NEW_TENANTS || '').toLowerCase() !== 'true') {
    warnings.push('New workspaces are not relational-primary; complete the storage migration before scaling');
  }
  if (!configured(env, 'BD_RELATIONAL_DEEP_CHECK_TENANTS')) {
    warnings.push('Deep relational parity monitoring has no canary workspace configured');
  }

  return { ready: errors.length === 0, errors, warnings };
}
