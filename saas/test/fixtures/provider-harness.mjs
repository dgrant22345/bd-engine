// Loaded only by the isolated provider journey test; never imported by the app.
import Stripe from 'stripe';
if (process.env.NODE_ENV !== 'test' || !process.send || process.env.STRIPE_SECRET_KEY !== 'sk_test_journey_fixture') throw new Error('Provider fixture requires the isolated test process');
const mockFetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  if (String(url).startsWith('https://api.resend.com/')) {
    const message = JSON.parse(init.body); process.send({ kind: 'email', message }); return Response.json({ id: 'email_fixture' });
  }
  if (String(url).startsWith('https://api.stripe.com/')) {
    const fields = Object.fromEntries(new URLSearchParams(init.body));
    process.send({ kind: 'stripe', path, fields });
    if (path === '/v1/checkout/sessions') return Response.json({ id: 'cs_journey_fixture', url: 'https://checkout.stripe.com/c/pay/journey_fixture' });
    if (path === '/v1/billing_portal/sessions') return Response.json({ id: 'bps_journey_fixture', url: 'https://billing.stripe.com/p/session/journey_fixture' });
    throw new Error(`Unexpected Stripe fixture path: ${path}`);
  }
  throw new Error('Provider fixture blocked an unexpected outbound request');
};
Stripe._platformFunctions.createDefaultHttpClient = () => Stripe.createFetchHttpClient(mockFetch);
globalThis.fetch = mockFetch;
