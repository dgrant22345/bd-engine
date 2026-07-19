# BD Engine Operations Runbook

## Release gate

Use `docs/commercial-launch-checklist.md` as the signed evidence record for a
broad paid launch. This runbook explains the commands; the checklist records who
verified each external dependency, customer flow, recovery control, and legal
review.

Run these before pushing a production change:

```powershell
npm.cmd --prefix saas run check
npm.cmd --prefix saas run lint
npm.cmd --prefix saas run check:schema
npm.cmd --prefix saas test
npm.cmd --prefix saas run test:browser
npm.cmd --prefix saas audit --omit=dev --audit-level=high
npm.cmd --prefix saas run check:production-config
npm.cmd --prefix saas run verify:db-contracts
$env:BD_CLOUD_SMOKE_URL='http://127.0.0.1:8787'
npm.cmd --prefix saas run smoke
```

Production smoke checks are read-only unless
`BD_CLOUD_SMOKE_ALLOW_MUTATIONS=true` is explicitly set. Never enable mutation
smoke checks against customer production data.

After deployment, verify `/health`, relational parity, recent application
errors, and HTTP 5xx logs. A healthy release has a connected database, zero
mirror or deep-content mismatches for legacy-primary workspaces, and the
expected relational-primary count. Relational-primary workspaces may diverge
from legacy rollback blobs during normal operation; refresh and verify those
snapshots before relying on a legacy rollback.

The public `/health` response is intentionally availability-only. An
authenticated `/api/status` response includes the 5xx rate, background queue
age, failed jobs, 24-hour ingestion success rate, and their SLO targets. Alert
when the 5xx rate remains above 1%, the oldest active job exceeds
`BD_BACKGROUND_JOB_STALE_MS` (15 minutes by default), or ingestion success is
below 95% after at least one completed or failed run. Treat a missing active-job
timestamp as unhealthy. Keep the external dashboard and paging destination
outside the application so an application outage cannot hide its own alert.

Production request logs are one-line JSON with release, request ID, method,
path, status, and elapsed time. Query strings are intentionally omitted. Error
summaries redact emails, credential-like assignments, long token-like values,
and URL queries. Webhook alerts omit workspace IDs and exception text entirely;
use their request ID to correlate with the sanitized application log.

`.github/workflows/production-probe.yml` runs the read-only smoke suite against
production every 15 minutes. Set the `BD_PRODUCTION_URL` repository variable
when moving to a custom domain. GitHub workflow failure notifications are a
secondary signal, not a paging service; route `/health`, `/readyz`, and the
application error webhook to an accountable on-call destination before launch.

## Billing verification

Before each paid release, run the read-only Stripe catalog check with Railway's
production variables. It retrieves prices, products, and webhook endpoint
configuration but does not create or modify customers, charges, subscriptions,
refunds, invoices, or endpoints:

```powershell
railway.cmd run --service bd-engine --environment production -- npm.cmd --prefix saas run check:billing-catalog
```

The check requires active live-mode monthly prices matching the application
amounts and `BD_BILLING_CURRENCY` (`usd` by default), active products, one
enabled canonical webhook, and coverage for checkout, subscription lifecycle,
failed-payment, and successful-payment events. A failure is a paid-launch
blocker. Update Stripe endpoint subscriptions only through an approved billing
change, then deliver signed test events before relying on recovery behavior.

## Schema migrations

`src/db.js` is the executable PostgreSQL migration source. Never apply
`schema.sql`; it is a historical reference only. `schema-manifest.json` is the
reviewable generated contract and CI fails when it drifts from the migration
source. After an intentional database-source change, inspect the migration,
then regenerate and verify the contract:

```powershell
npm.cmd --prefix saas run schema:manifest
npm.cmd --prefix saas run check:schema
```

Migration IDs are immutable once deployed. Add a new dated migration, take a
verified backup first, and roll application code back by commit if deployment
fails. Do not improvise down migrations against customer data.

Operational reports, dry runs, parity checks, and canary reads use
PostgreSQL-enforced read-only sessions and never apply migrations. Controlled
repair/apply commands also connect with migrations disabled. Run and review
migrations through an approved application deployment, not as a side effect of
diagnostics.

## Account closure recovery

Self-service account closure verifies the current password, requires an exact
confirmation phrase, refuses to orphan a shared workspace, cancels subscriptions
for workspaces being deleted, and removes the user's sessions and customer data
in one database transaction. `account_closures` retains only a hashed subject,
aggregate counts, an allowlisted reason category, status, and a safe error for
operational recovery.

