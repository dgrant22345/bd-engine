param(
    [string]$SpreadsheetId = $env:GOOGLE_SHEETS_SPREADSHEET_ID
)

$ErrorActionPreference = 'Stop'

if (-not $SpreadsheetId) {
    throw 'Provide -SpreadsheetId or set GOOGLE_SHEETS_SPREADSHEET_ID.'
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$syncScript = Join-Path $projectRoot 'scripts\Sync-LiveJobBoardsConfig.ps1'
$refreshScript = Join-Path $projectRoot 'scripts\Refresh-LiveHiringImport.ps1'

$syncOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -SpreadsheetId $SpreadsheetId -ProbeLimit 0 -SkipHttpProbe 2>&1
if ($LASTEXITCODE -ne 0) {
    throw (@($syncOutput | ForEach-Object { [string]$_ }) -join "`n")
}

$refreshOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $refreshScript -SpreadsheetId $SpreadsheetId 2>&1
if ($LASTEXITCODE -ne 0) {
    throw (@($refreshOutput | ForEach-Object { [string]$_ }) -join "`n")
}

$syncText = @($syncOutput | ForEach-Object { [string]$_ }) -join "`n"
$refreshText = @($refreshOutput | ForEach-Object { [string]$_ }) -join "`n"
$parsedSync = try { $syncText | ConvertFrom-Json } catch { $syncText }
$parsedRefresh = try { $refreshText | ConvertFrom-Json } catch { $refreshText }

[ordered]@{
    ok = $true
    configSync = $parsedSync
    jobRefresh = $parsedRefresh
} | ConvertTo-Json -Depth 20
