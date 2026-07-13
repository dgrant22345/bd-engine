# BD Engine Cloud

Hosted multi-tenant SaaS application for BD Engine.

This folder is intentionally separate from the local Windows app. The goal is to create a clean cloud path while preserving the working installer/local edition.

## Run Locally

```powershell
cd saas
npm run check
npm start
```

Open <http://localhost:8787>.

## Test Account

Use the signup flow on the landing page to create a trial workspace.

## Product Capabilities

### Phase 1 (Complete)
- The same static v0 frontend used by the local Windows app, mounted under `/app/`
- Tenant-aware API compatibility layer for the existing frontend routes
- Seeded demo tenant with accounts, contacts, jobs, activity, and follow-ups
- Outreach draft and log endpoints
- Production data model draft in `schema.sql`
- Dockerfile for containerised deployment

### Phase 2 (Complete)
- **Authentication** — Cookie-based sessions with signed HMAC cookies
- **Signup / Login / Logout** — Full auth flow with form validation
- **Landing page** — Premium dark SaaS landing page with hero, features, pricing sections
- **Login / Signup pages** — Polished auth pages with trial workspace creation
- **Cloud app shell** — Top-bar with branding, plan badge, trial countdown, user menu
- **Multi-tenant users** — User & tenant management with workspace creation
- **Tenant-safe first run** — New signups get an empty workspace profile and first-run setup
- **Plan tiers** — Trial, Job Seeker ($5/mo), and Sales Professional ($10/mo)
- **Billing** — Stripe Checkout, billing portal, webhook plan activation, usage metering, plan limits, and trial expiry tracking
- **Shared app mount** — The local app runs inside the cloud shell from `/app/`, with service-worker registration disabled for the hosted wrapper

## Architecture

```
saas/
├── public/             # Cloud-specific frontend (landing, auth, cloud shell)
│   ├── index.html      # SPA: landing → login → signup → app shell
│   └── cloud.css       # Premium dark SaaS design system
├── src/
│   ├── server.js       # HTTP server with auth middleware & tenant routing
│   ├── store.js        # Tenant store adapter with guarded relational reads
│   ├── auth.js         # Durable sessions, signed cookies, salted password hashing
│   ├── users.js        # User & tenant CRUD, memberships
│   └── billing.js      # Plan tiers, feature gating, usage metering
├── scripts/
│   └── smoke.mjs       # Local SaaS smoke test
├── schema.sql          # PostgreSQL production schema
├── package.json
├── Dockerfile
└── .env.example
```

## Production Dependencies

- New workspaces can use relational-primary storage with guarded legacy
  snapshots for rollback. Existing legacy workspaces remain supported and can
  be migrated individually after parity checks.
- Transactional password-reset and advisory email-verification delivery require
  `RESEND_API_KEY` and `BD_EMAIL_FROM`. When they are absent, the app does not
  issue unusable verification tokens or hide account-recovery limitations.
- External uptime monitoring and alert routing must be configured outside the
  app even though `/health` and error-reporting hooks are available.
- LinkedIn and live ATS imports persist resumable queue descriptors and recover
  after deploys. Other interrupted administrative jobs fail visibly; scheduled
  ATS refreshes retry after a bounded backoff instead of overlapping.

## Validation

With the SaaS server running:

```powershell
npm run check
npm run smoke
```

Smoke tests against a non-local URL are read-only by default. Set
`BD_CLOUD_SMOKE_ALLOW_MUTATIONS=true` only for a disposable environment where
test signups and workspace changes are expected.

## Backups and Recovery

Create a compressed Postgres backup from the `saas` folder:

```powershell
npm run backup
```

Verify a backup without touching the database:

```powershell
npm run restore -- --file .\backups\<backup-file>.json.gz --dry-run
```

The full runbook lives in `docs/disaster-recovery.md`.

## Relational Migration

The app supports both legacy tenant-document storage and relational-primary
storage. Mirror writes and parity checks provide a guarded migration path for
existing workspaces; newly created workspaces can default to relational-primary
storage with `BD_RELATIONAL_WRITE_NEW_TENANTS=true`.

Backfill existing workspaces after deploying the mirror tables:

```powershell
npm run backfill:relational -- --dry-run
npm run backfill:relational
```

Set `BD_RELATIONAL_MIRROR=false` to temporarily disable mirror writes. Guarded
read and query canaries are controlled independently with:

- `BD_RELATIONAL_READ_TENANTS`
- `BD_RELATIONAL_SQL_TENANTS`
- `BD_RELATIONAL_SQL_CONTACT_TENANTS`
- `BD_RELATIONAL_SQL_JOB_TENANTS`
- `BD_RELATIONAL_SQL_CONFIG_TENANTS`
- `BD_RELATIONAL_USAGE_TENANTS`
- `BD_RELATIONAL_DEEP_CHECK_TENANTS`
- `BD_RELATIONAL_WRITE_TENANTS` (explicit tenant IDs only; `*` is not accepted)
- `BD_RELATIONAL_WRITE_NEW_TENANTS` (`true` makes newly created workspaces relational-primary)

The read, query, usage, and deep-check flags accept a comma-separated tenant ID
list or `*`. The write flag requires explicit tenant IDs. Read canaries
automatically fall back to the legacy source if parity or a relational query
fails; write-primary workspaces fail and retry instead of risking split data.
The new-workspace default is persisted on each tenant as `storage_mode`, so the
chosen source of truth survives deploys and process restarts.

Resident workspace memory is bounded with `BD_RESIDENT_TENANT_LIMIT` (default
8) and `BD_RESIDENT_TENANT_IDLE_MS` (default 5 minutes). Unsaved workspaces are
never evicted, and eviction pauses while a background operation is active.

## Rollback

Production backup, restore, relational rollback, cleanup, and release procedures
are documented in [OPERATIONS.md](./OPERATIONS.md).

This experiment started from tag:

```powershell
git switch packaging/linkedin-import-phase-2
```

or, if explicitly resetting this branch:

```powershell
git reset --hard saas-experiment-start-2026-04-26
```
