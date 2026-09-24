# Reliability and activation release — 2026-09-24

## Scope

Incremental improvements to company context, source discovery, subscription handling, and first-use activation. The existing design language, pricing, role scoring, and API response shapes are preserved. No new dependencies, paid AI services, schema migration, historical relinking, or bulk customer-data changes.

### Person-to-company links

- Adding a person links a unique exact company name or alias within the workspace. Partial and ambiguous names never silently choose a company.
- Add/edit forms can find a saved company, select it explicitly, or retain a name without a link. Failed searches and saves preserve entered details.
- Corrections update the old/new companies' contact totals and retain previous employment details. Historical tasks and activity keep their original associations.
- Changing companies invalidates stale role choices without discarding an unfinished outreach message. The UI asks the user to reload openings and review the message.

### Discovery reliability

The bottleneck is `saas/src/store.js::runAtsDiscovery` → `discoverAtsBoard` → career-page requests, board probes, retries, and optional rendered-page fallback. Previously these paths each spent their own timeout budget.

- Requests now share a 30-second budget **per company**. `BD_ATS_DISCOVERY_TIME_BUDGET_MS` can configure it up to 120 seconds.
- Timed-out checks are counted and explained as incomplete discovery, not proof of no jobs. Existing jobs and verified board identities are retained; successful matches from the batch are applied.
- Coverage diagnostics expose the last discovery failure. Timings include the company budget and slowest company.

Measurements on an isolated in-memory workspace using the same two public targets (Linear's careers page and an unmatched company): 4,339 ms before, 3,854 ms after. This difference is normal network variability, **not a claimed speedup**. A deliberately stalled-source regression with a 150 ms budget returned in 188 ms, kept the successful company's match, reported one timeout, and left zero pending fixture requests.

Large batches still run multiple waves. The full browser suite observed 64–67 second discovery batches with individual checks near 30 seconds. Incremental result delivery, whole-run limits, and abortable DNS resolution remain a separate performance pass.

### Subscription safeguards

- Checkout completion only grants the configured paid plan when subscription/payment metadata is valid and payment is confirmed (or no payment is required).
- A late invoice or same-subscription update/checkout cannot reactivate a canceled subscription. Old subscription update/create/delete events and unrelated invoices cannot override the replacement subscription covered by the tests.
- Signed local webhook tests exercise initial activation, duplicate delivery, scheduled cancellation, payment failure/grace/recovery, cancellation, replacement, and current invoice payload shapes. Billing remains accessible when workspace access is blocked.
- Live Stripe inspection was read-only: live mode, two configured paid prices, and one matching enabled webhook. Checkout remains card-only; no payment methods or Stripe settings were changed.

No real customer, checkout session, or charge was created. An owner-performed real card purchase remains the final end-to-end payment proof. General reconciliation of arbitrarily reordered historical webhooks is outside this patch.

### CSV dependency maintenance

The production build exposed [GHSA-8cw4-87c7-c6xx](https://github.com/adaltas/node-csv/security/advisories/GHSA-8cw4-87c7-c6xx) in `csv-parse` 7.0.1. The app's array-record parser does not enable the advisory's affected column options. Still, the existing dependency and lockfile were updated narrowly to 7.0.2, with a regression asserting duplicate prototype headers remain data. No other package versions changed. A clean install reported zero known vulnerabilities.

### Onboarding and activation measurement

- The checklist emphasizes the next incomplete action. An empty People workspace opens the Add person form directly and does not reopen it on reload.
- A successfully saved private outreach draft records a deduplicated workspace milestone. Failed saves do not count; message text and recipient details never enter analytics.
- Seven-day activation recognizes saved drafts from the current workflow, while generated, saved, and actually logged outreach remain distinct. No historical analytics backfill.

## Validation

- 414 backend/unit/integration tests passed after the CSV patch (413 before its additional security regression).
- ESLint, JavaScript syntax checks, schema contract, and additional People/Saved Work syntax checks passed. Schema remains 28 tables, 62 indexes, 13 migrations; only the source fingerprint changed.
- All 9 company-link browser checks and 18 checkout-return checks passed across Chromium, Firefox, and WebKit. A further 9 Firefox company-link checks passed across three repetitions.
- New company controls inspected at 390, 900, and 1440 px. Automated WCAG A/AA checks passed in light and dark themes.
- Firefox intermittently missed the reload lifecycle notification even when the document and person had loaded. The regression now verifies a fresh document, completed DOM lifecycle, cleared unsaved-work guard, and restored person rather than depending only on that notification.
- All 114 full Chromium workflow/regression checks passed in 2.9 minutes.
- After the CSV patch, all 12 selected import/onboarding checks passed across Chromium, Firefox, and WebKit. The onboarding harness now waits for the reloaded iframe document to finish loading before continuing.
- A repeated headless Firefox onboarding run still intermittently timed out at different automation calls, despite the final 12-test run passing. No uncaught app exception or failed application request was captured. This is not claimed fixed; isolate the browser/harness behavior in a separate pass.

## Deployment / rollback

Asset version: `20260924-reliability-01`.

Core release `9044967`: Railway deployment `fcfe4421-a2d8-4347-b107-8a95d763809b`, created 2026-09-24 12:22 UTC, succeeded. Docker build/readiness and eight non-mutating production smoke checks passed. Deployed App/People scripts matched the tested local source by LF-normalized SHA-256. Immediate error-level deployment logs were empty; live Stripe catalog recheck remained READY.

CSV patch `e688587`: Railway deployment `2a4aa26c-64cf-4751-bf27-b69dae34271c`, created 2026-09-24 12:30 UTC, succeeded. The production Docker build reported zero known vulnerabilities, readiness passed, and all eight non-mutating smoke checks passed again. Immediate error-level deployment logs were empty. The repository uses the existing Railway `saas/Dockerfile`; it has no separate frontend build or TypeScript compilation step.

Previous production deployment: `89093d10-4f19-4f98-be3d-44384780a06e`, source `c1799d9`. This is the rollback target; no migration rollback is needed.
