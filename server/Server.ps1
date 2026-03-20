param(
    [int]$Port = 8173,
    [switch]$OpenBrowser,
    [switch]$LocalOnly
)

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $projectRoot 'app'
$dataRoot = Join-Path $projectRoot 'data'

Import-Module (Join-Path $PSScriptRoot 'Modules\BdEngine.State.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Modules\BdEngine.Domain.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Modules\BdEngine.Import.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Modules\BdEngine.JobImport.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Modules\BdEngine.GoogleSheets.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Modules\BdEngine.GoogleSheetSync.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Modules\BdEngine.BackgroundJobs.psm1') -Force -DisableNameChecking

$targetScoreRepair = Repair-AppTargetScoreRollout -Persist
if ($targetScoreRepair.needed) {
    Write-Host ("Target-score rollout repair refreshed {0} accounts in {1}ms (scope={2}ms, persist={3}ms, maxTargetScore={4})." -f [int]$targetScoreRepair.accountCount, [int]$targetScoreRepair.deriveMs, [int]$targetScoreRepair.scopeLoadMs, [int]$targetScoreRepair.persistMs, [int]$targetScoreRepair.maxTargetScore)
}

function Get-DefaultWorkbookPath {
    $userProfile = [Environment]::GetFolderPath('UserProfile')
    $desktop = [Environment]::GetFolderPath('Desktop')
    $downloads = Join-Path $userProfile 'Downloads'
    $oneDriveDesktop = Join-Path $userProfile 'OneDrive\Desktop'

    $candidates = @(
        (Join-Path $oneDriveDesktop 'Google_Sheets_Daily_BD_Engine (1).xlsx'),
        (Join-Path $desktop 'Google_Sheets_Daily_BD_Engine (1).xlsx'),
        (Join-Path $downloads 'BD Engine - Final v 1.6 (1).xlsx'),
        (Join-Path $dataRoot 'workbook.xlsx')
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $candidates[0]
}

function Get-DefaultConnectionsCsvPath {
    $userProfile = [Environment]::GetFolderPath('UserProfile')
    $downloads = Join-Path $userProfile 'Downloads'
    $oneDriveDownloads = Join-Path $userProfile 'OneDrive\Downloads'

    $candidates = @(
        (Join-Path $downloads 'Connections.csv'),
        (Join-Path $downloads 'connections.csv'),
        (Join-Path $oneDriveDownloads 'Connections.csv'),
        (Join-Path $dataRoot 'Connections.csv')
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $candidates[0]
}

$defaultWorkbookPath = Get-DefaultWorkbookPath
$defaultConnectionsCsvPath = Get-DefaultConnectionsCsvPath
$defaultSpreadsheetId = [string]$env:GOOGLE_SHEETS_SPREADSHEET_ID
$script:ApiGetCache = @{}
$script:ApiGetCacheSignature = ''
$script:ServerStartedAt = (Get-Date).ToString('o')
$script:ServerWarmedAt = ''

function Write-ServerLog {
    param([string]$Message)
    Write-Host ("[{0}] {1}" -f (Get-Date).ToString('HH:mm:ss'), $Message)
}

function Write-SnapshotLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        $SnapshotResult
    )

    if (-not $SnapshotResult) {
        return
    }

    $source = [string]$SnapshotResult.source
    $hit = if ($SnapshotResult.hit) { 'true' } else { 'false' }
    $age = if ($null -ne $SnapshotResult.snapshotAgeSeconds) { [string]$SnapshotResult.snapshotAgeSeconds } else { 'n/a' }
    $rebuildMs = if ($null -ne $SnapshotResult.rebuildDurationMs) { [string]$SnapshotResult.rebuildDurationMs } else { 'n/a' }
    $dirty = if ($null -ne $SnapshotResult.dirty) { [string][bool]$SnapshotResult.dirty } else { 'n/a' }
    $dirtyReason = if ($SnapshotResult.dirtyReason) { [string]$SnapshotResult.dirtyReason } else { '' }
    $sourceRevision = if ($SnapshotResult.sourceRevision) { [string]$SnapshotResult.sourceRevision } else { '' }
    $currentRevision = if ($SnapshotResult.currentRevision) { [string]$SnapshotResult.currentRevision } else { '' }
    Write-ServerLog ("SNAPSHOT {0} source={1} hit={2} ageSeconds={3} rebuildMs={4} dirty={5} dirtyReason={6} sourceRevision={7} currentRevision={8}" -f $Name, $source, $hit, $age, $rebuildMs, $dirty, $dirtyReason, $sourceRevision, $currentRevision)
}

function Get-ContentType {
    param([string]$Path)
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.js' { 'application/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.svg' { 'image/svg+xml' }
        '.png' { 'image/png' }
        default { 'application/octet-stream' }
    }
}

function Get-ReasonPhrase {
    param([int]$StatusCode)
    switch ($StatusCode) {
        200 { 'OK' }
        201 { 'Created' }
        400 { 'Bad Request' }
        404 { 'Not Found' }
        405 { 'Method Not Allowed' }
        500 { 'Internal Server Error' }
        default { 'OK' }
    }
}

function New-Result {
    param([byte[]]$Bytes, [string]$ContentType, [int]$StatusCode = 200)
    [ordered]@{
        StatusCode = $StatusCode
        ContentType = $ContentType
        Bytes = if ($Bytes) { $Bytes } else { [byte[]]@() }
    }
}

function New-JsonResult {
    param($Data, [int]$StatusCode = 200)
    $json = $Data | ConvertTo-Json -Depth 100
    New-Result -Bytes ([System.Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8' -StatusCode $StatusCode
}

function New-TextResult {
    param([string]$Text, [int]$StatusCode = 200, [string]$ContentType = 'text/plain; charset=utf-8')
    New-Result -Bytes ([System.Text.Encoding]::UTF8.GetBytes($Text)) -ContentType $ContentType -StatusCode $StatusCode
}

function Parse-QueryString {
    param([string]$QueryString)
    $result = @{}
    if (-not $QueryString) { return $result }
    foreach ($pair in $QueryString -split '&') {
        if (-not $pair) { continue }
        $parts = $pair -split '=', 2
        $key = [uri]::UnescapeDataString($parts[0])
        if (-not $key) { continue }
        $value = if ($parts.Count -gt 1) { [uri]::UnescapeDataString($parts[1]) } else { '' }
        $result[$key] = $value
    }
    $result
}

function Get-QueryCacheKey {
    param([hashtable]$Query)

    if (-not $Query -or @($Query.Keys).Count -eq 0) {
        return ''
    }

    return [string]::Join('&', @(
        $Query.Keys |
            Sort-Object |
            ForEach-Object {
                '{0}={1}' -f [string]$_, [string]$Query[$_]
            }
    ))
}

function Get-CachedApiResult {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [hashtable]$Query = @{},
        [Parameter(Mandatory = $true)]
        [scriptblock]$Factory
    )

    $signature = Get-AppStateSignature
    if ($script:ApiGetCacheSignature -ne $signature) {
        $script:ApiGetCache = @{}
        $script:ApiGetCacheSignature = $signature
    }

    $cacheKey = '{0}?{1}' -f $Path, (Get-QueryCacheKey -Query $Query)
    if ($script:ApiGetCache.ContainsKey($cacheKey)) {
        return $script:ApiGetCache[$cacheKey]
    }

    $result = & $Factory
    $script:ApiGetCache[$cacheKey] = $result
    return $result
}

function Read-Request {
    param([System.Net.Sockets.TcpClient]$Client)

    $Client.ReceiveTimeout = 5000
    $Client.SendTimeout = 5000
    $stream = $Client.GetStream()
    $stream.ReadTimeout = 5000
    $stream.WriteTimeout = 5000
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $false, 8192, $true)
    try {
        $requestLine = $reader.ReadLine()
    } catch [System.IO.IOException] {
        return $null
    }
    if ([string]::IsNullOrWhiteSpace($requestLine)) { return $null }

    $parts = $requestLine.Split(' ')
    if ($parts.Count -lt 2) { throw 'Invalid HTTP request line.' }

    $headers = @{}
    while ($true) {
        try {
            $line = $reader.ReadLine()
        } catch [System.IO.IOException] {
            return $null
        }
        if ($line -eq $null -or $line -eq '') { break }
        $index = $line.IndexOf(':')
        if ($index -lt 0) { continue }
        $headers[$line.Substring(0, $index).Trim().ToLowerInvariant()] = $line.Substring($index + 1).Trim()
    }

    $body = ''
    if ($headers.ContainsKey('content-length')) {
        $length = [int]$headers['content-length']
        if ($length -gt 0) {
            $stream.ReadTimeout = 30000
            $buffer = New-Object char[] $length
            $read = 0
            while ($read -lt $length) {
                try {
                    $count = $reader.Read($buffer, $read, $length - $read)
                } catch [System.IO.IOException] {
                    break
                }
                if ($count -le 0) { break }
                $read += $count
            }
            if ($read -gt 0) { $body = -join $buffer[0..($read - 1)] }
        }
    }

    $target = $parts[1]
    $path = $target
    $query = @{}
    if ($target.Contains('?')) {
        $split = $target.Split('?', 2)
        $path = $split[0]
        $query = Parse-QueryString -QueryString $split[1]
    }

    [ordered]@{
        Method = $parts[0].ToUpperInvariant()
        Path = $path
        Query = $query
        Body = $body
        Stream = $stream
    }
}

