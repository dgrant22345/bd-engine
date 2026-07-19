# Commercial Launch Readiness - 2026-07-18

## Executive verdict

**LIMITED BETA READY. Not ready for a broad paid launch.** The core product is
real and functional: production is healthy, tenant-scoped workflows work, live
ATS adapters imported 2,409 public jobs from 12/12 providers in 9.5 seconds,
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
- SaaS unit/contract tests: 154/154 pass.
- Chromium customer journeys and accessibility checks: 22/22 pass.
- Compact compatibility journey: Chromium, Firefox, and WebKit pass.
- Renderer checks/tests: 4/4 pass.
- Deterministic ATS contract: 12/12 providers pass.
- Live ATS canary: 12/12 providers, 2,409 jobs, 0 provider errors.
- Schema migration contract: 24 tables, 56 indexes, 10 migrations; no drift.
- Production relational parity: 3/3 workspaces pass deep parity.
- Production health: `{"ok":true,"status":"operational"}`.
- Production dependency audits: 0 known vulnerabilities in SaaS and renderer.
- Windows package staging: pass; public code signing was not verified.
- No repository secret was found by the targeted scan. Test-only fake keys and
  certificate marker parsing remain intentionally present.

## P0 - launch blockers

1. **The stronger production session secret is staged but not active.** A strong
   replacement and `BD_SUPPORT_ADMIN_EMAILS` were set in Railway with deployment
   explicitly skipped, so current sessions have not yet rotated. Impact: the
   active release still uses its previous signing configuration. Fix: include the
   planned one-time logout in the approved deployment, then verify login, logout,
   and restart persistence. Never print or commit the value.
2. **Production account recovery email is unavailable.** `RESEND_API_KEY` and
   `BD_EMAIL_FROM` are unset. Impact: paying users cannot self-recover accounts
   and verification/support email cannot be trusted. Fix: verify a sending
   domain, configure both values, and test reset, verification, support receipt,
   and reply delivery against real inboxes.
3. **Verified-email enforcement is not enabled in production.** Configure and
   test transactional email first, then set `BD_REQUIRE_EMAIL_VERIFICATION=true`.
   Impact: until rollout, unverified accounts can consume import, discovery, and
   renderer capacity. The production checker now fails until this gate is on.
4. **Known duplicate personal-data workspace awaits an owner decision.**
   `docs/workspace-provenance.md` documents 20,509 duplicated real contacts in
   an abandoned trial identity. Impact: unnecessary privacy and breach exposure.
   Fix: obtain explicit approval, take a fresh verified backup, delete through a
   controlled audited operation, and document the retention decision.

## P1 - serious commercial risks

1. `BD_SUPPORT_ADMIN_EMAILS` is staged for the named operator but will not be
   active until deployment. `BD_ERROR_WEBHOOK` remains unset, so server failures
   still lack accountable real-time routing.
2. The main legacy workspace has 12,235 mechanically linkable board records and
   12,317 unclassified legacy companies. Discovery is diluted across an entire
   network history. A dry-run board-link repair and owner-confirmed target
   curation workflow are now included; neither has changed production data.
3. Daily encrypted offsite backups, retention, alerting, and a recent restore
   drill are documented but not proven by repository state. Record evidence in
   the launch checklist; a backup that has never restored is not a recovery plan.
4. Privacy/Terms pages are plain-language launch summaries, not reviewed legal
   agreements. Refunds, taxes, renewal/cancellation language, processor terms,
   lawful-basis/consent, and Canadian/international privacy obligations need
   qualified legal/accounting review.
5. Windows distribution is not proven code-signed. Do not broadly distribute an
   unsigned installer to paying customers.

## P2 - important improvements

- PostgreSQL relational entities still store timestamps as text. Verified
  contact identity, LinkedIn URL, and job natural-key constraints are staged;
  re-run the duplicate gate before deployment. Account and board uniqueness is
  blocked by 120 production duplicate groups and 638 excess rows, which require
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
- Review dependency and pinned GitHub Action updates monthly through an explicit
  pull request; CI actions are now immutable commit references.

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

## Required production configuration

Core: `DATABASE_URL`, `SESSION_SECRET`, `BD_CLOUD_ENV=production`.

Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_JOBSEEKER`, `STRIPE_PRICE_SALES`.

Customer operations: `RESEND_API_KEY`, `BD_EMAIL_FROM`,
`BD_SUPPORT_ADMIN_EMAILS`, `BD_ERROR_WEBHOOK`,
`BD_REQUIRE_EMAIL_VERIFICATION=true`.

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
2. Create and verify a fresh encrypted backup; test its dry-run restore against
   a disposable database.
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
