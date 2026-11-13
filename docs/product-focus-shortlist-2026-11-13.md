# Product focus shortlist — November 13, 2026

Status: recommendation for the owner. Nothing in this document has been
removed, hidden, or renamed.

## Why narrow

The public promise is specific: know which target accounts are worth the next
call, from current roles on readable job boards and the contacts you already
have. The workspace delivers that through five screens (People, Follow-ups,
Companies, Hiring activity, Dashboard).

Around that core sit about twenty optional tools. Together with Warm Studio
they come to roughly 2,900 of the workspace script's 15,200 lines. They also
add a menu a new user has to read past and surface area to test and explain,
and several show figures the data cannot support.

## What this is based on

There is no per-tool usage data: product milestones record setup, companies,
people, and drafts, not which tool was opened. The grouping below therefore
rests on three things that can be checked in the code:

1. **Fit:** does the tool serve the stated promise?
2. **Honesty of output:** does it present numbers or claims derived from data
   the workspace actually holds?
3. **Overlap and cost:** does another tool already do this, and how much code
   does it carry?

The last section proposes a way to replace judgement with usage counts.

## Keep as the product

| Area | Why |
| --- | --- |
| People, CSV import, person review | The recruiter starting point; recently made reliable |
| Companies, career-site watchlist, readable job boards | Source of the dated evidence the product is sold on |
| Hiring activity, search focus, role feedback | Where "worth the next call" is decided |
| Follow-ups, calendar export, daily reminders, weekly digest | The reasons to return |
| Warm Studio and outreach drafts (about 480 lines) | The step from evidence to a message; already a tracked milestone |
| Dashboard first-value checklist | Guides a new workspace to its first result |

## Keep, but simplify

| Tool | Observation | Suggestion |
| --- | --- | --- |
| Daily plan and Morning Radar (about 330 lines together) | Two briefings built from the same accounts and roles | Merge into one "Daily plan" |
| Batch outreach (about 385 lines) | Extends drafting to several contacts | Keep inside Warm Studio rather than as a separate entry point |
| Account priority matrix | Useful view of contacts against hiring | Keep; it now has plain labels |
| Similar companies, location filters | Small, data-driven helpers on Companies | Keep where they are |
| Objection Buster | Static reply templates; the wording is restrained and sensible | Fold into drafts as "reply templates" rather than a separate tool |

## Hide by default, then retire if unused

| Tool | Reason |
| --- | --- |
| Fee pipeline simulator | Multiplies active roles by an assumed $22,500 fee and labels the result an addressable market and projected billings. The workspace has no fee, win-rate, or exclusivity data, so the figures are invented precision. |
| Deal pipeline board (dollar values) | The same assumed fee is applied per column. The board itself is reasonable; the dollar totals are not supported. Keep the stages, drop the values. |
| Client Pitch Deck | Generates a capability summary addressed to a client's leadership from workspace data. Output a recruiter would need to rewrite before sending, with claims the product cannot verify. |
| Cold Call Prompter | Script and timer; unrelated to the evidence the product provides. |
| Candidate templates (slate) | Candidate presentation is a different job from business development, and the workspace is not a candidate database. |
| Entity graph | A visual of contacts by company; the People and Companies tables answer the same questions. |
| Signal ticker | Scrolling restatement of items already listed on the page. |
| Referral credit and "Share stats" | Growth mechanics that matter once there is a user base. The referral credit also creates a billing obligation to honour. |
| Sound effects, theme presets | Small extras unrelated to the product's purpose; candidates for removal. |

## Already unreachable

These are built but never shown: the dashboard tab bar, the three-step quick
start, automation rules, and the script analytics panel. Four of their
functions are kept only because tests assert that they exist. They can be
removed once it is decided they are not coming back.

## Suggested order

1. Remove the unreachable code (no visible change).
2. Remove the assumed-fee dollar figures from the simulator and pipeline board.
   This is an accuracy fix more than a focus decision.
3. Move the "hide by default" group behind one "More tools" setting that is
   off for new workspaces and stays on for existing ones.
4. Record one privacy-safe `tool_opened` milestone (tool name only) and review
   after 30 days of real use. Retire whatever is not opened.
5. Merge Daily plan with Morning Radar, and Objection Buster and Batch outreach
   into drafts.

Steps 1, 2 and 4 are small and reversible. Step 3 changes what new users see
and is the real product decision.
