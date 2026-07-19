import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

import {
  BillingError,
  assessStripeConfig,
  buildStripeCheckoutParams,
  buildStripeReferralCreditParams,
  cancelStripeSubscription,
  constructStripeWebhookEvent,
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  createStripeReferralCredit,
  getBillingErrorResponse,
} from '../src/billing.js';

const salesPlan = {
  id: 'sales',
  displayName: 'Sales Pro',
  stripePriceEnv: 'STRIPE_PRICE_SALES',
  stripePriceId: 'price_sales_test',
};

test('commercial Stripe readiness requires both paid plans', () => {
  const partial = assessStripeConfig({
    secretKey: 'sk_live_example',
    webhookSecret: 'whsec_example',
    priceIds: { sales: 'price_sales' },
  });
  assert.equal(partial.ready, false);
  assert.equal(partial.commercialReady, false);
  assert.equal(partial.allPricesConfigured, false);
  assert.deepEqual(partial.missing, ['STRIPE_PRICE_JOBSEEKER']);

  const complete = assessStripeConfig({
    secretKey: 'rk_live_example',
    webhookSecret: 'whsec_example',
    priceIds: { sales: 'price_sales', jobseeker: 'price_jobseeker' },
  });
  assert.equal(complete.checkoutReady, true);
  assert.equal(complete.commercialReady, true);
  assert.deepEqual(complete.missing, []);
});

test('checkout sends one paid plan and tenant metadata to Stripe', async () => {
  let received;
  const stripeClient = {
    checkout: {
      sessions: {
        create: async (params) => {
          received = params;
          return { url: 'https://checkout.stripe.test/session' };
        },
      },
    },
  };

  const url = await createStripeCheckoutSession(stripeClient, {
    tenantId: 'tenant-1',
    userEmail: 'buyer@example.com',
    plan: salesPlan,
    successUrl: 'https://app.example.com/success',
    cancelUrl: 'https://app.example.com/cancel',
    metadata: {
      referralCode: 'REF123',
      tenantId: 'tenant-overridden',
      planId: 'owner',
      empty: '',
      absent: null,
    },
    customerId: 'cus_existing',
  });

  assert.equal(url, 'https://checkout.stripe.test/session');
  assert.deepEqual(received.line_items, [{ price: 'price_sales_test', quantity: 1 }]);
  assert.equal(received.customer, 'cus_existing');
  assert.equal(Object.hasOwn(received, 'customer_email'), false);
  assert.deepEqual(received.metadata, { tenantId: 'tenant-1', planId: 'sales', referralCode: 'REF123' });
  assert.deepEqual(received.subscription_data.metadata, received.metadata);

  const newCustomer = buildStripeCheckoutParams({
    tenantId: 'tenant-2',
    userEmail: 'new@example.com',
    plan: salesPlan,
    successUrl: 'https://app.example.com/success',
    cancelUrl: 'https://app.example.com/cancel',
  });
  assert.equal(newCustomer.customer_email, 'new@example.com');
  assert.equal(Object.hasOwn(newCustomer, 'customer'), false);
  assert.throws(
    () => buildStripeCheckoutParams({ plan: { id: 'trial' } }),
    (error) => error instanceof BillingError && error.code === 'invalid_billing_plan'
  );
});

test('referral credits use a negative customer balance transaction', async () => {
  let received;
  const stripeClient = {
    customers: {
      createBalanceTransaction: async (customerId, params) => {
        received = { customerId, params };
        return { id: 'cbtxn_1' };
      },
    },
  };
  const result = await createStripeReferralCredit(stripeClient, 'cus_referrer', {
    amountCents: 500,
    referredTenantId: 'tenant-new',
    referrerTenantId: 'tenant-referrer',
  });
  assert.equal(result.id, 'cbtxn_1');
  assert.equal(received.customerId, 'cus_referrer');
  assert.equal(received.params.amount, -500);
  assert.equal(received.params.currency, 'usd');
  assert.equal(received.params.metadata.source, 'bd_engine_referral');
  assert.throws(() => buildStripeReferralCreditParams({ amountCents: 0 }), /must be positive/);
});

