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

## Demo Account

```
Email:    demo@bdengine.io
Password: demo1234
```

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
- **Login / Signup pages** — Polished auth pages with demo account quick-login
- **Cloud app shell** — Top-bar with branding, plan badge, trial countdown, user menu
- **Multi-tenant users** — User & tenant management with workspace creation
- **Tenant-safe first run** — New signups get an empty workspace profile and first-run setup
- **Plan tiers** — Trial, Starter ($49/mo), Pro ($149/mo), Enterprise with feature gating
- **Billing stubs** — Usage metering, plan limits, trial expiry tracking
- **Shared app mount** — The local app runs inside the cloud shell from `/app/`, with service-worker registration disabled for the hosted wrapper

## Architecture

```
saas/
├── public/             # Cloud-specific frontend (landing, auth, cloud shell)
│   ├── index.html      # SPA: landing → login → signup → app shell
│   └── cloud.css       # Premium dark SaaS design system
├── src/
│   ├── server.js       # HTTP server with auth middleware & tenant routing
│   ├── store.js        # In-memory data store (tenant-aware)
│   ├── auth.js         # Session management, cookies, password hashing
│   ├── users.js        # User & tenant CRUD, memberships
│   └── billing.js      # Plan tiers, feature gating, usage metering
├── scripts/
│   └── smoke.mjs       # Local SaaS smoke test
├── schema.sql          # PostgreSQL production schema
├── package.json
├── Dockerfile
└── .env.example
```

## What Is Not Production-Ready Yet

- Data is in-memory (needs PostgreSQL adapter)
- Password hashing uses HMAC (needs bcrypt/argon2)
- Sessions are in-memory (needs Redis)
- Stripe billing is not connected
- Email verification is not implemented
- No production audit logging or rate limiting
- No CI/CD pipeline
- LinkedIn CSV cloud import needs file upload endpoint

## Validation

With the SaaS server running:

```powershell
npm run check
npm run smoke
```

## Rollback

This experiment started from tag:

```powershell
git switch packaging/linkedin-import-phase-2
```

or, if explicitly resetting this branch:

```powershell
git reset --hard saas-experiment-start-2026-04-26
```
