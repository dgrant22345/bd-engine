# People review UI — 2026-09-24

## Scope

An incremental improvement to the hosted People workspace, not another redesign. The existing palette, navigation model, backend, API contracts, and data remain unchanged. No dependencies or paid AI services were added.

## Improvements

- Keep the person's name, role, company, and position in the current result page together while reviewing a desktop profile. The header returns to normal scrolling if it would consume more than half the panel; mobile retains the existing single-column layout.
- Add compact Overview, Notes, Prepare outreach, and Activity shortcuts. They scroll and move keyboard focus within the current profile without reloading the list or discarding unfinished notes, messages, or follow-ups. Activity opens its existing disclosure automatically.
- Use the existing outreach action rather than a second composer or duplicate action. Failed draft loads focus the explanation; retry preserves notes and existing draft protections. A slow draft response cannot pull focus back after the user chooses a different profile section.
- Arrange contact corrections in two columns when space permits, with one column on narrow screens. Retain the shared company-link controls and their existing save semantics.
- Improve activity section spacing and align the profile header with its content on tablet layouts. Scroll targets stay below sticky controls, including wrapped names and short windows.
- Refresh the shared asset version to `20260924-people-review-01`.

## Validation

- ESLint, JavaScript syntax checks, and schema-contract checks pass.
- All 414 Node tests pass.
- Full Chromium workflow suite: 118 tests pass, followed by the additional delayed-response regression below.
- Five new regression scenarios pass across Chromium, Firefox, and WebKit (15 checks): context/data preservation, responsive long profiles, keyboard/dark-mode accessibility, failed outreach recovery, and focus preservation during a delayed response.
- Reviewed rendered light/dark screenshots at 1440, 1024, 390, and 320 pixels, plus a 1440 × 640 short-window case. Local browser inspection used synthetic demo data.
- Accessibility scans reported no WCAG A/AA violations in the tested profile states. This is automated coverage, not a comprehensive accessibility certification.
- Firefox test diagnostics established that Axe's temporary frame takes focus during analysis. Keyboard assertions now run before that scan; no speculative production focus workaround was retained.

Local visual evidence: `artifacts/people-ui-final/`. Full regression output: `artifacts/people-ui-release-verified/`.

## Deliberately deferred

- Consolidating the first-run trial/recovery banners, which still occupy substantial space on small screens.
- Whole-batch ATS discovery progress and time budgets. Existing per-company deadlines can still yield minute-long batches; that deserves a dedicated data-flow pass rather than a cosmetic loading indicator.
- Early production startup logs showed `saas/src/store.js::findActivities` and `findTasks` taking roughly 1.4–2.1 seconds, largely in `ensureDataLoaded`. Profile cold/scoped reads before proposing a performance fix; this observation is not a steady-state latency benchmark.
- No new marketing claims, profile scoring, AI integrations, subscription changes, or production customer-data edits.

## Deployment verification

- Source commit: `df80cbd` on `agent/paid-product-quality-audit`, pushed to origin.
- Railway deployment: `8ab81dc6-30dc-4975-a1ec-a4643ffcfc79`, status **SUCCESS**, created 2026-09-25 00:15 UTC (September 24 in Toronto).
- Production Docker build completed; production dependency audit reported zero known vulnerabilities.
- All eight non-customer-mutating production smoke checks passed.
- Confirmed the released `20260924-people-review-01` asset in the live synthetic demo. Reviewed the profile header, Activity shortcut, company-specific outreach choices, and return to Overview without changing the profile URL. No new production browser errors appeared during this inspection.
- No customer records, subscriptions, or outreach messages were changed during live validation.
