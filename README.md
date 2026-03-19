# BD Engine

Business development operating system. Daily account prioritization, contact intelligence, and ATS import orchestration in one place.

## Quick Start

**Windows:**

```
Double-click Start-BDEngine.bat
```

Or from PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File server\Server.ps1 -Port 8173 -OpenBrowser
```

Open [http://localhost:8173](http://localhost:8173).

## What It Does

BD Engine replaces the spreadsheet-based BD workflow with a web app that:

- **Ranks accounts** by hiring signals, contact density, and engagement score
- **Scores contacts** by title relevance, seniority, and relationship strength
- **Imports live jobs** from ATS platforms (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Jobvite)
- **Discovers job boards** automatically via slug-based ATS probing
- **Tracks outreach** with activity logging and stage management
- **Assigns ownership** across a fixed roster (Derek Grant, Alex Chong, Danny Chung)

## App Views

| View | What it shows |
|------|---------------|
| **Dashboard** | Today's prioritized account list with hiring signals and scores |
| **Accounts** | Full account list with search, filters, and detail drilldowns |
| **Contacts** | Contact directory with priority scoring and title classification |
| **Jobs** | Live job postings imported from connected ATS boards |
| **Admin** | ATS board config management, enrichment tools, and import controls |

## Architecture

```
app/                    Frontend (static HTML/CSS/vanilla JS)
server/Server.ps1       HTTP server (PowerShell, port 8173)
server/Modules/         Business logic modules
  BdEngine.Domain.psm1    Scoring, ranking, search, filters
  BdEngine.Import.psm1    Workbook parser and seed import
  BdEngine.JobImport.psm1 Live ATS importers + discovery pipeline
  BdEngine.State.psm1     File-backed persistence
  BdEngine.SqliteStore.psm1  SQLite storage adapter
  BdEngine.GoogleSheetSync.psm1  Google Sheets integration
data/                   Persisted state (JSON + SQLite)
scripts/                Utility and maintenance scripts
```

## ATS Board Discovery

The app automatically discovers which ATS platform each company uses. Current coverage: **609/839 companies resolved (72.6%)**.

Discovery methods:
- **Slug probing** — tests company name variants against Greenhouse, Lever, Ashby, SmartRecruiters, Jobvite APIs
- **Workday probing** — tests against Workday subdomain variants (wd1-wd12)
- **Known enterprise mappings** — curated career page URLs for 400+ major companies
- **Google Sheets sync** — imports config from a shared Google Sheet

### Running Discovery Scripts

```powershell
# Main ATS probe (Greenhouse, Lever, Ashby, SmartRecruiters, Jobvite)
powershell -NoProfile -File scripts\Fast-Probe.ps1

# Workday subdomain probing
powershell -NoProfile -File scripts\Fast-Probe-Extra.ps1

# Additional ATS types (Workable, Recruitee, Rippling)
powershell -NoProfile -File scripts\Fast-Probe-More.ps1

# Apply known enterprise career page mappings
powershell -NoProfile -File scripts\Apply-Known-Enterprise.ps1
powershell -NoProfile -File scripts\Apply-Known-Enterprise-2.ps1
powershell -NoProfile -File scripts\Apply-Known-Enterprise-3.ps1

# Check resolution stats
powershell -NoProfile -File scripts\check-stats.ps1
```

## Live Job Import

1. Open **Admin** in the app
2. Verify ATS configs are resolved (green status)
3. Click **Run job import**
4. Jobs appear in the **Jobs** view

Supported import sources: Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Jobvite.

## Data

- **SQLite database**: `data/bd-engine.db` — board configs, discovery state
- **JSON files**: `data/*.json` — accounts, contacts, settings, workspace state
- **Known mappings**: `data/resolver-known-mappings.json` — curated ATS mappings

## Sharing the App

**Local distribution**: Run `scripts\Package-Distribution.ps1` to create `BD-Engine.zip`. Recipients unzip and double-click `Start-BDEngine.bat`.

**Network sharing (Tailscale)**: The server binds to all interfaces by default. Install [Tailscale](https://tailscale.com/) on all machines, then share the Tailscale URL shown at startup. Use `-LocalOnly` flag to restrict to localhost.

## API

Key endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/dashboard` | Prioritized account list |
| `GET /api/accounts` | Account data with search/filter |
| `GET /api/contacts` | Contact directory |
| `GET /api/jobs` | Imported job postings |
| `GET /api/configs` | ATS board configurations |
| `GET /api/owners` | Owner roster |
| `POST /api/import/jobs` | Trigger live job import |
| `POST /api/discovery/run` | Run ATS discovery pipeline |
| `POST /api/enrichment/run` | Run company enrichment |

## Stack

- **Frontend**: Static HTML/CSS/vanilla JS (no build step)
- **Backend**: PowerShell HTTP server (.NET TcpListener)
- **Database**: SQLite + JSON file persistence
- **Dependencies**: PowerShell 5.1+, .NET Framework (included with Windows)
