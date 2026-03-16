# Google Apps Script Restore

The live sheet logic and data are repaired directly through the Google Sheets API, but the `BD Engine` menu itself is a bound Apps Script project. Google does not let us attach or update that bound script with the service-account flow we used for Sheets, so this part needs one quick manual paste in the sheet UI.

Files to paste from this repo:

- `C:\Users\ddere\OneDrive\Documents\Playground\google-apps-script\Code.gs`
- `C:\Users\ddere\OneDrive\Documents\Playground\google-apps-script\ATS_Helper.gs`
- `C:\Users\ddere\OneDrive\Documents\Playground\google-apps-script\appsscript.json`

Steps:

1. Open the spreadsheet.
2. Open `Extensions` -> `Apps Script`.
3. Replace the existing `Code.gs` contents with the repo `Code.gs`.
4. Add or replace `ATS_Helper.gs` with the repo `ATS_Helper.gs`.
5. Open `Project Settings` -> `Show "appsscript.json" manifest file in editor`, then replace the manifest with the repo `appsscript.json`.
6. Save the project.
7. Refresh the spreadsheet tab.
8. Approve the script permissions the first time you run a menu item.

What the restored menu gives you:

- `Run Full Engine`
- `Import Connections CSV (Drive)`
- `Repair Formula Tabs`
- `Sync Job Boards Config`
- `Run ATS Helper`
- `Run Job Feed`

Notes:

- `Import Connections CSV (Drive)` looks for the most recent Drive file named `Connections.csv` or `connections.csv`.
- `Connections` now normalizes common company aliases like `RBC`, `Royal Bank of Canada`, `BMO Financial Group`, and `Rogers` into a single clean company name before `Target_Accounts` rolls up the network.
- The script keeps unresolved boards inactive by default, so `Run Job Feed` only pulls from supported or verified boards.
- `Sync Job Boards Config` now also rebuilds `Config_Review_Queue`, which prioritizes the highest-value unresolved companies for manual ATS review.
- `Run Full Engine` now repairs the formula tabs, syncs configs, and runs the job feed. It does not re-run ATS discovery automatically, which keeps verified boards from being downgraded by weak public careers-page HTML.
- `Run ATS Helper` is now conservative: it skips manual and already-supported rows, focuses on the highest-priority unresolved companies first, and verifies supported board endpoints before reactivating them.
- `Run Job Feed` is more resilient now: one broken board no longer aborts the full ingest, and duplicate job rows are filtered before writing to `Hiring_Import`.
- The live sheet currently has the repaired config seed and a working job import path, so pasting the script restores the menu layer on top of a working sheet.
