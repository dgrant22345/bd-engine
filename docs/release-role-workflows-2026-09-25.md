# Role workflow improvements — 2026-09-25

## Changes

- Source discovery and live imports report completed checks while other sources are still running. Counts distinguish found, review-needed, unmatched, incomplete, and failed checks. Fetch counts are explicitly separate from jobs kept within import geography.
- Named role searches reuse private, optimistic-versioned saved-work storage. People views remain separate; no migration or new dependency. Results use the current saved focus rather than a snapshot of jobs or scoring rules.
- Last applied filters restore locally by workspace, user, and persona; page positions are not persisted. Storage failures do not prevent viewing roles. Read-only demos do not persist private searches.
- Applied filters can be removed individually using keyboard-accessible chips, preserving sibling filters and sort order.
- Trial and recovery notices share a compact strip. Limits and recovery explanations remain available in native disclosures. Recovery dismissal and account-menu access are preserved.
- Asset version: `20260925-role-workflows-01`.

## Validation

- 416 Node tests passed; lint, JavaScript syntax checks, schema contract and diff whitespace checks passed.
- Full Chromium suite: 122 passed; one old assertion expected the grammatically incorrect “1 results.” Corrected that assertion and reran the pipeline workflow successfully. Final targeted role-search/recovery rerun also passed.
- Jobs/help/filter/search/recovery coverage passed in Firefox and WebKit. Shared-server recovery rate limiting affected the second engine's repeated password resets; an isolated WebKit rerun passed. Production rate limits were not changed.
- Inspected actual rendered screenshots at desktop and phone widths; light/dark Jobs layouts and keyboard filter removal covered by browser tests.
- Discovery timing fixture: 181 ms before, 182 ms final; no outstanding requests after completion. Progress callback timing is recorded independently. This is progress visibility, not a speed optimization.

## Deliberately unchanged

Source approval, geography inclusion, role matching/scoring, payment configuration, customer records, and the overall design language. External careers sites can still be slow or unavailable. A real paid purchase remains an owner-performed acceptance test; no charge was initiated.
