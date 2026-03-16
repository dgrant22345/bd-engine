param(
    [string]$SpreadsheetId = $env:GOOGLE_SHEETS_SPREADSHEET_ID,
    [string]$SeedBackupPath = '',
    [int]$ProbeLimit = 250,
    [int]$MinConnections = 3,
    [switch]$SkipHttpProbe,
    [switch]$WriteReviewQueue
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

$defaultSeedPath = Join-Path $projectRoot 'data\seed-job-boards-config.json'

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

function Normalize-ImportedRows {
    param([object[]]$Rows)

    $normalized = New-Object System.Collections.ArrayList
    foreach ($row in @($Rows)) {
        if ($null -eq $row) {
            continue
        }

        if ($row.PSObject.Properties.Name -contains 'value') {
            [void]$normalized.Add(@($row.value))
            continue
        }

        [void]$normalized.Add(@($row))
    }

    return @($normalized)
}

function Get-PaddedRow {
    param(
        [object[]]$Row,
        [int]$Width
    )

    $cells = New-Object System.Collections.ArrayList
    foreach ($value in @($Row)) {
        [void]$cells.Add([string]$value)
    }
    while ($cells.Count -lt $Width) {
        [void]$cells.Add('')
    }
    return @($cells.ToArray()[0..($Width - 1)])
}

function Get-RowSignature {
    param(
        [object[]]$Row,
        [int]$Width
    )

    return ((Get-PaddedRow -Row $Row -Width $Width) -join [char]31)
}

function Set-GoogleSheetRangeDiff {
    param(
        [string]$SpreadsheetId,
        [string]$SheetName,
        [string]$EndColumn,
        [object[]]$DesiredRows,
        [object[]]$ExistingRows
    )

    $width = 0
    foreach ($row in @($DesiredRows)) {
        $width = [Math]::Max($width, @($row).Count)
    }
    foreach ($row in @($ExistingRows)) {
        $width = [Math]::Max($width, @($row).Count)
    }
    if ($width -lt 1) {
        $width = 1
    }

    $desired = @($DesiredRows | ForEach-Object { ,(Get-PaddedRow -Row $_ -Width $width) })
    $existing = @($ExistingRows | ForEach-Object { ,(Get-PaddedRow -Row $_ -Width $width) })

    $writePlan = New-Object System.Collections.ArrayList
    $index = 0
    while ($index -lt $desired.Count) {
        $desiredSignature = Get-RowSignature -Row $desired[$index] -Width $width
        $existingSignature = if ($index -lt $existing.Count) { Get-RowSignature -Row $existing[$index] -Width $width } else { $null }
        if ($desiredSignature -eq $existingSignature) {
            $index += 1
            continue
        }

        $start = $index
        $blockRows = New-Object System.Collections.ArrayList
        while ($index -lt $desired.Count) {
            $desiredSignature = Get-RowSignature -Row $desired[$index] -Width $width
            $existingSignature = if ($index -lt $existing.Count) { Get-RowSignature -Row $existing[$index] -Width $width } else { $null }
            if ($desiredSignature -eq $existingSignature -and $blockRows.Count -gt 0) {
                break
            }
            [void]$blockRows.Add($desired[$index])
            $index += 1
        }

        [void]$writePlan.Add([ordered]@{
            start = $start
            rows = @($blockRows.ToArray())
        })
    }

    # Avoid Sheets write-rate limits: large diff churn is cheaper as chunked full rewrites.
    if ($writePlan.Count -gt 20) {
        if ($desired.Count -gt 0) {
            $chunkSize = 120
            $offset = 0
            while ($offset -lt $desired.Count) {
                $take = [Math]::Min($chunkSize, $desired.Count - $offset)
                $startRow = $offset + 1
                $endRow = $startRow + $take - 1
                $slice = New-Object System.Collections.ArrayList
                for ($i = $offset; $i -lt ($offset + $take); $i++) {
                    [void]$slice.Add($desired[$i])
                }
                Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range ("'{0}'!A{1}:{2}{3}" -f $SheetName, $startRow, $EndColumn, $endRow) -Values @($slice.ToArray()) | Out-Null
                $offset += $take
                Start-Sleep -Milliseconds 1200
            }
        }
    } else {
        foreach ($plan in @($writePlan.ToArray())) {
            $startRow = [int]$plan.start + 1
            $planRows = @($plan.rows)
            $endRow = $startRow + $planRows.Count - 1
            $valueMatrix = New-Object System.Collections.ArrayList
            foreach ($blockRow in @($planRows)) {
                [void]$valueMatrix.Add(@($blockRow))
            }
            Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range ("'{0}'!A{1}:{2}{3}" -f $SheetName, $startRow, $EndColumn, $endRow) -Values @($valueMatrix.ToArray()) | Out-Null
        }
    }

    if ($existing.Count -gt $desired.Count) {
        $clearStart = $desired.Count + 1
        Clear-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range ("'{0}'!A{1}:{2}{3}" -f $SheetName, $clearStart, $EndColumn, $existing.Count) | Out-Null
    }
}

function Test-ManualReviewConfig {
    param($Config)

    $method = ([string]$Config.discoveryMethod).ToLowerInvariant()
    $source = ([string]$Config.source).ToLowerInvariant()
    $notes = ([string]$Config.notes).ToLowerInvariant()

    if ($method.StartsWith('manual')) { return $true }
    if ($source -eq 'manual') { return $true }
    if ($notes -match 'enterprise ats|staffing|government ats|not supported|too vague|not a real company') { return $true }
    return $false
}

function Clear-BooleanArtifactFields {
    param($Config)

    foreach ($field in 'atsType', 'boardId', 'domain', 'careersUrl', 'source') {
        $value = [string]$Config[$field]
        if ($value -in @('TRUE', 'FALSE')) {
            $Config[$field] = ''
        }
    }

    return $Config
}

function Get-ConfigQualityScore {
    param($Config)

    $score = 0
    if (Test-ManualReviewConfig -Config $Config) { $score += 1000 }
    if ($Config.atsType) { $score += 100 }
    if ($Config.boardId) { $score += 75 }
    if ($Config.careersUrl) { $score += 50 }
    if ($Config.domain) { $score += 25 }
    if ($Config.discoveryStatus -eq 'verified') { $score += 20 }
    if ($Config.discoveryStatus -eq 'manual') { $score += 15 }
    return $score
}

function Get-ReviewAction {
    param($Config)

    if ($Config.discoveryStatus -eq 'verified') {
        return 'Ready for import'
    }
    if ($Config.discoveryStatus -eq 'known_unsupported') {
        return 'Recognized ATS; importer not built yet'
    }
    if ($Config.discoveryStatus -eq 'manual') {
        return 'Manual review / keep'
    }
    if ($Config.careersUrl) {
        return 'Inspect careers URL and identify ATS'
    }
    return 'Find careers page first'
}

function Get-ReviewPriorityRank {
    param(
        $Config,
        [int]$TargetScore = 0
    )

    $status = [string]$Config.discoveryStatus
    $atsType = [string]$Config.atsType
    $hasSupportedAts = @('greenhouse', 'lever', 'ashby', 'smartrecruiters') -contains $atsType
    $hasBoardId = -not [string]::IsNullOrWhiteSpace([string]$Config.boardId)
    $hasCareersUrl = -not [string]::IsNullOrWhiteSpace([string]$Config.careersUrl)
    $isActive = [bool]$Config.active

    if ($status -eq 'verified' -and $isActive -and $hasSupportedAts -and $hasBoardId) { return 99 }
    if ($hasSupportedAts -and -not $hasBoardId) { if ($TargetScore -ge 150) { return 1 } else { return 2 } }
    if ($status -in @('needs_review', 'likely')) { if ($TargetScore -ge 150) { return 1 } else { return 2 } }
    if ($status -eq 'unresolved') { if ($hasCareersUrl) { return 2 } else { return 5 } }
    if ($status -eq 'known_unsupported') { if ($TargetScore -ge 150) { return 3 } else { return 4 } }
    if ($status -eq 'manual') { return 4 }
    if ($hasCareersUrl) { return 3 }
    return 5
}

function Get-ReviewPriorityLabel {
    param([int]$Rank)

    if ($Rank -ge 99) { return '' }
    if ($Rank -le 2) { return 'High' }
    if ($Rank -le 4) { return 'Medium' }
    return 'Low'
}

function Test-SuppressedCompanyName {
    param(
        [string]$CompanyName
    )

    $value = ([string]$CompanyName).Trim().ToLowerInvariant()
    if (-not $value) {
        return $true
    }

    $exactMatches = @(
        'self-employed',
        'self employed',
        'freelance',
        'independent consultant',
        'independent',
        'consultant',
        'stealth startup',
        'stealth',
        'confidential',
        'open to work',
        'seeking opportunities',
        'currently seeking new opportunities',
        'retired'
    )

    if ($exactMatches -contains $value) {
        return $true
    }

    if ($value -match '(^| )self[- ]employed( |$)') { return $true }
    if ($value -match '(^| )freelance(r)?( |$)') { return $true }
    if ($value -match '(^| )independent consultant( |$)') { return $true }
    if ($value -match '(^| )open to work( |$)') { return $true }
    if ($value -match '(^| )seeking (new )?opportunit(y|ies)( |$)') { return $true }

    return $false
}

function Get-EndpointForDetectedAts {
    param($Config)

    switch ([string]$Config.atsType) {
        'greenhouse' {
            if ($Config.boardId) { return "https://boards-api.greenhouse.io/v1/boards/$($Config.boardId)/jobs?content=true" }
        }
        'lever' {
            if ($Config.boardId) { return "https://api.lever.co/v0/postings/$($Config.boardId)?mode=json" }
        }
        'ashby' {
            if ($Config.boardId) { return "https://api.ashbyhq.com/posting-api/job-board/$($Config.boardId)" }
        }
        'smartrecruiters' {
            if ($Config.boardId) { return "https://api.smartrecruiters.com/v1/companies/$($Config.boardId)/postings" }
        }
    }

    return [string]$Config.source
}

function Get-AtsInferenceFromText {
    param(
        [string]$Text,
        [string]$Url = ''
    )

    $value = ([string]$Text).ToLowerInvariant()
    if (-not $value) {
        return $null
    }

    if ($value -match 'boards-api\.greenhouse\.io/v1/boards/([a-z0-9-]+)' -or $value -match 'job-boards\.greenhouse\.io/([a-z0-9-]+)' -or $value -match 'boards\.greenhouse\.io/([a-z0-9-]+)') {
        return [ordered]@{ atsType = 'greenhouse'; boardId = $matches[1]; discoveryStatus = 'verified'; discoveryMethod = 'url_pattern'; notes = 'Verified Greenhouse board from careers URL'; supported = $true }
    }
    if ($value -match 'api\.lever\.co/v0/postings/([a-z0-9-]+)' -or $value -match 'lever\.co/([a-z0-9-]+)') {
        return [ordered]@{ atsType = 'lever'; boardId = $matches[1]; discoveryStatus = 'verified'; discoveryMethod = 'url_pattern'; notes = 'Verified Lever board from careers URL'; supported = $true }
    }
    if ($value -match 'jobs\.ashbyhq\.com/([a-z0-9-]+)' -or $value -match 'posting-api/job-board/([a-z0-9-]+)') {
        return [ordered]@{ atsType = 'ashby'; boardId = $matches[1]; discoveryStatus = 'verified'; discoveryMethod = 'url_pattern'; notes = 'Verified Ashby board from careers URL'; supported = $true }
    }
    if ($value -match 'jobs\.smartrecruiters\.com/([a-z0-9-]+)' -or $value -match 'api\.smartrecruiters\.com/v1/companies/([a-z0-9-]+)') {
        return [ordered]@{ atsType = 'smartrecruiters'; boardId = $matches[1]; discoveryStatus = 'verified'; discoveryMethod = 'url_pattern'; notes = 'Verified SmartRecruiters board from careers URL'; supported = $true }
    }

    if ($value -match 'myworkdayjobs\.com|workdayjobs\.com') {
        return [ordered]@{ atsType = 'workday'; boardId = ''; discoveryStatus = 'known_unsupported'; discoveryMethod = 'url_pattern'; notes = 'Recognized Workday career site (not imported yet)'; supported = $false }
    }
    if ($value -match 'successfactors|jobs\.sap\.com|career[s]?\.?successfactors') {
        return [ordered]@{ atsType = 'successfactors'; boardId = ''; discoveryStatus = 'known_unsupported'; discoveryMethod = 'url_pattern'; notes = 'Recognized SuccessFactors career site (not imported yet)'; supported = $false }
    }
    if ($value -match 'taleo|oraclecloud\.com/.+candidateexperience') {
        return [ordered]@{ atsType = 'taleo'; boardId = ''; discoveryStatus = 'known_unsupported'; discoveryMethod = 'url_pattern'; notes = 'Recognized Taleo/Oracle recruiting site (not imported yet)'; supported = $false }
    }
    if ($value -match 'icims\.com|icims\.jobs') {
        return [ordered]@{ atsType = 'icims'; boardId = ''; discoveryStatus = 'known_unsupported'; discoveryMethod = 'url_pattern'; notes = 'Recognized iCIMS career site (not imported yet)'; supported = $false }
    }
    if ($value -match 'jobvite') {
        return [ordered]@{ atsType = 'jobvite'; boardId = ''; discoveryStatus = 'known_unsupported'; discoveryMethod = 'url_pattern'; notes = 'Recognized Jobvite career site (not imported yet)'; supported = $false }
    }
    if ($value -match 'dayforcehcm\.com|dayforce') {
        return [ordered]@{ atsType = 'dayforce'; boardId = ''; discoveryStatus = 'known_unsupported'; discoveryMethod = 'url_pattern'; notes = 'Recognized Dayforce career site (not imported yet)'; supported = $false }
    }

    return $null
}

function Apply-AtsInference {
    param(
        $Config,
        $Inference
    )

    if (-not $Inference) {
        return $Config
    }

    $Config.atsType = [string]$Inference.atsType
    if ($Inference.boardId) {
        $Config.boardId = [string]$Inference.boardId
    }
    $Config.discoveryStatus = [string]$Inference.discoveryStatus
    $Config.discoveryMethod = [string]$Inference.discoveryMethod
    $Config.notes = [string]$Inference.notes
    $Config.source = Get-EndpointForDetectedAts -Config $Config
    if (-not $Config.lastCheckedAt) {
        $Config.lastCheckedAt = (Get-Date).ToString('o')
    }
    return $Config
}

function Invoke-CareersProbe {
    param($Config)

    $uri = [string]$Config.careersUrl
    if (-not $uri) {
        return $null
    }

    try {
        $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 20
    } catch {
        return $null
    }

    $content = [string]$response.Content
    $finalUrl = if ($response.BaseResponse -and $response.BaseResponse.ResponseUri) { [string]$response.BaseResponse.ResponseUri.AbsoluteUri } else { $uri }
    $joinedSignals = "$finalUrl `n $content"
    return Get-AtsInferenceFromText -Text $joinedSignals -Url $finalUrl
}

function Convert-ConfigToSheetRow {
    param(
        [Parameter(Mandatory = $true)]
        $Config
    )

    function Clean-CellText {
        param($Value)

        $text = [string]$Value
        $text = $text.Replace("`r", ' ').Replace("`n", ' ').Replace("`t", ' ')
        $text = $text.Replace('"', "'")
        $text = $text.Replace([char]0x201C, "'").Replace([char]0x201D, "'").Replace([char]0x2018, "'").Replace([char]0x2019, "'")
        return $text.Trim()
    }

    $lastChecked = ''
    if ($Config.lastCheckedAt) {
        $parsed = [datetime]::MinValue
        if ([datetime]::TryParse([string]$Config.lastCheckedAt, [ref]$parsed)) {
            $lastChecked = $parsed.ToString('dd/MM/yyyy')
        } else {
            $lastChecked = [string]$Config.lastCheckedAt
        }
    }

    return @(
        (Clean-CellText $Config.companyName),
        (Clean-CellText $Config.atsType),
        (Clean-CellText $Config.boardId),
        (Clean-CellText $Config.domain),
        (Clean-CellText $Config.careersUrl),
        $(if ($Config.active -eq $false) { 'FALSE' } else { 'TRUE' }),
        (Clean-CellText $Config.notes),
        (Clean-CellText $Config.source),
        '',
        '',
        '',
        (Clean-CellText $lastChecked),
        (Clean-CellText $Config.discoveryStatus),
        (Clean-CellText $Config.discoveryMethod)
    )
}

$targetRows = Get-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Target_Accounts'!A1:F"
$configRows = Get-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Job_Boards_Config'!A1:N"

if (-not $SeedBackupPath -and (Test-Path -LiteralPath $defaultSeedPath)) {
    $SeedBackupPath = $defaultSeedPath
}

if ((-not $configRows -or $configRows.Count -eq 0) -and -not $SeedBackupPath) {
    $backupCandidates = Get-ChildItem (Join-Path $projectRoot 'data\live-sheet-backups') -Filter 'job-boards-config-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    foreach ($candidate in @($backupCandidates)) {
        $rows = Normalize-ImportedRows -Rows (Get-Content -LiteralPath $candidate.FullName -Raw | ConvertFrom-Json)
        if (@($rows).Count -gt 1) {
            $configRows = @($rows)
            $SeedBackupPath = $candidate.FullName
            break
        }
    }
}