If a closure is marked `failed`, do not manually delete rows. Confirm whether
Stripe cancellation completed, inspect the closure status by ID without
exposing the subject, and ask the customer to retry after the dependency is
healthy. The database deletion is transactional and the Stripe cancellation is
idempotent, so a retry is the supported recovery path.

## Product analytics

Activation and revenue milestones are server-recorded and idempotent. Event
names and dimensions are allowlisted; arbitrary public analytics requests are
limited to page views and rate limited. Account closure deletes events linked to
the closing user and deleted workspaces. Use aggregate funnel counts for product
decisions and do not export raw identifiers to third-party analytics without a
documented privacy review.

For an aggregate-only ATS diagnosis that does not print customer records:

```powershell
npm.cmd --prefix saas run report:job-coverage -- --tenant <tenant-id>
```

Legacy board records can be linked to an unambiguous normalized-name match with
a guarded repair. It is dry-run by default. Before applying, create and verify
a current backup; the exact backup reference is recorded in the audit log.

```powershell
npm.cmd --prefix saas run repair:board-links -- --tenant <tenant-id>
npm.cmd --prefix saas run repair:board-links -- --tenant <tenant-id> --apply --confirm LINK_BOARD_CONFIGS --backup-reference <backup-id-or-sha>
npm.cmd --prefix saas run check:integrity -- --tenant <tenant-id>
```

## Backup and restore

Create an encrypted, authenticated, checksummed application backup before
migrations or bulk data changes. `BD_BACKUP_ENCRYPTION_KEY` must decode to 32
random bytes and should be stored separately from the backup. Production and
`--require-encryption` runs fail closed when the key is absent or malformed.

```powershell
npm.cmd --prefix saas run backup -- --output backups/<change-name>.json.gz.enc --require-encryption
```

For a local operator backup using Railway's public database endpoint, run the
same command through the Postgres service and add `--public-url`. The connection
value stays in the process environment and is never placed in shell history.

All tables are read from one repeatable-read transaction so concurrent customer
writes cannot produce a mixed-time snapshot. The command decrypts and verifies
the archive after writing it, then prints its SHA-256 hash without printing the
key. Keep at least one copy outside the
application workspace and keep the key in a separate secret manager. Railway
database snapshots or another encrypted offsite destination should run daily;
this is an infrastructure setting and is not replaced by repository code.

Test a restore into a disposable database before relying on a backup:

```powershell
npm.cmd --prefix saas run restore -- --file <backup.json.gz.enc> --dry-run
$env:BD_RESTORE_CONFIRM='RESTORE'
npm.cmd --prefix saas run restore -- --file <backup.json.gz.enc> --apply --url <disposable-postgres-url>
Remove-Item Env:BD_RESTORE_CONFIRM
```

CI also runs a complete synthetic recovery rehearsal against PostgreSQL 16. It
migrates a fresh source and destination, creates an encrypted backup, performs
the guarded restore, compares every durable table, confirms volatile security
state was excluded, and verifies repaired serial sequences:

```powershell
$env:RECOVERY_SOURCE_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/bd_engine_recovery_source'
$env:DB_SSL='false'
npm.cmd --prefix saas run test:recovery
```

The source must be a fresh empty database and the database user must be allowed
to create and remove the disposable destination. The command rejects remote
hosts unless an operator explicitly sets `BD_RECOVERY_DRILL_ALLOW_REMOTE=true`.
This synthetic proof complements, but does not replace, a periodic restore of a
real production archive into approved disposable infrastructure.

Both `--apply` and the exact confirmation variable are required. Never place the
encryption key or database URL directly in shell history, and never point an
apply restore at production unless recovery has been approved and a current
production backup exists. Restore refuses a target containing customer or
workspace rows. `--allow-nonempty` bypasses that protection and is reserved for
an explicitly approved recovery plan; routine drills must use a fresh database.

## Relational storage

- `BD_RELATIONAL_WRITE_TENANTS` holds explicit relational-primary canaries.
- `BD_RELATIONAL_WRITE_NEW_TENANTS=true` makes newly created workspaces
  relational-primary and persists that choice in `tenants.storage_mode`.
- Existing legacy workspaces are not migrated by the new-workspace flag.

Audit candidate natural-key constraints without printing customer values:

```powershell
npm.cmd --prefix saas run report:duplicates
npm.cmd --prefix saas run report:duplicates -- --fail-on-duplicates
```

Do not add a unique index until this reports zero duplicate groups, deep parity
passes, and an owner-approved deduplication has been backed up and rehearsed.
Email alone is intentionally not a uniqueness key because shared team addresses
can be valid; tenant-scoped identity, LinkedIn, job, and provider-board keys are
the constraint candidates.

