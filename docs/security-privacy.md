# Security And Privacy

## Customer Data

LinkedIn exports, contacts, notes, outreach history, jobs, and backups are private customer data. Do not log full records, CSV bodies, generated messages, password material, reset tokens, license keys, or provider secrets.

Operational data is bounded by an hourly cleanup: expired sessions and tokens
are removed, completed background jobs are retained for 14 days, detailed
import history for 180 days, analytics for 395 days, audit records for 730 days,
and completed or failed Stripe webhook receipts for 90 days. Support-message
and core workspace retention still require a reviewed customer/legal policy;
do not shorten or extend those periods casually.

Production HTTP logs never include query strings. Error summaries redact common
emails, credentials, tokens, URL parameters, and internal record identifiers.
Database, authentication, scheduler, and ingestion failures use the same
sanitizer, and external alerts contain no workspace identifier or raw exception
text. Request IDs are the supported way to correlate a customer report,
application log, and alert.

Hosted workspaces store data in PostgreSQL. Data leaves the browser for the BD Engine service and for external services required by enabled features, including public careers providers, Stripe, configured email delivery, and operational monitoring. Windows-local workspaces store application data under `%LOCALAPPDATA%\BD Engine`, while job discovery still makes outbound provider requests.

Customer-facing reset, verification, support, referral, checkout, and billing
portal URLs use one validated canonical public origin. Forwarded or direct Host
headers are never trusted to construct those links.

## Controls

- Production requires a connected database and secure deployment secrets.
- Authentication cookies are server controlled; tenant access is checked for each request.
- SQL uses parameterized queries.
- UI rendering escapes untrusted text and URLs are validated before use.
- CSV parsing uses a structured parser and limits import size and resource creation.
- Successful authenticated mutations create privacy-safe audit records.
- Cross-workspace support access requires a recent login or rate-limited current-password step-up. The elevation is session-scoped, persisted, and expires after 15 minutes by default.
- Customer exports, password-and-phrase-confirmed workspace-data deletion, and self-service account closure are available from the authenticated account surface. Closure verifies the password and exact confirmation, prevents orphaned shared workspaces, cancels affected subscriptions, deletes sessions and customer records transactionally, and retains only a pseudonymous operational closure ledger.
- Backups include sensitive data and must be encrypted, access controlled, and retention limited.

## Release Security Checks

```powershell
npm.cmd --prefix saas audit --omit=dev
rg -n "BEGIN.*PRIVATE KEY|sk_live_|postgres(ql)?://[^ ]+:[^ ]+@" . -g '!node_modules/**' -g '!dist/**'
```

Also verify production CORS and cookie settings, Stripe webhook secrets, support/admin email allowlists, public health output, dependency audit results, and restore access. Legal review of Privacy and Terms text remains required before a broad public launch.
