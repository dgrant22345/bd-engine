# Commercial Launch Checklist

This checklist is the release record for a broad paid launch. Do not mark an
item complete based only on code presence. Record the owner, completion date,
and durable evidence link or identifier. Never paste secrets or customer rows.

## Release candidate

- [x] Approved head: `aa1c7399396c2ca19f0e6f750a8985a327678ba3`
  Owner/date: `dgrant22345 / 2026-07-19`
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
- [ ] `BD_ERROR_WEBHOOK` reaches an actively monitored destination; a controlled
  synthetic failure was received with release and request IDs but no customer data.
  Evidence: `________________`
- [ ] `BD_REQUIRE_EMAIL_VERIFICATION=true` and an unverified test account was
  blocked from import, discovery, and renderer-backed work. Evidence: `________________`
- [ ] The value-safe check passes without printing values:

  ```powershell
  railway.cmd run --service bd-engine --environment production -- npm.cmd --prefix saas run check:production-config
  ```

## Data and recovery

- [x] A fresh encrypted backup completed and its SHA-256 was recorded.
  Backup reference: `pre-deploy-1dea508-2026-07-19.json.gz.enc`, SHA-256
  `2ea029a9933b336763c53b11f46761449e2042a8f1b50597b5540ef1a9663d9c`
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
- [ ] Deep legacy/relational parity passes for every relational-primary and
  canary workspace. Evidence: `________________`
- [x] The ten migrations and restore path are exercised from empty PostgreSQL 16
  databases on every CI run. Evidence: `PostgreSQL recovery drill` required job.
- [ ] Production rollback was rehearsed by redeploying the previous application
  commit and confirming compatibility. Evidence: `________________`

## Billing and customer operations

- [ ] Stripe live checkout succeeds for Job Seeker and Sales Professional.
- [ ] Signed webhook activation, duplicate delivery, failed payment, grace period,
  recovery, cancellation, portal access, and invoice access were tested.
- [ ] Plan entitlements and limits match the public pricing page.
- [ ] Account closure cancels the affected subscription and removes access/data;
  shared-workspace ownership blockers and retry recovery were tested.
- [ ] Support ownership, response target, escalation path, refund policy, and
  incident communications are documented and staffed.

Evidence for this section: `________________`

## Deploy and observe

- [ ] Maintenance risk and rollback owner were announced before deployment.
- [x] The exact approved commit was deployed; Railway reports both services and
  PostgreSQL online. Merge `b5fd0eb1d6c79535081c477627a4893afd6a2434`,
  deployment `4c42b674-6674-4666-9e62-6020a60af19f`.
- [ ] `/livez`, `/readyz`, `/health`, public entry, login, verified signup, one
  ATS discovery, one job refresh, support, billing, export, and logout passed.
- [ ] Authenticated status reports database/parity health, queue age below the
  threshold, 5xx rate below 1%, and ingestion success at or above 95%.
- [ ] The scheduled production probe is green and external paging is active.
- [ ] Logs and alerts were watched through the agreed observation window.

Observation owner/window/evidence: `________________`

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
