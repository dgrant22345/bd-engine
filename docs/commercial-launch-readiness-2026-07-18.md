# Commercial Launch Readiness - 2026-07-18

## Executive verdict

**LIMITED BETA READY. Not ready for a broad paid launch.** The core product is
real and functional: production is healthy, tenant-scoped workflows work, live
ATS adapters imported 2,408 public jobs from 12/12 providers in 8.8 seconds,
and the main workspace currently holds 6,184 active jobs from 82 resolved
boards. The remaining launch gates are operational configuration, legacy data
curation, retention cleanup, and professional legal review rather than a demo
backend or a missing scraper.

Assumption: this is an early-stage hosted SaaS for staffing/recruiting business
development users and individual job seekers, initially at low-to-moderate
traffic and tens of thousands of records per large workspace. Railway hosts the
Node/PostgreSQL app and a private Playwright renderer. A legacy Windows-local
PowerShell/SQLite edition remains supported separately.

## Architecture and trust boundaries

- `saas/src/server.js`: HTTP API, authentication boundary, tenant authorization,
  billing routes, support, privacy, health, and static cloud shell.
- `saas/src/store.js`: tenant-scoped product workflows, import/discovery jobs,
  deduplication, scoring, and legacy/relational persistence coordination.
- `saas/src/db.js`: PostgreSQL connection, advisory-locked migrations, sessions,
  billing webhooks, support, analytics, audit records, and application data.
- `app/`: shared browser application loaded in a same-origin iframe.
- `renderer/`: private bearer-authenticated Playwright service. It receives only
  validated public careers URLs; SSRF checks block private/local destinations.
- External processors/services: Railway/PostgreSQL, public ATS and careers sites,
  Stripe, Resend when configured, and an operator-selected error webhook.
- Sensitive data: account credentials, LinkedIn-derived contacts, notes,
  outreach history, jobs, support messages, billing identifiers, and backups.

## Verified baseline

- SaaS syntax checks: pass.
- SaaS unit/contract tests: 198/198 pass.
- Chromium customer journeys and accessibility checks: 22/22 pass.
- Compact compatibility journey: Chromium, Firefox, and WebKit pass.
- Renderer checks/tests: 4/4 pass.
- Deterministic ATS contract: 12/12 providers pass.
- Live ATS canary: 12/12 providers, 2,408 jobs, 0 provider errors.
- Schema migration contract: 24 tables, 56 indexes, 10 migrations; no drift.
- Production parity audit: all 3 legacy-primary workspaces pass deep parity. The
  2 relational-primary workspaces correctly serve relational data but have
  stale legacy rollback mirrors; refresh and verify snapshots before rollback.
- Production health: `{"ok":true,"status":"operational"}`.
- Production dependency audits: 0 known vulnerabilities in SaaS and renderer.
- Windows package staging: pass; public code signing was not verified.
- No repository secret was found by the targeted scan. Test-only fake keys and
  certificate marker parsing remain intentionally present.
- HTTP requests now have bounded body size, header/request duration, header
  count, keep-alive reuse, and requests per socket; oversized declared uploads
  are rejected before their contents are buffered.
- The cloud shell's inline bootstrap is authorized with a fresh response nonce;
  the script policy no longer permits arbitrary inline JavaScript.
- A repeatable-read production backup completed and authenticated successfully
  on 2026-07-19: 20 tables, 15.79 MB encrypted, SHA-256
  `2ea029a9933b336763c53b11f46761449e2042a8f1b50597b5540ef1a9663d9c`.
- Railway deployment `4c42b674-6674-4666-9e62-6020a60af19f` successfully
  released merge commit `b5fd0eb1d6c79535081c477627a4893afd6a2434`.
  Production reports 10 applied migrations, zero recent warnings/5xx responses,
  valid CSP nonces, and successful live/readiness/anonymous-boundary smoke checks.

## P0 - launch blockers

1. **Production account recovery email is unavailable.** `RESEND_API_KEY` and
   `BD_EMAIL_FROM` are unset. Impact: paying users cannot self-recover accounts
   and verification/support email cannot be trusted. Fix: verify a sending
   domain, configure both values, and test reset, verification, support receipt,
   and reply delivery against real inboxes.
