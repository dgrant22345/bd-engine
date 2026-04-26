# BD Engine Cloud Plan

This branch starts a separate SaaS edition in `saas/` while preserving the working local Windows app.

## Product Shape

BD Engine Cloud helps staffing and recruiting business development teams:

- import LinkedIn connections and account/contact data
- prioritize accounts by hiring signals and relationship strength
- generate tailored email and LinkedIn outreach
- log outreach activity and schedule follow-up
- track open roles, accounts, contacts, and team ownership

## Architecture Direction

The first prototype is deliberately dependency-light, but it now serves the same v0 frontend used by the local app:

- `saas/src/server.js` hosts the API and static app shell.
- `saas/src/store.js` exposes the tenant-aware data access boundary and compatibility payloads for the existing frontend.
- `saas/schema.sql` defines the intended hosted Postgres model.
- `app/` remains the shared frontend until the hosted app needs a build system.

The local Windows app remains unchanged and can keep shipping as a private/local edition.

## SaaS Conversion Milestones

1. Hosted single-tenant MVP
   - Replace in-memory seed data with Postgres.
   - Add migrations and seed scripts.
   - Keep one tenant while validating hosting, imports, and worker runtime.

2. Auth and organizations
   - Add sign-up/login.
   - Add tenants, memberships, roles, invites, and session enforcement.
   - Add tenant isolation tests before allowing multiple paying customers.

3. Background jobs
   - Move LinkedIn CSV import, ATS import, scoring, enrichment, and AI generation into a queue/worker model.
   - Store job state per tenant.
   - Add retry, cancellation, and observable progress.

4. Billing
   - Add Stripe checkout, subscription webhooks, billing portal, trials, and plan gates.
   - Gate premium actions such as large imports, enrichment, and team seats.

5. Production controls
   - Audit logging, rate limits, backups, exports, delete-account flow, monitoring, and support tools.
   - Privacy policy, terms, data processing agreement, and customer-facing security notes.

## Data Isolation Rules

- Every customer-owned row must include `tenant_id`.
- Every query must resolve tenant membership before reading or writing data.
- Tenant isolation should be tested with canary data before any multi-customer launch.
- Uploaded files must be private by default and scoped by tenant.
- Background jobs must carry tenant context explicitly.

## Outreach Boundaries

The SaaS should begin with safe workflow automation:

- draft email
- draft LinkedIn message
- open/copy for manual sending
- log sent activity
- schedule follow-up

Direct Gmail/Microsoft sending can come later through OAuth and explicit user consent.
Direct LinkedIn sending should remain deferred unless there is a compliant approved integration path.

## Rollback

The experiment started at:

```powershell
git switch packaging/linkedin-import-phase-2
```

or:

```powershell
git reset --hard saas-experiment-start-2026-04-26
```
