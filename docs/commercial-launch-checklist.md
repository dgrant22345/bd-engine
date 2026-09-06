# Commercial Launch Checklist

This checklist is the release record for a broad paid launch. Do not mark an
item complete based only on code presence. Record the owner, completion date,
and durable evidence link or identifier. Never paste secrets or customer rows.

## Current audit checkpoint — 6 September 2026

The checked July items below are historical evidence, **not approval of the
current release**. See the [September product-quality audit](product-quality-audit-2026-09-06.md)
for the reproduced six-row paging defect, corrected code, current tests, and
remaining gates. Email credentials, verified sender, and verification rollout
remain incomplete. The latest live sample is 10 complete/nonempty boards out of
12, with one partial Workday board and one empty BambooHR board; do not reuse the
older 12/12 result as a current completeness claim. Re-run release, billing,
recovery, and delivery checks before a broad paid launch.

## Release candidate

- [x] Approved head: `3345c56218854a1b997ba516d10762e3ac42e107`
  Owner/date: `dgrant22345 / 2026-07-26`
- [x] CI is green for lint, schema contract, unit tests, browser journeys,
  compatibility, renderer tests, dependency audits, and deterministic ATS tests.
  Evidence: GitHub CI run 100.
- [x] Live ATS canary passes all supported providers with no provider errors.
  Evidence: 2026-07-19, 12/12 providers, 2,408 jobs in 8.8 seconds.
- [ ] Privacy, Terms, refund/cancellation language, subprocessors, outreach
  obligations, and retention rules were reviewed by qualified professionals.
  Reviewer/date/evidence: `________________`

## Production configuration

- [x] `SESSION_SECRET` is at least 32 characters of random material. Rotation is
  scheduled with the expected one-time logout communicated. Evidence: activated
  by production deployment `4c42b674-6674-4666-9e62-6020a60af19f`.
- [ ] `RESEND_API_KEY` and `BD_EMAIL_FROM` use a verified sending domain.
  Evidence: `________________`
- [ ] Password reset, email verification, support receipt, and customer support
  reply were delivered to real test inboxes. Evidence: `________________`
- [ ] `BD_SUPPORT_ADMIN_EMAILS` names an accountable, least-privilege support
  group. Access was tested after the 15-minute password step-up expired.
  Evidence: `________________`
- [x] `BD_ERROR_WEBHOOK` reaches an actively monitored destination; a controlled
  synthetic failure was received with release and request IDs but no customer data.
  Evidence: 2026-07-19, private Discord `bd-engine-alerts` channel. Railway
  production environment delivered the value-safe synthetic request
  `synthetic-setup-20260719` with HTTP 204, and the alert was observed in-channel.
- [ ] `BD_REQUIRE_EMAIL_VERIFICATION=true` and an unverified test account was
  blocked from import, discovery, and renderer-backed work. Evidence: `________________`
- [ ] The value-safe check passes without printing values:

  ```powershell
  railway.cmd run --service bd-engine --environment production -- npm.cmd --prefix saas run check:production-config
  ```

  Current result on 2026-07-26: all checks pass except `RESEND_API_KEY`,
  `BD_EMAIL_FROM`, and `BD_REQUIRE_EMAIL_VERIFICATION=true`.

## Data and recovery

- [x] A fresh encrypted backup completed and its SHA-256 was recorded.
  Latest backup reference: `pre-portfolio-rebalance-20260726.json.gz.enc`,
  SHA-256 `dd950a46751d36daa339a103fc3934e0c4cf9bd83ede420de2950de9d448eeb8`.
  The 17.94 MB AES-256-GCM archive was verified before the production rebalance.
- [ ] `BD_BACKUP_ENCRYPTION_KEY` is a dedicated 32-byte key stored separately
  from backup archives; a key-loss and key-rotation owner is documented.
  Evidence: `________________`
- [ ] That backup restored successfully into a disposable database and semantic
  integrity checks passed. Restore evidence: `________________`
- [x] CI restores a representative encrypted archive into disposable PostgreSQL,
  compares all durable tables, verifies volatile exclusions, and tests sequence
  recovery. Evidence: `PostgreSQL recovery drill` required CI job.
- [x] The aggregate duplicate audit was run immediately before deployment.
  Contact identity, contact LinkedIn URL, and job natural key all reported zero.
  Evidence: 2026-07-19 read-only production audit; account and board cleanup
  remains separately gated at 119 groups / 637 excess rows.
- [ ] Account and board duplicate retention/merge decisions were approved before
  any cleanup. No relational-only deletion was used while legacy blobs could
  recreate records. Decision/evidence: `________________`
- [x] Deep legacy/relational parity passes for every relational-primary and
  canary workspace. Evidence: 2026-07-19 production `check:relational -- --deep`,
  all three workspaces passed.
- [x] The ten migrations and restore path are exercised from empty PostgreSQL 16
  databases on every CI run. Evidence: `PostgreSQL recovery drill` required job.
- [ ] Production rollback was rehearsed by redeploying the previous application
  commit and confirming compatibility. Evidence: `________________`

## Billing and customer operations

- [x] Live Stripe prices are active monthly USD prices attached to active
  products: Job Seeker $5 and Sales Professional $10. Evidence: 2026-07-19
  read-only production catalog verification.
- [x] The enabled production webhook subscribes to checkout, subscription,
  failed-payment, and successful-payment events. Evidence: 2026-07-19 read-only
  production catalog verification passed after the event allowlist correction.
