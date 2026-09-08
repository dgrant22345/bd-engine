# Saved-focus correctness follow-up

## Scope

Two confirmed false-positive paths are fixed in source, without changing customer preferences or deleting imported records:

- `saas/src/store.js`, `scoreJobRelevance`: recruitment/hiring/career/job event and fair titles do not qualify as individual vacancies. The guard precedes exact and related title matching. Ordinary recruiting titles and event coordinator/manager titles retain normal matching. The record remains available without the saved-focus filter, with an explanatory relevance reason.
- `saas/src/job-geography.js`: London, Cambridge, Richmond, Surrey, Victoria, Windsor and Kingston alone no longer establish Canadian location. Explicit province/country evidence still qualifies. Both current query generation and the older Canada SQL helper were updated; multi-location Canadian opportunities remain eligible.

This is intentionally a bounded heuristic correction, not a claim that every event or ambiguous world city can now be recognized. Missing location evidence is not proof that a job is foreign.

## Validation

- Both regression tests failed against the original code and passed after the fix.
- 378/378 unit tests passed; lint, syntax checks and diff whitespace checks passed.
- 20/20 expanded PostgreSQL SELECT-only synthetic fixtures passed on the production database engine, with migrations disabled and no customer records touched. This exercises list/count/pagination agreement with the in-memory classifier.
- Local saved-focus Chromium browser journey passed; the unsandboxed rerun exited normally (1/1, 2.8 seconds). The initial sandbox run passed assertions but stalled during teardown.
- This plain Node/static-client application has no compilation/build script. Production Docker build was not performed for this undeployed patch; local Docker is unavailable.
- Representative mocked import path timing: 34.3 ms before / 32.6 ms after. Single-run diagnostic only, not a performance improvement claim.

## Follow-up: shortlist transparency and recovery

- Open roles now exposes the saved target/excluded titles, industry/work-style preferences and threshold in a compact native disclosure. The copy distinguishes title eligibility from score cutoff and source coverage.
- Remove focus filter clears only the cutoff and resets pagination; geography, search, work style and other query settings remain intact. The saved-target preset restores the threshold.
- A target-role preset without configured focus opens the focus editor instead of silently returning an empty shortlist.
- Saving entirely cleared focus removes the cutoff instead of filtering out every unscored job.
- No added network requests, new dependencies or preference migrations. Existing focus-save/rescore remains the sole settings path. Current brand and visual language retained.
- Added browser assertions cover filter preservation, restoring the saved threshold, cleared focus, and 390px layout overflow. Desktop/mobile rendered screenshots were inspected. Full unit suite (378), lint and syntax checks passed; the final browser rerun passed 6/6 across Chromium, Firefox and WebKit (22.8 seconds).

## Follow-up 2026-09-08: focus save reliability

The focus form now catches save failures locally and keeps entered values available for retry. A per-form in-flight guard blocks repeated submissions; controls expose busy state and are temporarily disabled so edits cannot silently diverge from the submitted payload. All controls and the submit label restore after failure. Successful requests invalidate cached data but do not redirect if the original form has been removed by navigation.

A real-browser failure fixture holds the first request, attempts a second submit, returns HTTP 503, verifies retained input and restored controls, and retries against the local server to verify saved preferences. All nine focus browser cases passed across Chromium, Firefox and WebKit (28.5 seconds); unit tests, lint and syntax checks passed. No production preferences were changed. The earlier discrepancy between the user's historical role list and current saved title remains unproven; this fix is not presented as its established cause.

## Deployment status

Deployed as 0.1.2.2 on 2026-09-08; see [release verification](focus-release-2026-09-08.md). After explicit user approval, an encrypted backup was verified and all 29,199 owner jobs were rescored through the existing saved-focus form. The saved preferences and active-job count remained unchanged. Aggregate verification found 10 Canadian matches. No scores were directly rewritten in SQL.

The owner's saved target remains `talent acquisition specialist`, threshold 45. No preference changes were made. Confirm the intended broader role list before restoring earlier titles; this correction should improve precision, not be presented as increasing the match count. Source coverage and unexplained changes to the saved role list deserve separate investigation.
