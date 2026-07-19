import Stripe from 'stripe';

function normalizeStripeSecretKey(value) {
  return String(value || '')
    .trim()
    .replace(/^STRIPE_SECRET_KEY\s*=\s*/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function getStripeKeyMode(secretKey) {
  if (!secretKey) return 'not_configured';
  if (secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')) return 'live';
  if (secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_')) return 'test';
  return 'unknown';
}

const stripeSecretKey = normalizeStripeSecretKey(process.env.STRIPE_SECRET_KEY);
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' }) : null;
const DEFAULT_BILLING_GRACE_DAYS = 7;

export class BillingError extends Error {
  constructor(message, { code = 'billing_error', status = 400, report = false } = {}) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    this.status = status;
    this.report = report;
  }
}

export function getBillingGraceDays() {
  const configured = Number(process.env.BD_BILLING_GRACE_DAYS);
  return Number.isFinite(configured) && configured >= 1 && configured <= 30
    ? Math.floor(configured)
    : DEFAULT_BILLING_GRACE_DAYS;
}

export function createBillingGraceDeadline(invoice = {}, nowMs = Date.now()) {
  const standardDeadline = nowMs + getBillingGraceDays() * 24 * 60 * 60 * 1000;
  const stripeRetryAt = Number(invoice.next_payment_attempt || 0) * 1000;
  const retryDeadline = Number.isFinite(stripeRetryAt) && stripeRetryAt > nowMs
    ? stripeRetryAt + 24 * 60 * 60 * 1000
    : 0;
  return new Date(Math.max(standardDeadline, retryDeadline)).toISOString();
}

export function getBillingAccessStatus(tenant = {}, nowMs = Date.now()) {
  const status = String(tenant.status || '').toLowerCase();
  if (status !== 'past_due') {
    return {
      paymentAttentionRequired: false,
      accessBlocked: false,
      graceEndsAt: '',
      graceDaysRemaining: null,
    };
  }

  const graceEndsAt = String(tenant.billingGraceEndsAt || tenant.billing_grace_ends_at || '');
  const deadlineMs = Date.parse(graceEndsAt);
  const validDeadline = Number.isFinite(deadlineMs) ? deadlineMs : nowMs;
  return {
    paymentAttentionRequired: true,
    accessBlocked: nowMs >= validDeadline,
    graceEndsAt,
    graceDaysRemaining: Math.max(0, Math.ceil((validDeadline - nowMs) / (24 * 60 * 60 * 1000))),
  };
}

export function isStripeConfigured() {
  return Boolean(stripe);
}

export function assessStripeConfig({
  secretKey = '',
  webhookSecret = '',
  priceIds = {},
  allowTestCheckout = false,
  clientConfigured = Boolean(secretKey),
} = {}) {
  const mode = getStripeKeyMode(secretKey);
  const allPricesConfigured = Boolean(priceIds.jobseeker && priceIds.sales);
  const ready = Boolean(clientConfigured && webhookSecret && allPricesConfigured);
  const liveMode = mode === 'live';
  const missing = [];
  if (!secretKey) missing.push('STRIPE_SECRET_KEY');
  if (!webhookSecret) missing.push('STRIPE_WEBHOOK_SECRET');
  if (!priceIds.jobseeker) missing.push('STRIPE_PRICE_JOBSEEKER');
  if (!priceIds.sales) missing.push('STRIPE_PRICE_SALES');
  return {
    configured: Boolean(clientConfigured),
    ready,
    liveMode,
    allowTestCheckout,
    checkoutReady: Boolean(ready && (liveMode || allowTestCheckout)),
    commercialReady: Boolean(ready && liveMode),
    mode,
    allPricesConfigured,
    missing,
    prices: {
      jobseeker: Boolean(priceIds.jobseeker),
      sales: Boolean(priceIds.sales),
    },
  };
}

export function getStripeConfigStatus() {
  return assessStripeConfig({
    secretKey: stripeSecretKey,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    priceIds: {
      jobseeker: process.env.STRIPE_PRICE_JOBSEEKER || '',
      sales: process.env.STRIPE_PRICE_SALES || '',
    },
    allowTestCheckout: process.env.BD_ALLOW_TEST_CHECKOUT === 'true',
    clientConfigured: Boolean(stripe),
  });
}

export const PLANS = {
  trial: {
    id: 'trial',
    name: 'Free Trial',
    displayName: 'Trial',
    price: 0,
    interval: null,
    trialDays: 14,
    limits: { accounts: 25, contacts: 100, jobBoards: 50, users: 1, csvImports: 3 },
    features: ['dashboard', 'accounts', 'contacts', 'jobs', 'csv_import', 'outreach_drafts'],
  },
  jobseeker: {
    id: 'jobseeker',
    name: 'Job Seeker',
    displayName: 'Job Seeker',
    price: 5,
    interval: 'month',
    stripePriceEnv: 'STRIPE_PRICE_JOBSEEKER',
    stripePriceId: process.env.STRIPE_PRICE_JOBSEEKER || 'price_placeholder_jobseeker',
    trialDays: 0,
    limits: { accounts: 200, contacts: 1000, jobBoards: 50, users: 1, csvImports: 50 },
    features: ['dashboard', 'accounts', 'contacts', 'jobs', 'csv_import', 'outreach_drafts'],
  },
  sales: {
    id: 'sales',
    name: 'Sales Professional',
    displayName: 'Sales Pro',
    price: 10,
    interval: 'month',
    stripePriceEnv: 'STRIPE_PRICE_SALES',
    stripePriceId: process.env.STRIPE_PRICE_SALES || 'price_placeholder_sales',
    trialDays: 0,
    limits: { accounts: 1000, contacts: 10000, jobBoards: -1, users: 1, csvImports: -1 },
    features: ['dashboard', 'accounts', 'contacts', 'jobs', 'csv_import', 'outreach_drafts', 'enrichment', 'export'],
  },
  owner: {
    id: 'owner',
    name: 'Internal Owner',
    displayName: 'Owner',
    price: 0,
    interval: null,
    trialDays: 0,
    limits: { accounts: -1, contacts: -1, jobBoards: -1, users: -1, csvImports: -1 },
    features: ['dashboard', 'accounts', 'contacts', 'jobs', 'csv_import', 'outreach_drafts', 'enrichment', 'export'],
  },
};

// ── Plan checking ───────────────────────────────────────────────────────────

export function getPlan(planId) {
  return PLANS[planId] || PLANS.trial;
}

export function getPlanByStripePriceId(priceId) {
  if (!priceId) return null;
  return Object.values(PLANS).find((plan) => plan.stripePriceId === priceId) || null;
}

export function hasFeature(planId, feature) {
  return getPlan(planId).features.includes(feature);
}

export function isWithinLimit(planId, resource, currentCount) {
  const limit = getPlan(planId).limits[resource];
  if (limit === undefined || limit === -1) return true;
  return currentCount < limit;
}

export function getEntitlementDecision(planId, { feature = '', resource = '', currentCount = 0, increment = 1 } = {}) {
  const plan = getPlan(planId);
  if (feature && !hasFeature(plan.id, feature)) {
    return {
      allowed: false,
      code: 'upgrade_required',
      reason: 'feature',
      feature,
      planId: plan.id,
      planName: plan.displayName,
    };
  }

  const limit = resource ? plan.limits[resource] : undefined;
  const current = Math.max(0, Number(currentCount) || 0);
  const requested = Math.max(0, Number(increment) || 0);
  if (limit !== undefined && limit !== -1 && current + requested > limit) {
    return {
      allowed: false,
      code: 'plan_limit_reached',
      reason: 'limit',
      resource,
      current,
      limit,
      requested,
      planId: plan.id,
      planName: plan.displayName,
    };
  }

  return { allowed: true, planId: plan.id, planName: plan.displayName, feature, resource, current, limit };
}

export function getUsagePercent(planId, resource, currentCount) {
  const limit = getPlan(planId).limits[resource];
  if (!limit || limit === -1) return 0;
  return Math.min(100, Math.round((currentCount / limit) * 100));
}

export function isTrialExpired(tenant) {
  if (tenant.plan !== 'trial') return false;
  if (!tenant.created_at && !tenant.createdAt) return false;
  const created = new Date(tenant.created_at || tenant.createdAt);
  const expiry = new Date(created.getTime() + getPlan('trial').trialDays * 24 * 60 * 60 * 1000);
  return new Date() > expiry;
}

export function getTrialDaysRemaining(tenant) {
  if (tenant.plan !== 'trial') return null;
  const created = new Date(tenant.created_at || tenant.createdAt);
  const expiry = new Date(created.getTime() + getPlan('trial').trialDays * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

// ── Usage metering (in-memory stub) ─────────────────────────────────────────
const usageCounters = new Map();

export function incrementUsage(tenantId, resource, amount = 1) {
  const key = `${tenantId}:${resource}`;
  usageCounters.set(key, (usageCounters.get(key) || 0) + amount);
}

export function getUsage(tenantId, resource) {
  return usageCounters.get(`${tenantId}:${resource}`) || 0;
}

export function getUsageSummary(tenantId, planId, actualUsage = {}) {
  const plan = getPlan(planId);
  const summary = {};
  for (const [resource, limit] of Object.entries(plan.limits)) {
    const current = Number.isFinite(Number(actualUsage[resource]))
      ? Number(actualUsage[resource])
      : getUsage(tenantId, resource);
    summary[resource] = {
      current,
      limit: limit === -1 ? 'unlimited' : limit,
      percent: getUsagePercent(planId, resource, current),
      exceeded: limit !== -1 && current >= limit,
    };
  }
  return summary;
}

// ── Stripe Checkout ─────────────────────────────────────────────────────────

export function buildStripeCheckoutParams({ tenantId, userEmail, plan, successUrl, cancelUrl, metadata = {}, customerId = '' }) {
  if (!plan?.stripePriceEnv) {
    throw new BillingError('Choose the Job Seeker or Sales Professional plan.', {
      code: 'invalid_billing_plan',
      status: 400,
    });
  }
  if (!plan.stripePriceId || plan.stripePriceId.startsWith('price_placeholder')) {
    throw new BillingError('Checkout is temporarily unavailable. Please contact support.', {
      code: 'billing_unavailable',
      status: 503,
      report: true,
    });
  }

  const checkoutMetadata = {
    ...Object.fromEntries(Object.entries(metadata || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')),
    tenantId,
    planId: plan.id,
  };

  const checkoutParams = {
    payment_method_types: ['card'],
    client_reference_id: tenantId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    mode: 'subscription',
    metadata: checkoutMetadata,
    subscription_data: {
      metadata: checkoutMetadata,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  };

  if (customerId) {
    checkoutParams.customer = customerId;
  } else {
    checkoutParams.customer_email = userEmail;
  }

  return checkoutParams;
}

export async function createStripeCheckoutSession(stripeClient, input) {
  const session = await stripeClient.checkout.sessions.create(buildStripeCheckoutParams(input));
  if (!session?.url) throw new Error('Stripe checkout session did not include a URL.');
  return session.url;
}

export async function createCheckoutSession(tenantId, userEmail, planId, successUrl, cancelUrl, metadata = {}, options = {}) {
  const plan = PLANS[planId];
  if (!plan?.stripePriceEnv) {
    throw new BillingError('Choose the Job Seeker or Sales Professional plan.', {
      code: 'invalid_billing_plan',
      status: 400,
    });
  }
  if (!stripe || !getStripeConfigStatus().checkoutReady) {
    throw new BillingError('Checkout is temporarily unavailable. Please contact support.', {
      code: 'billing_unavailable',
      status: 503,
      report: true,
    });
  }

  return createStripeCheckoutSession(stripe, {
    tenantId, userEmail, plan, successUrl, cancelUrl, metadata, customerId: options.customerId,
  });
}

export function buildStripeReferralCreditParams({ amountCents = 500, currency = 'usd', referredTenantId = '', referrerTenantId = '' } = {}) {
  const amount = Math.abs(Number(amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Referral credit amount must be positive.');
  return {
    amount: -amount,
    currency,
    description: 'BD Engine referral credit',
    metadata: {
      source: 'bd_engine_referral',
      referredTenantId,
      referrerTenantId,
    },
  };
}

export async function createStripeReferralCredit(stripeClient, customerId, options = {}) {
  if (!customerId) throw new Error('Stripe customer is required for referral credit.');
  return stripeClient.customers.createBalanceTransaction(customerId, buildStripeReferralCreditParams(options));
}

export async function createReferralCredit(customerId, options = {}) {
  if (!stripe) throw new Error('Stripe is not configured.');
  return createStripeReferralCredit(stripe, customerId, options);
}

export async function createStripeBillingPortalSession(stripeClient, customerId, returnUrl) {
  const session = await stripeClient.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  if (!session?.url) throw new Error('Stripe billing portal session did not include a URL.');
  return session.url;
}

export async function createBillingPortalSession(customerId, returnUrl) {
  if (!stripe) {
    throw new BillingError('The billing portal is temporarily unavailable. Please contact support.', {
      code: 'billing_unavailable',
      status: 503,
      report: true,
    });
  }
  return createStripeBillingPortalSession(stripe, customerId, returnUrl);
}

export async function cancelStripeSubscription(stripeClient, subscriptionId) {
  if (!subscriptionId) return { canceled: false, alreadyEnded: true };
  try {
    const existing = await stripeClient.subscriptions.retrieve(subscriptionId);
    if (existing.status === 'canceled') {
      return { canceled: true, alreadyEnded: true, subscriptionId };
    }
    const canceled = await stripeClient.subscriptions.cancel(subscriptionId, {
      prorate: false,
      invoice_now: false,
    });
    if (canceled.status !== 'canceled') {
      throw new Error('Stripe did not confirm subscription cancellation.');
    }
    return { canceled: true, alreadyEnded: false, subscriptionId };
  } catch (error) {
    if (error?.code === 'resource_missing') {
      return { canceled: true, alreadyEnded: true, subscriptionId };
    }
    throw error;
  }
}

export async function cancelSubscriptionForAccountClosure(subscriptionId) {
  if (!stripe) throw new Error('Stripe is not configured. The subscription must be canceled before account closure.');
  return cancelStripeSubscription(stripe, subscriptionId);
}

export function constructStripeWebhookEvent(stripeClient, payload, signature, endpointSecret) {
  if (!endpointSecret) throw new Error('Stripe webhook verification is not configured.');
  try {
    return stripeClient.webhooks.constructEvent(payload, signature, endpointSecret);
  } catch (err) {
    throw new Error('Stripe webhook signature verification failed.', { cause: err });
  }
}

export function handleWebhookEvent(payload, signature) {
  if (!stripe) throw new Error('Stripe is not configured.');
  return constructStripeWebhookEvent(stripe, payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

export function getBillingErrorResponse(error, action = 'checkout') {
  if (error instanceof BillingError) {
    return { status: error.status, code: error.code, message: error.message, report: error.report };
  }
  if (error?.code === 'resource_missing') {
    return {
      status: 409,
      code: 'billing_account_missing',
      message: 'We could not find this workspace billing account. Please contact support.',
      report: true,
    };
  }
  const portal = action === 'portal';
  return {
    status: 502,
    code: 'billing_provider_unavailable',
    message: portal
      ? 'The billing portal is temporarily unavailable. Please try again.'
      : 'Checkout is temporarily unavailable. Please try again.',
    report: true,
  };
}
