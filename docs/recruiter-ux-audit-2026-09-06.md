# Recruiter workspace audit and redesign

Date: 6 September 2026. Baseline: `64aa9d7` / application 0.1.1.1.
Status: audit and implementation brief written **before product-code changes**. Core redesign implemented; final review added 7 September 2026. Hosted 0.1.2.0 was subsequently deployed and verified; see the [release record](recruiter-workspace-release-2026-09-07.md).

## Executive judgment

The current application is a company/hiring-signal tool with a contacts table attached. It is not yet a convincing LinkedIn companion for a recruiter working through people for several hours. Changing the palette alone would polish the wrong hierarchy.

Preserve the useful foundations: CSV import, tenant-scoped storage, source links, company/job context, existing manual outreach logging, saved job stages, follow-ups, billing/privacy controls, and the recently improved ingestion diagnostics. Build the daily experience around **People → review in context → notes / preparation → next person**. Retain company business-development tools as secondary functionality, not the default lens through which every person must be viewed.

“People” is deliberately more accurate than “Candidates”: a LinkedIn connections export contains colleagues, potential candidates, and hiring contacts. Do not automatically infer candidacy or suitability from a job title. The present data does not establish a full employment history, skills evidence, consent to contact, availability, or candidate fit. Missing data must remain visibly missing.

This is an expert heuristic audit supported by code inspection, rendered browser inspection, synthetic journeys, and automated accessibility checks—not interviews, a usability study, a conversion experiment, or evidence that customers will pay. Recruiter validation is still necessary.

## Method and coverage

Local cloud server on port 8791, explicitly in-memory with no production database. Desktop Chromium 1440×1000, tablet 1024×768, mobile 390×844. Separate demo and synthetic first-run workspaces. No real messages sent, no customer data changed, no billing action taken.

The interactive browser connection was unavailable. Used the repository's installed headless Playwright harness to inspect actual rendered pages and save screenshots. Installed Windows desktop behavior, real LinkedIn navigation/session behavior, external payment/email delivery, live ATS imports, screen-reader speech, and touch-device ergonomics were not validated in this audit. Do not equate the hosted iframe review with those checks.

Evidence images are local, ignored test artifacts under `artifacts/recruiter-ux-audit/before/`. References below are relative to this document. Source symbols are stable references even when later edits move line numbers.

| Area | Inspected states / evidence |
|---|---|
| Public/auth | Landing `01`, signup `28`; auth implementation and existing browser tests inspected. Password-reset delivery and payment checkout not executed. |
| First run | Workspace `29`, watchlist `30`, CSV `31`, launch `32`, empty home `33`; skipped optional inputs and completed a synthetic signup. |
| Navigation | Sidebar, topbar, overflow menu, route dispatch, breadcrumb behavior, shortcuts `13`; legacy contact outreach changes route to company. |
| Home/company | Dashboard `02`, companies `07`, company detail `06`; existing company notes/actions/source/job sections inspected. |
| People | Table `03`, edit `04`, outreach `05`, filtered empty `24`, true empty `36`, tablet `26`, mobile `25`, batch preparation `27`. |
| Failure/loading | Intercepted local contacts response with HTTP 503; `37` shows error alert over a permanent loading skeleton. Loading captured in `38`. Initial fixture attempt hit the read cache; subsequently invalidated it before testing. |
| Hiring activity | Jobs `08`, filters/pipeline/contact/context action markup. Live geography/source correctness remains covered by existing ingestion tests, not re-established by this visual audit. |
| Follow-ups | Tasks `09`, pending/completed grouping, creation form and existing handlers. |
| Settings | Overview `10`; search focus, billing, coverage, background jobs, ATS records/new config, review queues, runtime (`settings-*.png`). Admin analytics data access was not exercised. |
| Dialogs/tools | Import `11`, export guide `12`, templates `14`, objection `15`, draft assistant `16`, radar `17`, call `18`, graph `19`, plan `20`, pitch `21`, pricing `22`, referral `23`, support `34`, privacy `35`. Privacy destruction not executed. |
| Accessibility | Axe WCAG 2 A/AA, 2.1 A/AA, 2.2 AA scan with contact edit expanded: critical unnamed `select`. Escape close observed for dialogs. Complete keyboard/screen-reader audit remains a validation item. |