function Read-JsonBody {
    param($Request)
    if (-not $Request.Body) { return [ordered]@{} }
    ConvertTo-PlainObject -InputObject ($Request.Body | ConvertFrom-Json)
}

function Get-PayloadValue {
    param(
        [Parameter(Mandatory = $true)]
        $Record,
        [Parameter(Mandatory = $true)]
        [string[]]$Names
    )

    if ($Record -is [System.Collections.IDictionary]) {
        foreach ($key in @($Record.Keys)) {
            $propertyKey = Normalize-TextKey ([string]$key)
            foreach ($name in $Names) {
                if ($propertyKey -eq (Normalize-TextKey $name)) {
                    return [string]$Record[$key]
                }
            }
        }
    } else {
        foreach ($property in @($Record.PSObject.Properties)) {
            $propertyKey = Normalize-TextKey $property.Name
            foreach ($name in $Names) {
                if ($propertyKey -eq (Normalize-TextKey $name)) {
                    return [string]$property.Value
                }
            }
        }
    }

    return ''
}

function Convert-ToStringList {
    param($Value)

    if ($null -eq $Value) {
        return @()
    }

    if ($Value -is [string]) {
        return @($Value -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }

    return @($Value | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
}

function Convert-ToAccountImportRow {
    param(
        [Parameter(Mandatory = $true)]
        $Record
    )

    if ($Record -is [string]) {
        $companyName = Get-CanonicalCompanyDisplayName ([string]$Record)
        if (-not $companyName) {
            return $null
        }

        return [ordered]@{
            company = $companyName
            domain = ''
            careersUrl = ''
            priority = ''
            owner = ''
            notes = ''
            status = ''
            nextAction = ''
            nextActionAt = ''
            tags = @()
        }
    }

    $companyName = Get-CanonicalCompanyDisplayName (Get-PayloadValue -Record $Record -Names @('company', 'company name', 'companyName', 'display name', 'displayName', 'name'))
    if (-not $companyName) {
        return $null
    }

    return [ordered]@{
        company = $companyName
        domain = (Get-PayloadValue -Record $Record -Names @('domain', 'website'))
        careersUrl = (Get-PayloadValue -Record $Record -Names @('careersUrl', 'careers_url', 'careers url', 'careers', 'career page', 'jobs url'))
        priority = (Get-PayloadValue -Record $Record -Names @('priority'))
        owner = (Get-PayloadValue -Record $Record -Names @('owner', 'ae'))
        notes = (Get-PayloadValue -Record $Record -Names @('notes'))
        status = (Get-PayloadValue -Record $Record -Names @('status'))
        nextAction = (Get-PayloadValue -Record $Record -Names @('nextAction', 'next action', 'next_action'))
        nextActionAt = (Get-PayloadValue -Record $Record -Names @('nextActionAt', 'next action at', 'next_action_at', 'follow up date'))
        tags = (Convert-ToStringList (Get-PayloadValue -Record $Record -Names @('tags', 'tag list')))
    }
}

function Parse-AccountImportRows {
    param(
        [Parameter(Mandatory = $true)]
        $Payload
    )

    $rows = New-Object System.Collections.ArrayList

    if ($Payload.rows) {
        foreach ($row in @($Payload.rows)) {
            $parsed = Convert-ToAccountImportRow -Record $row
            if ($parsed) {
                [void]$rows.Add($parsed)
            }
        }
    }

    if ($Payload.companies) {
        foreach ($companyName in @($Payload.companies)) {
            $parsed = Convert-ToAccountImportRow -Record ([string]$companyName)
            if ($parsed) {
                [void]$rows.Add($parsed)
            }
        }
    }

    if ($Payload.text) {
        $text = ([string]$Payload.text) -replace "`r", ''
        $lines = @($text -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        if ($lines.Count -gt 0) {
            $firstLine = $lines[0]
            $looksDelimited = ($firstLine.Contains(',') -or $firstLine.Contains("`t"))
            $looksLikeHeader = $firstLine -match '(?i)company|domain|careers|priority|owner|status'

            if ($looksDelimited -and $looksLikeHeader) {
                $delimiter = if ($firstLine.Contains("`t")) { "`t" } else { ',' }
                $records = $text | ConvertFrom-Csv -Delimiter $delimiter
                foreach ($record in @($records)) {
                    $parsed = Convert-ToAccountImportRow -Record $record
                    if ($parsed) {
                        [void]$rows.Add($parsed)
                    }
                }
            } else {
                foreach ($line in $lines) {
                    $parsed = Convert-ToAccountImportRow -Record $line
                    if ($parsed) {
                        [void]$rows.Add($parsed)
                    }
                }
            }
        }
    }

    return @($rows)
}

function Get-ConfigResults {
    param($State, [hashtable]$Query)
    $items = @($State.boardConfigs)
    if ($Query.q) {
        $needle = Normalize-TextKey $Query.q
        $items = @($items | Where-Object {
            (Normalize-TextKey $_.companyName) -like "*$needle*" -or
            (Normalize-TextKey $_.boardId) -like "*$needle*" -or
            (Normalize-TextKey $_.careersUrl) -like "*$needle*" -or
            (Normalize-TextKey $_.domain) -like "*$needle*"
        })
    }
    if ($Query.ats) { $items = @($items | Where-Object { $_.atsType -eq $Query.ats }) }
    if ($Query.discoveryStatus) { $items = @($items | Where-Object { $_.discoveryStatus -eq $Query.discoveryStatus }) }
    if ($Query.confidenceBand) { $items = @($items | Where-Object { ([string]$(if ($_.confidenceBand) { $_.confidenceBand } else { 'unresolved' })) -eq $Query.confidenceBand }) }
    if ($Query.reviewStatus) { $items = @($items | Where-Object { ([string]$(if ($_.reviewStatus) { $_.reviewStatus } else { 'pending' })) -eq $Query.reviewStatus }) }
    if ($Query.active) {
        $want = Test-Truthy $Query.active
        $items = @($items | Where-Object { (Test-Truthy $_.active) -eq $want })
    }
    $items = @($items | Sort-Object @(
            @{ Expression = { switch ([string]$(if ($_.confidenceBand) { $_.confidenceBand } else { 'unresolved' })) { 'high' { 1 } 'medium' { 2 } 'low' { 3 } default { 4 } } }; Descending = $false },
            @{ Expression = { [string]$_.companyName }; Descending = $false }
        ))
    $result = Get-PagedResult -Items $items -Page ([int]$Query.page) -PageSize ([int]$Query.pageSize)
    $result.items = @($result.items | ForEach-Object { Select-ConfigSummary -Config $_ })
    return $result
}

function Save-ConfigRecord {
    param($State, $Payload, [string]$ConfigId)
    $companyName = Get-CanonicalCompanyDisplayName ([string]$Payload.companyName)
    $normalizedCompanyName = Get-CanonicalCompanyKey $companyName
    if (-not $normalizedCompanyName) { throw 'Company name is required.' }

    $id = if ($ConfigId) {
        $ConfigId
    } else {
        New-DeterministicId -Prefix 'cfg' -Seed ('{0}|{1}|{2}|{3}' -f $normalizedCompanyName, $Payload.atsType, $Payload.boardId, $Payload.careersUrl)
    }

    $configs = New-Object System.Collections.ArrayList
    $matched = $false
    foreach ($config in @($State.boardConfigs)) {
        if ($config.id -ne $id) {
            [void]$configs.Add($config)
            continue
        }

        $config.companyName = $companyName
        $config.normalizedCompanyName = $normalizedCompanyName
        $config.atsType = ([string]$(if ($Payload.atsType) { $Payload.atsType } else { 'greenhouse' })).ToLowerInvariant()
        $config.boardId = [string]$Payload.boardId
        $config.domain = [string]$Payload.domain
        $config.careersUrl = [string]$Payload.careersUrl
        $config.resolvedBoardUrl = [string]$(if ($Payload.resolvedBoardUrl) { $Payload.resolvedBoardUrl } else { Get-ResolvedBoardUrl -AtsType ([string]$Payload.atsType) -BoardId ([string]$Payload.boardId) -FallbackUrl ([string]$Payload.careersUrl) })
        $config.source = [string]$(if ($Payload.source) { $Payload.source } else { 'manual' })
        $config.notes = [string]$Payload.notes
        $config.active = Test-Truthy $Payload.active
        $config.supportedImport = Test-ImportCapableAtsType -AtsType ([string]$config.atsType)
        $config.lastCheckedAt = (Get-Date).ToString('o')
        $config.lastResolutionAttemptAt = $config.lastCheckedAt
        $config.nextResolutionAttemptAt = (Get-Date).AddDays(30).ToString('o')
        $config.discoveryStatus = 'mapped'
        $config.discoveryMethod = 'manual'
        $config.confidenceScore = 100
        $config.confidenceBand = 'high'
        $config.evidenceSummary = 'Manually curated ATS config'
        $config.reviewStatus = 'approved'
        $config.failureReason = ''
        $config.redirectTarget = ''
        $config.matchedSignatures = @('manual')
        $config.attemptedUrls = @()
        $config.httpSummary = @()
        [void]$configs.Add($config)
        $matched = $true
    }

    if (-not $matched) {
        [void]$configs.Add([ordered]@{
            id = $id
            workspaceId = $State.workspace.id
            accountId = $null
            companyName = $companyName
            normalizedCompanyName = $normalizedCompanyName
            atsType = ([string]$(if ($Payload.atsType) { $Payload.atsType } else { 'greenhouse' })).ToLowerInvariant()
            boardId = [string]$Payload.boardId
            domain = [string]$Payload.domain
            careersUrl = [string]$Payload.careersUrl
            resolvedBoardUrl = [string]$(if ($Payload.resolvedBoardUrl) { $Payload.resolvedBoardUrl } else { Get-ResolvedBoardUrl -AtsType ([string]$Payload.atsType) -BoardId ([string]$Payload.boardId) -FallbackUrl ([string]$Payload.careersUrl) })
            source = [string]$(if ($Payload.source) { $Payload.source } else { 'manual' })
            notes = [string]$Payload.notes
            active = Test-Truthy $Payload.active
            supportedImport = Test-ImportCapableAtsType -AtsType ([string]$(if ($Payload.atsType) { $Payload.atsType } else { 'greenhouse' }))
            lastCheckedAt = (Get-Date).ToString('o')
            lastResolutionAttemptAt = (Get-Date).ToString('o')
            nextResolutionAttemptAt = (Get-Date).AddDays(30).ToString('o')
            discoveryStatus = 'mapped'
            discoveryMethod = 'manual'
            confidenceScore = 100
            confidenceBand = 'high'
            evidenceSummary = 'Manually curated ATS config'
            reviewStatus = 'approved'
            failureReason = ''
            redirectTarget = ''
            matchedSignatures = @('manual')
            attemptedUrls = @()
            httpSummary = @()
            lastImportAt = $null
            lastImportStatus = ''
        })
    }

    $State.boardConfigs = @($configs)
    $State
}

function Save-SettingsRecord {
    param($State, $Payload)
    foreach ($field in 'minCompanyConnections', 'minJobsPosted', 'contactPriorityThreshold', 'maxCompaniesToReview') {
        if (@($Payload.Keys) -contains $field) {
            $State.settings[$field] = [int](Convert-ToNumber $Payload[$field])
        }
    }
    if (@($Payload.Keys) -contains 'geographyFocus') { $State.settings.geographyFocus = [string]$Payload.geographyFocus }
    if (@($Payload.Keys) -contains 'gtaPriority') { $State.settings.gtaPriority = Test-Truthy $Payload.gtaPriority }
    $State.settings.updatedAt = (Get-Date).ToString('o')
    Save-AppSegment -Segment 'Settings' -Data $State.settings -SkipSnapshots
    $State
}

function Set-ConfigReviewDecision {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [string]$ConfigId,
        [Parameter(Mandatory = $true)]
        [ValidateSet('approve', 'reject', 'promote')]
        [string]$Decision
    )

    $updated = $null
    foreach ($config in @($State.boardConfigs)) {
        if ($config.id -ne $ConfigId) {
            continue
        }

        $timestamp = (Get-Date).ToString('o')
        switch ($Decision) {
            'approve' {
                $config.reviewStatus = 'approved'
                if (-not (Get-ObjectValue -Object $config -Name 'confidenceScore') -or [double](Convert-ToNumber (Get-ObjectValue -Object $config -Name 'confidenceScore')) -lt 85) {
                    $config.confidenceScore = 85
                }
                $config.confidenceBand = 'high'
                if (-not (Get-ObjectValue -Object $config -Name 'discoveryStatus') -or (Get-ObjectValue -Object $config -Name 'discoveryStatus') -eq 'no_match_supported_ats') {
                    $config.discoveryStatus = if (Get-ObjectValue -Object $config -Name 'atsType') { 'discovered' } else { 'mapped' }
                }
                if (-not (Get-ObjectValue -Object $config -Name 'discoveryMethod')) {
                    $config.discoveryMethod = 'manual_review'
                }
                $config.evidenceSummary = if (Get-ObjectValue -Object $config -Name 'evidenceSummary') { Get-ObjectValue -Object $config -Name 'evidenceSummary' } else { 'Approved during resolver review' }
                $config.failureReason = ''
                $config.supportedImport = Test-ImportCapableAtsType -AtsType ([string](Get-ObjectValue -Object $config -Name 'atsType'))
                if ($config.supportedImport) {
                    $config.active = $true
                }
            }
            'reject' {
                $config.reviewStatus = 'rejected'
                $config.active = $false
                $config.failureReason = if (Get-ObjectValue -Object $config -Name 'failureReason') { Get-ObjectValue -Object $config -Name 'failureReason' } else { 'Rejected during resolver review' }
                $config.nextResolutionAttemptAt = (Get-Date).AddDays(30).ToString('o')
            }
            'promote' {
                $config.supportedImport = Test-ImportCapableAtsType -AtsType ([string](Get-ObjectValue -Object $config -Name 'atsType'))
                $config.discoveryStatus = 'mapped'
                $config.discoveryMethod = 'known_override'
                $config.reviewStatus = 'promoted'
                $config.confidenceScore = 100
                $config.confidenceBand = 'high'
                $config.evidenceSummary = if (Get-ObjectValue -Object $config -Name 'evidenceSummary') { Get-ObjectValue -Object $config -Name 'evidenceSummary' } else { 'Promoted to explicit known mapping' }
                $config.failureReason = ''
                if (-not (Get-ObjectValue -Object $config -Name 'resolvedBoardUrl')) {
                    $config.resolvedBoardUrl = Get-ResolvedBoardUrl -AtsType ([string](Get-ObjectValue -Object $config -Name 'atsType')) -BoardId ([string](Get-ObjectValue -Object $config -Name 'boardId')) -FallbackUrl ([string](Get-ObjectValue -Object $config -Name 'careersUrl'))
                }
                if ($config.supportedImport) {
                    $config.active = $true
                }
                [void](Save-ResolverKnownMappingOverride -Config $config)
            }
        }

        $config.lastCheckedAt = $timestamp
        $config.lastResolutionAttemptAt = $timestamp
        if (-not (Get-ObjectValue -Object $config -Name 'nextResolutionAttemptAt') -or $Decision -ne 'reject') {
            $config.nextResolutionAttemptAt = (Get-Date).AddDays(30).ToString('o')
        }
        $updated = Select-ConfigSummary -Config $config
        break
    }

    if (-not $updated) {
        throw 'Config not found.'
    }

    $State.boardConfigs = @($State.boardConfigs)
    return [ordered]@{
        state = $State
        config = $updated
    }
}

function Invoke-GoogleSheetsConfigSync {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId,
        [string]$SeedBackupPath = ''
    )

    $scriptPath = Join-Path $projectRoot 'scripts\Sync-LiveJobBoardsConfig.ps1'
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        throw "Sync script not found at $scriptPath"
    }

    $args = @(
        '-NoProfile'
        '-ExecutionPolicy'
        'Bypass'
        '-File'
        $scriptPath
        '-SpreadsheetId'
        $SpreadsheetId
        '-ProbeLimit'
        '0'
        '-SkipHttpProbe'
    )

    if ($SeedBackupPath) {
        $args += @('-SeedBackupPath', [string]$SeedBackupPath)
    }

    $rawOutput = & powershell.exe @args 2>&1
    $textOutput = @($rawOutput | ForEach-Object { [string]$_ }) -join "`n"
    if ($LASTEXITCODE -ne 0) {
        throw $textOutput
    }

    try {
        return ($textOutput | ConvertFrom-Json)
    } catch {
        return [ordered]@{
            ok = $true
            raw = $textOutput
        }
    }
}

