/**
 * Read-only Stripe catalog and webhook verification.
 *
 * This command retrieves configuration only. It never creates customers,
 * checkout sessions, invoices, subscriptions, refunds, or webhook endpoints.
 */
import Stripe from 'stripe';
import { PLANS } from '../src/billing.js';
import { assessStripeCatalog } from '../src/billing-catalog.js';
import { resolvePublicOrigin } from '../src/public-origin.js';

function flag(name) {
  return process.argv.includes(name);
}

function keyMode(key) {
  if (/^(?:sk|rk)_live_/.test(key)) return 'live';
  if (/^(?:sk|rk)_test_/.test(key)) return 'test';
  return 'unknown';
}

async function main() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is required.');
  const mode = keyMode(secretKey);
  const allowTest = flag('--allow-test');
  if (mode !== 'live' && !allowTest) {
    throw new Error('A live Stripe key is required. Pass --allow-test only for an approved test environment.');
  }

  const origin = resolvePublicOrigin(process.env);
  if (!origin) throw new Error('A canonical BD_CLOUD_BASE_URL or Railway public domain is required.');
  const expectedWebhookUrl = new URL('/api/billing/webhook', origin).toString();
  const plans = ['jobseeker', 'sales'].map((id) => PLANS[id]);
  for (const plan of plans) {
    if (!process.env[plan.stripePriceEnv]) throw new Error(`${plan.stripePriceEnv} is required.`);
  }
  // stripe-node v12+ selects the API version that matches the installed SDK.
  const stripe = new Stripe(secretKey);
  const prices = await Promise.all(plans.map(async (plan) => ({
    planId: plan.id,
    price: await stripe.prices.retrieve(process.env[plan.stripePriceEnv], { expand: ['product'] }),
  })));
  const webhookEndpoints = (await stripe.webhookEndpoints.list({ limit: 100 })).data;
  const result = assessStripeCatalog({
    plans,
    prices,
    webhookEndpoints,
    expectedWebhookUrl,
    expectedCurrency: process.env.BD_BILLING_CURRENCY || 'usd',
    requireLiveMode: !allowTest,
  });

  console.log(`Stripe catalog verification: ${result.ready ? 'READY' : 'NOT READY'}`);
  console.log(`Mode: ${mode}; plans checked: ${plans.length}; matching webhook endpoints: ${webhookEndpoints.filter((item) => item.url === expectedWebhookUrl).length}`);
  for (const warning of result.warnings) console.log(`WARNING: ${warning}`);
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  if (!result.ready) process.exitCode = 1;
}

main().catch((error) => {
  const type = String(error?.type || error?.name || 'Error').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  console.error(`Stripe catalog verification failed (${type}). Check key permissions and provider availability.`);
  process.exit(1);
});
