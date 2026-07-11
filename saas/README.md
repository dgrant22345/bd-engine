# BD Engine Cloud

Hosted SaaS prototype for BD Engine.

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

## What This Prototype Includes

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

## Remaining Production Work

- The relational migration is still staged: the legacy tenant document remains
  the write source of truth while relational tables are parity-checked canaries.
- Transactional password-reset email requires `RESEND_API_KEY` and
  `BD_EMAIL_FROM`; email verification is not yet enforced.
- External uptime monitoring and alert routing must be configured outside the
  app even though `/health` and error-reporting hooks are available.
- Background operations are process-local. Finished entries are bounded, but
  durable job resumption across deploys is still future work.

## Validation

With the SaaS server running:

```powershell
npm run check
npm run smoke
```

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

The app still uses the existing tenant JSONB row as the production source of
truth, but writes now also mirror loaded workspace records into relational
tables for the larger data-model migration.

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

Each accepts a comma-separated tenant ID list or `*`. A canary automatically
falls back to the legacy source if count parity or the relational query fails.

Resident workspace memory is bounded with `BD_RESIDENT_TENANT_LIMIT` (default
8) and `BD_RESIDENT_TENANT_IDLE_MS` (default 5 minutes). Unsaved workspaces are
never evicted, and eviction pauses while a background operation is active.

## Rollback

This experiment started from tag:

```powershell
git switch packaging/linkedin-import-phase-2
```

or, if explicitly resetting this branch:

```powershell
git reset --hard saas-experiment-start-2026-04-26
```
