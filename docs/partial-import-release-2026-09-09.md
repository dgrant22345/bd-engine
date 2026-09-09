# 0.1.2.6 partial import recovery

## Fixes

- `saas/src/ats-pagination.js`, `fetchPaginatedAtsJobs`: a failed later request no longer discards successful pages from the same refresh. The current batch settles, successful pages are retained, further page dispatch stops, and `page_failed` plus `failedPages` explicitly describe incomplete coverage. A failed final verification likewise returns retained jobs with `verification_failed`. First-page failures still fail rather than fabricating an empty board. None of these partial paths permits closure of unseen jobs.
- `saas/src/store.js`, `readRetryAfterMs` / `waitForAtsRetry`: Retry-After seconds and HTTP dates are no longer truncated to ten seconds. When the requested cooldown exceeds the worker's ten-second wait allowance or remaining board budget, the current request is deferred by propagating its failure rather than retrying too early. This does not add a persistent host-wide cooldown across separately initiated imports.
- Existing source-health UI receives readable partial reasons through the existing diagnostics path. No redesign, new dependencies, schema changes, preference changes or bulk data changes.

## Verification

- 387/387 unit tests passed. Lint and syntax checks passed; 12/12 deterministic ATS contracts passed.
- End-to-end mocked Workday import: one existing unseen job preserved, 40 fetched jobs retained, zero closures, one partial board, exactly one request to a page returning Retry-After: 120. Fixture timing approximately 18 ms; not a live performance claim. Previously a later-page exception discarded the refresh's fetched jobs.
- SmartRecruiters integration verifies that a partial refresh retains the old job and adds the newly fetched job, without closing anything.
- Regression checks cover successful sibling pages, no further dispatch after a failed batch, first-page 403, verification failure, long/date/overflow cooldowns and exhausted deadlines.
- Two Chromium workflows passed in 9.3 seconds: search-focus save/shortlist and import-health visibility.
- Pre-deployment deep parity passed for three production workspaces.

## Deployment

- Source: `53bed78`, branch `agent/paid-product-quality-audit`.
- Railway deployment: `92206be8-493a-4f7a-944d-1a95d475f646`.
- Status: SUCCESS. Production build passed; `/readyz` returned 503 during initial startup and then passed its retry. Eight non-mutating production smoke checks passed. Deep parity passed for three workspaces after deployment. Immediate error-level log review returned no entries. Both changed runtime files matched tested source using LF-normalized SHA-256.
- Rollback: `a7bb23c0-aabe-4cf0-9936-ab799dfe94f2` (0.1.2.5); no migration to reverse.

## Limits

No extra production-wide refresh was triggered to force external rate-limit errors for testing. Third-party access denials, malformed source rows and provider quotas remain real limitations, not successes. Shared host-wide scheduling/cooldown coordination remains a separate reliability opportunity. Paid-launch email configuration remains outside this release and unresolved.