if ($SeedBackupPath) {
    $seedRows = Normalize-ImportedRows -Rows (Get-Content -LiteralPath $SeedBackupPath -Raw | ConvertFrom-Json)
    if (@($seedRows).Count -gt 1) {
        $configRows = @($seedRows)
    }
}

$targetObjects = Convert-RowsToObjects -Rows $targetRows
$configObjects = Convert-RowsToObjects -Rows $configRows

$backupRoot = Join-Path $projectRoot 'data\live-sheet-backups'
if (-not (Test-Path $backupRoot)) {
    New-Item -ItemType Directory -Path $backupRoot | Out-Null
}
$backupPath = Join-Path $backupRoot ("job-boards-config-{0}.json" -f (Get-Date).ToString('yyyyMMdd-HHmmss'))
@($configRows) | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $backupPath -Encoding UTF8

$companyOrder = New-Object System.Collections.ArrayList
$companyByKey = @{}
foreach ($row in @($targetObjects)) {
    $rawCompanyName = [string]$row.Company
    if (-not $rawCompanyName -or $rawCompanyName -eq 'Company') {
        continue
    }

    $connectionCount = [int](Convert-ToNumber $(if ($row.Contains('Connections')) { $row.Connections } elseif ($row.Contains('Your Connections')) { $row.'Your Connections' } else { 0 }))
    if ($connectionCount -lt $MinConnections) {
        continue
    }

    $companyName = Get-CanonicalCompanyDisplayName $rawCompanyName
    if (Test-SuppressedCompanyName -CompanyName $companyName) {
        continue
    }
    $key = Get-CanonicalCompanyKey $companyName
    if (-not $key) {
        continue
    }
    if ($companyByKey.ContainsKey($key)) {
        continue
    }

    $company = [ordered]@{
        id = New-DeterministicId -Prefix 'acctlive' -Seed $key
        workspaceId = 'workspace-default'
        normalizedName = $key
        displayName = $companyName
        connectionCount = $connectionCount
        careersUrl = ''
        targetScore = [int](Convert-ToNumber $row.'Target Score')
    }
    $companyByKey[$key] = $company
    [void]$companyOrder.Add($key)
}

