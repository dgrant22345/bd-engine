# Follow-up reliability — November 14, 2026

## Customer behavior

- Unfinished new-task descriptions, dates and disclosure state survive task searches, pagination, status changes, completion and navigation within the current tab. They stay separate for the workspace queue and each person's queue.
- Failed reads offer a retry with the same filters. The read has a 15-second deadline; outdated responses cannot replace a newer view.
- Failed creation keeps the entered task and displays an inline error. Pending creation stays disabled after list rebuilds. A completed save cannot navigate away from another screen or clear another person's unfinished task.
- Due-date editors confirm before discarding changes via Close or Escape, protect pending/dirty edits on tab close or reload, and retain the edited date after a failed save.

Unsubmitted new-task input stays in memory in the current tab; it is not a saved task, does not sync across devices, and does not survive a reload. Successful submissions clear their own input. No automatic submission or retry is introduced.

## Implementation and timing

`app/app.js::renderTasksView` previously replaced the task form on every list render without retaining input. `bindEvents` disabled only the original submit button, so a rebuilt form could submit again while an earlier request was pending. `editTask` allowed edited dates to be dismissed without warning.

The task query still uses a scoped `/api/tasks` read. Form state is kept separately by person and signed-in workspace identity, with initial background bootstrap hydration preserving input already entered. Saves retain their original person and only refresh that same route. API payloads and backend storage contracts are unchanged. Browser asset versions were updated.

`bd:follow-ups:render` records the real browser list-render path, including its scoped read. Local Chromium measurements used 50 synthetic tasks, seven runs, and cache invalidation before each run. Baseline: 10.1, 7.5, 7.3, 7.5, 12.6, 11.4, 8.0 ms (median 8.0 ms). After changes: 6.8, 7.5, 6.5, 7.5, 6.4, 6.8, 7.7 ms (median 6.8 ms). This is a local responsiveness check within timing variation, not a production speedup claim. Requests in this fixture use local intercepted responses, not a production database.

## Initial checkout validation

- Hosted syntax checks and ESLint.
- 416 Node tests.
- 29 Chromium browser checks: follow-up reliability, task queue, activity history and existing saved-work workflows.
- All seven new cases also pass in Firefox and WebKit (14 additional browser checks).
- The due-date editor's failed-save state passes axe WCAG 2 A/AA and 2.1 AA checks; desktop and 390px viewport overflow checks pass.
- The new behavior tests reproduced four failures before implementation: input loss, missing load recovery, pending-form replacement, and silent due-date dismissal.

Testing uses disposable in-memory workspaces and synthetic records. No production deployment, migration, customer-data changes or Windows installer rebuild was performed during initial implementation. The Windows-local PowerShell backend was not exercised.

## Hosted release candidate 0.1.3.4

The final deployment checkout includes `80d9aeda86c7`, verified through production's authenticated status response as the live release (Railway deployment `bac17ede-39c9-4ddd-8389-8353c447b5ba`). This is the newer `main` release with team workspaces, beyond the older `deploy/perf-restore` head. The release pull request targets `main`, preserving team workspaces and the current interface, workflow tools, reminder preferences, public pages and backend.

Before adding the latest team-workspace commits, all 509 Node tests and 159 full Chromium journeys passed on `b62725f`, along with syntax, lint, the schema contract, and all 13 normalized ATS adapter checks. The production dependency audit exits successfully at the high-severity threshold; it reports one inherited low-severity fast-xml-parser advisory. Dependencies and lockfiles are unchanged by this release. The final candidate is revalidated against the live team-workspace source before merging.

Railway CLI's stored OAuth session has expired. Deployment can still use the existing GitHub connection; local diagnostics requiring Railway variables were unavailable. Authenticated read-only production status confirms a connected database and healthy relational mirror/content checks with zero mismatches. Before this release, email delivery and background-ingestion health already report unavailable/unhealthy; the HTTP 5xx rate is 0.51%. This maintenance release changes no backend, schema, environment configuration, billing settings or customer data. CI's PostgreSQL recovery job supplies disposable-database contract verification. Final production verification uses Railway's commit status, authenticated release/assets checks and read-only public smoke checks.
