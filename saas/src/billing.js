/**
 * BD Engine Cloud — Billing & plan gating module.
 *
 * Defines plan tiers, feature limits, and usage metering stubs.
 * Stripe integration is a placeholder — connects in Phase 3.
 */

export const PLANS = {
  trial: {
    id: 'trial',
    name: 'Free Trial',
    displayName: 'Trial',
    price: 0,
    interval: null,
    trialDays: 14,
    limits: {
      accounts: 25,
      contacts: 100,
      jobBoards: 3,
      users: 1,
      csvImports: 3,
      outreachDrafts: 10,
      apiCalls: 500,
    },
    features: ['dashboard', 'accounts', 'contacts', 'jobs', 'csv_import', 'outreach_drafts'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    displayName: 'Starter',
    price: 49,
    interval: 'month',
    trialDays: 0,
    limits: {
      accounts: 200,
      contacts: 2000,
      jobBoards: 20,
      users: 3,
      csvImports: 50,
      outreachDrafts: 100,
      apiCalls: 5000,
    },
    features: ['dashboard', 'accounts', 'contacts', 'jobs', 'csv_import', 'outreach_drafts', 'enrichment', 'ats_discovery', 'export'],
  },
  pro: {
    id: 'pro',
    name: 'Professional',
    displayName: 'Pro',
    price: 149,
    interval: 'month',
    trialDays: 0,
    limits: {
      accounts: 2000,
      contacts: 25000,
      jobBoards: 200,
      users: 10,
      csvImports: -1, // unlimited
      outreachDrafts: -1,
      apiCalls: 50000,
    },
    features: ['dashboard', 'accounts', 'contacts', 'jobs', 'csv_import', 'outreach_drafts', 'enrichment', 'ats_discovery', 'export', 'automation', 'api_access', 'team_management', 'advanced_analytics'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    displayName: 'Enterprise',
    price: null, // custom
    interval: 'month',
    trialDays: 0,
    limits: {
      accounts: -1,
      contacts: -1,
      jobBoards: -1,
      users: -1,
      csvImports: -1,
      outreachDrafts: -1,
      apiCalls: -1,
    },
    features: ['dashboard', 'accounts', 'contacts', 'jobs', 'csv_import', 'outreach_drafts', 'enrichment', 'ats_discovery', 'export', 'automation', 'api_access', 'team_management', 'advanced_analytics', 'sso', 'audit_log', 'custom_integrations', 'dedicated_support'],
  },
};

// ── Plan checking ───────────────────────────────────────────────────────────

export function getPlan(planId) {
  return PLANS[planId] || PLANS.trial;
}

export function hasFeature(planId, feature) {
  const plan = getPlan(planId);
  return plan.features.includes(feature);
}

export function isWithinLimit(planId, resource, currentCount) {
  const plan = getPlan(planId);
  const limit = plan.limits[resource];
  if (limit === undefined) return true;
  if (limit === -1) return true; // unlimited
  return currentCount < limit;
}

export function getUsagePercent(planId, resource, currentCount) {
  const plan = getPlan(planId);
  const limit = plan.limits[resource];
  if (!limit || limit === -1) return 0;
  return Math.min(100, Math.round((currentCount / limit) * 100));
}

// ── Subscription status helpers ─────────────────────────────────────────────

export function isTrialExpired(tenant) {
  if (tenant.plan !== 'trial') return false;
  if (!tenant.created_at && !tenant.createdAt) return false;
  const created = new Date(tenant.created_at || tenant.createdAt);
  const plan = getPlan('trial');
  const expiry = new Date(created.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);
  return new Date() > expiry;
}

export function getTrialDaysRemaining(tenant) {
  if (tenant.plan !== 'trial') return null;
  const created = new Date(tenant.created_at || tenant.createdAt);
  const plan = getPlan('trial');
  const expiry = new Date(created.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);
  const remaining = Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
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