$existingConfigs = New-Object System.Collections.ArrayList
foreach ($row in @($configObjects)) {
    $companyName = Get-CanonicalCompanyDisplayName ([string]$row.Company)
    if (Test-SuppressedCompanyName -CompanyName $companyName) {
        continue
    }
    $key = Get-CanonicalCompanyKey $companyName
    if (-not $key) {
        continue
    }

    $notes = if ($row.Contains('Notes ')) { [string]$row.'Notes ' } else { [string]$row.Notes }
    $config = [ordered]@{
        id = New-DeterministicId -Prefix 'cfgsheet' -Seed $key
        workspaceId = 'workspace-default'
        accountId = $null
        companyName = $companyName
        normalizedCompanyName = $key
        atsType = [string]$row.ATS_Type
        boardId = [string]$row.Board_ID
        domain = [string]$row.Domain
        careersUrl = [string]$row.Careers_URL
        source = [string]$row.Source
        notes = $notes
        active = if ($row.Active) { Test-Truthy $row.Active } else { $true }
        lastCheckedAt = Convert-ToDateString $(if ($row.Last_Checked) { $row.Last_Checked } else { '' })
        discoveryStatus = [string]$row.Discovery_Status
        discoveryMethod = [string]$row.Discovery_Method
        lastImportAt = $null
        lastImportStatus = ''
    }
    $config = Clear-BooleanArtifactFields -Config $config

    if ((Test-ManualReviewConfig -Config $config) -and -not $config.discoveryMethod) {
        $config.discoveryMethod = 'manual'
    }
    if ((Test-ManualReviewConfig -Config $config) -and -not $config.discoveryStatus) {
        $config.discoveryStatus = 'manual'
    }

    [void]$existingConfigs.Add($config)

    if ($companyByKey.ContainsKey($key) -and -not $companyByKey[$key].careersUrl -and $config.careersUrl) {
        $companyByKey[$key].careersUrl = $config.careersUrl
    }
}

