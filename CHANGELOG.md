# Changelog

All notable customer-facing changes are recorded here. The project is currently in pre-1.0 commercial hardening.

## Unreleased

- Remove decorative emoji from the workspace: headings, buttons, confirmations, badges, pipeline stages, location filters, and copied briefings are now plain text. Check marks, close buttons, and arrows are unchanged.
- Replace combat and hype wording with plain descriptions. The account matrix quadrants are now "Warm and hiring", "Warm, hiring is quiet", "Hiring, few contacts", and "Watchlist"; "Executive Battle Plan" is "Daily plan"; "Cross-Hunt Sibling Cluster" is "Similar companies"; and "1-Click" buttons say what they do ("Copy plan", "Copy script").
- Stop describing roles open for 45 days or more as "fast-track" with a "high response rate" in job seeker mode. The badge now reads "Open 45+ days".

- Publish two guides for staffing recruiters: how to find companies that are hiring, and how to export LinkedIn connections to CSV. Both are listed on the guide index and in the sitemap.
- Keep the campaign that brought a visitor to a guide when they continue to the free audit or the product, so results from a post that links to a guide are attributed to that post.
- Show a new workspace its four first steps at the top of the Dashboard, and replace the grid of zero-value metrics with a single prompt until a company is ranked.
- Put the follow-up queue first on the Follow-ups page, with calendar reminders and activity history below it, and make the "New task" panel the same width as the rest of the page.
- Remove the box drawn around the page heading on the sign-up form and the first-run setup screen, which made the heading look like an editable field.
- Name the Dashboard consistently: the sidebar said "Overview" while the page title and breadcrumbs said "Dashboard".
- Use plain-text labels for the hiring-activity quick filters. The flag symbol on "Canada only" displayed as the letters "CA" on Windows.
- Even out the spacing above the Companies notice, and remove a stray divider from the Dashboard summary strip on phones.

- Read connection files as people actually save them: semicolon, tab, and pipe-delimited files; Windows-1252 and UTF-16 encodings (accented names no longer arrive garbled); and column names from other tools and languages, such as "Full Name", "Organization", "Job Title", "Vorname", or "Firma".
- When a file cannot be used, say which column is missing and which columns were found, before anything is queued, instead of reporting an import that skipped every row.
- Fix "Preview CSV" in Settings, which performed a real import because the preview option was only read from the request body.
- Show the server's own preview in the People import dialog, so the counts shown before importing are the counts that are imported, and report what was actually added afterwards. The dialog now stays on the page it was opened from and no longer flashes on each update.
- Track every company in a large connections file without placing thousands of names in the request address, which made large imports fail.
- Explain spreadsheet workbooks and zip archives when they are chosen instead of rejecting them without a reason, and accept `.tsv` and `.txt` files.
- Read target-account lists pasted from documents (numbered, bulleted, or quoted), with tab or semicolon separators, and with common column names such as "Account Name" and "Website".
- Count "Recruiter", "Recruiting", and "Recruitment" titles as talent contacts. They were previously missed, which lowered the ranking of companies where you know recruiters.

- Serve only regular files from the static directories and contain a failed file read to the request that triggered it, so one malformed asset request cannot interrupt the service for everyone else.
- Deliver the home page and `/job-search` already rendered for signed-out visitors, so the page appears without a loading spinner and its content is readable by search and AI crawlers that do not run JavaScript. Signed-in visitors still open straight into the workspace.
- Add a favicon and home-screen icon to every public page.
- Self-host the Inter typeface and load it on every public page. The ATS audit, guides, and walkthrough previously fell back to a system font, and the home page no longer contacts Google Fonts.
- Cache stylesheets, scripts, fonts, and media in the browser, and answer repeat requests with a short "not modified" response instead of resending the file.
- Support partial (byte-range) requests for media, which Safari requires to play the recruiter walkthrough video.
- Return a branded "page not found" page with a 404 status for unknown addresses instead of a copy of the home page, and add `/login`, `/signup`, `/pricing`, `/privacy`, and `/terms` as shortcuts to those views.
- Align the home page browser title with the headline used in link previews.
- Fix the home page headline so its highlighted phrase uses the same letter-spacing as the rest of the line.

