# Recruiter pilot: first five working sessions

Status: prepared, not sent. No advertising spend or community placement booked.
This is the next small experiment, not evidence of demand or a promised result.

## Audience and promise

Independent recruiters and small staffing-agency founders who already keep a
target-company list. One promise: identify which target accounts deserve the
next conversation using current hiring context, contacts and recruiter notes.
Keep the existing Job Seeker workflow available, but do not mix audiences in
this campaign. Recruiter Pro is the customer-facing $10 USD/month plan; the
internal `sales` identifier and entitlements remain unchanged.

## Gate before asking anyone to pay

Production currently blocks new checkout because the full commercial readiness
gate fails on email configuration. Do not describe paid checkout as available.
Configure RESEND_API_KEY and a verified BD_EMAIL_FROM securely, test password
reset, verification and support delivery with an owner-controlled inbox, then
enable BD_REQUIRE_EMAIL_VERIFICATION and test both blocked/unblocked imports.
Never enable verification first or bypass the commercial gate to increase sales.
Check live purchase, webhook entitlement, billing portal and cancellation in a
controlled owner-approved transaction before broad paid promotion. Automated
Stripe contracts do not substitute for that live evidence.

## Individual invitation draft

Hi [Name] — I'm testing a recruiting workspace that brings target-company hiring
activity, contact context and next steps together. Would you be open to a
20-minute working session to see whether it helps with your current account
research? We can use sample data; no contact import is required. I'm looking for
candid feedback, not a testimonial. No worries if this isn't relevant.

Choose five relevant people from the owner's existing network, personalize the
invitation and confirm recipients before sending. Do not scrape or bulk-message.
Use this link only when they want it:
https://bd-engine-production.up.railway.app/?utm_source=linkedin&utm_medium=direct&utm_campaign=recruiter_pilot&utm_content=working_session

## Working session

1. Ask how they decided which company to contact most recently. What was hard?
2. Ask permission before recording; written notes are enough.
3. Let them explore the sample-data demo without coaching. Ask them to find a
   company, explain the hiring evidence, review a contact and identify a next step.
4. If they opt in to a real workspace, try their own target companies. Check source
   coverage and relevance explicitly; distinguish unsupported sources from no jobs.
5. Ask what this would replace, what prevents a return visit and whether they would
   pay the displayed price after trying it. Record an objection, not just praise.
6. Agree on a follow-up only if wanted; check whether they returned without coaching.

## Private observation fields

Use participant codes, not emails, in shared notes: current workflow, task
completed without help, source quality, time to useful result, blocker, return
usage, purchase decision and reason. Keep contact details in the private workspace.
Do not publish comments or testimonials without separate explicit permission.

## Decision rule

Five sessions are a learning target, not a conversion benchmark. If users cannot
reach useful evidence, fix that specific blocker. If they can but do not return,
revisit the problem and audience before building more. If they return and request
paid access, finish verified purchase readiness and invite a paid pilot. Hold
broad ads until the value and purchase paths work repeatedly.

## Measurement limitations

The existing admin analytics counts visitor IDs, not verified humans. Internal
and test activity remain included and are labeled; do not invent a qualified
conversion rate. New blocked/failed checkout events are prospective and
deduplicated per workspace/day. A disabled purchase button emits no attempt.
Customer-linked cohort exclusion and return-use reporting deserve a separate
tested analytics pass; no historical events were deleted or reclassified here.
