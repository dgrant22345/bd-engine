param(
    [string]$SpreadsheetId = $env:GOOGLE_SHEETS_SPREADSHEET_ID
)

$ErrorActionPreference = 'Stop'

if (-not $SpreadsheetId) {
    throw 'Provide -SpreadsheetId or set GOOGLE_SHEETS_SPREADSHEET_ID.'
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Import-Module (Join-Path $projectRoot 'server\Modules\BdEngine.State.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'server\Modules\BdEngine.Domain.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'server\Modules\BdEngine.JobImport.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'server\Modules\BdEngine.GoogleSheets.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'server\Modules\BdEngine.GoogleSheetSync.psm1') -Force -DisableNameChecking

function Convert-RowsToObjects {
    param([object[]]$Rows)

    if (-not $Rows -or $Rows.Count -eq 0) {
        return @()
    }

    $headers = @($Rows[0])
    $items = New-Object System.Collections.ArrayList
    foreach ($row in @($Rows | Select-Object -Skip 1)) {
        $record = [ordered]@{}
        for ($index = 0; $index -lt $headers.Count; $index++) {
            $header = [string]$headers[$index]
            if (-not $header) {
                continue
            }
            $record[$header] = if ($index -lt $row.Count) { [string]$row[$index] } else { '' }
        }
        if (@($record.Keys).Count -gt 0) {
            [void]$items.Add($record)
        }
    }

    return @($items)
}

function Add-AutomationLogRow {
    param(
        [string]$SpreadsheetId,
        [string]$Message
    )

    Ensure-GoogleSheetExists -SpreadsheetId $SpreadsheetId -SheetName 'Automation_Log' | Out-Null
    $rows = Get-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Automation_Log'!A:B"
    if (-not $rows -or $rows.Count -eq 0) {
        Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Automation_Log'!A1:B2" -Values @(
            ,@('Timestamp', 'Message')
            ,@((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message)
        ) | Out-Null
        return
    }

    $nextRow = @($rows).Count + 1
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range ("'Automation_Log'!A{0}:B{0}" -f $nextRow) -Values @(
        ,@((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message)
    ) | Out-Null
}

$configRows = Get-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Job_Boards_Config'!A1:N"
$configObjects = Convert-RowsToObjects -Rows $configRows

$configs = New-Object System.Collections.ArrayList
foreach ($row in @($configObjects)) {
    $companyName = Get-CanonicalCompanyDisplayName ([string]$row.Company)
    $normalizedCompanyName = Get-CanonicalCompanyKey $companyName
    if (-not $normalizedCompanyName) {
        continue
    }

    $seed = '{0}|{1}|{2}|{3}' -f $normalizedCompanyName, $row.ATS_Type, $row.Board_ID, $row.Careers_URL
    [void]$configs.Add([ordered]@{
        id = New-DeterministicId -Prefix 'cfgsheet' -Seed $seed
        workspaceId = 'workspace-default'
        accountId = $null
        companyName = $companyName
        normalizedCompanyName = $normalizedCompanyName
        atsType = ([string]$row.ATS_Type).ToLowerInvariant()
        boardId = [string]$row.Board_ID
        domain = [string]$row.Domain
        careersUrl = [string]$row.Careers_URL
        source = [string]$row.Source
        notes = [string]$row.Notes
        active = if ($row.Contains('Active') -and [string]$row.Active) { Test-Truthy $row.Active } else { $false }
        lastCheckedAt = Convert-ToDateString $(if ($row.Contains('Last_Checked')) { $row.Last_Checked } else { '' })
        discoveryStatus = [string]$row.Discovery_Status
        discoveryMethod = [string]$row.Discovery_Method
        lastImportAt = $null
        lastImportStatus = ''
    })
}

$state = [ordered]@{
    workspace = [ordered]@{
        id = 'workspace-default'
        name = 'Live Google Sheet Import'
    }
    settings = New-DefaultSettings
    companies = @()
    contacts = @()
    jobs = @()
    boardConfigs = @($configs)
    activities = @()
    importRuns = @()
}

$result = Invoke-LiveJobImport -State $state
$state = $result.state
$written = Write-GoogleSheetTab -SpreadsheetId $SpreadsheetId -SheetName 'Hiring_Import' -EndColumn 'I' -Rows (Get-HiringImportSheetRows -State $state)
Restore-BdSheetLogic -SpreadsheetId $SpreadsheetId | Out-Null

$jobCount = [Math]::Max(0, $written - 1)
$message = "Job refresh wrote $jobCount rows from $($result.importRun.stats.configs) active configs"
try {
    Add-AutomationLogRow -SpreadsheetId $SpreadsheetId -Message $message
} catch {
    $message = "$message (log skipped: $($_.Exception.Message))"
}

[ordered]@{
    ok = $true
    writtenRows = $written
    jobRows = $jobCount
    importRun = $result.importRun
} | ConvertTo-Json -Depth 20