## 0.1.3.3 — 2026-10-16 — Daily priorities and follow-up reliability

- Rank the daily queue and playbook consistently using due follow-ups, recent posting dates, active roles, mapped contacts, and target score. Keep paused and network-only companies out of daily outreach suggestions, and exclude roles marked not relevant.
- Explain why each lead appears and provide direct review links in the daily hero, playbook, and queue. Due tasks now populate the dashboard follow-up queue, and completed tasks stop contributing urgency.
- Reject invalid follow-up due dates with a clear validation error instead of silently scheduling tomorrow or rolling impossible dates into the next month.
- Keep task versions advancing through rapid rescheduling, completion, and reopening so stale edits cannot overwrite newer work.

## 0.1.3.0 — Progressive imports and follow-up workflow (2026-10-08)

- Publish each completed ATS source while other checks continue, with timing and a link to available roles. Failed and incomplete sources retain the existing closure safeguards.
- Add workspace Relevant / Not relevant feedback, clear actions, a feedback filter, saved-search support, and guidance to refine saved title exclusions. Feedback survives reimports and stale snapshot writes; concurrent edits return a conflict.
- Export pending, dated follow-ups as an escaped, UTF-8-folded calendar snapshot with stable event IDs. Add private opt-in daily email reminder preferences, verified-recipient checks, bounded delivery scans, and provider idempotency with durable daily deduplication. No new database migration.
- Add operator customer-growth cohorts for confirmed subscriptions and returns during days 7–13 after signup, reported after the full 14-day window. Exclude demo workspaces, internal owners, reserved test domains, configured test inboxes, and test Stripe events.
- Publish a captioned 30-second recruiter sample walkthrough and prepare organic/ad copy pointing to the free ATS audit. No posts or paid ads were launched.
- Verify signup, verification, single-use email recovery, test-provider checkout, paid login, portal access, and cancellation as one isolated fixture journey. Actual Resend delivery and separate Stripe test-environment verification remain pending configuration; see docs/EMAIL-AND-STRIPE-TEST-SETUP.md.

## 0.1.2.9 — 2026-10-08 — Acquisition walkthrough

- Added an accessible three-step public sample showing hiring signals, imported contacts, and reviewed outreach drafts.
- Kept job-search visitors in job-seeker signup from the preview, retaining acquisition context.
- Improved contrast in the landing-page product facts strip and prepared tracked campaign drafts.
- Patched the CSV parser and development dependency audit findings.
- Preserved the live People, follow-up, saved-work, billing, and role-search workflows; no schema or configuration changes.

## 0.1.2.6 — 2026-09-09 — Partial import recovery

- Retain successfully fetched pages when a later ATS request or final verification fails; explicitly flag incomplete coverage and preserve unseen jobs.
- Respect long Retry-After cooldowns by deferring the refresh instead of retrying earlier than the source requested.
- Add failed-page counts and readable recovery reasons without changing focus or job-selection settings.

## 0.1.2.5 — 2026-09-08 — Import coverage and historical listing cleanup

- Continue bounded pagination after isolated duplicate rows, while still stopping fully repeated pages and preserving unseen jobs on incomplete feeds.
- Mark recognized historical static collection-page listings inactive during refresh; retain records and skip saved pipeline entries.
- Add provider-level Canadian coverage and import freshness diagnostics, plus an isolated public TD source check.

## 0.1.2.4 — 2026-09-08 — Durable focus saves

- Wait for saved focus and recalculated scores to finish persisting before reporting success, including persona changes.
- Return retryable feedback if storage fails instead of claiming the shortlist is ready.
- Serialize workspace saves and drain already-running writes during graceful shutdown.
- Preserve existing styling, search preferences, records and API success payloads; no migration or bulk cleanup.

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
