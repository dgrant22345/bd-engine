# 0.1.2.3 static vacancy validation — deployed

- Production: https://bd-engine-production.up.railway.app
- Source: `66a9bb9336c6c030487472edd3890cb4b7211e01`, pushed to `agent/paid-product-quality-audit`.
- Railway deployment: `1874abcb-197f-40d7-a819-1b09b141095e`, created 2026-09-08 16:57:53 UTC; SUCCESS.
- Scope: backend-only static careers link validation. No schema migration, visual redesign, preference changes, bulk cleanup, renderer deployment or Windows release.

## Changes

`saas/src/store.js`, `looksLikeStaticJobUrl` and `isGenericCareersLink`, now reject recognized job collection paths: search, category, location, department, pagination and faceted browse indexes. Generic careers labels are normalized without collapsing their words, so links such as “How we hire” and “View all jobs” are excluded reliably.

Regression coverage runs the complete mocked `importLiveJobs` path. It preserves genuine detail links, structured JobPosting entries, Search Engineer, Category Manager and a detail slug beneath a faceted path. A navigation-only re-import creates and closes zero jobs and preserves all five genuine jobs with incomplete-import feedback.

## Verification

- 379/379 SaaS unit tests passed.
- Lint, syntax checks and `git diff --check` passed.
- 12/12 deterministic ATS benchmark contracts passed.
- Three focused Chromium workflow tests passed: focus save/shortlist, import health/refresh visibility, and import preview target/network preservation.
- Production dependency audit: zero vulnerabilities.
- Docker was unavailable locally; Railway's production build and deployment succeeded.
- Eight live non-mutating HTTP smoke checks passed. Account creation and other mutating smoke checks remained disabled.
- Deep relational parity passed for all three workspaces before and after deployment.
- Immediate deployment error-level log review returned no entries.
- Live `src/store.js` matched the tested local source using LF-normalized SHA-256.
- Single mocked import timing for the initial four-valid-job fixture: 35.0 ms before, 39.1 ms after. These are local correctness-test timings, not production performance measurements or an optimization claim.

## Limits and follow-ups

- Previously imported category records were deliberately not bulk-deleted. This release prevents recognized false positives on future imports; it does not certify historical inventory cleanup.
- Static page detection remains a bounded heuristic. Source pagination completeness and Canadian role coverage need separate source-specific investigation.
- Saved-focus API completion can precede queued relational persistence; durable completion feedback remains a separate reliability task.
- Commercial email configuration remains NOT READY: missing `RESEND_API_KEY`, verified `BD_EMAIL_FROM`, and enabled `BD_REQUIRE_EMAIL_VERIFICATION`. This maintenance release is not paid-launch certification.
- Existing marketing and naming drafts were left untouched.

## Rollback

Restore deployment `b5a06a4f-ba42-4862-97aa-c002d437a3fb` (0.1.2.2; source `1f67e42cea25e50090d56fe62e411d8aed21c4ce`). No migration or bulk data operation accompanied this release.
