# People workflow reliability pass

Scope: incremental fixes to the existing hosted People workspace. No visual redesign, dependencies, schema changes, or API contract changes.

## Changes

- Add-person dialogs protect entered details on Cancel, Escape and page unload. During a save, controls are locked and closing is prevented; failures retain input and allow retry.
- Confirming discard before opening Add person restores saved notes in the underlying panel instead of leaving abandoned edits visible without a dirty guard.
- Changing result pages or search criteria resets list scroll; reviewing someone within the same results preserves it.
- Retrying a read no longer invalidates list identity before the user accepts discarding edits.
- Mark as contacted locks the stage selector and competing save action while pending. Notes remain editable and are retained.
- Added three regression journeys, a deterministic iframe-ready wait, and responsive screenshot artifacts. Added timing instrumentation to the add-person request lifecycle.

## Validation

- 369 unit tests passed.
- Full Chromium suite: 75 journeys passed.
- Focused People suite after test-helper correction: 18 passed across Chromium and WebKit.
- Lint, syntax checks, schema contract and diff whitespace checks passed.
- Automated accessibility and overflow checks passed at 1440, 1024 and 390 pixels. Desktop and phone screenshots inspected; existing design retained.
- Firefox could not create a test page (`browserContext.newPage` / undefined `_page`); no Firefox compatibility claim for this pass.
- Production container build not run: Docker is unavailable. This vanilla-JavaScript application has no separate bundler/type-check build step. The actual Node server and served frontend ran in the browser harness.
- No production deployment or customer data mutation in this pass.

## Separate follow-up areas

The original pass identified stale in-flight GET caching and last-write-wins contact edits. The follow-up below addresses stale caching and unintended overwrites of untouched fields; simultaneous edits to the same field still need contract-level conflict handling.

## Follow-up: cache invalidation and partial saves

- Reproduced three stale-read failures before changing `app/local-api.js::remoteApi`. Invalidations now detach in-flight requests. Only the current request may populate or remove its cache entry. Existing callers still receive their responses; no cancellation or full workspace reload is introduced.
- Forced reads retire cached and pending results for their own path, without clearing unrelated paths. Forced reads remain uncached, as before.
- People sends only fields changed from the rendered form baseline. A note edit therefore no longer overwrites a title/email edited elsewhere. Successful responses reconcile form fields with server-normalized values without replacing the form or moving focus. Explicit clearing remains supported; empty updates make no request.
- Seven cache unit cases cover deduplication, isolated copies, explicit/mutation invalidation, completion ordering, failures and forced reads. Two browser regressions exercise delayed pre-save responses and independent edits against the real local server.
- This is a correctness fix, not a claimed latency optimization. Existing person-save timing instrumentation remains in place.
- Follow-up validation: 376 unit tests passed; all 77 Chromium cases reported passing and 11 WebKit journeys passed. The Chromium runner stalled during local server teardown after all cases completed and was stopped; WebKit exited successfully. Lint, syntax, schema checks and responsive accessibility assertions passed. Desktop screenshot reviewed. Docker remains unavailable; Firefox was not revalidated in this follow-up.
- Remaining limitation: two users editing the same field still use last-write-wins semantics. No schema/API migration or production deployment was performed.

## Follow-up: trustworthy search recovery

- List fetches retire the previous displayed query and reuse the existing loading skeleton. Previous rows, pagination and editable details no longer remain actionable while a different query is pending or failed.
- Errors preserve the requested URL for retry and offer an explicit Show all people action. Failed queries cannot reuse an old successful list identity.
- Empty results on an outdated page link normalize to page one, retaining the search rather than displaying an impossible page number.
- Added browser regressions for pending/failed searches, repeated retries, return-to-all recovery and empty stale pagination. The search-error test also checks mobile accessibility and overflow and captures a screenshot.
- Same-list person navigation and existing unsaved-change confirmation are retained. No styling, dependencies, backend or API changes.
- Validation: 376 unit tests passed; all 79 Chromium cases reported passing (runner again required stopping after its teardown stalled). Both new recovery cases passed in WebKit with a successful exit. Lint, syntax, schema and whitespace checks passed. Mobile error screenshot inspected; accessibility and overflow checks passed. No deployment or production container build performed; Docker remains unavailable.