## Architecture and constraints

- Shared vanilla JS frontend: `app/index.html`, `app/app.js` (~772 KB), `app/styles.css` (~281 KB), `app/palette.css` (~21 KB), `app/local-api.js`. It serves both hosted and Windows-local paths. Avoid a framework migration as a prerequisite to usable screens.
- Hosted shell: `saas/public/index.html` (~134 KB with inline JS) and `cloud.css`; same-origin iframe hosts the shared app. Two headers plus trial/demo banners consume vertical space.
- Backend: `saas/src/server.js` routes, `store.js` persistence/query orchestration, relational read/write modules and legacy compatibility. Current entities are companies, contacts, jobs, tasks, activities—not full candidate profiles or recruiting projects.
- Contact records already support identity, role/company, email/LinkedIn link, connection date, source, outreach stage, notes and an employer/title-related priority score. Use that durable contract first. Do not put simulated CVs or opaque candidate ratings into the UI.
- Exact interaction bottlenecks: `app/app.js::renderContactsView` destroys the list for each filter and emits a large hero; `openOutreachForContact` navigates to `#/accounts/:id`; `renderAccountsView` places multiple strategic widgets before the table; `renderJobsTable` emits several chips, contacts, and studio actions per row. `renderRoute` does not support a person detail.
- Scope reads/writes. Single-person saves must patch one record and update the visible row/panel, not reload bootstrap. Add timing around the changed list/detail path. Native tables are preferable to an incomplete custom ARIA grid.

## Ranked findings

Severity: P0 = trust/core workflow blocker; P1 = substantial daily friction; P2 = polish or supporting-path friction. Effort S/M/L is relative, not a delivery estimate.