2. **Verified-email enforcement is not enabled in production.** Configure and
   test transactional email first, then set `BD_REQUIRE_EMAIL_VERIFICATION=true`.
   Impact: until rollout, unverified accounts can consume import, discovery, and
   renderer capacity. The production checker now fails until this gate is on.
3. **Known duplicate personal-data workspace awaits an owner decision.**
   `docs/workspace-provenance.md` documents 20,509 duplicated real contacts in
   an abandoned trial identity. Impact: unnecessary privacy and breach exposure.
   Fix: obtain explicit approval, take a fresh verified backup, delete through a
   controlled audited operation, and document the retention decision.

## P1 - serious commercial risks

1. `BD_SUPPORT_ADMIN_EMAILS` is active for the named operator, but the full
   support step-up workflow still needs a production test. `BD_ERROR_WEBHOOK`
   remains unset, so server failures still lack accountable real-time routing.
2. Both live Stripe prices and products are active with the advertised monthly
   USD amounts. The canonical webhook is enabled for all six required checkout,
   subscription, failed-payment, and recovery events, and the read-only catalog
   verifier passes. Local boundary tests now prove signed payload acceptance,
   tamper rejection, checkout and portal contracts, referral credits, and
   idempotent subscription cancellation. Live checkout/failure/refund exercises
   are still required before payment operations are launch-approved.
3. The main legacy workspace has 12,235 mechanically linkable board records and
   12,317 unclassified legacy companies. Discovery is diluted across an entire
   network history. A dry-run board-link repair and owner-confirmed target
   curation workflow are now included; neither has changed production data.
4. The backup tool now produces authenticated AES-256-GCM archives and refuses
   unencrypted production runs. A dedicated key is active and a current archive
   verified. CI now proves encrypted backup, transactional restore, exact durable
   table recovery, volatile-data exclusion, and serial-sequence repair against
   disposable PostgreSQL 16 databases. Off-platform key custody, daily offsite
   scheduling and retention, and a restore of an actual production archive still
   require operator-owned infrastructure and recorded evidence.
5. Privacy/Terms pages are plain-language launch summaries, not reviewed legal
   agreements. Refunds, taxes, renewal/cancellation language, processor terms,
   lawful-basis/consent, and Canadian/international privacy obligations need
   qualified legal/accounting review.
6. Windows distribution is not proven code-signed. Do not broadly distribute an
   unsigned installer to paying customers.
7. The two relational-primary workspaces have intentionally diverged from their
   legacy blobs since cutover. Current reads are not impaired, but an immediate
   legacy rollback would restore stale data. Create an encrypted backup, run the
   documented per-workspace snapshot command, and verify deep parity before any
   rollback or broad launch.

## P2 - important improvements

- PostgreSQL relational entities still store timestamps as text. Verified
  contact identity, LinkedIn URL, and job natural-key constraints are deployed;
  the production audit was clean before migration. Account and board uniqueness is
  blocked by 119 production duplicate groups and 637 excess rows, which require
  an owner-approved, backed-up deduplication rather than an automatic migration.
- CI now enforces ESLint correctness rules across SaaS source, scripts, and tests.
  Formatting and static typing remain incremental engineering improvements; do
  not force a broad legacy rewrite solely to add them.
- Configure centralized structured log retention and external dashboards/paging.
  The authenticated status API now reports 5xx rate, queue age/failures, and a
  24-hour ingestion success rate against explicit SLO targets.
- Review the new privacy-safe activation and revenue funnel monthly and define
  cohort targets after enough real customer volume exists for a useful baseline.
- Cross-workspace support access now requires a recent login or rate-limited
  current-password step-up. Add passkeys or MFA when enrollment, recovery, and
  operator support can be implemented and exercised end to end.
- Dependabot now opens grouped monthly npm and pinned GitHub Action update pull
  requests against the deployment branch; each still requires the full CI gate
  and explicit review before merge.

## P3 - optional enhancements

- Server-rendered metadata, sitemap, and richer SEO only matter if organic
  acquisition becomes a channel; the authenticated product itself is the focus.
- Add customer-visible incident history and an SLA only when support capacity
  and monitoring can sustain the promise.
- Add organization invites/seat billing after role semantics and seat limits are
  fully productized; do not advertise seats before then.

## Changes in this hardening pass