test('billing portal sessions preserve the customer and return URL contract', async () => {
  let received;
  const stripeClient = {
    billingPortal: {
      sessions: {
        create: async (params) => {
          received = params;
          return { url: 'https://billing.stripe.test/session' };
        },
      },
    },
  };
  assert.equal(
    await createStripeBillingPortalSession(stripeClient, 'cus_1', 'https://app.example.com/admin'),
    'https://billing.stripe.test/session'
  );
  assert.deepEqual(received, { customer: 'cus_1', return_url: 'https://app.example.com/admin' });
});

test('account closure cancellation is idempotent and requires Stripe confirmation', async () => {
  let cancelCalls = 0;
  const activeClient = {
    subscriptions: {
      retrieve: async () => ({ status: 'active' }),
      cancel: async (subscriptionId, options) => {
        cancelCalls += 1;
        assert.equal(subscriptionId, 'sub_active');
        assert.deepEqual(options, { prorate: false, invoice_now: false });
        return { status: 'canceled' };
      },
    },
  };
  assert.deepEqual(await cancelStripeSubscription(activeClient, 'sub_active'), {
    canceled: true,
    alreadyEnded: false,
    subscriptionId: 'sub_active',
  });
  assert.equal(cancelCalls, 1);

  const endedClient = {
    subscriptions: {
      retrieve: async () => ({ status: 'canceled' }),
      cancel: async () => { throw new Error('cancel should not be called'); },
    },
  };
  assert.equal((await cancelStripeSubscription(endedClient, 'sub_ended')).alreadyEnded, true);

  const missingClient = {
    subscriptions: {
      retrieve: async () => { throw Object.assign(new Error('missing'), { code: 'resource_missing' }); },
    },
  };
  assert.deepEqual(await cancelStripeSubscription(missingClient, 'sub_missing'), {
    canceled: true,
    alreadyEnded: true,
    subscriptionId: 'sub_missing',
  });

  const unconfirmedClient = {
    subscriptions: {
      retrieve: async () => ({ status: 'active' }),
      cancel: async () => ({ status: 'active' }),
    },
  };
  await assert.rejects(
    cancelStripeSubscription(unconfirmedClient, 'sub_unconfirmed'),
    /did not confirm subscription cancellation/
  );
});

test('signed Stripe webhooks reject tampered payloads', () => {
  const stripeClient = new Stripe('sk_test_signature_only');
  const endpointSecret = 'whsec_test_signature_secret';
  const payload = JSON.stringify({
    id: 'evt_signed',
    object: 'event',
    type: 'invoice.paid',
    data: { object: { id: 'in_1' } },
  });
  const signature = stripeClient.webhooks.generateTestHeaderString({
    payload,
    secret: endpointSecret,
    timestamp: Math.floor(Date.now() / 1000),
  });

  const event = constructStripeWebhookEvent(stripeClient, payload, signature, endpointSecret);
  assert.equal(event.id, 'evt_signed');
  assert.equal(event.type, 'invoice.paid');
  assert.throws(
    () => constructStripeWebhookEvent(stripeClient, `${payload}tampered`, signature, endpointSecret),
    /signature verification failed/
  );
});

test('billing failures never expose raw provider messages to customers', () => {
  const missing = Object.assign(new Error('No such customer: cus_private_identifier'), {
    code: 'resource_missing',
  });
  const missingResponse = getBillingErrorResponse(missing, 'portal');
  assert.equal(missingResponse.status, 409);
  assert.equal(missingResponse.code, 'billing_account_missing');
  assert.doesNotMatch(missingResponse.message, /cus_private_identifier|No such customer/);

  const outage = getBillingErrorResponse(new Error('connect ECONNRESET stripe.internal'), 'checkout');
  assert.equal(outage.status, 502);
  assert.equal(outage.report, true);
  assert.doesNotMatch(outage.message, /ECONNRESET|stripe\.internal/);
});
