# Recruiter design system

Implementation brief, 6 September 2026; look revised 14 November 2026 (Refined teal, chosen by the owner from three directions; it replaced the Bold dark look of 13 November). Scope: shared app + cloud shell. See the [baseline audit](recruiter-ux-audit-2026-09-06.md).

## Foundations

- Self-hosted Inter throughout; headings and headline numbers use heavier weights and slightly tighter tracking (`--font-display` is Inter). No third-party font requests. Body 14px/1.5, data/helper 12–13px/1.45, row name 14px/600, panel title 18px/650, page title 22px/700. Large numerals are welcome where a number is the point (counts, scores); avoid uppercase paragraphs and promotional slogans.
- Spacing: 4, 8, 12, 16, 20, 24, 32. Desktop page gutter 24px; compact 16px; mobile 12px. Row height target 60–72px for name+role, not fixed if content must wrap. Avoid six different near-identical paddings.
- Light is the default theme (Refined teal): canvas #f3f6f7, surface and sidebar #ffffff, text #18232f, muted #526272, border #d5dce2 (strong #b8c4cd), one accent teal #0f6b65 (hover and selected text #0b5550) with white text on it, selected #e7f3f1. Flat surfaces: one hairline border, 8px corners, no drop shadows except overlays. The brand mark is a flat teal tile with a white BD. The signed-in shell keeps a slim slate bar (#18232f) with soft teal account notices. Dark remains available with the navy/teal palette: canvas #10191f, surface #17232b, text #ecf2f5, muted #a7b8c3, border #344650, accent #80d4c5 with #102923 text on it, selected #203d3b. One accent per theme; a second hue only for a status that also carries text. Validate actual computed combinations, not just token swatches.
- Semantic success/warning/error must pair color with text/icon; no red/green-only decision indicators. Candidate fit is not a color inferred from seniority or employer prestige.
- Border radius: 6px controls, 8px panels/dialogs, no pill-shaped paragraph containers. 1px borders and very limited elevation for overlays only. No gradients, glass or decorative animation in working surfaces.

## Layout and navigation

- Desktop rail ~196px; common topbar 60px; main list flexes, detail 380–440px. At intermediate width keep list usable with horizontal table scroll or show detail as full-width drill-down. At <=760px use full-width detail with Back and previous/next.
- Primary navigation before supporting tools. Selected state: tinted background + weight + `aria-current=page`. Utility menu grouped, not a 20-item wall.
- One heading per workspace, one primary creation CTA. Use toolbar/text subheads instead of nested cards. Company strategy is an optional disclosure above/below list, closed by default.

## Components and interaction contracts

| Component | Contract |
|---|---|
| Buttons | Primary = one next action; secondary = import/save alternatives; ghost = contextual navigation; destructive only for actual deletion. 32px desktop / 40px touch minimum default height. Text verbs, no emoji-only controls. Disabled reason nearby. |
| Forms | Visible associated labels; 36px controls; textarea for notes; concise help beneath field; invalid messages adjacent; Enter submits ordinary filters; submit locks while saving; show saved / failed without replacing whole page. |
| Table | Semantic table, scoped headers, fixed 40px selection column, name opens detail, sticky header in scroll container, explicit `aria-sort`, context-labeled selection. No nested button soup. Secondary facts in subdued text, never low-contrast essential data. |
| Filtering | Search clear button, stage and sort controls; results count matches current server result; filtered-empty has Clear filters. URL includes query/page/selected person; changing criteria resets to page 1. |
| Selection | Select page explicitly, count selected, compare 2–3, export or prepare actions only while selected. Explain selection scope. Never treat Copy as Sent. |
| Detail | Name/role/company, safe external profile link, source/known facts, notes/edit, outreach. Unknown fields visibly absent/not provided. Previous/next within visible page; return maintains position. |
| Compare | Actual selected records only. Fixed comparable labels, missing-data placeholders, no invented winner or fit percentage. Accessible close/return focus. |
| Status | Human-readable outreach stage, not a claim about candidate quality. Use consistent badge vocabulary across table/panel. |
| Modal | Only for short interrupted tasks (import, add, compare, confirmation). Labeled dialog, focus contained and restored, Escape, viewport-bound scroll. Non-modal desktop person panel leaves list keyboard-accessible. |
| Empty | First-use = add/import action; no matches = explain active filters + clear; missing optional field = plain “Not provided”; no giant illustrations. |
| Loading | Table/panel-shaped skeleton or inline refresh state, `aria-busy`, status text; no fake percentages. Keep existing data on refresh failure. |
| Feedback | Inline save state stays close to form; local error with Retry; optional toast supplements it. Success never implies external delivery. |
| Focus | Clearly visible 2px ring + offset; not obscured by sticky toolbar. Do not steal focus on background refresh. Ignore navigation shortcuts in inputs, selects, textareas and contenteditable elements. |

## Consolidation rules

Keep existing shared primitives (`renderField`, pagination, safe links, escape helpers, global dialog lifecycle) where correct. Move new People behavior out of the monolithic renderer into a bounded reusable module. Use semantic tokens and component-scoped selectors. Avoid adding a new framework or loading all contacts for client-only global filtering. New server query/detail behavior must work for both relational and in-memory paths, with tenant isolation and bounded page size.

Saved view definitions, if implemented, must be explicitly device-local or use an authorized durable preference contract. Do not present local browser state as shared workspace storage. Full recruiting projects are not simulated with tags or templates.
