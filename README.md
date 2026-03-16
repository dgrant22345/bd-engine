# BD Engine Web App MVP

BD Engine turns the spreadsheet-based business development workflow into a lightweight web app with a clean dashboard, ranked accounts, contact intelligence, job ingestion, and ATS config management.

## What This Repo Contains

- `app/`
  - browser UI for dashboard, accounts, contacts, jobs, and admin
- `server/Server.ps1`
  - local HTTP server and JSON API
- `server/Modules/BdEngine.Domain.psm1`
  - scoring, ranking, search, filters, and account-detail models
- `server/Modules/BdEngine.Import.psm1`
  - workbook parser and seed import
- `server/Modules/BdEngine.JobImport.psm1`
  - live Greenhouse, Lever, and Ashby importers
- `server/Modules/BdEngine.State.psm1`
  - file-backed persistence
- `data/`
  - persisted workspace state
- `docs/migration-plan.md`
  - spreadsheet audit, app architecture, and schema

## Workbook Audit Summary

The workbook at `C:\Users\ddere\OneDrive\Desktop\Google_Sheets_Daily_BD_Engine (1).xlsx` exports these visible sheets:

- `Setup`
- `Connections`
- `Hiring_Import`
- `Target_Accounts`
- `Daily_Hot_List`
- `Today_View`
- `Top_Contacts`
- `Outreach_Templates`
- `History`

Important findings from the audit:

- `Setup` contains the live operating thresholds the app now imports:
  - min company connections: `3`
  - min jobs posted: `2`
  - contact priority threshold: `55`
  - max companies to review: `25`
- `Connections` is the real source of truth in this export. It contains 20k+ people rows plus formula-driven flags for title relevance, company overlap, years connected, and contact priority.
- `Hiring_Import` in this `.xlsx` only contains placeholder/example rows, not a real jobs snapshot.
- `Target_Accounts`, `Today_View`, `Top_Contacts`, and `History` are mostly empty in the exported file because the live Google Sheets workflow depended on formulas/scripts that do not survive the `.xlsx` export cleanly.
- There is no visible `Job_Boards_Config` sheet in this workbook export, so ATS config data starts empty and is managed in the app admin UI.

## What The App Preserves

- contact title classification and priority scoring from `Connections`
- setup-driven threshold controls from `Setup`
- ranked account rollups derived from company overlap and contact quality
- `Daily_Hot_List` style scoring as an app-native service
- `Today_View` style shortlist logic
- admin-managed ATS config and live job refresh flow
- outreach stages, notes, and activity tracking

## Current Seed State

The repo is currently seeded from your workbook and now contains:

- `12,261` accounts
- `20,736` contacts
- `0` jobs
- `0` ATS config rows
- `0` activity history rows

That is expected for this workbook export. To populate jobs in the app, add ATS config rows in **Admin** and run **Run job import**.

## Stack

This MVP stays intentionally lightweight in this environment:

- frontend: static HTML/CSS/vanilla JS
- backend: PowerShell HTTP server
- persistence: JSON files in `data/`
- import layer: Open XML workbook parsing plus live ATS HTTP importers

The product model is structured so it can later move to a React/Next.js + relational database stack without changing the core workflow.

## Run The App

Windows:

```powershell
.\Start-App.cmd
```

Or directly:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-App.ps1
```

Optional port override:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-App.ps1 -Port 8188
```

Then open [http://localhost:8173](http://localhost:8173).

## Import Behavior

Default workbook path:

- `C:\Users\ddere\OneDrive\Desktop\Google_Sheets_Daily_BD_Engine (1).xlsx`

The workbook import is now resilient to:

- missing `Job_Boards_Config` tabs
- formula cells exported as literal `=...` strings
- placeholder rows in `Hiring_Import`
- empty history/config/job sections
- clean reseeds where collections are empty

## Live Job Import

Supported live ATS sources:

- Greenhouse
- Lever
- Ashby
- SmartRecruiters

Workflow:

1. Open **Admin**.
2. Add or edit ATS config rows.
3. Click **Run job import**.
4. Refresh the dashboard/accounts/jobs views.

## Google Sheets API Access

Service-account based Google Sheets access is now scaffolded for this project.

- setup guide: `docs/google-sheets-api-setup.md`
- test script: `scripts/Test-GoogleSheetsAccess.ps1`
- server endpoint: `POST /api/google-sheets/test`

## Notes

- Reads are served from the JSON snapshot in `data/`. Workbook imports and live ATS refreshes use the PowerShell API, while day-to-day UI edits are stored locally in the browser for this MVP.
- The app is single-user at runtime today, but the data model keeps `workspaceId` on major entities for future SaaS expansion.
- Because the provided workbook export does not carry real job/config/history rows, the first meaningful “hiring” dashboard experience depends on adding ATS configs and running a live import.
