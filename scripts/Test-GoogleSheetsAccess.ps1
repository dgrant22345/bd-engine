param(
    [string]$SpreadsheetId = $env:GOOGLE_SHEETS_SPREADSHEET_ID
)

$ErrorActionPreference = 'Stop'

if (-not $SpreadsheetId) {
    throw 'Provide -SpreadsheetId or set GOOGLE_SHEETS_SPREADSHEET_ID.'
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Import-Module (Join-Path $projectRoot 'server\Modules\BdEngine.GoogleSheets.psm1') -Force -DisableNameChecking

$result = Test-GoogleSheetsAccess -SpreadsheetId $SpreadsheetId
$result | ConvertTo-Json -Depth 10
