# 0.1.2.2 maintenance release — deployed

- Production: https://bd-engine-production.up.railway.app
- Source: `1f67e42cea25e50090d56fe62e411d8aed21c4ce`, pushed to `agent/paid-product-quality-audit`.
- Railway deployment: `b5a06a4f-ba42-4862-97aa-c002d437a3fb`, created 2026-09-08 09:52:53 UTC; SUCCESS. Docker build and `/readyz` health check passed.
- Browser assets/cache version: `20260908-focus-01`.
- Scope: event/title and ambiguous-city matching corrections, saved-focus transparency, context-preserving cutoff removal, empty-focus recovery, and duplicate/failed-save protection. No rebrand, schema change, renderer deployment or Windows publication.

## Verification

- 378 unit tests; 81/81 full Chromium browser cases; nine focused workflow cases across Chromium/Firefox/WebKit; 12/12 deterministic ATS contracts; four renderer tests; lint and syntax checks passed.
- Production dependency audit: zero vulnerabilities.
- 20/20 SELECT-only PostgreSQL synthetic query fixtures passed, including city ambiguity, list/count agreement and pagination.
- Deep relational parity passed for all three legacy workspaces before and after deployment.
- Six changed runtime files in the live container matched LF-normalized local SHA-256 values: app JS, styles, index, service worker, store and geography module.
- Eight live non-mutating smoke checks passed; mutation tests stayed disabled. Immediate deployment error-level log review returned no entries.
- Existing authenticated owner session loaded the new saved-focus explanation and target-role filter successfully. No saved preferences or customer records were changed.

## Pending score recalculation and backup authorization

The automatic safety review rejected copying the complete production database to a local encrypted backup without explicit approval of the payload and destination. The backup command did not execute. No workaround was attempted and no bulk rescore was performed.

Proposed destination, only after approval: `saas/backups/pre-focus-0.1.2.2-2026-09-08.json.gz.enc` (Git-ignored) using the existing encryption key. This backup would contain sensitive production customer records. After creating and verifying it, use the owner's normal saved-focus workflow to recalculate existing scores without changing the saved titles/threshold. Verify persistence and parity afterward.

Geography query filtering is live immediately. Recruitment-event relevance corrections apply on import or rescore; existing stored relevance scores are not retroactively updated merely by deployment.

## Rollback

Restore deployment `345f3ad0-0ee4-4cbb-ba63-ea5c283d73ab` (0.1.2.1; source `645e1b7decfc6819a04ebafd1317180b825740cf`). No data rollback is required for this code-only deployment.

## Separate follow-ups

- Commercial email configuration remains NOT READY: missing `RESEND_API_KEY`, verified `BD_EMAIL_FROM`, and enabled `BD_REQUIRE_EMAIL_VERIFICATION`. This is maintenance, not paid-launch certification.
- The historical saved-role-list discrepancy remains unexplained.
- Live all-location inventory includes a Randstad category page titled “employment & recruitment agency” as a job; static-board vacancy validation needs a separate focused correction.
- Reloading the job workspace reset transient filters; target filter could be reapplied. Persisting job-list context on reload remains a useful follow-up.
- Local browser-suite background discovery logged long external discovery waits in `saas/src/store.js`, `runAtsDiscovery` (up to approximately 90 seconds). Not investigated or represented as a production timing measurement in this release.