$state = [ordered]@{
    workspace = [ordered]@{ id = 'workspace-default'; name = 'Google Sheets Live Sync' }
    companies = @($companyOrder | ForEach-Object { $companyByKey[$_] })
    boardConfigs = @($existingConfigs)
}

$state = Sync-BoardConfigsFromCompanies -State $state

$bestByCompany = @{}
foreach ($config in @($state.boardConfigs)) {
    $key = Get-CanonicalCompanyKey $(if ($config.normalizedCompanyName) { $config.normalizedCompanyName } else { $config.companyName })
    if (-not $companyByKey.ContainsKey($key)) {
        continue
    }

    if (-not $config.discoveryStatus) {
        $config.discoveryStatus = if (Test-ManualReviewConfig -Config $config) { 'manual' } elseif ($config.atsType) { 'likely' } else { 'needs_review' }
    }
    if (-not $config.discoveryMethod) {
        $config.discoveryMethod = if (Test-ManualReviewConfig -Config $config) { 'manual' } elseif ($config.atsType) { 'known_map' } else { 'account_seed' }
    }
    if (-not $config.notes) {
        $config.notes = if ($config.atsType) { 'Generated automatically from target accounts' } else { 'Needs review - ATS not inferred automatically yet' }
    }
    if (-not $config.lastCheckedAt) {
        $config.lastCheckedAt = (Get-Date).ToString('o')
    }
    if (-not $config.domain -and $config.careersUrl) {
        $config.domain = Get-DomainFromUrl -Url $config.careersUrl
    }
    $config = Clear-BooleanArtifactFields -Config $config
    if (-not $config.atsType -and $config.careersUrl) {
        $config = Apply-AtsInference -Config $config -Inference (Get-AtsInferenceFromText -Text $config.careersUrl -Url $config.careersUrl)
    }
    if (-not $config.careersUrl -and $config.discoveryMethod -eq 'careers_url') {
        $config.discoveryMethod = 'account_seed'
        $config.discoveryStatus = 'unresolved'
        if ($config.notes -eq 'Copied careers URL from account data') {
            $config.notes = 'No ATS inferred automatically yet'
        }
    }

    $candidateScore = Get-ConfigQualityScore -Config $config
    if (-not $bestByCompany.ContainsKey($key)) {
        $bestByCompany[$key] = $config
        continue
    }

    $currentScore = Get-ConfigQualityScore -Config $bestByCompany[$key]
    if ($candidateScore -gt $currentScore) {
        $bestByCompany[$key] = $config
    }
}

