# BD Engine product-quality audit — 6 September 2026

## Decision

The highest-priority failure was real: the deployed database query returned six
jobs on a page that should contain twenty. This branch fixes that defect and
hardens import completeness, role matching, saved pipeline stages, and product
claims. It is a reliability release candidate, **not approval for a broad paid
launch**. Willingness to pay still needs customer evidence.

Branch: `agent/paid-product-quality-audit`. The branch incorporates the live
`origin/main` commit `b24d7b8` and the separate production-readiness work from
`f8112ad`; neither original branch contained all of the other's changes.
No production records were changed by this audit. Deployment remains separate
from pushing the reviewed code.

## The six-result defect, reproduced against production

Exact path: `saas/src/relational-reads.js::findTenantJobsRelational`.

The page query joined authoritative relational jobs to the legacy
`tenant_data.jobs` array for ordering. The count query did not require that
legacy membership. Only **43 of 9,075 active relational jobs** existed in the
owner workspace's old array. Matching jobs disappeared from the visible page,
while the count continued to describe a much larger inventory.

Read-only comparison on 6 September; Canada, active, minimum stored relevance
45, best-fit order, page size 20:

| Query | Matching total | Rows on first page | Observed elapsed time |
| --- | ---: | ---: | ---: |
| Deployed function | 618 | 6 | 60 ms |
| Corrected count + page query | 659 | 20 | 200 ms |

The total changes because geography rules are also reconciled. These are
**stored relevance scores**, not 659 manually verified suitable jobs. The
timings are individual read-only observations, not a load test or a latency
improvement claim; the old query was fast but incorrect. The new function also
loads a bounded contact preview after fetching the page.

Fix: `saas/src/job-queries.js::buildTenantJobQueries` gives count and page the
same relational source and predicates, deterministic ordering, bound inputs,
tenant-scoped joins, and filtering before pagination. It never consults the
legacy ordering array. Twenty SELECT-only PostgreSQL fixtures verify location
parity, three pages, network counts, work styles, saved pipeline filtering,
explicit IDs, and foreign-workspace exclusion. The fixtures are now part of the
PostgreSQL CI job and can run with `npm run verify:job-queries`.

## Changes implemented

### Import reliability and relevance

- `saas/src/store.js::importLiveJobs` distinguishes complete, partial, malformed,
  empty, and failed source responses. A pagination cap or malformed row does not
  silently close previously imported jobs that were not fetched.
- A posting seen on a source remains seen even when a changed import geography
  excludes it. A filter change is not evidence that the employer closed it.
- Board diagnostics retain fetched/kept counts, completeness, invalid rows, and
  the source's reported total when available. Partial sources appear in the
  attention queue, not as clean successes.