| # | Severity / effort | Problem, impact and exact evidence | Recommendation |
|---|---|---|---|
| 1 | P0 / L | No person/profile workspace. Names are plain text; inline edit only exposes stage and one-line notes. No rapid review, correction or next-person journey. `renderContactsTable`; [table](../artifacts/recruiter-ux-audit/before/03-contacts.png). | Introduce a real master-detail People workspace with identity first, source-aware facts, multiline notes, editable contact details, previous/next and preserved list state. |
| 2 | P0 / M | Outreach leaves the people list for a company page; unlinked people have a disabled action. Opening then closing requires a separate return to Contacts and recovery of position. `openOutreachForContact`; [composer](../artifacts/recruiter-ux-audit/before/05-contact-outreach-context-switch.png). | Prepare person-specific outreach in the detail panel, without requiring a company. Explicit manual copy/send/log; no automatic sending or fabricated personalization. |
| 3 | P0 / M | Scripts claim “2 pre-vetted” candidates and 30-day openings without evidence; pitch template says “Verified & Available.” These are not cosmetic defects: they can damage recruiter credibility. `OBJECTION_*`, call studio, pitch deck; [call](../artifacts/recruiter-ux-audit/before/18-call-studio.png), [pitch](../artifacts/recruiter-ux-audit/before/21-pitch-deck.png). | Remove unsupported assertions, visibly label blank/example material, demote these optional legacy tools. AI/template output must never visually outrank source facts. |
| 4 | P1 / M | Current IA and default home reflect sales account management. Sidebar, “Staffing BD,” revenue widgets, account “battle plans,” and admin language contradict the requested product identity. [companies](../artifacts/recruiter-ux-audit/before/07-companies.png). | People as recruiter home; Follow-ups adjacent; Companies/Hiring activity/Overview secondary; Settings utility. Keep legacy routes and job-seeker workflows functional. |
| 5 | P1 / S | First contact row starts ~581 px down a 1000 px window (481 inside iframe + 100 shell). On mobile it starts ~965 px down an 844 px window. Multiple headings describe the same list. [desktop](../artifacts/recruiter-ux-audit/before/03-contacts.png), [mobile](../artifacts/recruiter-ux-audit/before/25-mobile-contacts.png). | Single compact toolbar, inline results count, one primary Add person action and secondary Import. First useful row targeted within 300 px desktop; no metrics hero. |
| 6 | P1 / M | Contact table wastes a large first column on checkboxes, has opaque score, no name navigation or sort controls. “Ready now” counts only the current page but appears global. `renderContactsView/Table`. | Fixed selection column; name/role dominant, company and stage secondary. Accurate result/pagination labels, server-wide sort/filter, contextual selection bar. Explain priority or remove from default columns. |
| 7 | P1 / S | Filtered-empty result says “No contacts in workspace yet,” offering import/sample instead of recovery. [filtered empty](../artifacts/recruiter-ux-audit/before/24-filtered-empty.png). | Separate true-empty, no-match, loading, failed-load, and stale/refresh states. Clear-filters action must be adjacent to no-match explanation. |
| 8 | P1 / M | HTTP 503 shows a global error while leaving “Loading relationship intelligence…” indefinitely. Global API copy tells cloud users to relaunch a desktop shortcut. `renderContactsView`, `local-api.js::getNetworkErrorMessage`; [error](../artifacts/recruiter-ux-audit/before/37-contacts-error.png). | End busy state, show a local retry action, preserve existing rows on refresh failure, and provide environment-appropriate wording. |
| 9 | P1 / M | Onboarding treats people import as optional step three after company watchlist; readiness requires companies/boards/jobs. Four post-signup actions were needed to reach an empty workspace. [onboarding](../artifacts/recruiter-ux-audit/before/30-onboarding-watchlist.png). | Offer an explicit recruiter quick start to People with import/manual add; make company/job configuration optional enrichment. Keep advanced guided setup available. |
| 10 | P1 / S | LinkedIn export guide promises under 30 seconds and 2–5 minute delivery; directs a selection not matching current official guide. Import implies complete network/company job coverage. [guide](../artifacts/recruiter-ux-audit/before/12-export-guide.png). | Link official export instructions, no timing guarantees, explain first-degree connection fields and missing emails. Separate import, employer matching and supported-board discovery outcomes. |
| 11 | P1 / M | Company table is below a full viewport of scoring quadrants, live wire and revenue kanban. Job rows contain repeated inferred skill/stack/signal chips and three studio CTAs before the recruiter can scan factual fields. [company](../artifacts/recruiter-ux-audit/before/07-companies.png), [jobs](../artifacts/recruiter-ux-audit/before/08-jobs.png). | Tables first. Put optional strategy and BD widgets behind a clearly named disclosure. Facts and one contextual review action in job rows; secondary intelligence on demand. |
| 12 | P1 / M | Contacts priority score is not candidate fit. Candidate templates, role “fit” and employer priority co-exist without enough conceptual separation. | Label job-match/relationship priority precisely; never imply candidate evaluation. Show “Not provided” for skills/history not imported. Real criteria/evidence evaluation is a separate future capability. |
| 13 | P1 / S | Expanded contact edit has a critical unnamed select; notes input label is also unassociated. Very small row links and multiple nested menus increase motor burden. Axe selector: `.contact-inline-form .inline-field > select`. | Associated visible labels; >=32 px desktop controls, 40 px touch targets; visible focus; input-safe keyboard handling; test expanded and failed states, not only default screens. |
| 14 | P1 / M | Selection/context is fragile across filtering/paging; no person identity in route; no comparison of actual people. Existing batch modal has useful next/previous patterns but is isolated. [batch](../artifacts/recruiter-ux-audit/before/27-batch-outreach.png). | Preserve query, scroll, selected identity and return focus. Compare 2–3 selected people on known facts, not guessed suitability. Clear or explicitly scope bulk selection when results change. |
| 15 | P2 / M | Visual system is a cascade of giant style files, repeated overrides and one-off studio styles. Cloud and inner app have different type/spacing. Dense tables compete with oversized cards and pill clusters. | Establish semantic tokens and scoped reusable workspace/table/panel/form/state components. Remove conflicting declarations incrementally; do not add another all-purpose override pile. |
| 16 | P2 / S | Overflow contains ~20 heterogeneous tools, pricing/referral, color cycling, sounds and operational actions. Repeated Import competes with every route's primary action. [shortcuts](../artifacts/recruiter-ux-audit/before/13-shortcuts.png), `app/index.html`. | One common search; utility menu for appearance/help/settings; grouped optional legacy tools; import contextual to People/empty state. Correct stale referral label. |
| 17 | P2 / M | Settings mixes ten operational, billing, role preference and developer configuration sections in a two-column landing page. Labels such as “Create config” and “runtime” are not recruiter tasks. | Secondary settings navigation/group headings: Recruiting preferences, Import & sources, Workspace & billing, Advanced diagnostics. Keep source-health/error recovery discoverable. |
| 18 | P2 / S | Trial badge + full trial banner + Upgrade compete with app content; landing text has a visibly washed-out trust strip. Public positioning promises BD outcomes rather than the actual companion workflow. [landing](../artifacts/recruiter-ux-audit/before/01-public-entry.png). | Compact non-dismissive subscription status; readable neutral surfaces. Align product copy with shipped functionality, avoiding a public promise of candidate evaluation until it exists. |

