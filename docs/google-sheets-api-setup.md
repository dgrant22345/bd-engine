# Google Sheets API Setup

This project now supports Google Sheets API access through a Google service account.

## 1. Create a Google Cloud project and enable Sheets API

Use the official Google Cloud console to:

1. Create or choose a project.
2. Enable the Google Sheets API.
3. Create a service account.
4. Generate a JSON key for that service account.

Official references:

- https://developers.google.com/workspace/guides/create-project
- https://developers.google.com/workspace/sheets/api/quickstart/nodejs

## 2. Save the JSON key locally

Put the downloaded JSON key somewhere outside the repo if possible, for example:

`C:\Users\ddere\.config\gcp\bd-engine-service-account.json`

## 3. Set environment variables

PowerShell for the current shell:

```powershell
$env:GOOGLE_SERVICE_ACCOUNT_JSON = 'C:\Users\ddere\.config\gcp\bd-engine-service-account.json'
$env:GOOGLE_SHEETS_SPREADSHEET_ID = '1OupXnSuWyWJGxEiVkucNrsMg7kUDnTC80OUGfgiLaX8'
```

You can also use `GOOGLE_APPLICATION_CREDENTIALS` instead of `GOOGLE_SERVICE_ACCOUNT_JSON`.

## 4. Share the sheet with the service account

Open the JSON key and copy the `client_email` value from it.

Share the Google Sheet with that email address as `Editor`.

Without this step, the API auth can succeed but the spreadsheet call will still be denied.

## 5. Test access

From the repo root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test-GoogleSheetsAccess.ps1
```

Or through the local API:

`POST /api/google-sheets/test`

Example JSON body:

```json
{
  "spreadsheetId": "1OupXnSuWyWJGxEiVkucNrsMg7kUDnTC80OUGfgiLaX8"
}
```

## What is implemented

- service-account JWT auth in `server/Modules/BdEngine.GoogleSheets.psm1`
- metadata test endpoint in `server/Server.ps1`
- CLI test script in `scripts/Test-GoogleSheetsAccess.ps1`

## Next recommended step

Once access is confirmed, wire actual read/write helpers for:

- reading `Connections`, `Target_Accounts`, and `Job_Boards_Config`
- writing updated `Job_Boards_Config` rows back to the live sheet
