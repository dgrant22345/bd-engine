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

## Completed score recalculation and encrypted backup

The automatic safety review rejected copying the complete production database to a local encrypted backup without explicit approval of the payload and destination. The backup command did not execute. No workaround was attempted and no bulk rescore was performed.

The user subsequently explicitly approved that payload and destination. The approved backup was completed and verified on 2026-09-08 at `saas/backups/pre-focus-0.1.2.2-2026-09-08.json.gz.enc` (Git-ignored), using the existing AES-256-GCM encryption key. Size: 31,404,850 bytes (29.95 MiB); creation/verification: 22.2 seconds. SHA-256: `46d357273e9aa97d3264498eef4a093856b0e9cb433979e91350b05bf2e1ed92`. No plaintext backup or encryption key was committed.

The owner's unchanged focus was submitted once through the existing authenticated saved-focus form. Final aggregate-only PostgreSQL verification: 29,199/29,199 stored jobs rescored; 11,150 active jobs preserved; 10 Canadian matches at the existing 45 cutoff (12 before the geography and event corrections); four active event listings excluded across all locations. Deep relational parity passed for all three legacy workspaces. No titles, thresholds, source boards or pipeline stages were edited.

A detailed diagnostic export was separately rejected by automatic review; the check was narrowed to aggregate counts, with no individual job records or preference text returned. During persistence, an intermediate check showed only 6,812 rescored jobs; completion was not reported until all 29,199 were verified. The normal settings-save path returns before all queued relational writes finish, which remains a reliability improvement opportunity.

## Rollback

Restore deployment `345f3ad0-0ee4-4cbb-ba63-ea5c283d73ab` (0.1.2.1; source `645e1b7decfc6819a04ebafd1317180b825740cf`). No data rollback is required for this code-only deployment.

## Separate follow-ups

- Commercial email configuration remains NOT READY: missing `RESEND_API_KEY`, verified `BD_EMAIL_FROM`, and enabled `BD_REQUIRE_EMAIL_VERIFICATION`. This is maintenance, not paid-launch certification.
- The historical saved-role-list discrepancy remains unexplained.
- Live all-location inventory includes a Randstad category page titled “employment & recruitment agency” as a job; static-board vacancy validation needs a separate focused correction.
- Reloading the job workspace reset transient filters; target filter could be reapplied. Persisting job-list context on reload remains a useful follow-up.
- Local browser-suite background discovery logged long external discovery waits in `saas/src/store.js`, `runAtsDiscovery` (up to approximately 90 seconds). Not investigated or represented as a production timing measurement in this release.
