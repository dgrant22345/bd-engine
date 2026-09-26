# Workspace mode and mobile menu release

Source commit: `67d97f9`.
Railway deployment: `5b1199b6-dd66-4191-9507-409493517b13` — SUCCESS.
Asset version: `20260925-mode-clarity-01`.

## Changes

- Make the desktop workspace mode button visibly interactive and describe the current/destination modes accessibly; mobile menu uses the same description.
- Guard concurrent switches across both controls and tolerate unavailable browser storage after the server saves the preference.
- Preserve the open People editor and unsaved notes instead of rerendering it on a mode change.
- Fix the mobile overflow menu: the legacy refresh button's grid placement created implicit columns and overlapping text. A vertical flex layout makes all entries full-width.
- Remove unsupported ATS coverage, verified-role, and immediate LinkedIn-export claims from in-app guidance.
- No API, data migration, billing, or overall design changes.

## Validation

- 416 Node tests passed; lint, syntax checking and schema contract passed.
- Six new browser checks passed across Chromium, Firefox and WebKit, covering blocked storage, pending controls, retained notes, mobile menu geometry, request failure and retry.
- Existing mode-persistence and job-seeker journey checks passed across the same engines. Firefox initially stalled waiting for the outer page's full load event; the test now waits for DOM content plus the actual rendered iframe/mode assertions, and its rerun passed.
- Inspected desktop and 390px mobile screenshots. The screenshot review found the overlapping mobile menu; subsequent screenshots confirm the correction.
- Eight read-only production smoke checks passed. Mutating checks deliberately skipped; no customer data or payments changed.
- Production serves all seven references to the new asset version and the corrected menu CSS.

No performance improvement claim: fixture mode-switch timings include an artificial 400ms request delay and are not production benchmarks.
