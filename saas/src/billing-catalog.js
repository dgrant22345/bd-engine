export const REQUIRED_STRIPE_WEBHOOK_EVENTS = Object.freeze([
  Object.freeze({ label: 'checkout completion', anyOf: Object.freeze(['checkout.session.completed']) }),
  Object.freeze({ label: 'subscription creation', anyOf: Object.freeze(['customer.subscription.created']) }),
  Object.freeze({ label: 'subscription updates', anyOf: Object.freeze(['customer.subscription.updated']) }),
  Object.freeze({ label: 'subscription deletion', anyOf: Object.freeze(['customer.subscription.deleted']) }),
  Object.freeze({ label: 'failed payments', anyOf: Object.freeze(['invoice.payment_failed']) }),
  Object.freeze({ label: 'successful payments', anyOf: Object.freeze(['invoice.payment_succeeded', 'invoice.paid']) }),
]);

function endpointHandles(endpoint, eventNames) {
  const enabled = Array.isArray(endpoint?.enabled_events) ? endpoint.enabled_events : [];
  return enabled.includes('*') || eventNames.some((eventName) => enabled.includes(eventName));
}

export function assessStripeCatalog({
  plans = [],
  prices = [],
  webhookEndpoints = [],
  expectedWebhookUrl = '',
  expectedCurrency = 'usd',
  requireLiveMode = true,
} = {}) {
  const errors = [];
  const warnings = [];
  const normalizedCurrency = String(expectedCurrency || 'usd').toLowerCase();

  for (const plan of plans) {
    const price = prices.find((candidate) => candidate.planId === plan.id)?.price;
    if (!price) {
      errors.push(`${plan.id}: Stripe price could not be loaded`);
      continue;
    }
    if (price.active !== true) errors.push(`${plan.id}: Stripe price is inactive`);
    if (requireLiveMode && price.livemode !== true) errors.push(`${plan.id}: Stripe price is not live-mode`);
    if (Number(price.unit_amount) !== Number(plan.price) * 100) {
      errors.push(`${plan.id}: Stripe amount does not match the application price`);
    }
    if (String(price.currency || '').toLowerCase() !== normalizedCurrency) {
      errors.push(`${plan.id}: Stripe currency does not match ${normalizedCurrency.toUpperCase()}`);
    }
    if (price.type !== 'recurring' || price.recurring?.interval !== 'month' || Number(price.recurring?.interval_count || 0) !== 1) {
      errors.push(`${plan.id}: Stripe price must recur monthly`);
    }
    if (!price.product || typeof price.product !== 'object' || price.product.active !== true) {
      errors.push(`${plan.id}: Stripe product is missing or inactive`);
    }
  }

  const matching = webhookEndpoints.filter((endpoint) => endpoint?.url === expectedWebhookUrl);
  const enabled = matching.filter((endpoint) => endpoint.status === 'enabled');
  if (!enabled.length) {
    errors.push('webhook: no enabled endpoint matches the canonical billing webhook URL');
  } else {
    for (const requirement of REQUIRED_STRIPE_WEBHOOK_EVENTS) {
      if (!enabled.some((endpoint) => endpointHandles(endpoint, requirement.anyOf))) {
        errors.push(`webhook: missing ${requirement.label} event (${requirement.anyOf.join(' or ')})`);
      }
    }
  }
  if (enabled.length > 1) warnings.push('webhook: multiple enabled endpoints match the canonical URL');

  return { ready: errors.length === 0, errors, warnings };
}
