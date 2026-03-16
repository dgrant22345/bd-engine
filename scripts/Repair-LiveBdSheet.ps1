param(
    [string]$SpreadsheetId = $env:GOOGLE_SHEETS_SPREADSHEET_ID,
    [switch]$SkipConfigSync
)

$ErrorActionPreference = 'Stop'

if (-not $SpreadsheetId) {
    throw 'Provide -SpreadsheetId or set GOOGLE_SHEETS_SPREADSHEET_ID.'
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Import-Module (Join-Path $projectRoot 'server\Modules\BdEngine.State.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'server\Modules\BdEngine.GoogleSheets.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'server\Modules\BdEngine.GoogleSheetSync.psm1') -Force -DisableNameChecking

$state = Get-AppState
$writeResult = Export-BdStateToGoogleSheets -SpreadsheetId $SpreadsheetId -State $state

Start-Sleep -Seconds 2

$configResult = $null
if (-not $SkipConfigSync) {
    $configScript = Join-Path $projectRoot 'scripts\Sync-LiveJobBoardsConfig.ps1'
    $configResult = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $configScript -SpreadsheetId $SpreadsheetId -ProbeLimit 0 -SkipHttpProbe
    if ($LASTEXITCODE -ne 0) {
        throw (@($configResult | ForEach-Object { [string]$_ }) -join "`n")
    }
    try {
        $configResult = @($configResult | ForEach-Object { [string]$_ }) -join "`n" | ConvertFrom-Json
    } catch {
        $configResult = [ordered]@{
            ok = $true
            raw = @($configResult | ForEach-Object { [string]$_ }) -join "`n"
        }
    }
}

[ordered]@{
    ok = $true
    spreadsheetId = $SpreadsheetId
    tabsWritten = $writeResult
    configSync = $configResult
} | ConvertTo-Json -Depth 10
