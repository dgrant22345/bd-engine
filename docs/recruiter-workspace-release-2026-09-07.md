# Recruiter workspace 0.1.2.0 — deployed 7 September 2026

## Released checkpoint

- URL: https://bd-engine-production.up.railway.app
- Release commit: `a06dfd5189c2ca16f57a6d9db82845660a7b90fe` on `agent/paid-product-quality-audit`.
- Railway project/service: `robust-vision` / `bd-engine`, production.
- Deployment: `7ddd4a83-29b8-4953-af3a-7c3b4f9a9c5f`, created 15:41:08 UTC. Status **SUCCESS**, `/readyz` health check passed.
- Uploaded the committed workspace with the explicit project/service/environment target. LF-normalized SHA-256 verification matched **12/12 deployed files**, including the People module, workspace CSS, hosted shell, server/store/query code and PostgreSQL verifier.
- The initial deployment `0df758c5-33a1-417b-b0d1-3e153dbb9584` failed during upload/snapshot creation with no associated build. Its failure was confirmed before retrying; it never replaced the prior healthy application.
- Rollback: redeploy `26569ebb-71a4-4d07-8b72-aded0217c0bd`, release 0.1.1.1 / commit `9d735bb49b21dc3cebfab20d1401fb809a155b68`. No new schema migration or production variable change was required for 0.1.2.0.

## What shipped

People-first hosted recruiter navigation; master-detail person review; manual add, corrected contact facts, multiline notes, actual-record comparison, manual outreach preparation, deep links and preserved list context. Shared neutral/teal light/dark styling, compact controls and progressive disclosure reduce visual competition. Generation guards prevent slow supporting-view responses from overwriting newer navigation.

See the [audit and final review](recruiter-ux-audit-2026-09-06.md) and [design system](recruiter-design-system.md). Full candidate evidence/evaluation, persistent recruiting lists and the Windows-local People redesign remain outside this release. Existing ingestion logic and job-seeker functionality were preserved.

## Verification

### Before deployment

- 369 unit tests passed; syntax and ESLint checks passed. The prior final UX run passed 72 Chromium journeys and 21 People/compatibility checks across Chromium, Firefox and WebKit.
- Production dependency audit: zero vulnerabilities at the release check.
- Schema contract: 26 tables, 61 indexes, 12 existing migrations. Twelve deterministic ATS provider contracts passed.
- No staging environment was configured. Instead, `verify-contact-query-quality.mjs` ran **30 SELECT-only CTE fixtures** on the existing PostgreSQL engine with migrations disabled and a read-only connection. Checks cover global sort/page ordering, status/score filters, ID/tenant isolation, literal wildcard escaping, Unicode search and empty results. These fixtures do not insert or update customer rows.
- Actual owner queries returned **20,509 contacts and full 20-row pages** for four sorting modes; individual count/page observations were 31, 34, 4 and 33 ms. These are not a scale benchmark or a guarantee of future response time.
- Deep legacy/relational parity passed for all three legacy workspaces.

### Backup

An encrypted operator backup completed at approximately 11:01 UTC, before the initial upload attempt. The successful retry was at 15:41 UTC after the interrupted session resumed.

- File: `C:\Users\ddere\BD-Engine-Backups\bd-engine-backup-2026-09-07T11-01-36-984Z.json.gz.enc` (outside the uploaded repository).
- Size: 29.73 MB. AES-256-GCM authenticated decryption and integrity verification passed; elapsed 26.7 seconds.
- SHA-256: `2ebd0aa0be88f0566a54173c6754ca53a5e0de5c84b71f88da0b79749e8a6862`.
- Backup used the app service's encryption key and the database public connection in a local child process; credential values were not printed, written to the repository or changed. This verifies the archive, not a full restore drill.

### After deployment

- Eight read-only HTTP smoke checks passed: availability/readiness, security headers/CSP, anonymous access denial, public plans, shared app mount and synthetic read-only demo. Production mutation smoke checks remained disabled.
- The deployed contact verifier passed **30/30** fixtures again. Four live owner count/page reads still returned 20,509 / 20. The first name-sort observation was 1,038 ms; the other three were 47, 6 and 47 ms. These are isolated observations, not evidence of a proven speedup or a diagnosed regression.
- Deep legacy parity passed for three workspaces again. The immediate deployment error-level log query returned zero records; this is a point-in-time check, not ongoing monitoring.
- Actual production Chromium rendering: opened People and a person panel, changed sorting, prepared a placeholder draft without sending, reloaded the outer page and retained person context. Tested desktop 1440×1000 and phone 390×844. No uncaught page errors, no mobile horizontal overflow, and no axe WCAG A/AA violations in the tested desktop/mobile states.
- Live screenshots are ignored local artifacts: `artifacts/recruiter-ux-audit/after/deployed-person-desktop.png` and `deployed-person-mobile.png`.
- No customer record was edited for a production save/reload demonstration. Save/error/tenant behavior was tested locally; read-only production checks do not claim to verify a real customer write/restart workflow.

## Remaining commercial launch gates

The existing configuration checker still reports missing `RESEND_API_KEY`, missing verified `BD_EMAIL_FROM`, and disabled `BD_REQUIRE_EMAIL_VERIFICATION`. No credentials or enforcement flags were changed, and the existing paid-checkout readiness controls remain in place. This is a limited interface/workflow release, **not approval for a broader paid launch**.

Candidate evidence workflows, recruiter usability sessions, full backup restore proof, installed Windows validation and the remaining secondary-screen cleanup are still needed. The deployment does not establish willingness to pay or complete coverage of every hiring source.
