# Release 0.1.3.0 verification

Production target: https://bd-engine-production.up.railway.app
Source base: d01650eda596cb6fe30bfb2a0caabe513e87785b (deployed 0.1.2.9)

## Implemented

Completed-source results during ongoing ATS imports, shared job feedback with saved-search filters and focus guidance, calendar snapshots, private daily email reminder preferences and delivery, operator customer paid/return cohorts, and a captioned recruiter walkthrough with campaign copy. Main was fast-forwarded to the deployed source before starting this feature branch. The release uses the existing `jobs.raw`, `tenant_data.jobs`, and private `saved_work` storage; it adds no database migration.

## Validation

- 421 Node tests pass, including the single account/provider journey: signup, verification, single-use reset, checkout, confirmed paid access after a fresh login, portal, and cancellation. Providers are mocked; no messages or real payments occur.
- 129 existing Chromium journeys pass. New feedback, follow-up, and walkthrough journeys pass, including mobile overflow and accessibility checks. The task queue regression also passes after the direct-entry bootstrap change.
- PostgreSQL 16 checks pass for tenant isolation, stale feedback conflicts, reimport and stale-snapshot preservation, simultaneous reminder delivery deduplication, and test/demo/internal exclusions in the actual growth SQL. These use an isolated local database and fixture rows; CI repeats them.
- Syntax checks, ESLint, the unchanged migration contract (13 migrations), and whitespace checks pass.
- Actual public-source import benchmark (`saas/src/store.js::importLiveJobs`, Figma and Stripe Greenhouse boards, isolated in-memory workspace): first visible result 1,658 ms before, 990 ms after; total 1,658 ms before, 1,430 ms after; 876 roles and no source errors in each run. This is one sequential sample and does not establish a typical network speedup. A gated-source regression separately proves results are queryable before a slow board completes.
- Snapshot write benchmark (`saas/src/db.js::dbSaveTenantData`, 1,000 fixture jobs on local PostgreSQL, five writes): 10.9 ms average before and 14.2 ms after adding durable feedback preservation.
- The full CI browser suite exceeded the existing 120/hour analytics limit because all synthetic visits share one IP. The isolated browser harness now uses a larger event budget; the production default remains 120/hour. The analytics journey asserts successful recording responses before checking report counts.
- Walkthrough MP4: 30 seconds, approximately 383 KiB, silent with on-screen captions, English caption track, and HTML transcript. Sample ATS audit is labeled host recognition and does not claim live job verification.

## Pending external verification

Actual email receipts at dgfinance15@gmail.com and actual Stripe test checkout are pending Resend and separate Stripe test-environment configuration. Follow docs/EMAIL-AND-STRIPE-TEST-SETUP.md. Email opt-in is unavailable until delivery is configured and the recipient is verified. New return-visit tracking starts with this release, so older cohorts may undercount returns. Operator QA inbox exclusions require `BD_ANALYTICS_TEST_EMAILS` configuration.

## Deployment receipt

The final accepted commit, Railway deployment, and read-only live check results are recorded in GitHub PR #37: https://github.com/dgrant22345/bd-engine/pull/37.