- [ ] Stripe live checkout succeeds for Job Seeker and Sales Professional.
- [x] Signed webhook acceptance, tamper rejection, duplicate delivery, checkout
  payloads, referral credits, portal sessions, and idempotent account-closure
  cancellation pass automated contract tests. Evidence: required billing tests.
- [ ] Live webhook delivery, failed payment, grace period, recovery, cancellation,
  portal access, and invoice access were tested against Stripe.
- [x] Plan entitlements and limits match the public pricing page. Evidence:
  `public prices and limits match enforced plan entitlements` required unit test.
- [x] Account closure cancellation, shared-workspace ownership blockers, data
  removal, and failed-dependency recovery pass automated tests and local smoke.
- [ ] Account closure was exercised with a live test subscription.
- [ ] Support ownership, response target, escalation path, refund policy, and
  incident communications are documented and staffed.

Evidence for this section: `________________`

## Commercial truth and offer

- [ ] Public positioning names the buyer the current product serves and does not
  imply multi-seat collaboration while the paid plan is limited to one login.
- [ ] Every customer-visible dashboard label is derived from tenant records. No
  fixed example count or proxy queue is described as live, stale, overdue, or
  ranked without the underlying evidence.
- [ ] Referral copy names the actual credit recipient, amount, and qualifying
  event. A live test confirms the credit lands on that Stripe customer only once.
- [ ] Signup presents the reviewed Terms and Privacy notice before account
  creation, and the accepted document versions and timestamp are recoverable.
- [x] Privacy-safe product analytics accepts outreach, reply, meeting,
  opportunity, and client win/loss milestones while discarding arbitrary
  customer-content dimensions. Evidence: `product-analytics` required unit test.

Evidence for this section: `________________`

## Deploy and observe

- [ ] Maintenance risk and rollback owner were announced before deployment.
- [x] The exact approved commit was deployed; Railway reports both services and
  PostgreSQL online. Commit `3345c56218854a1b997ba516d10762e3ac42e107`,
  deployment `470f6f0a-93ce-4b7e-8a61-c599a6b25468`, image digest
  `sha256:8efa5000d9fcc2193b705b49187e099f78421b2b9ea32d59dfce88f87a06364e`.
- [ ] `/livez`, `/readyz`, `/health`, public entry, login, verified signup, one
  ATS discovery, one job refresh, support, billing, export, and logout passed.
  Partial evidence: all three health endpoints returned HTTP 200, and authenticated
  production ATS discovery and a live job refresh completed on 2026-07-26. The
  remaining flows still require one recorded pass.
- [ ] Authenticated status reports database/parity health, queue age below the
  threshold, 5xx rate below 1%, and ingestion success at or above 95%.
- [x] The default-branch scheduled production probe is registered and green.
  The probe now covers availability, readiness, anonymous authorization,
  pricing, CSP nonces, security headers, secure demo sessions, app mounting,
  and read-only demo boundaries. Evidence: GitHub Actions run 2 on 2026-07-19.
- [ ] External paging is active and reaches an accountable operator.
- [ ] Logs and alerts were watched through the agreed observation window.

Observation owner/window/evidence: `________________`

## Focused portfolio and ingestion evidence

- [x] The existing production workspace was classified without deletion into
  100 tracked companies and 12,217 searchable network-only companies. No legacy
  unclassified companies remain.
- [x] Actionable tracked-company ATS coverage is 99%: 99 of 100 tracked companies
  have a refresh-ready source and currently return usable active jobs. TD resolved
  through its official Workday board; Scotiabank remains the one honest gap because
  its public SAP careers site does not expose a supported import feed.
- [x] Bounded discovery checked every uncovered tracked company and completed
  without errors. Weak or unverifiable matches were not imported.
- [x] A focused live ATS import completed at 100% with zero provider errors. It
  fetched 20,646 postings from 99 configs, retained 9,381 in-scope rows, created
  one job, closed 14 stale jobs, and left 8,622 active jobs. Role scoring marked
  936 active jobs relevant to the configured search focus.
- [x] The UI distinguishes actionable tracked-company coverage from the historical
  all-company resolver rate. The historical 1% figure includes 12,217 network-only
  records and is not the operational refresh coverage for the focused portfolio.
- [x] Job-search focus is configured for MBA-relevant talent acquisition, people
  operations, customer success, account management, program, business operations,
  strategy, consulting, and workforce-planning roles, with remote work preferred
  and low-value role families excluded.
- [x] The 100-company target portfolio was previewed and rebalanced without
  deleting history: 12 stronger companies entered, 12 moved to searchable network
  context, and all five placeholder employers left the tracked list. The result
  contains 76 companies with relevant roles and 30 with strong-fit roles.
- [x] Fourteen retained companies with inherited personal-email or mismatched
  domains were corrected. Account and linked ATS config domains now agree for all
  14, no tracked company retains those invalid domains, and the two remaining
  companies without identities received verified official careers entry points.

## Rollback decision

Roll back the application commit for readiness failure, sustained 5xx errors,
authentication or billing regression, migration failure, parity drift, stale
queues, or unexplained data-count changes. Do not improvise reverse SQL. Preserve
the failed release logs and request IDs, redeploy the last known-good commit, and
restore data only with incident-owner approval and a verified backup.

- Last known-good commit: `________________`
- Incident owner: `________________`
- Backup/restore owner: `________________`
- Final launch approver and date: `________________`