function Handle-ApiRequest {
    param($Request)

    $path = $Request.Path
    $method = $Request.Method
    $query = $Request.Query

    if ($path -eq '/api/health' -and $method -eq 'GET') { return (New-JsonResult ([ordered]@{ ok = $true })) }
    if ($path -eq '/api/runtime/status' -and $method -eq 'GET') {
        return (New-JsonResult (Get-BackgroundRuntimeStatus -ServerStartedAt $script:ServerStartedAt -ServerWarmedAt $script:ServerWarmedAt))
    }
    if ($path -eq '/api/background-jobs' -and $method -eq 'GET') {
        return (New-JsonResult (Find-AppBackgroundJobs -Query $query))
    }
    if ($path -match '^/api/background-jobs/([^/]+)/cancel$' -and $method -eq 'POST') {
        $job = Cancel-AppBackgroundJob -JobId $matches[1]
        if (-not $job) {
            return (New-JsonResult ([ordered]@{ error = 'Background job not found.' }) 404)
        }
        return (New-JsonResult $job)
    }
    if ($path -match '^/api/background-jobs/([^/]+)$' -and $method -eq 'GET') {
        $job = Get-AppBackgroundJob -JobId $matches[1]
        if (-not $job) {
            return (New-JsonResult ([ordered]@{ error = 'Background job not found.' }) 404)
        }
        return (New-JsonResult $job)
    }
    if ($path -eq '/api/admin/bootstrap' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            $workspace = Get-AppSegment -Segment 'Workspace'
            $settings = Get-AppSegment -Segment 'Settings'
            $filters = if (Test-AppStoreUsesSqlite) {
                $snapshot = Get-AppFilterSnapshotResult
                Write-SnapshotLog -Name 'filters' -SnapshotResult $snapshot
                $snapshot.payload
            } else {
                $state = Get-AppStateView -Segments @('Workspace', 'Settings', 'Companies', 'BoardConfigs')
                Get-AccountFilterOptions -State $state
            }

            $configQuery = @{
                page = if ($query.configPage) { $query.configPage } else { '1' }
                pageSize = if ($query.configPageSize) { $query.configPageSize } else { '20' }
                q = if ($query.configQ) { $query.configQ } else { '' }
                ats = if ($query.configAts) { $query.configAts } else { '' }
                active = if ($query.configActive) { $query.configActive } else { '' }
                discoveryStatus = if ($query.configDiscoveryStatus) { $query.configDiscoveryStatus } else { '' }
                confidenceBand = if ($query.configConfidenceBand) { $query.configConfidenceBand } else { '' }
                reviewStatus = if ($query.configReviewStatus) { $query.configReviewStatus } else { '' }
            }
            $enrichmentQuery = @{
                page = if ($query.enrichmentPage) { $query.enrichmentPage } else { '1' }
                pageSize = if ($query.enrichmentPageSize) { $query.enrichmentPageSize } else { '20' }
                confidence = if ($query.enrichmentConfidence) { $query.enrichmentConfidence } else { '' }
                missingDomain = if ($query.enrichmentMissingDomain) { $query.enrichmentMissingDomain } else { '' }
                missingCareersUrl = if ($query.enrichmentMissingCareersUrl) { $query.enrichmentMissingCareersUrl } else { '' }
                hasConnections = if ($query.enrichmentHasConnections) { $query.enrichmentHasConnections } else { '' }
                minTargetScore = if ($query.enrichmentMinTargetScore) { $query.enrichmentMinTargetScore } else { '' }
                topN = if ($query.enrichmentTopN) { $query.enrichmentTopN } else { '' }
            }

            $runtime = Get-BackgroundRuntimeStatus -ServerStartedAt $script:ServerStartedAt -ServerWarmedAt $script:ServerWarmedAt

            if (Test-AppStoreUsesSqlite) {
                $configs = Find-AppConfigsFast -Query $configQuery
                $resolverReport = Get-AppResolverCoverageReportFast
                $enrichmentReport = Get-AppEnrichmentCoverageReportFast
                $unresolvedQueue = Find-AppConfigsFast -Query @{ page = '1'; pageSize = '8'; confidenceBand = 'unresolved'; reviewStatus = 'pending' }
                $mediumQueue = Find-AppConfigsFast -Query @{ page = '1'; pageSize = '8'; confidenceBand = 'medium'; reviewStatus = 'pending' }
                $enrichmentQueue = Find-AppEnrichmentQueueFast -Query $enrichmentQuery
            } else {
                $state = Get-AppStateView -Segments @('Companies', 'BoardConfigs')
                $configs = Get-ConfigResults -State $state -Query $configQuery
                $resolverReport = [ordered]@{ summary = [ordered]@{}; byAtsType = @(); byConfidenceBand = @(); topFailureReasons = @(); history = @() }
                $enrichmentReport = [ordered]@{ summary = [ordered]@{}; byConfidence = @(); bySource = @(); resolutionByEnrichmentPresence = @(); topUnresolvedReasons = @(); history = @() }
                $unresolvedQueue = Get-ConfigResults -State $state -Query @{ page = '1'; pageSize = '8'; confidenceBand = 'unresolved'; reviewStatus = 'pending' }
                $mediumQueue = Get-ConfigResults -State $state -Query @{ page = '1'; pageSize = '8'; confidenceBand = 'medium'; reviewStatus = 'pending' }
                $enrichmentQueue = [ordered]@{ items = @(); total = 0; page = 1; pageSize = 20 }
            }

            New-JsonResult ([ordered]@{
                bootstrap = [ordered]@{
                    workspace = $workspace
                    settings = $settings
                    filters = $filters
                    ownerRoster = @(Get-OwnerRoster)
                    defaults = [ordered]@{
                        workbookPath = $defaultWorkbookPath
                        connectionsCsvPath = $defaultConnectionsCsvPath
                        spreadsheetId = $defaultSpreadsheetId
                    }
                }
                configs = $configs
                runtime = $runtime
                resolverReport = $resolverReport
                enrichmentReport = $enrichmentReport
                unresolvedQueue = $unresolvedQueue
                mediumQueue = $mediumQueue
                enrichmentQueue = $enrichmentQueue
            })
        })
    }
    if ($path -eq '/api/bootstrap' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            $includeFilters = Test-Truthy $query.includeFilters
            if ($includeFilters) {
                $workspace = Get-AppSegment -Segment 'Workspace'
                $settings = Get-AppSegment -Segment 'Settings'
                $filters = if (Test-AppStoreUsesSqlite) {
                    $snapshot = Get-AppFilterSnapshotResult
                    Write-SnapshotLog -Name 'filters' -SnapshotResult $snapshot
                    $snapshot.payload
                } else {
                    $state = Get-AppStateView -Segments @('Workspace', 'Settings', 'Companies', 'BoardConfigs')
                    Get-AccountFilterOptions -State $state
                }
            } else {
                $workspace = Get-AppSegment -Segment 'Workspace'
                $settings = Get-AppSegment -Segment 'Settings'
                $filters = $null
            }

            New-JsonResult ([ordered]@{
                workspace = $workspace
                settings = $settings
                filters = $filters
                ownerRoster = @(Get-OwnerRoster)
                defaults = [ordered]@{
                    workbookPath = $defaultWorkbookPath
                    connectionsCsvPath = $defaultConnectionsCsvPath
                    spreadsheetId = $defaultSpreadsheetId
                }
            })
        })
    }
    if ($path -eq '/api/owners' -and $method -eq 'GET') {
        return New-JsonResult ([ordered]@{
            owners = @(Get-OwnerRoster)
        })
    }
    if ($path -eq '/api/dashboard/extended' -and $method -eq 'GET') {
        $state = Get-AppStateView -Segments @('Companies', 'Activities', 'BoardConfigs')
        $playbook = Get-PlaybookAccounts -State $state
        $overdue = Get-OverdueFollowUps -State $state
        $stale = Get-StaleAccounts -State $state
        $activityFeed = Get-GlobalActivityFeed -State $state -Limit 10
        $enrichmentFunnel = Get-EnrichmentFunnelStats -State $state
        return (New-JsonResult ([ordered]@{
            playbook = $playbook
            overdueFollowUps = $overdue
            staleAccounts = $stale
            activityFeed = $activityFeed
            enrichmentFunnel = $enrichmentFunnel
        }))
    }

    if ($path -eq '/api/dashboard' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            if (Test-AppStoreUsesSqlite) {
                $snapshot = Get-AppDashboardSnapshotResult
                Write-SnapshotLog -Name 'dashboard' -SnapshotResult $snapshot
                New-JsonResult $snapshot.payload
            } else {
                $state = Get-AppStateView -Segments @('Settings', 'Companies', 'Jobs', 'BoardConfigs')
                New-JsonResult (Get-DashboardModel -State $state)
            }
        })
    }
    if ($path -eq '/api/accounts' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            if (Test-AppStoreUsesSqlite) {
                New-JsonResult (Find-AppAccountsFast -Query $query)
            } else {
                $state = Get-AppStateView -Segments @('Companies')
                New-JsonResult (Find-Accounts -State $state -Query $query)
            }
        })
    }
    if ($path -eq '/api/accounts' -and $method -eq 'POST') {
        $state = Get-AppState
        $payload = Read-JsonBody -Request $Request
        if (@($payload.Keys) -contains 'tags') {
            $payload.tags = Convert-ToStringList $payload.tags
        }
        $result = Add-Account -State $state -Payload $payload
        $state = $result.state
        Save-AppSegment -Segment 'Companies' -Data $state.companies -SkipSnapshots
        $account = @($state.companies | Where-Object { $_.id -eq $result.account.id } | Select-Object -First 1)
        return (New-JsonResult $account 201)
    }
    if ($path -eq '/api/accounts/import' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request
        $rows = @(Parse-AccountImportRows -Payload $payload)
        if ($rows.Count -eq 0) {
            return (New-JsonResult ([ordered]@{ error = 'No importable account rows were found.' }) 400)
        }

        $state = Get-AppState
        $result = Import-Accounts -State $state -Rows $rows
        $state = $result.state
        Save-AppSegment -Segment 'Companies' -Data $state.companies
        return (New-JsonResult ([ordered]@{
            ok = $true
            count = $result.count
            accounts = @($result.accounts | Select-Object -First 50)
        }) 201)
    }
    if ($path -match '^/api/accounts/([^/]+)/generate-outreach$' -and $method -eq 'POST') {
        $accountId = $matches[1]
        $payload = Read-JsonBody -Request $Request
        $bookingLink = if ($payload.bookingLink) { [string]$payload.bookingLink } else { 'https://tinyurl.com/ysdep7cn' }

        # Fetch account detail
        $detail = if (Test-AppStoreUsesSqlite) {
            Get-AppAccountDetailFast -AccountId $accountId
        } else {
            $state = Get-AppStateView -Segments @('Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities')
            Get-AccountDetail -State $state -AccountId $accountId
        }
        if (-not $detail) { return (New-JsonResult ([ordered]@{ error = 'Not found' }) 404) }

        # Quick web search for company context
        $companySnippet = ''
        try {
            $searchQuery = "$($detail.account.displayName) company about"
            $searchUrl = 'https://duckduckgo.com/html/?q=' + [uri]::EscapeDataString($searchQuery)
            $searchResp = Invoke-WebRequest -Uri $searchUrl -UseBasicParsing -TimeoutSec 5 -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36' -ErrorAction Stop
            $snippets = @([regex]::Matches($searchResp.Content, '<a class="result__snippet"[^>]*>(.*?)</a>') | ForEach-Object { ($_.Groups[1].Value -replace '<[^>]+>', '') -replace '&amp;', '&' -replace '&#x27;', "'" -replace '&quot;', '"' } | Where-Object { $_.Length -gt 40 } | Select-Object -First 1)
            if ($snippets.Count -gt 0) {
                $companySnippet = [string]$snippets[0]
                if ($companySnippet.Length -gt 200) { $companySnippet = $companySnippet.Substring(0, 197) + '...' }
            }
        } catch {
            # Non-critical, proceed without snippet
        }

        $outreachParams = @{
            Account = $detail.account
            Jobs = $detail.jobs
            Contacts = $detail.contacts
            BookingLink = $bookingLink
            CompanySnippet = $companySnippet
        }
        if ($payload.contactName) { $outreachParams.OverrideContactName = [string]$payload.contactName }
        if ($payload.contactTitle) { $outreachParams.OverrideContactTitle = [string]$payload.contactTitle }
        if ($payload.template) { $outreachParams.Template = [string]$payload.template }
        $outreach = Build-SmartOutreachDraft @outreachParams

        return (New-JsonResult ([ordered]@{
            outreach = [string](Get-ObjectValue -Object $outreach -Name 'message_body' -Default '')
            subject_line = [string](Get-ObjectValue -Object $outreach -Name 'subject_line' -Default '')
            message_body = [string](Get-ObjectValue -Object $outreach -Name 'message_body' -Default '')
            companySnippet = $companySnippet
        }))
    }

    # Quick update endpoint - lightweight account patch with auto activity log
    if ($path -match '^/api/accounts/([^/]+)/quick-update$' -and $method -eq 'PATCH') {
        $accountId = $matches[1]
        $state = Get-AppState
        $payload = Read-JsonBody -Request $Request
        $result = Set-AccountFields -State $state -AccountId $accountId -Patch $payload
        if ($payload.quickNote) {
            $activity = Add-Activity -State $state -Payload ([ordered]@{
                accountId = $accountId
                normalizedCompanyName = [string]$result.account.normalizedName
                type = 'note'
                summary = [string]$payload.quickNote
            })
            Save-AppSegment -Segment 'Activities' -Data $state.activities -SkipSnapshots
        }
        Save-AppSegment -Segment 'Companies' -Data $state.companies -SkipSnapshots
        return (New-JsonResult $result.account)
    }

    # Hiring velocity for an account
    if ($path -match '^/api/accounts/([^/]+)/hiring-velocity$' -and $method -eq 'GET') {
        $accountId = $matches[1]
        $detail = if (Test-AppStoreUsesSqlite) {
            Get-AppAccountDetailFast -AccountId $accountId
        } else {
            $state = Get-AppStateView -Segments @('Companies', 'Jobs')
            Get-AccountDetail -State $state -AccountId $accountId
        }
        if (-not $detail) { return (New-JsonResult ([ordered]@{ error = 'Not found' }) 404) }
        $velocity = Get-HiringVelocity -Jobs $detail.jobs
        return (New-JsonResult $velocity)
    }

    if ($path -match '^/api/accounts/([^/]+)$') {
        $accountId = $matches[1]
        if ($method -eq 'GET') {
            return (Get-CachedApiResult -Path $path -Query $query -Factory {
                $detail = if (Test-AppStoreUsesSqlite) {
                    Get-AppAccountDetailFast -AccountId $accountId
                } else {
                    $state = Get-AppStateView -Segments @('Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities')
                    Get-AccountDetail -State $state -AccountId $accountId
                }
                if (-not $detail) { return (New-JsonResult ([ordered]@{ error = 'Not found' }) 404) }
                New-JsonResult $detail
            })
        }
        if ($method -eq 'PATCH') {
            $state = Get-AppState
            $payload = Read-JsonBody -Request $Request
            if (@($payload.Keys) -contains 'tags') {
                $payload.tags = Convert-ToStringList $payload.tags
            }
            $result = Set-AccountFields -State $state -AccountId $accountId -Patch $payload
            Save-AppSegment -Segment 'Companies' -Data $result.state.companies -SkipSnapshots
            return (New-JsonResult $result.account)
        }
        if ($method -eq 'DELETE') {
            $state = Get-AppState
            $result = Remove-Account -State $state -AccountId $accountId
            Save-AppSegment -Segment 'Companies' -Data $result.state.companies -SkipSnapshots
            return (New-JsonResult ([ordered]@{ ok = $true }))
        }
    }

    # Bulk account update
    if ($path -eq '/api/accounts/bulk' -and $method -eq 'PATCH') {
        $state = Get-AppState
        $payload = Read-JsonBody -Request $Request
        $ids = @($payload.ids)
        $patch = [ordered]@{}
        if ($payload.status) { $patch.status = [string]$payload.status }
        if ($payload.owner) { $patch.owner = [string]$payload.owner }
        if ($payload.priority) { $patch.priority = [string]$payload.priority }
        if ($payload.outreachStatus) { $patch.outreachStatus = [string]$payload.outreachStatus }
        $result = Invoke-BulkAccountUpdate -State $state -AccountIds $ids -Patch $patch
        Save-AppSegment -Segment 'Companies' -Data $state.companies -SkipSnapshots
        return (New-JsonResult $result)
    }

    # Duplicate contacts
    if ($path -eq '/api/contacts/duplicates' -and $method -eq 'GET') {
        $state = Get-AppStateView -Segments @('Contacts')
        $duplicates = Find-DuplicateContacts -State $state
        return (New-JsonResult ([ordered]@{ duplicates = $duplicates }))
    }

    # Global activity feed
    if ($path -eq '/api/activity/feed' -and $method -eq 'GET') {
        $state = Get-AppStateView -Segments @('Activities', 'Companies')
        $feed = Get-GlobalActivityFeed -State $state -Limit 15
        return (New-JsonResult ([ordered]@{ items = $feed }))
    }

    # Enrichment funnel stats
    if ($path -eq '/api/enrichment/funnel' -and $method -eq 'GET') {
        $state = Get-AppStateView -Segments @('Companies', 'BoardConfigs')
        $funnel = Get-EnrichmentFunnelStats -State $state
        return (New-JsonResult $funnel)
    }

    if ($path -eq '/api/contacts' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            if (Test-AppStoreUsesSqlite) {
                New-JsonResult (Find-AppContactsFast -Query $query)
            } else {
                $state = Get-AppStateView -Segments @('Contacts')
                New-JsonResult (Find-Contacts -State $state -Query $query)
            }
        })
    }
    if ($path -match '^/api/contacts/([^/]+)$' -and $method -eq 'PATCH') {
        $state = Get-AppState
        $result = Set-ContactFields -State $state -ContactId $matches[1] -Patch (Read-JsonBody -Request $Request)
        Save-AppSegment -Segment 'Contacts' -Data $result.state.contacts -SkipSnapshots
        return (New-JsonResult $result.contact)
    }

    if ($path -eq '/api/jobs' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            if (Test-AppStoreUsesSqlite) {
                New-JsonResult (Find-AppJobsFast -Query $query)
            } else {
                $state = Get-AppStateView -Segments @('Jobs')
                New-JsonResult (Find-Jobs -State $state -Query $query)
            }
        })
    }
    if ($path -eq '/api/configs' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            if (Test-AppStoreUsesSqlite) {
                New-JsonResult (Find-AppConfigsFast -Query $query)
            } else {
                $state = Get-AppStateView -Segments @('BoardConfigs')
                New-JsonResult (Get-ConfigResults -State $state -Query $query)
            }
        })
    }
    if ($path -eq '/api/configs/report' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            if (Test-AppStoreUsesSqlite) {
                New-JsonResult (Get-AppResolverCoverageReportFast)
            } else {
                $state = Get-AppStateView -Segments @('BoardConfigs')
                $configs = @($state.boardConfigs)
                $total = $configs.Count
                $resolved = @($configs | Where-Object { $_.discoveryStatus -in @('mapped', 'discovered') }).Count
                New-JsonResult ([ordered]@{
                    summary = [ordered]@{
                        totalCompanies = $total
                        resolvedCount = $resolved
                        unresolvedCount = [int][Math]::Max(0, $total - $resolved)
                        activeCount = @($configs | Where-Object { $_.active }).Count
                        coveragePercent = if ($total -gt 0) { [double][Math]::Round(($resolved / $total) * 100, 1) } else { 0 }
                        mediumReviewQueueCount = @($configs | Where-Object { $_.confidenceBand -eq 'medium' -and ([string]$(if ($_.reviewStatus) { $_.reviewStatus } else { 'pending' })) -eq 'pending' }).Count
                        unresolvedReviewQueueCount = @($configs | Where-Object { ([string]$(if ($_.confidenceBand) { $_.confidenceBand } else { 'unresolved' })) -eq 'unresolved' -and ([string]$(if ($_.reviewStatus) { $_.reviewStatus } else { 'pending' })) -ne 'rejected' }).Count
                    }
                    byAtsType = @()
                    byConfidenceBand = @()
                    topFailureReasons = @()
                    history = @()
                })
            }
        })
    }
    if ($path -eq '/api/enrichment/report' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            if (Test-AppStoreUsesSqlite) {
                New-JsonResult (Get-AppEnrichmentCoverageReportFast)
            } else {
                $state = Get-AppStateView -Segments @('Companies', 'BoardConfigs')
                $companies = @($state.companies)
                $total = @($companies).Count
                $withDomain = @($companies | Where-Object { $_.canonicalDomain -or $_.domain }).Count
                $withCareers = @($companies | Where-Object { $_.careersUrl }).Count
                $withAliases = @($companies | Where-Object { @($_.aliases).Count -gt 0 }).Count
                $enriched = @($companies | Where-Object { ([string]$_.enrichmentStatus) -in @('enriched', 'verified', 'manual') }).Count
                New-JsonResult ([ordered]@{
                    summary = [ordered]@{
                        totalCompanies = $total
                        canonicalDomainCount = $withDomain
                        careersUrlCount = $withCareers
                        aliasesCount = $withAliases
                        enrichedCount = $enriched
                        unenrichedCount = [int][Math]::Max(0, $total - $enriched)
                        enrichmentCoveragePercent = if ($total -gt 0) { [double][Math]::Round(($enriched / $total) * 100, 1) } else { 0 }
                    }
                    byConfidence = @()
                    bySource = @()
                    resolutionByEnrichmentPresence = @()
                    topUnresolvedReasons = @()
                    history = @()
                })
            }
        })
    }
    if ($path -eq '/api/enrichment/queue' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            if (Test-AppStoreUsesSqlite) {
                New-JsonResult (Find-AppEnrichmentQueueFast -Query $query)
            } else {
                $state = Get-AppStateView -Segments @('Companies')
                $items = @(
                    $state.companies |
                        Where-Object {
                            -not $_.canonicalDomain -or
                            -not $_.careersUrl -or
                            ([string]$_.enrichmentStatus) -notin @('enriched', 'verified', 'manual')
                        } |
                        Sort-Object @(
                            @{ Expression = { if (-not $_.canonicalDomain -and -not $_.careersUrl) { 0 } elseif (-not $_.canonicalDomain -or -not $_.careersUrl) { 1 } else { 2 } }; Descending = $false },
                            @{ Expression = { [double]$_.dailyScore }; Descending = $true },
                            @{ Expression = { [double]$_.targetScore }; Descending = $true },
                            @{ Expression = { [int]$_.connectionCount }; Descending = $true }
                        ) |
                        Select-Object -First 20 |
                        ForEach-Object { Select-AccountSummary -Company $_ }
                )
                New-JsonResult ([ordered]@{
                    page = 1
                    pageSize = 20
                    total = @($items).Count
                    items = $items
                })
            }
        })
    }
    if ($path -match '^/api/companies/([^/]+)/enrichment$' -and $method -eq 'PATCH') {
        $accountId = $matches[1]
        $payload = Read-JsonBody -Request $Request
        $state = Get-AppState
        $company = @($state.companies | Where-Object { $_.id -eq $accountId } | Select-Object -First 1)
        if (-not $company) {
            return (New-JsonResult ([ordered]@{ error = 'Company not found' }) 404)
        }
        
        $patch = [ordered]@{}
        foreach ($key in 'canonicalDomain', 'careersUrl', 'linkedInCompanySlug') {
            if (@($payload.Keys) -contains $key) {
                $patch[$key] = [string]$payload[$key]
            }
        }
        if (@($payload.Keys) -contains 'aliases') {
            $patch.aliases = @(Convert-ToStringList $payload.aliases)
        }
        
        $patch.enrichmentStatus = 'manual'
        $patch.enrichmentScore = 100
        $patch.enrichmentConfidence = 'high'
        $patch.enrichmentSource = 'manual_review'
        $patch.lastEnrichedAt = (Get-Date).ToString('o')
        $patch.lastVerifiedAt = (Get-Date).ToString('o')
        
        $result = Set-AccountFields -State $state -AccountId $accountId -Patch $patch
        Save-AppSegment -Segment 'Companies' -Data $result.state.companies -SkipSnapshots
        return (New-JsonResult $result.account 200)
    }
    if ($path -eq '/api/enrichment/run' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request
        $job = Enqueue-BackgroundJob -Type 'company-enrichment' -Payload ([ordered]@{
            limit = [int]$(if ($payload.limit) { $payload.limit } else { 500 })
            forceRefresh = [bool]$(if (@($payload.Keys) -contains 'forceRefresh') { Test-Truthy $payload.forceRefresh } else { $false })
            accountId = [string]$(if ($payload.accountId) { $payload.accountId } else { '' })
        }) -Summary 'Enrich company identity inputs' -ProgressMessage 'Queued company enrichment'
        Write-ServerLog ("JOB enqueue id={0} type={1}" -f $job.id, $job.type)
        return (New-JsonResult (Get-BackgroundJobAcceptedResult -Job $job) 202)
    }
    if ($path -eq '/api/enrichment/run-local' -and $method -eq 'POST') {
        # Direct fast-path: run local SQL enrichment pass synchronously and return stats.
        # No HTTP probing — just derives domain/careers from contact emails and board configs.
        $payload = Read-JsonBody -Request $Request
        $forceRefresh = [bool]$(if (@($payload.Keys) -contains 'forceRefresh') { Test-Truthy $payload.forceRefresh } else { $false })
        $localStats = Invoke-AppLocalEnrichmentPassFast -ForceRefresh:$forceRefresh
        Write-ServerLog ("LOCAL-ENRICH contactEmail={0} boardDomain={1} boardCareers={2} total={3}" -f `
            [int]$localStats.contactEmailDomainApplied, [int]$localStats.boardConfigDomainApplied,
            [int]$localStats.boardConfigCareersApplied, [int]$localStats.totalUpdated)
        return (New-JsonResult ([ordered]@{ success = $true; stats = $localStats }) 200)
    }

    if ($path -match '^/api/enrichment/([^/]+)/rerun-resolution$' -and $method -eq 'POST') {
        $accountId = $matches[1]
        $state = Get-AppStateView -Segments @('Companies', 'BoardConfigs')
        $account = @($state.companies | Where-Object { $_.id -eq $accountId } | Select-Object -First 1)
        if (-not $account) {
            return (New-JsonResult ([ordered]@{ error = 'Account not found' }) 404)
        }
        $config = @($state.boardConfigs | Where-Object { $_.accountId -eq $accountId -or $_.normalizedCompanyName -eq $account.normalizedName } | Select-Object -First 1)
        if (-not $config) {
            return (New-JsonResult ([ordered]@{ error = 'No ATS config found for that account' }) 404)
        }
        $job = Enqueue-BackgroundJob -Type 'ats-discovery' -Payload ([ordered]@{
            limit = 1
            onlyMissing = $false
            forceRefresh = $true
            configId = [string]$config.id
        }) -Summary 'Rerun ATS resolution after enrichment update' -ProgressMessage 'Queued ATS resolution'
        Write-ServerLog ("JOB enqueue id={0} type={1}" -f $job.id, $job.type)
        return (New-JsonResult (Get-BackgroundJobAcceptedResult -Job $job) 202)
    }
    if ($path -eq '/api/configs' -and $method -eq 'POST') {
        $state = Get-AppState
        $state = Save-ConfigRecord -State $state -Payload (Read-JsonBody -Request $Request)
        $state = Sync-ImportedCompanyData -State $state
        $state = Update-DerivedData -State $state
        Save-AppState -State $state
        return (New-JsonResult ([ordered]@{ ok = $true; count = @($state.boardConfigs).Count }) 201)
    }
    if ($path -eq '/api/configs/sync' -and $method -eq 'POST') {
        $job = Enqueue-BackgroundJob -Type 'config-sync' -Payload ([ordered]@{}) -Summary 'Rebuild ATS config records' -ProgressMessage 'Queued config rebuild'
        Write-ServerLog ("JOB enqueue id={0} type={1}" -f $job.id, $job.type)
        return (New-JsonResult (Get-BackgroundJobAcceptedResult -Job $job) 202)
    }
    if ($path -match '^/api/configs/([^/]+)/review$' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request
        $decision = [string]$payload.action
        if ($decision -notin @('approve', 'reject', 'promote')) {
            return (New-JsonResult ([ordered]@{ error = 'action must be approve, reject, or promote' }) 400)
        }

        $state = Get-AppStateView -Segments @('BoardConfigs')
        $result = Set-ConfigReviewDecision -State $state -ConfigId $matches[1] -Decision $decision
        Save-AppSegment -Segment 'BoardConfigs' -Data $result.state.boardConfigs -SkipSnapshots
        return (New-JsonResult ([ordered]@{ ok = $true; config = $result.config }))
    }
    if ($path -match '^/api/configs/([^/]+)/resolve$' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request
        $job = Enqueue-BackgroundJob -Type 'ats-discovery' -Payload ([ordered]@{
            limit = 1
            onlyMissing = $false
            forceRefresh = $true
            configId = $matches[1]
        }) -Summary 'Resolve ATS config' -ProgressMessage 'Queued config resolution'
        Write-ServerLog ("JOB enqueue id={0} type={1}" -f $job.id, $job.type)
        return (New-JsonResult (Get-BackgroundJobAcceptedResult -Job $job) 202)
    }
    if ($path -match '^/api/configs/([^/]+)$' -and $method -eq 'PATCH') {
        $state = Get-AppState
        $state = Save-ConfigRecord -State $state -Payload (Read-JsonBody -Request $Request) -ConfigId $matches[1]
        $state = Sync-ImportedCompanyData -State $state
        $state = Update-DerivedData -State $state
        Save-AppState -State $state
        return (New-JsonResult ([ordered]@{ ok = $true; count = @($state.boardConfigs).Count }))
    }
    if ($path -eq '/api/discovery/run' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request
        $limit = [int](Convert-ToNumber $payload.limit)
        if ($limit -lt 1) { $limit = 75 }
        $job = Enqueue-BackgroundJob -Type 'ats-discovery' -Payload ([ordered]@{
            limit = $limit
            onlyMissing = Test-Truthy $payload.onlyMissing
            forceRefresh = Test-Truthy $payload.forceRefresh
            configId = [string]$payload.configId
        }) -Summary 'Discover supported ATS boards' -ProgressMessage 'Queued ATS discovery'
        Write-ServerLog ("JOB enqueue id={0} type={1}" -f $job.id, $job.type)
        return (New-JsonResult (Get-BackgroundJobAcceptedResult -Job $job) 202)
    }

    if ($path -eq '/api/settings' -and $method -eq 'PATCH') {
        $state = [ordered]@{ settings = Get-AppSegment -Segment 'Settings' }
        $state = Save-SettingsRecord -State $state -Payload (Read-JsonBody -Request $Request)
        return (New-JsonResult $state.settings)
    }

    if ($path -eq '/api/activity' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            if (Test-AppStoreUsesSqlite) {
                New-JsonResult (Find-AppActivityFast -Query $query)
            } else {
                $state = Get-AppStateView -Segments @('Activities')
                $items = @($state.activities)
                if ($query.accountId) { $items = @($items | Where-Object { $_.accountId -eq $query.accountId }) }
                $items = @($items | Sort-Object @{ Expression = { if ($_.occurredAt) { [DateTime]::Parse($_.occurredAt) } else { [DateTime]::MinValue } }; Descending = $true })
                $result = Get-PagedResult -Items $items -Page ([int]$query.page) -PageSize ([int]$query.pageSize)
                $result.items = @($result.items | ForEach-Object { Select-ActivitySummary -Activity $_ })
                New-JsonResult $result
            }
        })
    }
    if ($path -eq '/api/activity' -and $method -eq 'POST') {
        $state = Get-AppState
        $payload = Read-JsonBody -Request $Request
        $result = Add-Activity -State $state -Payload $payload
        if ($payload.accountId -and $payload.pipelineStage) {
            $patched = Set-AccountFields -State $result.state -AccountId $payload.accountId -Patch ([ordered]@{ outreachStatus = $payload.pipelineStage })
            Save-AppSegment -Segment 'Activities' -Data $patched.state.activities -SkipSnapshots
            Save-AppSegment -Segment 'Companies' -Data $patched.state.companies -SkipSnapshots
        } else {
            Save-AppSegment -Segment 'Activities' -Data $result.state.activities -SkipSnapshots
        }
        return (New-JsonResult $result.activity 201)
    }

    if ($path -eq '/api/search' -and $method -eq 'GET') {
        return (Get-CachedApiResult -Path $path -Query $query -Factory {
            if (Test-AppStoreUsesSqlite) {
                New-JsonResult (Find-AppSearchResultsFast -Query $query.q)
            } else {
                $state = Get-AppStateView -Segments @('Companies', 'Contacts', 'Jobs')
                New-JsonResult (Find-SearchResults -State $state -Query $query.q)
            }
        })
    }
    if ($path -eq '/api/import/workbook' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request
        $workbookPath = if ($payload.workbookPath) { [string]$payload.workbookPath } else { $defaultWorkbookPath }
        $job = Enqueue-BackgroundJob -Type 'workbook-import' -Payload ([ordered]@{
            workbookPath = $workbookPath
        }) -Summary 'Reimport workbook seed data' -ProgressMessage 'Queued workbook import'
        Write-ServerLog ("JOB enqueue id={0} type={1}" -f $job.id, $job.type)
        return (New-JsonResult (Get-BackgroundJobAcceptedResult -Job $job) 202)
    }
    if ($path -eq '/api/import/connections-csv' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request

        # Support file upload (csvContent) or server-side path (csvPath)
        $csvPath = [string]$payload.csvPath
        $isTempFile = $false
        if ($payload.csvContent -and [string]$payload.csvContent -ne '') {
            $tempFile = Join-Path $env:TEMP ("bd-csv-" + [System.Guid]::NewGuid().ToString('N') + ".csv")
            [System.IO.File]::WriteAllText($tempFile, [string]$payload.csvContent, [System.Text.Encoding]::UTF8)
            $csvPath = $tempFile
            $isTempFile = $true
        }

        if (-not $csvPath) {
            return (New-JsonResult ([ordered]@{ error = 'csvPath or csvContent is required' }) 400)
        }
        if (Test-Truthy $payload.dryRun) {
            $result = Import-BdConnectionsCsv `
                -CsvPath $csvPath `
                -DryRun:(Test-Truthy $payload.dryRun) `
                -UseEmptyState:(Test-Truthy $payload.useEmptyState)
            if ($isTempFile -and (Test-Path -LiteralPath $csvPath)) {
                Remove-Item -LiteralPath $csvPath -Force -ErrorAction SilentlyContinue
            }
            return (New-JsonResult $result.importRun 201)
        }

        $job = Enqueue-BackgroundJob -Type 'connections-csv-import' -Payload ([ordered]@{
            csvPath    = $csvPath
            isTempFile = $isTempFile
        }) -Summary 'Import LinkedIn connections CSV' -ProgressMessage 'Queued connections import'
        Write-ServerLog ("JOB enqueue id={0} type={1}" -f $job.id, $job.type)
        return (New-JsonResult (Get-BackgroundJobAcceptedResult -Job $job) 202)
    }
    if ($path -eq '/api/import/jobs' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request
        $job = Enqueue-BackgroundJob -Type 'live-job-import' -Payload ([ordered]@{
            discoverFirst = Test-Truthy $payload.discoverFirst
        }) -Summary 'Import jobs from active ATS configs' -ProgressMessage 'Queued live ATS import'
        Write-ServerLog ("JOB enqueue id={0} type={1}" -f $job.id, $job.type)
        return (New-JsonResult (Get-BackgroundJobAcceptedResult -Job $job) 202)
    }
    if ($path -eq '/api/google-sheets/test' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request
        $spreadsheetId = if ($payload.spreadsheetId) { [string]$payload.spreadsheetId } elseif ($env:GOOGLE_SHEETS_SPREADSHEET_ID) { [string]$env:GOOGLE_SHEETS_SPREADSHEET_ID } else { '' }
        if (-not $spreadsheetId) {
            return (New-JsonResult ([ordered]@{ error = 'spreadsheetId is required' }) 400)
        }
        return (New-JsonResult (Test-GoogleSheetsAccess -SpreadsheetId $spreadsheetId) 200)
    }
    if ($path -eq '/api/google-sheets/sync-configs' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request
        $spreadsheetId = if ($payload.spreadsheetId) { [string]$payload.spreadsheetId } elseif ($env:GOOGLE_SHEETS_SPREADSHEET_ID) { [string]$env:GOOGLE_SHEETS_SPREADSHEET_ID } else { '' }
        if (-not $spreadsheetId) {
            return (New-JsonResult ([ordered]@{ error = 'spreadsheetId is required' }) 400)
        }
        $job = Enqueue-BackgroundJob -Type 'google-sheets-config-sync' -Payload ([ordered]@{
            spreadsheetId = $spreadsheetId
            seedBackupPath = [string]$payload.seedBackupPath
        }) -Summary 'Sync live Google Sheet configs' -ProgressMessage 'Queued Google Sheet config sync'
        Write-ServerLog ("JOB enqueue id={0} type={1}" -f $job.id, $job.type)
        return (New-JsonResult (Get-BackgroundJobAcceptedResult -Job $job) 202)
    }
    if ($path -eq '/api/google-sheets/run-engine' -and $method -eq 'POST') {
        $payload = Read-JsonBody -Request $Request
        $spreadsheetId = if ($payload.spreadsheetId) { [string]$payload.spreadsheetId } elseif ($env:GOOGLE_SHEETS_SPREADSHEET_ID) { [string]$env:GOOGLE_SHEETS_SPREADSHEET_ID } else { '' }
        if (-not $spreadsheetId) {
            return (New-JsonResult ([ordered]@{ error = 'spreadsheetId is required' }) 400)
        }
        $job = Enqueue-BackgroundJob -Type 'google-sheets-run-engine' -Payload ([ordered]@{
            spreadsheetId = $spreadsheetId
            connectionsCsvPath = [string]$payload.connectionsCsvPath
            skipJobImport = Test-Truthy $payload.skipJobImport
        }) -Summary 'Run full BD engine and sync Google Sheet' -ProgressMessage 'Queued full BD engine run'
        Write-ServerLog ("JOB enqueue id={0} type={1}" -f $job.id, $job.type)
        return (New-JsonResult (Get-BackgroundJobAcceptedResult -Job $job) 202)
    }

    New-JsonResult ([ordered]@{ error = 'Not found' }) 404
}

