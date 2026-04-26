import Stripe from 'stripe';

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' }) : null;

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
  
  const plan = getPlan(planId);
  if (!plan || !plan.stripePriceId) throw new Error('Invalid plan selected.');

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: userEmail,
    client_reference_id: tenantId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
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
