# BD Engine for Windows

BD Engine is a local business-development workspace for turning your relationship data into target accounts, contacts, follow-up priorities, and hiring signals.

It runs on your Windows PC and opens in your browser. You do not need Git, Node.js, npm, SQLite tools, or manual PowerShell commands.

## What BD Engine Does

BD Engine helps you:

- Import your LinkedIn `Connections.csv`
- Turn people into contacts and companies into target accounts
- Find accounts where you have relationship coverage
- Track account status, owner, priority, outreach stage, notes, and next actions
- Review contacts by company, title, score, and outreach status
- Monitor background jobs such as imports, enrichment, and job-board discovery
- Keep all working data on your own computer

BD Engine is not a cloud service. The packaged Windows app stores your data locally in:

`%LOCALAPPDATA%\BD Engine\Data`

That data folder is preserved when you update or uninstall unless you explicitly choose to remove it during uninstall.

## Install

1. Run `BD-Engine-Setup.exe`.
2. Keep the desktop shortcut selected unless you do not want one.
3. Finish the installer.
4. Launch `BD Engine` from the desktop or Start Menu.

The launcher starts a local server at:

`http://localhost:8173`

It then opens your default browser. If BD Engine is already running, the launcher reuses the existing local server instead of starting a duplicate.

## First Launch

On a fresh install, BD Engine opens a setup wizard.

You will enter:

- Workspace or company name
- Your name and email
- Optional team or owner names
- Optional LinkedIn `Connections.csv` import

After setup is complete, future launches skip the wizard and open the dashboard.

## Import LinkedIn Connections

The fastest way to make BD Engine useful is to import your LinkedIn connections.

To get the file from LinkedIn:

1. Open LinkedIn in your browser.
2. Go to Settings and Privacy.
3. Find the data export or "Get a copy of your data" area.
4. Choose the Connections export.
5. Download and unzip the archive when LinkedIn sends it.
6. In BD Engine, upload the included `Connections.csv` file.

BD Engine accepts LinkedIn fields such as:

`First Name, Last Name, URL, Email Address, Company, Position, Connected On`

Missing email, company, title, or connected date fields are allowed. Re-importing the same file updates existing contacts instead of creating duplicates.

Large LinkedIn exports can take several minutes. BD Engine queues the import in the background; contacts and accounts appear after the background job finishes. You can watch progress in Admin > Background jobs.

An empty template is included with the installed app at:

`data-template\sample-linkedin-connections.csv`

## Main Screens

### Dashboard

Use the dashboard to see the current state of your BD workspace: account coverage, follow-up opportunities, recommended actions, recent activity, and hiring or discovery signals.

### Accounts

Accounts are companies you may want to pursue. Use this screen to:

- Search and filter companies
- Review target score, status, owner, priority, and hiring signals
- Open an account detail page
- Add notes and next actions
- Update outreach or pipeline status

### Contacts

Contacts are people imported from LinkedIn or other sources. Use this screen to:

- Search by name, company, title, or email
- Filter by score or outreach status
- Review relationship coverage at each account
- Export contacts if needed

### Jobs

Jobs show hiring activity discovered from configured job boards and ATS sources. This helps identify accounts with current hiring motion.

### Admin

Admin contains setup, import, background-job, and maintenance tools.

Most users will mainly use:

- LinkedIn Connections CSV import
- Runtime status
- Background jobs
- Account/config maintenance tools

Some Admin buttons are for legacy or advanced workflows. In particular, `Run Full Engine` is the older Google Sheets pipeline. It requires a Google Sheets Spreadsheet ID and is not required for normal local use.

## Common Workflow

1. Launch BD Engine.
2. Import your LinkedIn `Connections.csv`.
3. Open Contacts to confirm people imported.
4. Open Accounts to review companies created from those contacts.
5. Prioritize accounts using score, hiring signals, title coverage, and notes.
6. Update statuses and next actions as you work.
7. Re-import LinkedIn periodically to refresh contacts without creating duplicates.

## Updating BD Engine

Run the newer `BD-Engine-Setup.exe`.

Your database, settings, logs, and import history remain in:

`%LOCALAPPDATA%\BD Engine\Data`

## Uninstalling

Use:

Windows Settings > Apps > Installed apps > BD Engine > Uninstall

The uninstaller asks whether to remove local BD Engine user data. Choose `No` if you want to keep your data for a future install.

## Troubleshooting

Logs are stored in:

`%LOCALAPPDATA%\BD Engine\Logs`

Useful log files:

- `launcher.log`
- `server.out.log`
- `server.err.log`

BD Engine uses port `8173`. If another app is using that port, close the other app and launch BD Engine again.

If a button appears to do nothing:

- Refresh the browser tab.
- Check Admin > Runtime status.
- Check Admin > Background jobs.
- If a LinkedIn import says no rows were found, upload the unzipped `Connections.csv` file from the LinkedIn export. Do not upload the ZIP file, a blank template, or a renamed file without LinkedIn connection rows.
- For `Run Full Engine`, enter a Google Sheets Spreadsheet ID first, or use the local LinkedIn import workflow instead.
