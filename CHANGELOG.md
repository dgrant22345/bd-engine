# Changelog

All notable customer-facing changes are recorded here. The project is currently in pre-1.0 commercial hardening.

## Unreleased

## 0.1.2.3 — 2026-09-08 — Static vacancy validation

- Reject static-careers category, search, location, pagination and facet-only links as vacancies.
- Correct multi-word navigation-label filtering without rejecting real role titles.
- Preserve existing jobs when the source returns only navigation instead of vacancies.
- Backend-only maintenance; no bulk cleanup, schema migration, preference or branding changes.

## 0.1.2.2 — 2026-09-08 — Saved-focus matching and recovery

- Keep recruitment-event listings out of vacancy matches while retaining source records.
- Require province/country evidence for several ambiguous Canadian city names.
- Explain saved titles, exclusions and scoring beside the shortlist.
- Remove the focus cutoff without clearing geography and other filters.
- Preserve focus entries on failed saves, prevent duplicate submissions and handle cleared focus.
- Hosted maintenance release; no rebrand, schema migration or paid-launch configuration change.

## 0.1.2.1 — 2026-09-07 — People workflow reliability

- Protect add-person input and pending saves; preserve notes and list context.
- Prevent old requests from repopulating the cache after a save or refresh.
- Save only edited person fields, preserving unrelated updates made elsewhere.
- Make failed searches recoverable without misleading stale rows or pagination.
- Normalize outdated empty page links and retain the existing visual design.
- Hosted maintenance release; no schema migration or paid-launch configuration change.

## 0.1.2.0 — 2026-09-07 — Recruiter People workspace

- Make People the hosted recruiter home, with in-context profile review,
  contact correction, multiline notes, manual add and comparison of saved people.
- Preserve search, pagination and profile context on reload; prevent delayed
  responses from replacing a newer screen; keep single-person saves scoped.
- Introduce restrained neutral/teal light and dark styling, compact controls,
  clearer table hierarchy and optional disclosures for business-development tools.
- Prepare outreach without requiring a linked company, distinguish copying from
  sending, and remove unsupported candidate and template claims.
- Improve first-run, empty, loading, error, keyboard and responsive states.
- Validate contact sorting/filtering with SELECT-only PostgreSQL fixtures.
  No schema migration or ingestion rewrite; existing paid-launch controls remain.
- Hosted interface release only. The Windows-local People renderer and broader
  email/verification launch gates remain unchanged.

## 0.1.1.1 — 2026-09-06 — Large-board ingestion

- Raised bounded Workday and SmartRecruiters coverage from 1,000 to 5,000
  postings per board, with shared request deadlines and bounded concurrency.
- Handled Workday's zero-total sentinel on later pages and verified the source
  head before treating multi-page scans as complete.
- Detect repeated, missing, invalid, and changing pages; preserve unseen jobs
  and explain incomplete coverage with fetched/reported counts in source health.
- Added pagination regression cases and per-board timings. The live sample now
  retrieves 2,000 of 2,000 reported NVIDIA jobs; the empty BambooHR sample remains
  unresolved. This does not establish complete coverage of every employer.
- Prevented the public live canary from running against a configured database.

## 0.1.1.0 — 2026-09-06 — Hosted reliability release

- Fixed relational job pagination dropping matches that were absent from old
  workspace snapshots, and aligned Canada/role filtering with the result count.
- Preserved prior jobs during incomplete imports, exposed source completeness,
  and tightened title matching and posting-date handling.
- Saved job pipeline stages to the cloud workspace with failure-safe UI feedback.
- Simplified the dashboard and removed unsupported performance, review, candidate,
  and referral claims from primary customer workflows and public marketing.
- This is a limited reliability release. Email delivery and the broader paid-launch
  gates remain incomplete; see `docs/product-quality-audit-2026-09-06.md`.

## Earlier pre-release hardening

- Fixed dashboard tab visibility, post-setup navigation races, mobile header
  overflow, wide Accounts layouts, and several customer-facing accessibility
  failures found during the production audit.
