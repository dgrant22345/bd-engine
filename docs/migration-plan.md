# BD Engine Migration Plan

## 1. Spreadsheet Audit

Workbook audited:

- `C:\Users\ddere\OneDrive\Desktop\Google_Sheets_Daily_BD_Engine (1).xlsx`

Visible sheets in the export:

- `Setup`
- `Connections`
- `Hiring_Import`
- `Target_Accounts`
- `Daily_Hot_List`
- `Today_View`
- `Top_Contacts`
- `Outreach_Templates`
- `History`

Key findings:

- `Setup` is the most reliable configuration source in the workbook export.
- `Connections` is the real operational dataset and contains the reusable scoring logic.
- `Hiring_Import` only contains placeholder/example rows in this `.xlsx`.
- `Target_Accounts`, `Today_View`, `Top_Contacts`, and `History` are mostly empty or template-only in the export.
- No visible `Job_Boards_Config` tab exists in this file, so ATS configuration must be app-managed.

### Logic Preserved From The Workbook

`Connections` formulas clearly preserve these rules and the app now mirrors them in code:

- Buyer flag intent: titles matching senior buying/hiring language.
- Senior flag intent: VP/director/head/chief/founder style titles.
- Talent flag intent: recruiting, people, talent, HR, staffing titles.
- Tech flag intent: engineering/product/data/IT titles.
- Finance flag intent: finance/accounting/risk/compliance titles.
- Company overlap: count contacts by normalized company.
- Contact priority score:
  - `buyer*20 + senior*20 + talent*25 + tech*10 + finance*6 + overlap bonus`
  - overlap bonus: `5 / 10 / 15 / 20` at `5 / 10 / 20 / 50` contacts
- `Setup` thresholds:
  - min company connections: `3`
  - min jobs posted: `2`
  - contact priority threshold: `55`
  - max companies to review: `25`
- `Daily_Hot_List` visible formula intent:
  - `jobs*5 + contacts*2 + senior*3 + talent*4`

### Logic Reimplemented Because The Export Lost It

The exported `.xlsx` does not include the full Google Sheets script runtime, so these pieces are reimplemented in the app service layer:

- account rollups from connections
- target score derivation from contact mix
- today queue generation
- top-contact ranking by company
- ATS config-driven live job imports
- activity tracking outside the spreadsheet

## 2. Spreadsheet To App Map

| Spreadsheet sheet | App module |
| --- | --- |
| `Setup` | Scoring and workflow settings |
| `Connections` | Contacts + company overlap engine |
| `Hiring_Import` | Jobs dataset |
| `Target_Accounts` | Accounts rollup service |
| `Daily_Hot_List` | Ranked accounts list |
| `Today_View` | Dashboard today queue |
| `Top_Contacts` | Account detail contact ranking |
| `Outreach_Templates` | Template-ready outreach prompts |
| `History` | Activity timeline |
| missing `Job_Boards_Config` in export | Admin ATS config UI |

## 3. MVP Architecture

### Frontend

- static HTML/CSS/vanilla JS app
- recruiter-first screens instead of spreadsheet tabs
- dashboard, accounts, account detail, contacts, jobs, admin

### Backend

- PowerShell local HTTP server
- JSON API for imports and persistent mutations
- Open XML workbook parser for `.xlsx` imports
- ATS adapters for Greenhouse, Lever, and Ashby

### Persistence

- JSON collections under `data/`
- multi-workspace-ready entity shape via `workspaceId`

## 4. Normalized Schema

### `workspaces`
- `id`
- `name`
- `created_at`

### `settings`
- `workspace_id`
- `min_company_connections`
- `min_jobs_posted`
- `contact_priority_threshold`
- `max_companies_to_review`
- `geography_focus`
- `gta_priority`
- `updated_at`

### `accounts`
- `id`
- `workspace_id`
- `normalized_name`
- `display_name`
- `industry`
- `location`
- `status`
- `outreach_status`
- `priority_tier`
- `notes`
- `tags`
- `connection_count`
- `senior_contact_count`
- `talent_contact_count`
- `buyer_title_count`
- `target_score`
- `daily_score`
- `network_strength`
- `job_count`
- `last_job_posted_at`
- `hiring_status`
- `last_contacted_at`
- `days_since_contact`
- `stale_flag`
- `careers_url`
- `ats_types`
- `top_contact_name`
- `top_contact_title`

### `contacts`
- `id`
- `workspace_id`
- `account_id`
- `normalized_company_name`
- `company_name`
- `full_name`
- `first_name`
- `last_name`
- `title`
- `linkedin_url`
- `email`
- `connected_on`
- `years_connected`
- `buyer_flag`
- `senior_flag`
- `talent_flag`
- `tech_flag`
- `finance_flag`
- `company_overlap_count`
- `priority_score`
- `relevance_score`
- `outreach_status`
- `notes`

### `jobs`
- `id`
- `workspace_id`
- `account_id`
- `normalized_company_name`
- `company_name`
- `title`
- `normalized_title`
- `location`
- `department`
- `employment_type`
- `job_url`
- `source_url`
- `ats_type`
- `posted_at`
- `imported_at`
- `dedupe_key`
- `raw_payload`
- `active`

### `board_configs`
- `id`
- `workspace_id`
- `account_id`
- `company_name`
- `normalized_company_name`
- `ats_type`
- `board_id`
- `careers_url`
- `source`
- `notes`
- `active`
- `last_import_at`
- `last_import_status`

### `activities`
- `id`
- `workspace_id`
- `account_id`
- `contact_id`
- `normalized_company_name`
- `type`
- `summary`
- `notes`
- `pipeline_stage`
- `occurred_at`
- `metadata`

## 5. MVP Product Decisions

- Keep derived spreadsheet views as services, not user-editable tabs.
- Preserve the spreadsheet’s scoring intent, but move it into deterministic code.
- Let ATS config live in the app because it is absent from this workbook export.
- Treat live job ingestion as the path to a usable hiring dashboard once configs are added.
- Keep the app single-user today while preserving future workspace separation.

## 6. Current Migration Outcome

Imported from the workbook:

- `12,261` accounts
- `20,736` contacts
- `0` jobs
- `0` ATS configs
- `0` activities

That outcome is faithful to the exported workbook. The missing jobs/config/history are not a migration failure; they are absent from the file itself.

## 7. Next Logical Upgrades

- add CSV upload for contacts/network refreshes
- add in-app workbook path picker instead of a fixed default path
- add saved views and saved filters
- move persistence to SQLite or PostgreSQL
- add auth and recruiter workspaces
- add AI-generated outreach drafts on top of `Outreach_Templates`