import Stripe from 'stripe';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' }) : null;

export function isStripeConfigured() {
  return Boolean(stripe);
}

export function getStripeConfigStatus() {
  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  const mode = secretKey.startsWith('sk_live_')
    ? 'live'
    : (secretKey.startsWith('sk_test_') ? 'test' : (secretKey ? 'unknown' : 'not_configured'));
  const allowTestCheckout = process.env.BD_ALLOW_TEST_CHECKOUT === 'true';
  const priceIds = {
    jobseeker: process.env.STRIPE_PRICE_JOBSEEKER || '',
    sales: process.env.STRIPE_PRICE_SALES || '',
  };
  const ready = Boolean(stripe && process.env.STRIPE_WEBHOOK_SECRET && (priceIds.jobseeker || priceIds.sales));
  const liveMode = mode === 'live';
  const missing = [];
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!process.env.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
  if (!process.env.STRIPE_PRICE_JOBSEEKER) missing.push('STRIPE_PRICE_JOBSEEKER');
  if (!process.env.STRIPE_PRICE_SALES) missing.push('STRIPE_PRICE_SALES');
  return {
    configured: Boolean(stripe),
    ready,
    liveMode,
    allowTestCheckout,
    checkoutReady: Boolean(ready && (liveMode || allowTestCheckout)),
    commercialReady: Boolean(ready && liveMode),
    mode,
    allPricesConfigured: Boolean(priceIds.jobseeker && priceIds.sales),
    missing,
    prices: {
      jobseeker: Boolean(priceIds.jobseeker),
      sales: Boolean(priceIds.sales),
    },
  };
}

export const PLANS = {
  trial: {
    id: 'trial',
    name: 'Free Trial',
    displayName: 'Trial',
    price: 0,
    interval: null,
    trialDays: 14,
    limits: { accounts: 25, contacts: 100, jobBoards: 3, users: 1, csvImports: 3 },
    features: ['dashboard', 'accounts', 'contacts', 'jobs', 'csv_import'],
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
    limits: { accounts: 200, contacts: 1000, jobBoards: 10, users: 1, csvImports: 50 },
    features: ['dashboard', 'accounts', 'contacts', 'jobs', 'csv_import'],
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
    limits: { accounts: 1000, contacts: 10000, jobBoards: 100, users: 3, csvImports: -1 },
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

export function getUsageSummary(tenantId, planId) {
  const plan = getPlan(planId);
  const summary = {};
  for (const [resource, limit] of Object.entries(plan.limits)) {
    const current = getUsage(tenantId, resource);
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

export async function createCheckoutSession(tenantId, userEmail, planId, successUrl, cancelUrl) {
  if (!stripe) throw new Error('Stripe is not configured. Add STRIPE_SECRET_KEY environment variable.');
  const status = getStripeConfigStatus();
  if (!status.checkoutReady) {
    throw new Error('Live Stripe checkout is not enabled yet. Set live Stripe keys before taking public paid upgrades.');
  }
  
  const plan = getPlan(planId);
  if (!plan || !plan.stripePriceId) throw new Error('Invalid plan selected.');
  if (!plan.stripePriceId || plan.stripePriceId.startsWith('price_placeholder')) {
    throw new Error(`Stripe price ID is not configured for ${plan.displayName}. Set ${plan.stripePriceEnv || 'the plan price environment variable'}.`);
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: userEmail,
    client_reference_id: tenantId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    mode: 'subscription',
    metadata: { tenantId, planId: plan.id },
    subscription_data: {
      metadata: { tenantId, planId: plan.id },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      tenantId: tenantId,
      planId: planId,
    },
  });

  return session.url;
}

export async function createBillingPortalSession(customerId, returnUrl) {
  if (!stripe) throw new Error('Stripe is not configured.');
  
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

export function handleWebhookEvent(payload, signature) {
  if (!stripe) throw new Error('Stripe is not configured.');
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, endpointSecret);
  } catch (err) {
    throw new Error(`Webhook Error: ${err.message}`);
  }
  
  return event;
}