## Proposed information architecture

| Level | Destination | Behavior |
|---|---|---|
| Primary | People (`#/contacts`, preserve alias) | Default recruiter entry. Search/filter/sort table and an adjacent person panel. Person ID in hash query; close returns to unchanged list. |
| Primary | Follow-ups (`#/tasks`) | Due/overdue/completed work; retain existing task behavior. Person-specific due-date/task links need a durable relationship before promising an integrated candidate timeline. |
| Context | Person panel | Overview, notes/contact editing, outreach preparation. Verified/imported facts above recruiter-authored notes, then draft suggestions. Previous/next within visible results; explicit page boundary. |
| Context | Compare selected | Up to three actual records; name, role, company, source, stage, notes. No synthetic fit ranking. |
| Secondary | Companies (`#/accounts`) | Employer context and existing business-development records; table before optional strategy. Company detail remains a drill-down. |
| Secondary | Hiring activity (`#/jobs`) | Source-backed jobs, existing geography and role relevance filters and pipeline; job-seeker label remains Open roles. |
| Secondary | Overview (`#/dashboard`) | Optional hiring/BD summary, not obligatory first screen for recruiters. |
| Utility | Settings (`#/admin` aliases retained) | Preferences, sources, workspace, diagnostics. Billing/privacy/support keep current authorization boundaries. |
| Utility | Help / appearance / optional tools | Compact grouped menu; legacy generators explicitly templates, not verified intelligence. |
| Future, not empty navigation | Lists / Projects | Add only with durable memberships, saved criteria, tenant tests and actual workflows. Saved filters alone are not recruiting projects. |

### Primary journey specification

1. First run: open People, import connection CSV or add one person manually. Show source/field limits before import. Existing board discovery remains optional.
2. Search by name/role/company; submit with Enter, change stage/sort without an extra Apply click. Display result count and active query.
3. Open a name once. Keep list, filters, pagination and scroll. Desktop adjacent panel; small screen full-width detail with explicit Back to people. Name/current role, company and source facts first.
4. Read known facts, expand supplied employment history if present. Missing skills/location stay missing. Notes and editable contact fields have visible labels and save/error feedback.
5. Prepare a note beside identity. User-entered role/opportunity and recruiter text; no invented shared connection, availability, candidate achievements, or consent. Copying is not sending. Log outreach only after explicit confirmation that it was sent.
6. Move previous/next or return to list. Warn before discarding unsaved notes/draft. Open LinkedIn in a new tab; app context stays intact.