if (-not $SkipHttpProbe -and $ProbeLimit -gt 0) {
    $probeCandidates = @(
        $companyOrder |
            ForEach-Object { $bestByCompany[$_] } |
            Where-Object {
                $_ -and
                -not (Test-ManualReviewConfig -Config $_) -and
                $_.careersUrl -and
                (-not $_.atsType -or $_.discoveryStatus -in @('needs_review', 'unresolved'))
            } |
            Sort-Object @{ Expression = { [int]$companyByKey[$_.normalizedCompanyName].targetScore }; Descending = $true } |
            Select-Object -First $ProbeLimit
    )

    foreach ($config in @($probeCandidates)) {
        $inference = Invoke-CareersProbe -Config $config
        if (-not $inference) {
            continue
        }

        $bestByCompany[$config.normalizedCompanyName] = Apply-AtsInference -Config $config -Inference $inference
    }
}

$header = @('Company', 'ATS_Type', 'Board_ID', 'Domain', 'Careers_URL', 'Active', 'Notes', 'Source', '', '', '', 'Last_Checked', 'Discovery_Status', 'Discovery_Method')
$outputRows = New-Object System.Collections.ArrayList
[void]$outputRows.Add($header)

foreach ($key in @($companyOrder)) {
    if (-not $bestByCompany.ContainsKey($key)) {
        continue
    }
    [void]$outputRows.Add((Convert-ConfigToSheetRow -Config $bestByCompany[$key]))
}

