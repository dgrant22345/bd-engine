function configured(env, name) {
  return Boolean(String(env[name] || '').trim());
}

export function assessProductionReadiness(env = process.env) {
  const errors = [];
  const warnings = [];
  const requireValue = (name, purpose) => {
    if (!configured(env, name)) errors.push(`${name}: ${purpose}`);
  };

  requireValue('DATABASE_URL', 'durable PostgreSQL storage is required');
  requireValue('SESSION_SECRET', 'signed sessions require a production secret');
  if (configured(env, 'SESSION_SECRET') && String(env.SESSION_SECRET).length < 32) {
    errors.push('SESSION_SECRET: use at least 32 characters of random material');
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
  ]) requireValue(name, purpose);

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
  }
  if (String(env.BD_RELATIONAL_WRITE_NEW_TENANTS || '').toLowerCase() !== 'true') {
    warnings.push('New workspaces are not relational-primary; complete the storage migration before scaling');
  }
  if (!configured(env, 'BD_RELATIONAL_DEEP_CHECK_TENANTS')) {
    warnings.push('Deep relational parity monitoring has no canary workspace configured');
  }

  return { ready: errors.length === 0, errors, warnings };
}
