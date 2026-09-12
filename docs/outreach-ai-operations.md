# Outreach AI activation

The Warm Studio now supports an explicit AI rewrite preview and optional linked
task completion when the user confirms sent. Neither copying nor generating
completes tasks. The server checks that the task belongs to the workspace and
the outreach account before recording the activity. No fuzzy task matching.

AI is disabled unless all three Railway service variables are configured:

- OPENAI_API_KEY: secret API key; never paste into chat, frontend code or Git.
- BD_OUTREACH_AI_MODEL: an account-accessible Responses API text model.
- BD_OUTREACH_AI_ENABLED=true: explicit rollout switch.

As of September 12, no key or model is configured in production. No live model
call or model quality evaluation has been performed. Tests use synthetic mocked
responses; they validate integration behavior, not generation quality.

Before activation, select a model and budget, review provider disclosure in the
privacy policy, and run an owner-approved synthetic-data canary. API usage has
separate costs. Server limits: 20 requests per workspace and 200 globally per
24-hour rate-limit window, a 6,000-character input bound, 900 output tokens and
25-second timeout. These are request caps, not dollar-budget guarantees. Set a
provider-side project budget/alerts as appropriate. Disable the feature flag to
stop further requests.

Only the visible draft is submitted, after consent; no automatic contact-file,
notes or profile upload. API response storage is disabled with store:false;
this does not promise zero provider retention. Treat model output as unverified.

Official reference used:
https://developers.openai.com/api/reference/cli/resources/responses/methods/create

Remaining limits: integration is in Warm Studio, not the separate account composer.
Draft persistence across modal closure is unchanged. External delivery is not
verified; users explicitly confirm sending. Existing background tenant persistence
and multi-replica cache limitations are not replaced by a new transaction system.