function Handle-StaticRequest {
    param($Request)

    $root = $appRoot
    $relative = switch ($Request.Path) {
        '/' { 'index.html' }
        '/index.html' { 'index.html' }
        default {
            if ($Request.Path.StartsWith('/data/')) {
                $root = $dataRoot
                $Request.Path.Substring(6)
            } else {
                $Request.Path.TrimStart('/')
            }
        }
    }

    $relative = $relative -replace '/', [System.IO.Path]::DirectorySeparatorChar
    $filePath = Join-Path $root $relative
    if (-not (Test-Path $filePath)) { return (New-JsonResult ([ordered]@{ error = 'Not found' }) 404) }
    New-Result -Bytes ([System.IO.File]::ReadAllBytes($filePath)) -ContentType (Get-ContentType -Path $filePath) -StatusCode 200
}

function Write-Response {
    param($Request, $Result)
    $stream = $Request.Stream
    $writer = New-Object System.IO.StreamWriter($stream, [System.Text.Encoding]::ASCII, 1024, $true)
    $writer.NewLine = "`r`n"
    $reasonPhrase = Get-ReasonPhrase -StatusCode $Result.StatusCode
    $writer.WriteLine("HTTP/1.1 $($Result.StatusCode) $reasonPhrase")
    $writer.WriteLine("Content-Type: $($Result.ContentType)")
    $writer.WriteLine("Content-Length: $($Result.Bytes.Length)")
    $writer.WriteLine('Connection: close')
    $writer.WriteLine('Access-Control-Allow-Origin: *')
    $writer.WriteLine('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS')
    $writer.WriteLine('Access-Control-Allow-Headers: Content-Type')
    $writer.WriteLine('')
    $writer.Flush()
    if ($Result.Bytes.Length -gt 0) {
        $stream.Write($Result.Bytes, 0, $Result.Bytes.Length)
        $stream.Flush()
    }
}