- Enforced read-only viewer behavior and owner/admin billing permissions.
- Restricted workspace-wide data deletion and legacy mass classification to the
  owner role.
- Made session creation, logout revocation, password reset, user/membership
  persistence, legacy tenant saves, and privacy deletion fail truthfully on DB
  errors. Added a PostgreSQL pool error listener to prevent idle-client crashes.
- Added 10-character new-password minimum and 32-character production session
  secret minimum; existing password hashes remain compatible.
- Added a customer-facing Privacy and data dialog with export and typed deletion.
- Added aggregate job-coverage diagnostics, dry-run board-link repair, and
  owner-confirmed legacy target curation.
- Added production configuration checks, deterministic Docker installs, CI
  production dependency audits, stronger headers, tests, and runbook updates.
- Added hashed PostgreSQL-backed rate limits shared across app instances, with a
  bounded in-memory fallback when PostgreSQL is unavailable.
- Added rollout-gated verified-email enforcement for imports and ATS discovery.
- Added axe WCAG/contrast checks and Chromium, Firefox, and WebKit browser gates;
  corrected search semantics and low-contrast UI tokens found by the rendered tests.
- Added transactional self-service account closure with ownership protection,
  idempotent Stripe cancellation, session erasure, and a pseudonymous recovery ledger.
- Added allowlisted, idempotent activation and revenue milestones without accepting
  arbitrary public event names or dimensions.
- Added a generated schema contract and CI drift gate for the executable migrations.
- Added authenticated queue/error/ingestion operational metrics and explicit SLOs.
- Pinned every third-party GitHub Action to an immutable upstream commit.
- Added a scheduled, read-only production probe for availability, readiness,
  anonymous authorization boundaries, plan visibility, and customer entry.
- Made the production probe and ATS canary reusable from the default branch so
  GitHub schedules execute the checks against `deploy/perf-restore`, the branch
  Railway actually deploys.
- Added a focused ESLint correctness gate and fixed the defects it exposed.
- Added expiring, persisted password step-up for cross-workspace support access.
- Required the current password as well as the exact confirmation phrase for
  workspace-wide data deletion.
- Added a read-only production duplicate gate and staged only the contact/job
  constraints proven clean by aggregate production evidence.
- Corrected account-to-board resolution across blob and relational reads, made
  all visible account/contact/board/enrichment filters functional, and added
  account-linked board lookup indexes.
- Excluded network-only companies from discovery coverage metrics and legacy
  refresh work while preserving them as searchable relationship context.
- Restored job-seeker terminology and workflows across setup, navigation,
  companies, network contacts, open roles, search, and outreach.
- Reworked sales outreach around one verified role plus a compact role count,
  with shorter LinkedIn, email, follow-up, and call copy.
- Fixed Pause account to use the supported reversible status transition and
  added contract coverage for every literal customer action.
- Restricted customer-visible and imported external links to HTTP/HTTPS and
  discarded unsafe job-link protocols before persistence.
- Added authenticated AES-256-GCM database backups, fail-closed production key
  validation, tamper detection, backward-compatible restore reads, and a
  two-part restore confirmation contract.
- Made backup coverage derive from the complete schema contract and made restore
  preserve every archived column, including verification state, relational
  storage mode, billing recovery fields, and the account-closure ledger.
- Added hourly bounded retention for detailed import history, analytics, audit
  records, Stripe webhook receipts, background jobs, rate-limit buckets,
  sessions, and authentication tokens while preserving active webhook claims.
- Added structured production request/error logs with path-only request data,
  sanitized error summaries, and privacy-safe alerts that omit workspace IDs,
  query strings, and raw exception messages.
- Extended error sanitization to database, authentication, scheduler, email,
  billing-webhook, and ingestion failure paths, including credential-bearing
  URL and internal record-ID redaction.
- Expanded the Content Security Policy across scripts, styles, APIs, frames,
  workers, images, forms, fonts, manifests, and objects; CI and live-canary
  workflow tokens now have explicit read-only repository permissions.
- Removed Host-header trust from password reset, verification, support, referral,
  checkout, and billing-portal URL generation; production now requires one
  validated canonical public origin.
- Stopped trusting caller-controlled `X-Forwarded-For` for abuse controls;
  Railway deployments use validated `X-Real-IP` and local deployments use the
  socket peer address.
