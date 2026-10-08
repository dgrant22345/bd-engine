# Email and payment verification setup

Live app: https://bd-engine-production.up.railway.app
Requested test inbox: dgfinance15@gmail.com

The app implements email verification, single-use password reset, opt-in follow-up digests, Stripe Checkout, a billing portal, signed webhooks, paid access, payment recovery, and cancellation. Automated tests exercise these together with isolated provider fixtures. Actual provider delivery and checkout remain pending; neither Resend nor a separate Stripe test environment is configured. Configure secrets in the provider/hosting dashboards, not in chat or the repository.

## Resend

1. Create or open the Resend account and verify a sender domain you own. Add the DNS records Resend supplies. A Gmail inbox can receive mail but cannot serve as your verified sending domain.
2. Create a sending API key and add `RESEND_API_KEY` to the Railway service variables. Set `BD_EMAIL_FROM` to a sender on the verified domain, such as `BD Engine <support@your-domain.example>`; replace this example with your actual sender.
3. For an isolated initial test, Resend's `onboarding@resend.dev` sender can send only to the Resend account owner's verified email. Use it only in the test environment if that recipient is dgfinance15@gmail.com; a production app needs its verified domain.
4. Use an isolated test workspace to sign up with the requested inbox. Confirm that its verification link arrives, points at the test app, verifies the account once, and rejects reuse.
5. Request a password reset, open its link, set a new password, then check that the old password fails and the link cannot be reused.
6. Create a dated follow-up due today and enable email reminders from Follow-ups → Calendar & email reminders. Choose your time zone and an hour that has passed. Delivery scans run every five minutes. Confirm one digest arrives, a repeated scan does not send a second digest that local day, and disabling reminders stops delivery. Undated and completed tasks are excluded. Provider delivery acceptance is recorded; inbox arrival still requires observation.
7. After production sender delivery is verified, review enabling `BD_REQUIRE_EMAIL_VERIFICATION=true` for expensive import/discovery operations. Do not enable this gate while mail is unavailable.

## Separate Stripe test environment

1. Create an isolated Railway environment/service with its own PostgreSQL database, public URL, session secret, and Resend test configuration. Do not share the production database or replace live Stripe credentials with test keys.
2. In Stripe test mode, create monthly prices matching the application's $5 Job Seeker and $10 Recruiter Pro plans and USD currency. Configure a test billing portal with cancellation enabled.
3. In the isolated service, set `STRIPE_SECRET_KEY` to the test key, `STRIPE_PRICE_JOBSEEKER` and `STRIPE_PRICE_SALES` to those test price IDs, and `BD_ALLOW_TEST_CHECKOUT=true`. Set `BD_CLOUD_BASE_URL` to the test app's own HTTPS URL. Keep `BD_ALLOW_TEST_CHECKOUT` off in production. If the test service was cloned from production, set `BD_ENFORCE_COMMERCIAL_READINESS=false` only in that isolated service so its intentional test checkout is allowed; preserve the production gate. Do not grant the QA inbox an internal-owner entitlement in the test service, because that bypass would invalidate paid-access checks.
4. Add a Stripe test webhook endpoint at `https://YOUR-TEST-APP/api/billing/webhook`, subscribing to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, and `invoice.payment_succeeded`. Configure its signing secret as `STRIPE_WEBHOOK_SECRET` in the isolated service.
5. Sign up and verify the test account. Complete checkout using Stripe's documented test card (4242 4242 4242 4242, a future expiry, and any valid test CVC). Confirm checkout alone does not grant access: access changes after the signed payment-confirmed webhook.
6. Log out and back in. Confirm the subscribed plan and access remain correct. Replay the same webhook and confirm it is processed once.
7. Open the portal, schedule cancellation, and confirm access remains through the paid period. Use Stripe's test clock/events to end the subscription, then check paid workspace APIs require billing and the billing/recovery page stays accessible.
8. Record actual provider receipt IDs and outcomes in a private deployment record. Never record full keys, card details, verification/reset tokens, or customer messages.

## Analytics and automated verification

Configure `BD_ANALYTICS_TEST_EMAILS=dgfinance15@gmail.com` in the environments where this inbox is used for QA, preserving any existing entries. Configure actual internal owner emails in `BD_INTERNAL_OWNER_EMAILS`/`BD_OWNER_EMAILS`. The customer growth report excludes these identities, demo workspaces, reserved test domains, and explicitly classified test events. Test Stripe subscriptions do not count as customer paid conversion. New daily workspace-visit events measure returns during days 7–13 after signup, reported after the full 14-day window closes; older cohorts may undercount returns.

Run `npm --prefix saas test` for isolated account/provider fixtures, `npm --prefix saas run test:browser` for UI journeys, and the PostgreSQL CI workflow for feedback persistence, simultaneous reminder scans, and cohort exclusions. No automated fixture sends real mail or creates real Stripe charges.
