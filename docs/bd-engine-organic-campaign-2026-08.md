# BD Engine organic campaign — August/September 2026

## Campaign objective

Turn a narrow, credible free utility into qualified product trials:

1. A staffing leader sees a useful point of view about target-account coverage.
2. They run the free ATS coverage audit on a real target list.
3. The result makes recognized sources and unresolved gaps visible.
4. They continue directly into a BD Engine trial to add target companies, hiring signals, network context, and next actions.

The positioning is **more client conversations with less manual account research**. BD Engine is not presented as another full ATS, a replacement CRM, a LinkedIn automation bot, or a promise of complete job coverage.

## Primary audience

- Staffing agency founders and desk leaders who still assemble target lists manually.
- Agency recruiters with a business-development responsibility.
- Small staffing teams that have an ATS or CRM but lack a clear daily account-prioritization queue.
- Recruiters with a large existing LinkedIn network who are not systematically mapping that network to companies hiring now.

## Message hierarchy

1. **Outcome:** know which target accounts deserve attention today.
2. **Mechanism:** combine public hiring signals with existing relationship context.
3. **Proof:** show the denominator, the source, and the unresolved gaps.
4. **Control:** drafts are assisted and human-reviewed; BD Engine does not auto-send outreach.
5. **Offer:** free browser-based ATS coverage audit, followed by a 14-day no-card trial.

## Campaign destinations

Use these URLs unchanged so attribution remains comparable:

- LinkedIn launch post → `https://bd-engine-production.up.railway.app/ats-checker?utm_source=linkedin&utm_medium=organic&utm_campaign=coverage_denominator`
- Playbook post → `https://bd-engine-production.up.railway.app/staffing-bd-playbook?utm_source=linkedin&utm_medium=organic&utm_campaign=staffing_bd_playbook`
- Workflow/demo post → `https://bd-engine-production.up.railway.app/?utm_source=linkedin&utm_medium=organic&utm_campaign=bd_workflow_demo`
- Job-seeker crossover post → `https://bd-engine-production.up.railway.app/job-search?utm_source=linkedin&utm_medium=organic&utm_campaign=job_search_focus`

## Four-post LinkedIn sequence

### Post 1 — The denominator problem

Most staffing BD “coverage” numbers are not coverage numbers.

“We monitor 500 companies” sounds useful, but it does not answer the questions that matter:

- How many companies are actually in the target universe?
- How many have a usable public career source?
- How many sources are recognized versus unresolved?
- How many have a current hiring signal worth acting on?

Without a denominator, a large count can hide a large blind spot.

I built a free browser-based ATS coverage audit for this exact first step. Paste up to 50 public career-site URLs and it shows:

- valid URLs audited
- recognized ATS hosts
- sources that still need discovery
- the explicit recognized-host rate
- a CSV export of the result

The URLs are checked in the browser and are not fetched by the tool. Host recognition is a compatibility signal—not a promise of complete or fresh job coverage.

Run it here:
https://bd-engine-production.up.railway.app/ats-checker?utm_source=linkedin&utm_medium=organic&utm_campaign=coverage_denominator

### Post 2 — The pre-CRM question

A CRM can tell you what happened.

The harder staffing BD question is what deserves attention today.

For each target account, I want four things visible:

1. Is the company in the defined target universe?
2. Is there current hiring evidence?
3. Is the evidence relevant to the desk?
4. Is there already a warm relationship path?

That produces a much better queue than “work every account” or “message everyone who posted a job.”

The useful output is not more data. It is a short, explainable list of companies, people, and next actions.

I wrote the operating method behind BD Engine here:
https://bd-engine-production.up.railway.app/staffing-bd-playbook?utm_source=linkedin&utm_medium=organic&utm_campaign=staffing_bd_playbook

### Post 3 — What a hiring signal is not

A job posting is evidence. It is not automatically a good reason to pitch a company.

Before outreach, I would still ask:

- Is the role recent?
- Is it relevant to the desk?
- Is the company already over-contacted?
- Is there a known talent or business leader in the network?
- Is the source trustworthy and current?
- What would make the message useful to this recipient?

BD Engine ranks the evidence and prepares a starting draft, but it deliberately keeps the final decision with the recruiter.

No auto-send. No pretending an unresolved source is a confident signal. No score without visible components.

The live synthetic demo shows the workflow:
https://bd-engine-production.up.railway.app/?utm_source=linkedin&utm_medium=organic&utm_campaign=bd_workflow_demo

### Post 4 — A seven-day pilot

If I were testing a new staffing BD workflow, I would not start with 5,000 companies.

I would start with 25.

Day 1: define the target accounts and why each belongs.

Day 2: collect the best public careers URL for each.

Day 3: separate recognized ATS hosts from sources that still need discovery.

Day 4: map existing LinkedIn connections to the companies.

Day 5: rank current hiring evidence and relationship coverage.

Days 6–7: review the top actions, send only the outreach that makes sense, and record what happened.

The point of the pilot is not message volume. It is whether the workflow produces better conversations with less manual research.

The free audit is a useful place to begin:
https://bd-engine-production.up.railway.app/ats-checker?utm_source=linkedin&utm_medium=organic&utm_campaign=coverage_denominator

## Reply prompts for comments

Use these only when they answer the actual comment; do not paste them indiscriminately.

- “That distinction is exactly why I keep recognized-host rate separate from actionable coverage. One tells you the source pattern; the other tells you whether there is a usable current signal.”
- “I see BD Engine as the prioritization layer before the CRM record: what changed, why it matters, who may already know the account, and what the next action is.”
- “The current workflow creates assisted drafts, but the recruiter reviews the facts, tone, recipient, timing, and channel before anything is sent.”
- “Unresolved sources remain visible by design. Hiding them would make the coverage number look better while making the workflow less trustworthy.”

## Measurement plan

Review the funnel weekly by campaign, not by total traffic alone:

| Stage | Event or evidence | Diagnostic question |
| --- | --- | --- |
| Reach | LinkedIn impressions and profile views | Did the idea earn attention from the intended audience? |
| Visit | Campaign-attributed page view | Did the post create enough curiosity to visit? |
| Utility use | `tool_used` on `/ats-checker` | Did visitors bring a real target list? |
| Trial intent | `signup_started` | Did the result make the broader workflow relevant? |
| Trial creation | `signup_completed` with acquisition source | Did the signup form and offer convert qualified intent? |
| Activation | Setup complete plus target accounts, contacts, and resolved boards | Did the product reach a useful operating state? |
| Value | Draft reviewed, next action recorded, or follow-up created | Did the workspace change what the user did next? |

Do not optimize the campaign for raw clicks if utility use, activation, and recorded next actions do not improve. The free audit is the wedge; the activated workflow is the product.

## Publishing cadence

- Publish one primary post every 5–7 days.
- Reply to substantive comments the same day when possible.
- Repost only when there is a new product fact, example, or lesson—not merely to repeat the link.
- After four posts, keep the two themes with the strongest utility-use and activation rates and retire the rest.