- Ashby secondary locations and unlisted roles, Lever location arrays, and
  structured work style are handled explicitly. The adapter contract follows
  the [Ashby public posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)
  and [Lever postings API](https://github.com/lever/postings-api).
- Workday relative dates are normalized only when interpretable. Approximate
  ranges such as “30+ days” remain labelled age text instead of invalid dates.
  Inferred dates use UTC days and are not precise publication timestamps.
- `scoreJobRelevance` now requires a relevant title when target roles are set.
  Department text or a generic “manager” overlap cannot qualify an unrelated
  role. Exact phrases and explicitly related recruiting titles remain distinct.
  Exclusions use word boundaries, so “intern” does not reject “International”.
- Explicitly out-of-focus roles stay out of score-filtered shortlists and
  matching rollups, even at very low thresholds. Existing jobs need a rescore
  through **Save focus and show matches** after release; the audit did not
  silently rescore every customer's workspace.

### A usable, durable workflow

- `PATCH /api/jobs/:id/pipeline` validates the stage and workspace ownership and
  uses the existing durable incremental persistence path. Cloud pipeline stages
  are no longer browser-only labels. Reimports preserve them.
- Pipeline filtering happens before paging. The native stage selector saves on
  change, is disabled during a request, and restores the last saved value if the
  request fails. Success is not displayed for a rejected save.
- Saving search focus preserves the selected geography/work style, rescoring
  imported jobs and opening the relevant shortlist without silently broadening
  a Canada search to all locations.
- Open roles distinguishes filtered results from the active workspace inventory.
  Empty states point to filters or source coverage as appropriate, and explain
  that imported inventory is not a search of every job on the web.
- Cloud behavior is capability-gated. Old device-local pipeline labels are not
  silently attributed to a signed-in workspace; re-save those stages manually.

### Product trust and visual hierarchy

- Replaced invented ROI/time-savings dashboard figures with recorded inventory,
  ready-source counts, refresh status, and an explicit coverage limitation.
- Removed competing dashboard cockpit/ticker blocks, duplicate header actions,
  and redundant role presets. Preserved the live branch's Tools organization
  and contrast improvements. Existing sapphire/slate semantic colors remain.
- Removed unsupported landing-page review ratings, reply rates, time savings,
  fixed job counts, real-time guarantees, and money-back promises. Demo evidence
  is labelled illustrative. Public copy explains coverage and sending limits.
- Candidate-slate placeholders no longer invent actual people, availability,
  salaries, or achievements. Batch drafts use provided context and explicitly
  request verified details; follow-ups require confirmation of earlier sending.
- Draft-assistant copy no longer claims messages were launched when the action
  only copies text. Its context score is labelled uncalibrated, not a reply
  probability.
- Referral sharing obtains the actual workspace-issued URL and configured
  invoice credit. It no longer invents user-ID referral codes or free paid months
  for both parties. Clipboard failures produce errors, not fake success.
- Prepared LinkedIn/community sharing copy describes actual capabilities without
  fabricated personal results. No posts, DMs, emails, or ads were sent.

## Verification and limits of the evidence

| Area | Evidence |
| --- | --- |
| SaaS unit suite | 341 tests passed after reconciliation and trust-copy changes |
| PostgreSQL job-query fixtures | 20/20 passed through read-only production connection; no DDL or customer mutations |
| Deterministic ATS adapters | 12/12 normalized contract fixtures passed |
| Renderer | 4/4 tests passed; syntax check passed |
| Static quality | SaaS syntax, lint, and schema checks passed; 26 tables, 61 indexes, 12 migrations |
| Dependencies | SaaS full audit and renderer production audit reported zero vulnerabilities at audit time |
| Browser journeys | 66/66 Chromium journeys passed, including accessibility, failed-save, campaign, setup, billing-entry, and privacy flows |
| Engine compatibility | 3/3 public-entry/demo journeys passed across Chromium, Firefox, and WebKit |
| Browser layout | Desktop and 390 px mobile role views inspected; responsive and contrast checks included in browser suite |
| Production HTTP | `/health` and `/readyz` returned 200 |
| Billing catalog | Read-only verification passed: live mode, two configured paid plans, one matching webhook |

The live ATS sample returned **2,300 jobs in 10.734 seconds**: 9.843 seconds fetching
and 0.857 seconds upserting into the canary's test store. Ten of twelve sample
boards returned complete, nonempty results. This is not complete-provider
certification:

- NVIDIA Workday: **partial**, 1,000 fetched versus 2,000 reported. The existing
  request/page budget remains bounded; this release exposes the shortfall and
  prevents false closures, but does not retrieve the missing half.
- The tested BambooHR board: **empty**. Zero postings alone is not evidence of
  either a working nonempty importer or a broken employer board.
- HTML-based career pages can omit paginated or client-rendered postings. A
  successful parse cannot establish whole-employer coverage.

Browser journeys use a local, disposable in-memory server, not customer data.
The pipeline tests verify page reload and reimport behavior; a production
restart/recovery exercise for newly saved stages remains a release check.
Security tests cover important boundaries but are not a penetration test.
The installed Windows desktop application's ingestion paths were not exercised.

## Remaining gates, in priority order

| Priority | Remaining work | Acceptance evidence |
| --- | --- | --- |
| P0 — operations | Configure `RESEND_API_KEY` and a verified `BD_EMAIL_FROM`; then enable email verification deliberately | Password reset, verification, and support mail received in real test inboxes; value-safe production check passes |
| P0 — release | Deploy the reconciled candidate only with operator approval; rescore the owner focus and check the live Canada shortlist | Full pages, relevant titles, preserved stages after restart, healthy readiness, and no unexplained count loss |
| P1 — ingestion | Resume large-board pagination safely within provider/request budgets; add source-specific empty-feed checks | Reported/fetched totals reconcile or the source stays explicitly partial; failed refreshes preserve prior jobs |
| P1 — commercial truth | Audit or retire remaining experimental objection/call/presentation tools | No unverified candidate representation, staffing terms, past contact, revenue, or success claims in any generated content |
| P1 — customer operations | Prove live checkout lifecycle, support ownership, a current production backup restore, and rollback | Owner-signed release checklist with durable evidence; professional review of public policies |
| P1 — matching validation | Label a representative Canada/recruiting sample with the owner; evaluate title precision and missed-role cases | Agreed examples and regression cases, separately from stored relevance-score counts |
| P2 — UX/performance | Reduce persistent trial-banner and mobile filter height; show better bounded discovery progress; split large frontend modules | First useful role is easier to reach; measured improvements on real paths without hiding failures |
| P2 — compatibility | Verify old desktop filters and device-local pipeline transitions | Installed Windows smoke journey, including empty IDs and saved pipeline behavior |

`saas/src/store.js::runAtsDiscovery` is still dominated by external discovery
requests: browser-run observations ranged from roughly 15 to 71 seconds, while
scope loading/persistence setup was negligible. It is background work; no claim
is made that this release improved discovery latency.

Ambiguous location strings and the existing broad “GTA / ON” behavior still need
a labelled geography evaluation. Location agreement between SQL and JavaScript
proves implementation parity, not that every employer's location is correct.

## Commercial next step

Use the [30-day founder-led plan](marketing-launch-plan-30-days.md) for a small,
permission-based recruiter design-partner cohort, not paid mass acquisition.
Show the free ATS audit, then prove the workflow on each participant's actual
target list. Ask whether they return to the shortlist and record useful actions;
do not substitute demo metrics, social engagement, or synthetic scores for
evidence that someone will pay.

The existing job-seeker experience remains supported. Recruiter and job-seeker
results must not be pooled into a single claim of product-market fit.

Before deployment, record the current application deployment and a verified
backup reference. If authentication, readiness, saved stages, or inventory
integrity regress, restore the previous application release; do not delete jobs
or improvise reverse SQL. No schema change is required for this patch.