## Design system

See [recruiter-design-system.md](recruiter-design-system.md). The palette is a restrained design decision, not a claim that a study found a universally preferred color scheme. Accessibility, hierarchy and durable state patterns are more defensible requirements than popularity of a hue.

## Implementation sequence and acceptance gates

### Phase 1 — immediate usability and trust

High impact / low-to-medium effort: correct templates/export/referral copy; compact People list; distinguish empty/error states; accessible forms; demote company strategy and novelty actions; remove duplicate primary import/button hierarchy. Preserve existing endpoints. Gate: existing tests plus expanded-edit axe, no-match/retry screenshots, desktop/tablet/phone review.

### Phase 2 — core people-first redesign

High impact / medium effort: reusable People workspace module and semantic CSS; in-context person review/edit/manual outreach; query and detail URL state; sort/pagination and comparison of actual records; additive tenant-scoped detail query only where needed; People home/quick start and clear secondary navigation. No framework/backend rewrite. Gate: synthetic multi-page data, persisted edits on reload, no full bootstrap reload after save, no accidental send/log, keyboard/unsaved changes, context restoration, tenant isolation and legacy compatibility.

### Phase 3 — whole-app consistency and validation

Medium impact / variable effort: common type/control/table/feedback rules across jobs, companies, follow-ups, settings, dialogs and shell; compact job context; responsive drawer behavior; focus restoration and reduced-motion; loading/error checks; final route sweep. Gate: unit, syntax, browser regression, expanded-state accessibility, Chromium plus compatibility engines where installed, 1440/1024/390 screenshots. Document remaining architecture/product gaps explicitly.

### Deferred product work (do not simulate it)

Full candidate evidence/history ingestion, user-defined evaluation criteria with corrections/provenance, persistent recruiting projects/lists, contact-linked tasks/timeline, collaborative review, and LinkedIn extension capture require validated data/permission contracts. Validate priorities with 5–8 working recruiters on “find → review → note → prepare → next,” measuring completion/errors/context loss rather than asking only about aesthetics. No promise of willingness to pay without that evidence.

## Research references used narrowly