The contact identity, contact LinkedIn URL, and job natural-key constraints are
included in migration `20260718_relational_identity_constraints` after the
2026-07-18 production audit reported zero duplicates for all three. Re-run the
auditor immediately before deployment; the migration fails closed if data has
drifted. Account and board constraints remain blocked because the same audit
found 120 duplicate groups and 638 excess rows across those keys.

Verify legacy mirrors:

```powershell
npm.cmd --prefix saas run check:relational -- --deep
```

Create or refresh a legacy rollback snapshot from relational data:

```powershell
npm.cmd --prefix saas run snapshot:legacy -- --tenant <tenant-id> --dry-run
npm.cmd --prefix saas run snapshot:legacy -- --tenant <tenant-id>
```

Before reverting a relational-primary workspace to legacy reads, create the
snapshot and verify exact content parity. Then change its storage mode or
remove its explicit canary flag and redeploy.

## Test-data cleanup

The cleanup command only targets old accounts on reserved `example.com` and
`bd-engine.invalid` smoke patterns. It refuses billed workspaces, defaults to a
dry run, and requires an exact confirmation phrase to apply:

```powershell
npm.cmd --prefix saas run cleanup:test-data -- --before 2026-01-01
npm.cmd --prefix saas run cleanup:test-data -- --before 2026-01-01 --apply --confirm DELETE_TEST_DATA
```

Review the complete dry-run manifest and create a verified backup first.

## External production services

The app reports these in the authenticated status screen:

- `BD_CLOUD_BASE_URL` is the canonical customer-facing origin for reset,
  verification, support, referral, checkout, and billing portal links. Railway's
  injected public domain is the fallback; request Host headers are never used.
- `BD_INTERNAL_OWNER_EMAILS` grants internal owner entitlements; keep this in
  deployment configuration and never hardcode privileged identities.
- `BD_ANALYTICS_ADMIN_EMAILS` controls access to site analytics.
- `BD_SUPPORT_ADMIN_EMAILS` controls access to customer support conversations;
  internal owners also retain access. Keep this list narrower than general
  workspace administration and review it when support staff change.
- `RESEND_API_KEY` and `BD_EMAIL_FROM` enable password reset, email verification,
  and support notifications. New customer messages go to support admins;
  customer-facing replies go to the requester. Internal notes are never emailed.
  Confirm these flows against real inboxes after changing either setting.
- `BD_REQUIRE_EMAIL_VERIFICATION=true` blocks unverified users from CSV/job
  imports, ATS discovery, and external resolution work. Enable it only after
  verification delivery has been tested; the commercial configuration check
  requires it.
- Authentication, demo, verification, client-error, and support abuse limits are
  coordinated through hashed PostgreSQL buckets. Raw IP addresses and emails are
  not stored in the limiter table; expired buckets are removed by operational
  cleanup.
- `BD_ERROR_WEBHOOK` enables immediate server-error alerts.
- `BD_BACKGROUND_JOB_STALE_MS` controls the queue-age alert threshold and
  defaults to 900000 milliseconds.
- Operational cleanup runs hourly. Defaults retain completed background jobs
  for 14 days, detailed import history for 180 days, privacy-safe analytics for
  395 days, audit records for 730 days, and completed/failed Stripe webhook
  receipts for 90 days. Configure `BD_BACKGROUND_JOB_RETENTION_DAYS`,
  `BD_IMPORT_HISTORY_RETENTION_DAYS`, `BD_ANALYTICS_RETENTION_DAYS`,
  `BD_AUDIT_RETENTION_DAYS`, and `BD_STRIPE_WEBHOOK_RETENTION_DAYS` only after
  the documented customer/legal retention policy changes.
- `BD_PRIVILEGED_SESSION_MAX_AGE_MS` controls how long a login or password
  confirmation unlocks cross-workspace support access and defaults to 900000
  milliseconds. Keep it short; increasing it expands stolen-session exposure.
- An external uptime monitor should poll `/health` and alert on non-200 results.
- Privacy and Terms copy requires legal review before broad commercial launch.

Do not mark these ready based only on code presence; verify the live provider
configuration and an end-to-end test.

### Optional careers-page renderer

- `BD_ATS_RENDER_SERVICE_URL` enables the last-resort public careers-page render adapter.
- `BD_ATS_RENDER_SERVICE_TOKEN` is sent as a bearer token when configured.
- `BD_ATS_RENDER_TIMEOUT_MS` bounds each render request and defaults to 20 seconds.
- Keep renderer concurrency and egress restricted. The application sends only a public careers URL and never customer records.
- Run `npm run benchmark:ats:live` after provider or renderer changes. The deterministic `npm run benchmark:ats` remains the CI-safe adapter contract check.