$reviewHeader = @('Priority', 'Company', 'Connections', 'Target_Score', 'Discovery_Status', 'ATS_Type', 'Board_ID', 'Domain', 'Careers_URL', 'Notes', 'Recommended_Action')
$reviewRows = New-Object System.Collections.ArrayList
[void]$reviewRows.Add($reviewHeader)

$reviewCandidates = @(
    $companyOrder |
        ForEach-Object {
            $key = $_
            $config = $bestByCompany[$key]
            if (-not $config) { return $null }
            $targetScore = [int]$companyByKey[$key].targetScore
            $priorityRank = Get-ReviewPriorityRank -Config $config -TargetScore $targetScore
            $priorityLabel = Get-ReviewPriorityLabel -Rank $priorityRank
            if (-not $priorityLabel) { return $null }
            [ordered]@{
                companyKey = $key
                companyName = $config.companyName
                connections = [int]$companyByKey[$key].connectionCount
                targetScore = $targetScore
                discoveryStatus = [string]$config.discoveryStatus
                atsType = [string]$config.atsType
                boardId = [string]$config.boardId
                domain = [string]$config.domain
                careersUrl = [string]$config.careersUrl
                notes = [string]$config.notes
                action = Get-ReviewAction -Config $config
                priority = [int]$priorityRank
                priorityLabel = [string]$priorityLabel
            }
        } |
        Where-Object { $_ } |
        Sort-Object @(
            @{ Expression = { [int]$_.priority }; Descending = $false },
            @{ Expression = { [int]$_.targetScore }; Descending = $true },
            @{ Expression = { [int]$_.connections }; Descending = $true },
            @{ Expression = { [string]$_.companyName }; Descending = $false }
        ) |
        Select-Object -First 500
)

