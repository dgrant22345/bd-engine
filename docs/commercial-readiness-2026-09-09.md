# SignalAI: first paying customers

## Executive Summary
Prioritize purchase readiness and observed customer onboarding—not another broad redesign. The available traffic and signup sample cannot establish product rejection or a reliable conversion rate.

## Findings
Five signup completions were recorded in the last 30 days; one matches a test pattern, leaving four not identified as owner/test activity. One setup completion was recorded. The only checkout session matches a test pattern. These are separate event counts, not a validated cohort funnel.

## Launch readiness

Correction after tracing the complete checkout call chain: `isCommercialCheckoutReady` uses the full readiness assessment in production. Missing email configuration therefore actively blocks new checkout (HTTP 503); Stripe catalog readiness alone does not mean customers can buy. The earlier assessment understated this dependency. Preserve the gate until delivery is verified.
Live configuration checks on 9 September found the Stripe catalog and webhook configuration ready. Transactional email is not configured: RESEND_API_KEY and a verified BD_EMAIL_FROM are missing, and email-verification enforcement is disabled. This is a recovery/trust and abuse-prevention gap, not proof of broken checkout. The app has no linked subscriptions or webhook-event records; Stripe revenue was not independently reconciled.

## Next steps
1. Configure transactional email, verify actual delivery, then test signup → first useful result → upgrade → entitlement and account recovery in a controlled environment.
2. Choose one initial audience: independent recruiters/small staffing agencies. Align the landing page, plan name and LinkedIn promise; the current recruiter offer is called Sales Professional.
3. Personally onboard five recruiters using their real target accounts. Observe friction, relevant-job quality and whether they return. Five is a proposed learning target, not a benchmark.
4. Use a short real-workflow demonstration and personalized LinkedIn invitations to recruit these pilots. Ask permission before community promotion. Defer broad advertising until users repeatedly reach value.
5. Separate internal/test traffic and track customer-linked activation, return usage, checkout failures and paid entitlements. Build only against observed blockers.

## Questions to resolve
Are recent signups actually target buyers? Where do they stop? Does their target-company data produce useful, current opportunities? What task would they replace with this product, and will they pay the displayed price after trying it?

## Caveats and sources
Traffic snapshot at 2026-09-09 09:32 UTC: 622 pageviews and 84 distinct visitor IDs over the preceding 30 days. IDs are not verified people, and internal activity/bots are not fully excluded. Event absence may reflect instrumentation gaps. No conversion percentage or causal attribution is justified. Read-only production aggregates and scripts/check-production-config.mjs, scripts/verify-billing-catalog.mjs informed this brief; saas/public/index.html and docs/marketing-launch-plan-30-days.md informed positioning. No production settings, messages or ads were changed. A compact table is used instead of a chart because three unlinked event counts should not resemble a conversion funnel. Founder-led interviews are also consistent with [YC's customer-discovery discussion](https://www.ycombinator.com/blog/peter-reinhardt-on-finding-product-market-fit-at-segment).

Artifact delivery note: the report renderer requires a chart. This brief uses prose rather than a misleading funnel visualization; delivered as Markdown instead.