- Added a production-readiness gate for new paid checkout, aligned billing UI
  availability with that gate, added anonymous aggregate job-coverage
  diagnostics, and proved Canada plus target-role filtering counts matches
  before pagination.
- Activated the production and ATS scheduled checks through default-branch
  schedulers that delegate to the Railway deployment branch.
- Pinned delegated scheduler checkouts to the Railway deployment branch so
  dependency caches and probes run against the intended release.
- Required both paid Stripe prices before billing reports ready, converted
  provider failures into actionable customer-safe responses, and added direct
  coverage for checkout payloads, signed webhooks, referral credits, portal
  sessions, and subscription cancellation.
- Removed customer examples, workspace IDs, and internal record IDs from the
  default semantic-integrity CLI and JSON reports.

- Preserved signup workspace and profile details through first-run setup.
- Corrected sample-workspace readiness after data is loaded.
- Focused the default dashboard on daily actions while keeping advanced sections optional.
- Replaced browser-native account dialogs with accessible in-app dialogs.
- Expanded and tested public ATS coverage, discovery isolation, lifecycle handling, and ingestion diagnostics.
- Prevented incomplete paginated ATS refreshes from closing valid jobs, added rate-limit-aware retries for XML and HTML providers, and corrected ambiguous Canada/US location filtering.
- Added a deterministic release benchmark that certifies all 12 supported hosted job adapters against the normalized job contract.
- Restored live Jobvite imports after its legacy JSON endpoint was retired, fixed Ashby board identity parsing, and improved ATS discovery across redirects and JavaScript-escaped links.
- Added a bounded authenticated careers-page renderer fallback plus a scheduled live canary covering all 12 public provider adapters.
- Added grounded outreach variants, support conversations, mutation auditing, subscription recovery states, backup/restore tools, and production storage safeguards.
- Added authenticated encrypted backups, guarded non-empty restores, bounded data retention, privacy-safe structured logs, and non-migrating read-only operational diagnostics.
- Added an explicit public-database mode for encrypted Railway operator backups.
- Added a required PostgreSQL 16 recovery drill that proves encrypted backup,
  transactional restore, exact durable-table recovery, volatile-data exclusion,
  and sequence repair on disposable databases.
- Added a published vulnerability-reporting path, a functional support fallback,
  pricing-to-entitlement contract coverage, and grouped monthly dependency PRs.
- Expanded the scheduled production probe to detect browser-security, CSP nonce,
  secure-cookie, and public pricing regressions.
- Added read-only live Stripe catalog and webhook verification, and accepted
  both supported successful-invoice event variants for payment recovery.
- Labeled paid plan prices as USD in public and in-app billing surfaces.
- Kept expected pre-initialization readiness probes from creating false error alerts.
- Restricted browser resource loading with a full Content Security Policy, stopped trusting Host headers for customer URLs, and reduced CI workflow tokens to read-only permissions.
- Replaced the broad inline-script CSP exception with a per-response cryptographic nonce.
- Hardened signup, login, reset, demo, analytics, and client-error rate limits against spoofed forwarded IP headers.
- Blocked unsafe cross-site browser mutations before API routing while preserving signed webhooks.
- Bounded upload size, request/header duration, keep-alive reuse, and header counts at the HTTP server boundary.
- Corrected account-to-board matching and working filters so ATS state, target-company coverage, network paths, and admin review queues agree across blob and relational reads.
- Restored job-seeker terminology and workflows across setup, navigation, company and role views, search, and outreach.
- Shortened sales outreach around one verified role, fixed reversible account pausing, and added customer-action browser coverage.
- Restricted imported and customer-visible external links to HTTP and HTTPS protocols.
- Escaped task-loading errors before rendering them into the customer workspace.
- Updated product, privacy, provider, troubleshooting, packaging, and release documentation.

## 0.1.0

- Initial hosted SaaS and Windows-local product foundation.
