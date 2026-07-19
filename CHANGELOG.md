# Changelog

All notable customer-facing changes are recorded here. The project is currently in pre-1.0 commercial hardening.

## Unreleased

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
