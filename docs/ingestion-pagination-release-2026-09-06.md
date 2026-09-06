# Ingestion reliability follow-up — 6 September 2026

## Decision and scope

0.1.1.0 is deployed. The 0.1.1.1 follow-up fixes another verified coverage gap:
`saas/src/store.js::fetchWorkdayJobs` stopped at 50 pages of 20 jobs. Nine connected
boards reached exactly 1,000 fetched rows while reporting 1,053–2,615 postings.
`fetchSmartRecruitersJobs` had the same 1,000-row ceiling at 10 pages of 100.

This is a limited ingestion release, not approval for a broad paid launch.
The test evidence below distinguishes provider-reported inventory from verified
role suitability. No customer records were manually changed for smoke tests.

## Deployed 0.1.1.0 checkpoint

- Commit: `054a404`; Railway deployment: `f094f262-c066-4009-8a82-41fda05be94e`.
- Previous deployment: `6558014a-6a6b-4016-99a9-3696b057eba9` from `b24d7b8`.
  Prefer the corrected 0.1.1.0 release, not that older paging-defective build,
  as rollback for the pagination follow-up.
- Six deployed source/UI file digests matched the local reviewed release.
- Eight read-only HTTP smoke checks passed; 20 SELECT-only PostgreSQL fixtures
  passed; deep legacy parity passed for all three legacy workspaces. No
  error-level records were returned by the immediate post-release log check.
- Actual owner Canada/best-fit/minimum-45 query: 247 matches, a full 20-row page,
  400 ms including contact preview; count/page SQL alone took 166 ms. These are
  individual observations, not latency benchmarks or a precision evaluation.
- Encrypted operator backup: `bd-engine-backup-2026-09-06T08-30-32-684Z.json.gz.enc`
  in `C:\Users\ddere\BD-Engine-Backups`, outside the uploaded workspace. The 29.25 MB
  AES-256-GCM archive passed authenticated decryption and hash verification.
  SHA-256: `f058857c7f4aa74178ae61a4ebdc6c00dc019744582dd577e7314ce0b86ba8f6`.
  This verifies the archive, not a full restore into a disposable database.
- The Postgres service's separate backup-key setting failed format validation.
  The operator backup used the valid app-service key with the public database
  connection in a child process; no credentials were printed or modified.
  Correct the backup operator context before treating unattended backups as proven.

### Normal scheduled-refresh reconciliation

The scheduled import at 08:40:58–08:41:23 UTC completed in 25 seconds with one
source error and eleven partial boards. It fetched 20,628 source rows across
99 board attempts, kept 9,845 within import geography, and filtered out 10,783.

- Owner total jobs: 28,496 → 28,532, exactly 36 new records.
- Active jobs: 9,075 → 9,099 = +36 new +34 reactivated −46 closed.
- 9,042 active jobs received current relevance scoring. The corrected query's
  earlier 659 stored-score matches became 247 after this normal rescore, not
  unexplained inventory loss. These counts do not establish human-rated precision.
- Nine partial Workday boards each fetched 1,000 rows. Two static-careers boards
  also remained partial; the one error was separate. Network-only company history
  is not part of the 99 attempted operational boards.
- No owner jobs had a persisted pipeline stage at the check. Local reload and
  reimport tests passed, but no fake production stage was created to claim a
  real write/restart test.

## 0.1.1.1 changes and boundaries

`saas/src/ats-pagination.js::fetchPaginatedAtsJobs` now provides:

- Default 5,000-job ceilings: Workday 250 pages, SmartRecruiters 50. Configured
  overrides are bounded to 500/100 pages respectively. Existing smaller explicit
  environment overrides still apply and must not be silently ignored.
- Six concurrent page requests by default (hard maximum ten) and a shared
  two-minute board deadline, including fetch timeouts and retry waits.
- Sequential paging for feeds without totals, stopping at a short terminal
  page without speculative out-of-range requests.
- Unique identities, duplicate detection, missing-row checks, explicit partial
  reasons, and a recheck of the first page after a complete multi-page scan.
- Workday-specific handling of the empirically observed `total: 0` sentinel
  on non-head pages. The first page's real count remains authoritative.
- Preservation of unseen jobs whenever coverage is partial; failed later pages
  cannot be interpreted as a whole-board HTTP 404. Verified complete snapshots
  can still close genuinely unseen jobs through the existing import contract.
- Source-health text with fetched/reported counts and the specific incomplete
  reason. Metrics include page count, unique rows, and measured page-fetch
  duration; retries honor the shared deadline. No whole-workspace reload or new
  data migration.

Offset feeds do not offer a transactional snapshot. Count, identity, and head
checks reduce drift risk but cannot prove that an employer made no simultaneous
edits. Refreshes restart from page zero; they do not combine stale offset cursors
from different runs. Boards beyond the ceiling remain explicitly partial.

## Verification

Live public-board canary, in an isolated in-memory workspace:

| Observation | Before | After |
| --- | ---: | ---: |
| NVIDIA unique jobs / reported total | 1,000 / 2,000 — partial | 2,000 / 2,000 — complete |
| All 12 sampled boards' imported jobs | 2,300 | 3,300 |
| Complete, nonempty sample boards | 10 / 12 | 11 / 12 |
| Full canary wall time | 10,485 ms | 20,684 ms |
| Import fetch time | 9,438 ms | 19,154 ms |
| Import normalization/upsert time | 1,005 ms | 1,474 ms |

After: Workday fetched 100 pages plus one head-verification request in 18,456 ms.
The additional time pays for previously omitted pages; this is a completeness
improvement, **not a speedup claim**. Timings are single network observations.
The sampled BambooHR board remains empty and unresolved; 11/12 is not a claim
of complete coverage for all providers or every customer's targets.

Deterministic tests cover a 2,615-role Workday board with zero-total later pages,
a 1,201-role SmartRecruiters board, 5,000-row caps preserving old jobs, unknown
totals, changing heads/counts, duplicate/malformed rows, failed later pages,
time budgets, bounded concurrency, and human-readable diagnostic details.

Pre-deployment validation: 364 unit tests, 66 Chromium browser journeys, three
browser-engine compatibility journeys, and 12 deterministic provider contracts
passed. Syntax, lint, and schema checks passed; the production-dependency audit
reported zero vulnerabilities. These are local checks, not a claim of a new
remote CI run.

Immediately before the follow-up deployment, a fresh encrypted backup also
passed authenticated verification: `bd-engine-backup-2026-09-06T13-53-03-799Z.json.gz.enc`
(29.44 MB, 27.4 seconds), in the same operator backup directory. SHA-256:
`8ae568c7126a1897758a3a08b29c4022a1cf13c8cf9411f1e9e87405b8b32d9a`.

The deployment checkpoint will record the exact production revision. Email
delivery, verification rollout, full backup restore,
real saved-stage restart proof, and human-labelled matching evaluation remain
open launch gates.
