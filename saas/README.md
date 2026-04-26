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

## What This Prototype Includes

- Hosted web shell for BD Engine Cloud
- Tenant-aware API shape
- Seeded demo tenant with accounts, contacts, jobs, activity, and follow-ups
- Outreach draft and log endpoints
- Production data model draft in `schema.sql`
- Auth, billing, and integration placeholders that make the remaining SaaS work explicit

## What Is Not Production-Ready Yet

- Authentication is a development stub
- Data is in-memory unless the Postgres adapter is implemented
- Stripe billing is not connected
- Email/LinkedIn sending is not automated
- No production audit logging, rate limiting, or tenant isolation tests yet

## Rollback

This experiment started from tag:

```powershell
git switch packaging/linkedin-import-phase-2
```

or, if explicitly resetting this branch:

```powershell
git reset --hard saas-experiment-start-2026-04-26
```