- Added an explicit cross-site mutation gate using validated Origin and Fetch
  Metadata headers, beyond response-only CORS protection.
- Made operational reports and dry runs connect without applying migrations and
  use PostgreSQL-enforced read-only sessions; mutating maintenance tools also no
  longer migrate the schema as an undocumented side effect.

## Required production configuration

Core: `DATABASE_URL`, `SESSION_SECRET`, `BD_CLOUD_ENV=production`, and
`BD_CLOUD_BASE_URL` (or Railway's injected public domain).

Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_JOBSEEKER`, `STRIPE_PRICE_SALES`.

Customer operations: `RESEND_API_KEY`, `BD_EMAIL_FROM`,
`BD_SUPPORT_ADMIN_EMAILS`, `BD_ERROR_WEBHOOK`,
`BD_REQUIRE_EMAIL_VERIFICATION=true`, `BD_BACKUP_ENCRYPTION_KEY`.

ATS renderer pair: `BD_ATS_RENDER_SERVICE_URL`,
`BD_ATS_RENDER_SERVICE_TOKEN`; renderer service uses `RENDERER_TOKEN`.

Privileged access: narrowly scoped `BD_INTERNAL_OWNER_EMAILS`,
`BD_ANALYTICS_ADMIN_EMAILS`, and `BD_SUPPORT_ADMIN_EMAILS`.

Never enable in production: `BD_EXPOSE_RESET_TOKEN`,
`BD_ALLOW_TEST_CHECKOUT`, `BD_ENABLE_SYNTHETIC_ERROR`.

## Deployment and rollback

Record owners, dates, and evidence in `docs/commercial-launch-checklist.md`.
Repository checks alone cannot prove provider delivery, restore success, legal
review, support staffing, or alert ownership.

1. Resolve all P0 environment gates and run `check:production-config` without
   exposing values.
2. Create and verify a fresh encrypted backup; run its dry-run validation and
   periodically restore the actual archive into an approved disposable database.
3. Run check, unit tests, browser tests, both dependency audits, ATS contract,
   and renderer tests. Review `git diff` and deploy the exact approved commit.
4. Verify `/readyz`, `/health`, login/logout, password email, setup, one ATS
   discovery, one live refresh, billing test-mode flow, support delivery, and
   relational parity. Do not run mutation smoke against customer data.
5. Roll back by redeploying the last known-good commit. If a data repair was
   applied, use its verified pre-change backup and documented restore procedure;
   never reverse a migration with ad hoc SQL under incident pressure.

## Monitoring and alert minimum

- External `/health` and `/readyz` probes with paging on sustained failures.
- 5xx rate, p95 latency, memory, restart count, DB connections, background queue
  age/failures, ATS board success/empty/failure rates, webhook failures, email
  failures, payment recovery state, and relational parity drift.
- Alerts must include release and request ID, never customer rows or secrets.
- Daily backup success and monthly restore-drill evidence.

## Manual QA gate

- Recruiter and job-seeker signup, verification, setup, CSV preview/import, target
  selection, board discovery, job refresh, outreach, task completion, and logout.
- Trial limit, upgrade, successful webhook, duplicate webhook, failed payment,
  grace period, portal, cancellation, invoice access, and plan entitlement.
- Owner/member/viewer permissions; cross-tenant requests; support customer/admin
  views; privacy export; wrong and correct destructive confirmations.
- Password reset, expired token, unavailable email, session restart, and logout
  revocation.
- Empty/loading/error/offline/retry states at desktop, laptop, and mobile widths;
  keyboard-only operation and screen-reader labels on critical dialogs/forms.
- ATS outage, renderer outage, rate limit, malformed/large CSV, duplicate import,
  DB interruption, deploy restart, rollback, and restore rehearsal.

## Professional review required

Qualified counsel should review Privacy, Terms, consent/lawful processing of
contact data, retention/erasure, cookies/analytics, subprocessors, cross-border
transfers, anti-spam/outreach obligations, PIPEDA/GDPR applicability, and breach
response. A qualified accountant should review taxes, invoices, refunds, and
revenue recognition. Security controls here are engineering evidence, not SOC 2,
PCI, GDPR, or PIPEDA certification.
