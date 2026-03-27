# BD Engine — Commercial Edition

Business development operating system. Daily account prioritization, contact intelligence, and live ATS job import in one desktop app.

## Requirements

- **Windows 10 or 11**
- **PowerShell 5.1+** (included with Windows)
- No other dependencies — everything is bundled

## Installation

### 1. Unzip

Extract the `BD-Engine.zip` file to any folder (e.g., `C:\BD-Engine`).

### 2. First-Run Setup

Double-click **`Start-BDEngine.bat`**. On the first launch, the setup wizard will run automatically and ask for:

1. **License key and payload** — provided to you at purchase
2. **Workspace name** — name your workspace (e.g., your company name)
3. **Team members** — add the people who will use the app
4. **Geography focus** — optional, filters account prioritization by region

You can also run setup manually anytime:

```
powershell -NoProfile -ExecutionPolicy Bypass -File Setup-BDEngine.ps1
```

### 3. Launch

After setup, double-click **`Start-BDEngine.bat`**. The app will:
- Start a local server on port 8173
- Open your browser to the dashboard at http://localhost:8173

To stop: double-click **`Stop-BDEngine.bat`** or close the PowerShell window.

## License Activation

Each copy of BD Engine requires a unique license key. You'll receive two values at purchase:

- **License Key**: formatted as `BDENG-XXXXX-XXXXX-XXXXX-XXXXX`
- **License Payload**: a base64 string

Enter both during first-run setup. The license is stored locally in `data\license.json`.

If your license expires, contact your vendor for a renewal key.

## What It Does

BD Engine replaces spreadsheet-based BD workflows with a web app that:

- **Ranks accounts** by hiring signals, contact density, and engagement score
- **Scores contacts** by title relevance, seniority, and relationship strength
- **Imports live jobs** from ATS platforms (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Jobvite)
- **Discovers job boards** automatically via ATS probing
- **Tracks outreach** with activity logging and stage management
- **Assigns ownership** across your team roster

## App Views

| View | What it shows |
|------|---------------|
| **Dashboard** | Today's prioritized account list with hiring signals and scores |
| **Accounts** | Full account list with search, filters, and detail drilldowns |
| **Contacts** | Contact directory with priority scoring and title classification |
| **Jobs** | Live job postings imported from connected ATS boards |
| **Admin** | ATS board config management, enrichment tools, and import controls |

## Configuration

### Team Members

Edit `data\owners.json` to add, remove, or rename team members:

```json
[
  { "ownerId": "jane-smith", "displayName": "Jane Smith" },
  { "ownerId": "john-doe", "displayName": "John Doe" }
]
```

### Settings

Edit `data\settings.json` or use the Admin view in the app:

| Setting | Default | Description |
|---------|---------|-------------|
| `minCompanyConnections` | 3 | Minimum contacts needed to surface a company |
| `minJobsPosted` | 2 | Minimum active jobs to flag as "hiring" |
| `contactPriorityThreshold` | 10 | Minimum score for high-priority contacts |
| `maxCompaniesToReview` | 25 | Max companies shown on the dashboard |
| `geographyFocus` | (empty) | Filter by country/region |

### ATS Board Configuration

Add your target companies in the Admin view, or import via the `data\seed-job-boards-config.json` file. Use the built-in ATS discovery to automatically detect which job board platform each company uses.

## Architecture

```
Start-BDEngine.bat       Windows launcher (double-click to start)
Setup-BDEngine.ps1       First-run setup wizard
Stop-BDEngine.bat        Shutdown script

app/                     Frontend (static HTML/CSS/vanilla JS)
server/Server.ps1        HTTP server (PowerShell, port 8173)
server/Modules/          Business logic modules
data/                    Your data (JSON + SQLite, created at runtime)
scripts/                 Utility and maintenance scripts
```

## Data & Privacy

All data stays on your machine. BD Engine runs entirely locally — no cloud services, no telemetry, no external data transmission. The only outbound requests are ATS API calls to fetch public job postings from platforms like Greenhouse and Lever.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No license found" error | Run `Setup-BDEngine.ps1` and enter your key |
| "License expired" error | Contact your vendor for a renewal |
| Port 8173 in use | Close other BD Engine instances, or edit the port in `Open-BD-Engine.ps1` |
| PowerShell error | Ensure PowerShell 5.1+ is installed (run `$PSVersionTable.PSVersion`) |
| App won't load in browser | Wait 30 seconds for the server to warm up, then refresh |

## Support

Contact your vendor for license issues, bug reports, or feature requests.
