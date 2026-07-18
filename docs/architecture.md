# Architecture

## Shared Product UI

`app/` is a static HTML, CSS, and JavaScript application used by both runtimes. It talks only to same-origin `/api/*` routes. The hosted shell in `saas/public/` provides authentication, billing, support, and the application iframe.

## Hosted Runtime

`saas/src/server.js` is the HTTP entry point. Authentication, billing, email, support, audit logging, and persistence are split into focused modules. `store.js` owns the tenant-scoped product contract and background workflows.

Production data is stored in PostgreSQL. New relational tables are the preferred model; a tenant-level storage mode and parity tools support controlled migration from legacy tenant blobs. Production never falls back to in-memory storage.

Long imports and scans are background jobs with durable status. Provider failures are isolated per board so one company cannot abort a batch.

## Windows-Local Runtime

`server/Server.ps1` hosts the same UI on `127.0.0.1`. PowerShell modules provide domain logic, imports, job discovery, and SQLite persistence. The launcher enforces a single healthy runtime, redirects output to `%LOCALAPPDATA%\BD Engine\Logs`, and waits for readiness before opening the browser.

## Persistence And Migrations

- PostgreSQL migrations are additive, idempotent functions in `saas/src/db.js` and are recorded in `schema_migrations`.
- Relational writes use stable natural identities and tenant-scoped indexes. Legacy snapshots remain available for rollback during migration.
- SQLite migrations are additive and advance the local `schema_version` only after successful application.
- Back up production before schema or bulk-data changes. Never edit a previously shipped migration in place.

## Trust Boundaries

Browser input, CSV content, provider payloads, and support text are untrusted. Rendering helpers escape user-controlled values; database calls use parameterized queries; uploads and request bodies are bounded; authenticated mutations are tenant scoped and audited without storing full sensitive payloads.