Initialize-DataStore
if (Test-AppStoreUsesSqlite) {
    try {
        $filterSnapshotWarm = Get-AppFilterSnapshotResult
        Write-SnapshotLog -Name 'filters-warmup' -SnapshotResult $filterSnapshotWarm
        $dashboardSnapshotWarm = Get-AppDashboardSnapshotResult
        Write-SnapshotLog -Name 'dashboard-warmup' -SnapshotResult $dashboardSnapshotWarm
        $script:ServerWarmedAt = (Get-Date).ToString('o')
    } catch {
        Write-ServerLog ("SNAPSHOT warmup failed: {0}" -f $_.Exception.Message)
    }
} else {
    $script:ServerWarmedAt = (Get-Date).ToString('o')
}

$bindAddr = if ($LocalOnly) { [System.Net.IPAddress]::Loopback } else { [System.Net.IPAddress]::Any }
$listener = [System.Net.Sockets.TcpListener]::new($bindAddr, $Port)
$listener.Start()
$prefix = "http://localhost:$Port/"
if (-not $LocalOnly) {
    $tailscaleIp = try { (Get-NetIPAddress -InterfaceAlias 'Tailscale' -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress } catch { $null }
    if ($tailscaleIp) {
        Write-ServerLog "BD Engine app listening at $prefix"
        Write-ServerLog "Tailscale URL: http://${tailscaleIp}:$Port/"
    } else {
        Write-ServerLog "BD Engine app listening at $prefix (all interfaces on port $Port)"
    }
} else {
    Write-ServerLog "BD Engine app listening at $prefix (localhost only)"
}
Write-ServerLog 'Press Ctrl+C to stop.'
if ($OpenBrowser) { Start-Process $prefix | Out-Null }

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $request = Read-Request -Client $client
            if (-not $request) {
                $client.Close()
                continue
            }

            if ($request.Method -eq 'OPTIONS') {
                $result = New-TextResult -Text '' -StatusCode 200
            } elseif ($request.Path.StartsWith('/api/')) {
                $result = Handle-ApiRequest -Request $request
            } else {
                $result = Handle-StaticRequest -Request $request
            }

            Write-Response -Request $request -Result $result
        } catch {
            $stack = $_.ScriptStackTrace
            if ($stack) {
                Write-ServerLog "ERROR $($_.Exception.Message)`n$stack"
            } else {
                Write-ServerLog "ERROR $($_.Exception.Message)"
            }

            if ($client.Connected) {
                try {
                    $fallbackRequest = [ordered]@{ Stream = $client.GetStream() }
                    $fallbackResult = New-JsonResult ([ordered]@{ error = $_.Exception.Message }) 500
                    Write-Response -Request $fallbackRequest -Result $fallbackResult
                } catch {
                }
            }
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