- [LinkedIn: export connections](https://www.linkedin.com/help/lms/answer/a566336): current archive workflow; connection data does not guarantee email availability. No fixed delivery-time promise.
- [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): focus containment, Escape and return focus for modal overlays. Desktop non-modal master-detail should not trap focus.
- [W3C target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum): WCAG 2.2 minimum 24×24 CSS px or qualifying spacing/exceptions; choose larger default controls.
- [W3C grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/): a custom interactive grid entails a full keyboard contract. A semantic table with ordinary buttons/links is safer here.

## Final review

### Outcome

The hosted application now has a coherent daily People workflow: add/import → find → review beside the list → correct details/save notes → prepare outreach → move to the next person. It no longer requires every person to belong to a company before outreach preparation works. This is a material workflow improvement, not simply a palette change.

The broader product is **not yet a complete candidate evaluation platform**. The redesigned workspace is suitable for recruiter pilot testing; this audit does not establish product-market fit, paid conversion, or production database performance. The Windows-local renderer and several secondary BD workflows remain legacy experiences.

### Comparison with the original findings

| Findings | Result | Remaining limitation |
|---|---|---|
| 1, 2: person review and outreach | Implemented hosted master-detail review, source facts, multiline notes, contact correction, independent manual add, previous/next, manual outreach preparation. | No CV/skills ingestion, candidate-linked task history or saved drafts. |
| 3, 10: trust and import guidance | Removed the audited invented candidate/availability/achievement assertions; labeled templates; corrected archive guidance and import expectations. | No new live LinkedIn or ATS coverage claim; additional generated material still requires human verification. |
| 4, 9, 16: people-first IA | People is the authenticated recruiter home; Follow-ups primary; company intelligence secondary; quick start bypasses optional company setup; optional BD tools grouped; duplicate Import and novelty appearance/sound controls deemphasized. | Demo still opens the existing Overview. Brand, public positioning and some company terminology still say BD Engine. Job-seeker and advanced setup flows retained. |
| 5, 6: density and tables | Compact People toolbar, fixed selection column, semantic sticky headers, server-wide sort/filter, accurate pagination, contextual bulk actions. | No column resizing, custom columns or durable saved People views. Desktop first-row target of 300 px not fully met. |
| 7, 8: states and recovery | Separate true-empty/no-match/error/loading states; clear filters and retry; failed saves retain input; failed refresh retains prior results. Hosted network error copy corrected. | A full offline product is not promised. Legacy Windows contacts still use the old empty-state layout. |
| 11: secondary-screen clutter | Company strategy and optional row tools collapsed; job context and people hidden behind disclosures; desktop job filters fit one row. | Companies still have large ranking/portfolio guidance. Hiring activity filters remain too tall on phones; job/company details are not fully restructured. |
| 12: misleading assessment | Removed score from default People table; priority explicitly employer/title-related; job column says Role match; missing evidence is visibly missing. | Criteria-based candidate assessment needs a real evidence model and correction workflow. It was not simulated. |
| 13, 14: accessibility and context | Labeled new/legacy contact controls, native add/compare dialogs, keyboard previous/next, unsaved-change protection, scoped selection, actual-record comparison, query/person deep links and full-reload restoration. | Screen-reader speech and physical touch/keyboard ergonomics still need manual testing. Comparison remains page-scoped and limited to three people. |
| 15, 17, 18: consistency | Shared neutral/teal workspace tokens, compact controls, restrained table/panel styles, dark-mode states, smaller hosted chrome, Settings jump navigation, readable public trust strip. | Large legacy stylesheets are not fully consolidated. Public auth/ATS utilities retain older palette layers; Settings/Overview still contain operational and BD-heavy sections. |

### Rendered evidence and measurements

- People first row at 1440×1000: **581 px → 351 px** from the top of the outer browser viewport, approximately 230 px reclaimed. At 390×844: **965 px → 450 px**, approximately 515 px reclaimed. Measurements include the hosted chrome and demo notice; a paid workspace without that notice will differ. These are layout measurements, not measured recruiter time savings.
- `app/app.js::renderContactsView` previously destroyed list context for review/outreach. `app/people-workspace.js::render` now preserves the current results when opening a person; `savePerson` patches one record and updates its row and identity facts without a bootstrap reload. A five-run local synthetic list-navigation check measured a 35 ms median before and 32 ms after. This tiny sample does **not** demonstrate a meaningful performance improvement; the verified gain is preserved context and scoped saves.
- `saas/src/relational-reads.js::findTenantContactsRelational` uses bound ID/search/stage/score filters and allowlisted ordering. Slow-query timing is included. SQL construction is unit-tested; **live PostgreSQL execution, collation parity and scale performance were not verified** in this in-memory UX run.
- Actual rendered review covered 1440×1000, 1024×768 and 390×844, plus light/dark states. The new browser journeys also scan expanded contact fields at widths 1440/1024/390 with a 1000 px height.

Final screenshots (local ignored artifacts): [People desktop](../artifacts/recruiter-ux-audit/after/final-people-desktop.png), [person desktop](../artifacts/recruiter-ux-audit/after/final-person-desktop.png), [dark person](../artifacts/recruiter-ux-audit/after/final-person-dark.png), [tablet person](../artifacts/recruiter-ux-audit/after/final-person-tablet.png), [People phone](../artifacts/recruiter-ux-audit/after/final-people-mobile.png), [phone person](../artifacts/recruiter-ux-audit/after/final-person-mobile.png), [compare](../artifacts/recruiter-ux-audit/after/final-compare.png), [add person](../artifacts/recruiter-ux-audit/after/final-add-person.png), [no matches](../artifacts/recruiter-ux-audit/after/final-filtered-empty.png), [recoverable failure](../artifacts/recruiter-ux-audit/after/final-load-error.png), [companies](../artifacts/recruiter-ux-audit/after/final-companies-desktop.png), [hiring activity](../artifacts/recruiter-ux-audit/after/final-jobs-desktop.png), [phone hiring activity](../artifacts/recruiter-ux-audit/after/final-jobs-mobile.png). Supporting Settings and Follow-ups images are `after/route-admin.png` and `after/route-tasks.png`.

### Regressions caught and corrected during implementation

1. Wrapped form labels included control contents in their accessible names. Replaced them with explicit associated labels; added expanded-form axe and exact-label interaction tests.
2. Correcting identity initially refreshed the name but not the displayed email/profile link. Those facts now update without replacing the form or losing focus. Draft greetings use the corrected name.
3. Full browser reload originally returned to Overview. The hosted shell now preserves the iframe's current route, query and person identity in the outer URL; analytics excludes the query portion.
4. Legacy async renders could overwrite a newer route after a slow response. Main list/detail/settings/task renders now check a shared render generation and current route before painting. A deterministic delayed-response journey exercises Overview, jobs, companies and Settings while switching to Follow-ups.
5. Tablet header controls wrapped into a second row. The workspace-mode switch moves to the utility menu at that breakpoint; the rendered tablet header is now 69 px high and has a regression assertion.
6. New dark-mode surfaces exposed a low-contrast success treatment. Updated dark semantic colors and reran rendered contrast checks.
7. Existing job-table CSS assigned a 210 px minimum to the checkbox column. The compact width is now scoped only to selectable tables so embedded tables keep their Role column.

No known failing core journey is being intentionally accepted as a redesign feature. Persistent limitations are listed above rather than hidden behind compilation success. One earlier Firefox run had a browser-harness response-binding timeout; the clean rerun result is recorded below.

### Final validation record

- Unit suite: **369 passed**, including contact filtering/sorting, tenant isolation, validation, SQL bindings, route manifest and new asset/trust guards.
- Syntax checks and ESLint: passed. New standalone People script also parses in a unit test; shell and service-worker asset versions match.
- Full Chromium browser suite: **72 passed** in the final clean run (2.0 minutes).
- Cross-engine People + compatibility suite: **21 passed** in the final clean run (1.0 minute), covering Chromium, Firefox and WebKit. The earlier Firefox response-binding timeout did not recur.
- Automated checks include no-match recovery, save/load failures, unlinked manual add, corrections, comparison, copy-does-not-send, unsaved draft protection, page-two context, full browser reload, no bootstrap read on save, expanded-state axe and responsive overflow.
- Earlier broad runs caught real route races and were not dismissed as test flakiness. Existing billing/privacy/job-ingestion regressions remained in the suite. No customer messages, real payment transactions, production database writes, or deployments were performed for this redesign.

### Recommended next release gate

The PostgreSQL query and parity gate was subsequently completed using SELECT-only production fixtures because no staging environment was configured. Hosted 0.1.2.0 is now deployed; see the [release record](recruiter-workspace-release-2026-09-07.md) for exact checks, backup, limitations and rollback.

Next, validate import → People → save → reload with representative tenant sizes in an isolated staging workspace, then conduct recruiter task sessions. Prioritize saved People views/lists, contact-linked follow-ups, evidence-rich candidate profiles and mobile hiring filters. Public marketing should describe only the functionality that ships. This implementation has no schema migration, no new framework/dependency, and no replacement of working ingestion logic.
