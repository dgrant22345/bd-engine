# More natural outreach — November 14, 2026

The requested problem was generic, robotic wording. The main sources were `app/app.js::generateWarmStudioCopy`, `generateBatchDraftCopy`, and `saas/src/store.js::buildSalesDraft` / `buildJobSeekerDraft`: repeated stock openers, title-parroting, generic service pitches, and multiple asks.

## What changes

- First messages lead with one selected opening and its actual location. Recruiting contacts get a question about outside support; other employees get a question about the right person to contact. A contact's title is not proof that they own the search.
- The sender's own background/offer, real relationship context and preferred question are used as supplied. Professional tone no longer rewrites a user question into an awkward “If appropriate…” sentence.
- People now supports optional relationship context and a custom closing question. These fields save privately with the existing draft and restore after reload, within the existing user/workspace scope. Changing context preserves the current message until regeneration is confirmed.
- The account composer exposes the same three inputs under “Make it sound like you.” Generic first-person claims about the sender's services, market maps and hiring pain are removed. Alternate drafts are deduplicated rather than presented as different angles when they say the same thing.
- Warm Studio avoids adding an extra sales paragraph to the recruiter format. Connection invitations fit the existing 300-character editor without ending mid-sentence. Follow-ups keep their role context and do not invent candidate availability or credentials.
- If supplied posting text includes an explicit experience/requirement clause mentioning a supported skill, Warm Studio can reference up to two such terms. Negated clauses are excluded. This is a bounded keyword rule, not general job-description understanding; many imported jobs contain only title/location/team data, so no requirement detail is added in that case.
- Missing or closed roles do not become invented openings. Account requests for an unavailable selected role fail with a recoverable message rather than silently substituting a different role.

## Synthetic example

With a Finance Director role in Toronto and the supplied offer “I recruit finance leaders across Ontario,” the People draft is:

> Hi Jamie,
>
> I saw the Finance Director opening at Example Co in Toronto. I recruit finance leaders across Ontario.
>
> Are you open to outside recruiting support for this role?

## Verification and limits

The eight new Node cases cover wording, recipient context, user-supplied claims, unavailable roles, bounded private saved context, negated posting requirements, compact invitations and duplicate angles. All 522 Node tests and the full 163-test Chromium browser suite pass. The three new browser journeys also pass in Firefox and WebKit (six additional checks), including save/reload, retained manual edits, the account composer and professional-tone questions. Expanded People controls pass the tested axe WCAG A/AA checks and desktop/390px overflow checks. The mobile layout was visually inspected. Syntax, ESLint and the unchanged schema contract (30 tables, 63 indexes, 15 migrations) pass.

Live browser measurements for `app/people-workspace.js::generatePersonDraft` were 2 ms in Chromium, 4 ms in Firefox and 1 ms in WebKit on synthetic data. `buildDraft` now reports measured generation time instead of a constant 1 ms. No speedup or conversion-rate claim is made.

This remains rule-based drafting. No paid AI service was enabled, no external research or private-note upload was added, and no message was sent automatically. API inputs are additive, bounded fields; no database migration is needed. The Windows-local PowerShell account generator is unchanged; hosted account drafts and the shared browser People/Warm/batch generators are covered here.

Release candidate 0.1.3.5 is prepared on branch `codex/smarter-outreach` from deployed `main` commit `bd4ef83`. Deployment was authorized after local validation. Pre-deployment production checks confirm the database is connected, relational mirrors/content have zero mismatches, the background queue is healthy and the observed HTTP 5xx rate is 0%. Existing email delivery remains unconfigured. Production rollout is verified separately after merge; this release changes no schema, dependencies, billing or environment configuration.
