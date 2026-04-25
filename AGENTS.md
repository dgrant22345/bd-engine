# BD Engine Agent Rules

This repository is being prepared for frontend redesign work through v0 with GitHub as the handoff point. Keep changes tightly scoped and preserve the working BD Engine application.

## App Structure

- Frontend entry points:
  - `app/index.html` loads the static app shell.
  - `app/app.js` contains the hash router, view rendering, UI behavior, and frontend state.
  - `app/local-api.js` contains the browser API helper, GET cache, and request/error handling.
  - `app/sw.js` is the service worker and asset cache.
  - `app/manifest.json` and `app/icons/` support PWA metadata/icons.
- Routing structure:
  - Hash routes are used in `app/app.js`.
  - Current primary routes are `#/dashboard`, `#/accounts`, `#/accounts/:id`, `#/contacts`, `#/jobs`, and `#/admin`.
  - Primary nav markup lives in `app/index.html`.
- Styling files:
  - `app/styles.css` is the main stylesheet.
  - There is no component-scoped CSS system at this time.
- Component folders:
  - There is currently no separate frontend component folder.
  - View/component-like render functions live in `app/app.js` (`renderDashboardView`, `renderAccountsView`, `renderContactsView`, `renderJobsView`, `renderAdminView`, and related helpers).
- API client/service files:
  - `app/local-api.js` is the frontend API client boundary.
  - Preserve existing endpoint paths, methods, payload shapes, cache assumptions, and error handling unless explicitly requested.
- Backend/server files that frontend redesign agents should not touch:
  - `server/Server.ps1`
  - `server/BackgroundJobWorker.ps1`
  - `server/schema.sql`
  - `server/Modules/*.psm1`
  - `server/vendor/`
  - `scripts/*.ps1`
  - `data/` and `BD-Engine/data/`
  - Google Apps Script and outreach helper folders unless explicitly requested.

## Frontend Redesign Scope

- Focus frontend work on layout, components, styling, UX, accessibility, responsive behavior, loading states, empty states, error states, and visual polish.
- Make the product feel like a premium modern B2B SaaS dashboard for staffing/recruiting business development.
- Preserve all existing features and workflows.
- Preserve all existing API calls and payload assumptions.
- Do not remove views, filters, actions, forms, buttons, tables, exports, background-job controls, or admin workflows.
- Do not introduce unnecessary dependencies. This app is currently static HTML/CSS/vanilla JS with no frontend build step.
- Keep the app easy to run locally.

## Protected Areas

- Do not change backend logic, API endpoints, database code, authentication, job import logic, enrichment logic, persistence logic, or data models unless explicitly requested.
- Do not change `server/Modules/BdEngine.JobImport.psm1`, `server/Modules/BdEngine.BackgroundJobs.psm1`, `server/Modules/BdEngine.SqliteStore.psm1`, or other backend modules for a frontend-only redesign.
- Treat broken imports, broken routes, broken API integrations, missing controls, and build/runtime failures as high-priority issues.
- If a visual redesign needs new data, first reuse existing API fields. Do not alter backend contracts without explicit approval.

## Local Development

- There is currently no `package.json`, npm install step, or npm build step.
- Start the app on Windows with `Start-BDEngine.bat`.
- Or run the server directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File server\Server.ps1 -Port 8173 -OpenBrowser
```

- Open `http://localhost:8173`.
- For syntax checks on frontend JavaScript, use `node --check app/app.js` and `node --check app/sw.js` when Node is available.

## Performance Rules

- Always add timing around performance-sensitive paths before and after meaningful changes.
- Report bottlenecks by exact file path and function name first, before broader summaries or proposed fixes.
- Prefer incremental updates, partial upserts, and dirty-flag refreshes over full rebuilds.
- Avoid full-state reloads after single-entity changes whenever a scoped read or targeted query is possible.
- Trace the full call chain for slow paths instead of assuming the slow step from a label like `snapshot` or `sync`.
- When optimizing, measure live timings on the real path you changed and report before/after numbers.
- Preserve existing API contracts and UI behavior unless a change is required to fix correctness or performance.

## PR Review Priorities

- Verify routes still render: dashboard, accounts, account detail, contacts, jobs, and admin.
- Verify existing API calls still use the same endpoints, HTTP methods, query parameters, and payload shapes.
- Verify loading, empty, and error states are present and accessible.
- Verify responsive behavior for desktop and mobile widths.
- Verify frontend JavaScript syntax before review approval.
- Confirm no protected backend/server/data files changed in frontend-only PRs.
