# v0 Frontend Redesign Workflow

Use GitHub as the bridge between v0 and Codex so the frontend can improve quickly without risking backend regressions.

## Intended Workflow

1. Push this repository to GitHub.
2. Connect or import the GitHub repository inside v0.
3. Use v0 only for frontend redesign work.
4. Have v0 create a branch and open a pull request.
5. Use Codex to review, test, and fix the v0 pull request before merging.

## Scope for v0

- Work only in frontend files unless a human explicitly asks for broader changes.
- Safe frontend files include `app/index.html`, `app/app.js`, `app/local-api.js`, `app/styles.css`, `app/sw.js`, `app/manifest.json`, and `app/icons/`.
- Do not change backend/server files, API contracts, persistence, data models, import pipelines, authentication, job ingestion, enrichment logic, or database code.
- Preserve existing functionality, routes, forms, actions, filters, API calls, and payload assumptions.
- Do not introduce unnecessary dependencies or a new build system.

## Recommended v0 Prompt

```text
Redesign the frontend only. Do not change backend logic, API endpoints, data models, authentication, import pipelines, or persistence logic. Make this look like a premium modern B2B SaaS dashboard for staffing/recruiting business development. Improve layout, typography, navigation, cards, tables, filters, dashboard widgets, loading states, empty states, error states, and responsive behavior. Preserve all existing functionality.
```

## Local Verification

This app currently has no `package.json`, npm install step, or npm build step. It is a static frontend served by the PowerShell backend.

Run locally on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File server\Server.ps1 -Port 8173 -OpenBrowser
```

Or double-click:

```text
Start-BDEngine.bat
```

Open:

```text
http://localhost:8173
```

Recommended frontend syntax checks when Node is available:

```powershell
node --check app/app.js
node --check app/sw.js
```