foreach ($item in @($reviewCandidates)) {
    [void]$reviewRows.Add(@(
        [string]$item.priorityLabel,
        [string]$item.companyName,
        [string]$item.connections,
        [string]$item.targetScore,
        [string]$item.discoveryStatus,
        [string]$item.atsType,
        [string]$item.boardId,
        [string]$item.domain,
        [string]$item.careersUrl,
        [string]$item.notes,
        [string]$item.action
    ))
}

$lastRow = @($outputRows).Count
Set-GoogleSheetRangeDiff -SpreadsheetId $SpreadsheetId -SheetName 'Job_Boards_Config' -EndColumn 'N' -DesiredRows @($outputRows) -ExistingRows @($configRows)

$reviewLastRow = @($reviewRows).Count
if ($WriteReviewQueue) {
    Ensure-GoogleSheetExists -SpreadsheetId $SpreadsheetId -SheetName 'Config_Review_Queue' | Out-Null
    $existingReviewRows = Get-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Config_Review_Queue'!A:K"
    Set-GoogleSheetRangeDiff -SpreadsheetId $SpreadsheetId -SheetName 'Config_Review_Queue' -EndColumn 'K' -DesiredRows @($reviewRows) -ExistingRows @($existingReviewRows)
}

[ordered]@{
    ok = $true
    spreadsheetId = $SpreadsheetId
    backupPath = $backupPath
    targetCompanies = @($companyOrder).Count
    writtenRows = $lastRow
    reviewRows = $reviewLastRow
} | ConvertTo-Json -Depth 10
