import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

// Real local HTTP handler + signed fixture events, isolated memory store.
// No Stripe network requests, real customers, checkout sessions, or charges.
test('signed subscription lifecycle grants access only on confirmation and supports recovery and cancellation', { timeout: 30000 }, async t => {
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const secret = 'whsec_local_lifecycle_fixture';
  const processUnderTest = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', BD_CLOUD_HOST: '127.0.0.1', BD_CLOUD_PORT: String(port), BD_CLOUD_BASE_URL: origin,
      STRIPE_SECRET_KEY: 'sk_test_local_lifecycle_fixture', STRIPE_WEBHOOK_SECRET: secret,
      STRIPE_PRICE_SALES: 'price_sales_fixture', STRIPE_PRICE_JOBSEEKER: 'price_jobseeker_fixture',
      RESEND_API_KEY: '', SMTP_HOST: '', BD_OWNER_EMAILS: '',
      BD_ANALYTICS_ADMIN_EMAILS: 'billing-lifecycle@example.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  processUnderTest.stdout.on('data', chunk => { output += chunk; });
  processUnderTest.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => { if (processUnderTest.exitCode === null) { const stopped = once(processUnderTest, 'exit'); processUnderTest.kill(); await stopped; } });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${origin}/readyz`)).ok) break; } catch { /* Local startup is still in progress. */ }
    assert.equal(processUnderTest.exitCode, null, output);
    if (attempt === 99) assert.fail(`Local billing server did not become ready: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const signup = await fetch(`${origin}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'billing-lifecycle@example.com', password: 'Billing-lifecycle-fixture-2026', name: 'Billing QA', workspaceName: 'Billing QA', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } }) });
  assert.equal(signup.status, 201);
  const cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const request = (path, options = {}) => fetch(`${origin}${path}`, { ...options, headers: { cookie, 'content-type': 'application/json', ...options.headers } });
  const identity = await (await request('/api/auth/me')).json();
  const tenantId = identity.tenant.id;
  const savedDraft = { title: 'Private draft', version: 0, body: { text: 'Private message content never belongs in analytics', recipient: 'Private recipient' } };
  assert.equal((await request('/api/saved-work/draft/measurement-fixture', { method: 'PUT', body: JSON.stringify(savedDraft) })).status, 200);
  assert.equal((await request('/api/saved-work/draft/measurement-fixture', { method: 'PUT', body: JSON.stringify(savedDraft) })).status, 409);
  assert.equal((await request('/api/saved-work/draft/measurement-fixture', { method: 'PUT', body: JSON.stringify({ ...savedDraft, version: 1 }) })).status, 200);
  const admin = await (await request('/api/admin/bootstrap')).json();
  const milestone = admin.analytics.funnel.find(row => row.eventType === 'outreach_draft_saved');
  assert.equal(milestone.workspaces, 1); assert.equal(milestone.events, 1);
  assert.doesNotMatch(JSON.stringify(admin.analytics), /Private message|Private recipient/);
  const stripe = new Stripe('sk_test_local_fixture');
  let sequence = 0;
  async function event(type, object, id = `evt_lifecycle_${++sequence}`) {
    const payload = JSON.stringify({ id, type, data: { object } });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const response = await fetch(`${origin}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  const checkout = { id: 'cs_lifecycle_fixture', mode: 'subscription', customer: 'cus_lifecycle_fixture', subscription: 'sub_lifecycle_fixture', client_reference_id: tenantId, metadata: { tenantId, planId: 'sales' } };
  const subscription = { id: checkout.subscription, customer: checkout.customer, metadata: checkout.metadata, status: 'active' };
  assert.equal((await event('checkout.session.completed', { ...checkout, payment_status: 'unpaid' })).updated, false);
  assert.equal((await (await request('/api/billing')).json()).plan.id, 'trial');
  assert.equal((await event('checkout.session.completed', { ...checkout, payment_status: 'paid' }, 'evt_paid_fixture')).updated, true);
  assert.equal((await event('checkout.session.completed', { ...checkout, payment_status: 'paid' }, 'evt_paid_fixture')).duplicate, true);
  const billing = await (await request('/api/billing')).json();
  assert.equal(billing.plan.id, 'sales'); assert.equal(billing.tenant.status, 'active');
  assert.equal((await request('/api/contacts')).status, 200);
  assert.equal((await event('customer.subscription.updated', { ...subscription, cancel_at_period_end: true })).updated, true);
  assert.equal((await request('/api/contacts')).status, 200, 'Scheduled cancellation retains access until the subscription ends');
  const invoice = { id: 'in_lifecycle_fixture', customer: checkout.customer, subscription: checkout.subscription };
  assert.equal((await event('invoice.payment_failed', { id: 'in_one_off_fixture', customer: checkout.customer })).updated, false);
  assert.equal((await (await request('/api/billing')).json()).tenant.status, 'active');
  await event('invoice.payment_failed', invoice);
  const failed = await (await request('/api/billing')).json();
  assert.equal(failed.tenant.status, 'past_due');
  assert.equal(failed.billingAccess.paymentAttentionRequired, true);
  assert.equal(failed.billingAccess.accessBlocked, false);
  await event('invoice.payment_succeeded', { id: invoice.id, customer: checkout.customer, paid: true, parent: { subscription_details: { subscription: checkout.subscription, metadata: checkout.metadata } } });
  assert.equal((await (await request('/api/billing')).json()).tenant.status, 'active');
  await event('customer.subscription.deleted', { ...subscription, status: 'canceled' });
  assert.equal((await request('/api/contacts')).status, 402);
  assert.equal((await request('/api/billing')).status, 200, 'Billing recovery remains reachable');
  assert.equal((await (await request('/api/billing')).json()).tenant.status, 'canceled');
  // A delayed invoice from the ended subscription must not re-enable access.
  await event('invoice.paid', { ...invoice, id: 'in_old_late_fixture', paid: true });
  assert.equal((await request('/api/contacts')).status, 402);
  await event('customer.subscription.updated', subscription);
  assert.equal((await request('/api/contacts')).status, 402);
  await event('checkout.session.completed', { ...checkout, payment_status: 'paid' });
  assert.equal((await request('/api/contacts')).status, 402);
  const replacement = { ...checkout, id: 'cs_replacement_fixture', subscription: 'sub_replacement_fixture', payment_status: 'paid' };
  await event('checkout.session.completed', replacement);
  assert.equal((await request('/api/contacts')).status, 200);
  assert.equal((await event('customer.subscription.created', subscription)).updated, false);
  assert.equal((await event('customer.subscription.updated', subscription)).updated, false);
  await event('customer.subscription.deleted', { ...subscription, status: 'canceled' });
  await event('invoice.payment_failed', { ...invoice, id: 'in_old_failed_fixture' });
  assert.equal((await (await request('/api/billing')).json()).tenant.status, 'active');
});
