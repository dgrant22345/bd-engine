# 0.1.2.5 import coverage and historical cleanup

## Findings and fixes

The data-quality review uses individual jobs as the inventory grain and board configurations as the source-health grain. These denominators are deliberately separate: a large imported network is not a large monitored job-source set.

- High severity, confirmed: an occasional duplicate stopped the remaining ATS pages in `saas/src/ats-pagination.js`, `fetchPaginatedAtsJobs`. The previous TD snapshot reported 1,687 jobs but fetched only 378 unique jobs across 19 pages, with two duplicates. The fix continues through isolated overlaps, retains existing budgets, stops fully repeated pages, and still marks duplicate-affected feeds incomplete so unseen jobs cannot be closed.
- High severity, confirmed: 42 active Randstad category-page URLs were counted as jobs; zero had pipeline stages. The normal import path now marks recognized static collection URLs inactive with `closureReason: invalid_collection_page`, retains their records, skips pipeline entries in this cleanup, and records audit items. Cleanup is restricted to selected static configurations with exact config IDs and explicit browse-path patterns, not broad title guesses.
- Coverage baseline: owner workspace had 29,444 stored jobs, 11,173 active, 2,734 Canadian, nine Canadian focus matches at the unchanged cutoff of 45. Its 12,317 accounts include 100 tracked targets. The rendered diagnostics showed 99/100 tracked companies refresh-ready; the 121 active board configurations are a different denominator.
- Other incomplete sources included public 403 responses, unrecognized static pages and Workday invalid rows. Those remain explicitly incomplete; the fix does not claim to bypass access restrictions or prove missing postings are closed.

## Validation

- 383 unit tests passed, including isolated overlap, fully repeated pages, time budgets, collection quarantine, idempotence and preservation tests.
- Lint, syntax and diff checks passed; 12/12 deterministic ATS contracts passed.
- Two Chromium journeys passed in 8.4 seconds: focus save/shortlist and import-health visibility.
- Isolated live TD canary: 1,775/1,775 jobs, 89 pages, complete, 783 Canadian jobs; total 17.9 seconds, fetch 17.5 seconds. This newer snapshot had no duplicates and is not a paired performance/coverage experiment against the older production snapshot. The regression fixture demonstrates recovery when overlap occurs.
- Reproducible checks: `saas/scripts/verify-canadian-source.mjs` (refuses a database connection) and `saas/scripts/report-job-coverage.mjs` (read-only, aggregate-only output). The coverage report now separates Canadian matches, outside-focus jobs, below-threshold jobs and import freshness by provider.
- Pre-deployment deep parity passed for three workspaces.

## Deployment and live refresh

- Source `23d5760`, deployed to the existing production Railway service as `a7bb23c0-aabe-4cf0-9936-ab799dfe94f2`; SUCCESS and `/readyz` passed.
- Eight non-mutating production smoke checks passed. Three deployed source checksums matched local tested files: store, pagination and coverage report.
- The authenticated owner used the existing Import latest jobs action once after deployment. The run completed: 21,177 jobs fetched across 99 boards, 10,039 retained within import geography, five incomplete boards and six failures.
- Post-refresh aggregate verification: all 42 quarantined records retained, zero still active, zero pipeline entries affected. Inventory: 29,654 total jobs, 11,232 active/scored, 2,799 Canadian, eight Canadian focus matches. Provider breakdown found zero Canadian jobs excluded solely for being below the cutoff. The match count declined with the changing source inventory; no match-count increase is claimed.
- Deep relational parity passed for all three workspaces after the live refresh. Remaining issues include LinkedIn HTTP 403, Workday HTTP 429 and later-page failures, three unrecognized static feeds, duplicate/invalid source rows. No access controls were bypassed or repeated refreshes triggered to force a success.
- Production timing in `saas/src/store.js`, `importLiveJobs`: 51.9 seconds total, 39.7 seconds fetching, 8.5 seconds discovery, 2.2 seconds upsert, 7 ms collection cleanup. External fetching is the dominant measured stage. Immediate log review returned the slow-import timing warning, not a persistence failure. The rendered owner shortlist agreed with the database: eight results, Canada, saved focus 45+.
- Rollback code: deployment `0dd934c9-e37f-4051-8473-34825027cd70` (0.1.2.4). Code rollback does not reactivate quarantined records; they remain retained with an explicit reason for scoped recovery.

## Deliberate boundaries

No focus, geography, threshold, target selections, branding, credentials or email settings were changed. No customer records were deleted. No new paid services or job-board accounts were created. Historical data is not certified universally clean: classification remains bounded to explicit collection URLs. Broader source expansion and remaining blocked feeds need source-specific work; paid-launch email setup still needs a configured provider and verified sender.
