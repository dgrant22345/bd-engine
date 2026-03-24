Set-StrictMode -Version Latest

$script:CachedState = $null
$script:CachedSignature = ''
$script:JsonSerializer = $null
$script:CachedSegments = @{}
$script:CachedSegmentSignatures = @{}

Import-Module (Join-Path $PSScriptRoot 'BdEngine.SqliteStore.psm1') -DisableNameChecking

function Test-AppStoreUsesSqlite {
    return (Test-BdSqliteStoreEnabled)
}

function Get-JsonSerializer {
    if (-not ('System.Web.Script.Serialization.JavaScriptSerializer' -as [type])) {
        Add-Type -AssemblyName System.Web.Extensions
    }

    if (-not $script:JsonSerializer) {
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $serializer.MaxJsonLength = [int]::MaxValue
        $script:JsonSerializer = $serializer
    }

    return $script:JsonSerializer
}

function Get-ProjectRoot {
    return (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

function Get-DataRoot {
    return (Join-Path (Get-ProjectRoot) 'data')
}

function Get-StorageMap {
    $root = Get-DataRoot
    return [ordered]@{
        Workspace = Join-Path $root 'workspace.json'
        Settings = Join-Path $root 'settings.json'
        Companies = Join-Path $root 'companies.json'
        Contacts = Join-Path $root 'contacts.json'
        Jobs = Join-Path $root 'jobs.json'
        BoardConfigs = Join-Path $root 'board-configs.json'
        Activities = Join-Path $root 'activities.json'
        ImportRuns = Join-Path $root 'import-runs.json'
    }
}

function Get-StorageSignature {
    if (Test-AppStoreUsesSqlite) {
        return (Get-BdSqliteStoreSignature)
    }

    $map = Get-StorageMap
    $parts = New-Object System.Collections.ArrayList

    foreach ($path in @($map.Values)) {
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path
            [void]$parts.Add(('{0}:{1}' -f $path, $item.LastWriteTimeUtc.Ticks))
        } else {
            [void]$parts.Add(('{0}:missing' -f $path))
        }
    }

    return [string]::Join('|', @($parts))
}

function Get-SegmentStorageSignature {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment
    )

    if (Test-AppStoreUsesSqlite) {
        return (Get-BdSqliteStoreSignature)
    }

    $map = Get-StorageMap
    $path = $map[$Segment]
    if (Test-Path -LiteralPath $path) {
        $item = Get-Item -LiteralPath $path
        return '{0}:{1}' -f $path, $item.LastWriteTimeUtc.Ticks
    }

    return '{0}:missing' -f $path
}

function ConvertTo-PlainObject {
    param(
        [Parameter(ValueFromPipeline = $true)]
        $InputObject
    )

    if ($null -eq $InputObject) {
        return $null
    }

    if ($InputObject -is [string] -or $InputObject -is [ValueType]) {
        return $InputObject
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
        $hash = [ordered]@{}
        foreach ($key in $InputObject.Keys) {
            $hash[$key] = ConvertTo-PlainObject -InputObject $InputObject[$key]
        }
        return $hash
    }

    if ($InputObject -is [System.Collections.IEnumerable]) {
        $list = New-Object System.Collections.ArrayList
        foreach ($item in $InputObject) {
            [void]$list.Add((ConvertTo-PlainObject -InputObject $item))
        }
        return ,($list.ToArray())
    }

    $result = [ordered]@{}
    foreach ($property in $InputObject.PSObject.Properties) {
        $result[$property.Name] = ConvertTo-PlainObject -InputObject $property.Value
    }
    return $result
}

function Convert-ToShallowPlainObject {
    param($InputObject)

    if ($null -eq $InputObject) {
        return $null
    }

    if ($InputObject -is [string] -or $InputObject -is [ValueType]) {
        return $InputObject
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
        $keys = @($InputObject.Keys)
        $allStringKeys = $true
        foreach ($key in $keys) {
            if ($key -isnot [string]) {
                $allStringKeys = $false
                break
            }
        }

        if ($allStringKeys) {
            return $InputObject
        }

        $hash = [ordered]@{}
        foreach ($key in $keys) {
            $hash[[string]$key] = $InputObject[$key]
        }
        return $hash
    }

    $result = [ordered]@{}
    foreach ($property in $InputObject.PSObject.Properties) {
        $result[$property.Name] = $property.Value
    }
    return $result
}

function Test-CollectionHasFields {
    param(
        [object[]]$Items,
        [string[]]$Fields,
        [int]$SampleSize = 25
    )

    if (-not $Items -or $Items.Count -eq 0) {
        return $false
    }

    $limit = [Math]::Min($Items.Count, $SampleSize)
    for ($index = 0; $index -lt $limit; $index++) {
        $item = $Items[$index]
        foreach ($field in $Fields) {
            if ($item -is [System.Collections.IDictionary]) {
                $hasField = $false
                if ($item -is [System.Collections.Generic.Dictionary[string, object]]) {
                    $hasField = $item.ContainsKey($field)
                } else {
                    $hasField = $item.Contains($field)
                }

                if (-not $hasField) {
                    return $false
                }
            } elseif (-not $item.PSObject.Properties[$field]) {
                return $false
            }
        }
    }

    return $true
}

function Ensure-RecordDefaults {
    param(
        [Parameter(Mandatory = $true)]
        $Record,
        [Parameter(Mandatory = $true)]
        [hashtable]$Defaults
    )

    foreach ($key in @($Defaults.Keys)) {
        $hasKey = $false
        if ($Record -is [System.Collections.Generic.Dictionary[string, object]]) {
            $hasKey = $Record.ContainsKey($key)
        } else {
            $hasKey = $Record.Contains($key)
        }

        if (-not $hasKey) {
            $Record[$key] = Get-DefaultClone -Default $Defaults[$key]
        }
    }

    return $Record
}

function Get-CompanyRecordDefaults {
    return @{
        industry = ''
        location = ''
        status = 'new'
        outreachStatus = 'not_started'
        priorityTier = 'Tier 3'
        priority = 'medium'
        owner = ''
        domain = ''
        notes = ''
        tags = @()
        connectionCount = 0
        seniorContactCount = 0
        talentContactCount = 0
        buyerTitleCount = 0
        targetScore = 0
        normalizedTargetScore = 0
        dailyScore = 0
        networkStrength = 'Cold'
        jobCount = 0
        openRoleCount = 0
        jobsLast30Days = 0
        jobsLast90Days = 0
        newRoleCount7d = 0
        staleRoleCount30d = 0
        avgRoleSeniorityScore = 0
        hiringSpikeRatio = 0
        externalRecruiterLikelihoodScore = 0
        companyGrowthSignalScore = 0
        companyGrowthSignalSummary = ''
        engagementScore = 0
        engagementSummary = ''
        hiringVelocity = 0
        departmentFocus = ''
        departmentFocusCount = 0
        departmentConcentration = 0
        hiringSpikeScore = 0
        followUpScore = 0
        scoreBreakdown = @{}
        targetScoreExplanation = @{}
        lastJobPostedAt = $null
        hiringStatus = 'No active jobs'
        lastContactedAt = $null
        daysSinceContact = $null
        staleFlag = ''
        careersUrl = ''
        canonicalDomain = ''
        linkedinCompanySlug = ''
        aliases = @()
        enrichmentStatus = 'missing_inputs'
        enrichmentSource = ''
        enrichmentConfidence = 'unresolved'
        enrichmentConfidenceScore = 0
        enrichmentNotes = ''
        enrichmentEvidence = ''
        enrichmentFailureReason = ''
        enrichmentAttemptedUrls = @()
        enrichmentHttpSummary = @()
        nextEnrichmentAttemptAt = $null
        lastEnrichedAt = $null
        lastVerifiedAt = $null
        atsTypes = @()
        topContactName = ''
        topContactTitle = ''
        recommendedAction = ''
        outreachDraft = ''
        pipelineState = @{}
        connectionGraph = @{}
        triggerAlerts = @()
        sequenceState = @{}
        relationshipStrengthScore = 0
        alertPriorityScore = 0
        nextAction = ''
        nextActionAt = $null
    }
}

function Get-ContactRecordDefaults {
    return @{
        accountId = $null
        normalizedCompanyName = ''
        companyName = ''
        firstName = ''
        lastName = ''
        title = ''
        linkedinUrl = ''
        email = ''
        connectedOn = $null
        yearsConnected = 0
        buyerFlag = $false
        seniorFlag = $false
        talentFlag = $false
        techFlag = $false
        financeFlag = $false
        companyOverlapCount = 0
        priorityScore = 0
        relevanceScore = 0
        outreachStatus = 'not_started'
        notes = ''
    }
}

function Get-JobRecordDefaults {
    return @{
        accountId = $null
        normalizedCompanyName = ''
        title = ''
        normalizedTitle = ''
        location = ''
        department = ''
        employmentType = ''
        jobId = ''
        url = ''
        jobUrl = ''
        sourceUrl = ''
        atsType = ''
        configKey = ''
        postedAt = $null
        retrievedAt = $null
        importedAt = $null
        firstSeenAt = $null
        lastSeenAt = $null
        naturalKey = ''
        dedupeKey = ''
        rawPayload = $null
        active = $true
        isGta = $false
        isNew = $false
    }
}

function Get-BoardConfigDefaults {
    return @{
        accountId = $null
        normalizedCompanyName = ''
        atsType = ''
        boardId = ''
        domain = ''
        careersUrl = ''
        resolvedBoardUrl = ''
        source = ''
        notes = ''
        active = $false
        supportedImport = $false
        lastCheckedAt = $null
        discoveryStatus = 'missing_inputs'
        discoveryMethod = ''
        confidenceScore = 0
        confidenceBand = 'unresolved'
        evidenceSummary = ''
        reviewStatus = 'pending'
        lastResolutionAttemptAt = $null
        nextResolutionAttemptAt = $null
        failureReason = ''
        redirectTarget = ''
        matchedSignatures = @()
        attemptedUrls = @()
        httpSummary = @()
        lastImportAt = $null
        lastImportStatus = ''
    }
}

function Get-ActivityRecordDefaults {
    return @{
        workspaceId = ''
        accountId = $null
        contactId = ''
        normalizedCompanyName = ''
        type = 'note'
        summary = 'Activity note'
        notes = ''
        pipelineStage = ''
        occurredAt = $null
        metadata = @{}
    }
}

function Get-DefaultClone {
    param($Default)

    if ($null -eq $Default) {
        return $null
    }

    if ($Default -is [System.Collections.IEnumerable] -and $Default -isnot [string] -and @($Default).Count -eq 0) {
        return ,([object[]]@())
    }

    return (ConvertTo-PlainObject -InputObject $Default)
}

function Ensure-Collection {
    param($Value)

    if ($null -eq $Value) {
        return @()
    }

    if ($Value -is [System.Collections.IDictionary]) {
        return @($Value)
    }

    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
        return @($Value)
    }

    return @($Value)
}

function New-DefaultWorkspace {
    return [ordered]@{
        id = 'workspace-default'
        name = 'BD Engine Workspace'
        createdAt = (Get-Date).ToString('o')
    }
}

function New-DefaultSettings {
    return [ordered]@{
        workspaceId = 'workspace-default'
        minCompanyConnections = 3
        minJobsPosted = 2
        contactPriorityThreshold = 10
        maxCompaniesToReview = 25
        geographyFocus = 'Canada'
        gtaPriority = $true
        updatedAt = (Get-Date).ToString('o')
    }
}

function Initialize-DataStore {
    $root = Get-DataRoot
    if (-not (Test-Path $root)) {
        New-Item -ItemType Directory -Path $root | Out-Null
    }

    $map = Get-StorageMap
    if (-not (Test-Path $map.Workspace)) {
        Write-JsonFile -Path $map.Workspace -Data (New-DefaultWorkspace)
    }
    if (-not (Test-Path $map.Settings)) {
        Write-JsonFile -Path $map.Settings -Data (New-DefaultSettings)
    }

    foreach ($collectionName in 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns') {
        $path = $map[$collectionName]
        if (-not (Test-Path $path)) {
            Write-JsonFile -Path $path -Data (,([object[]]@()))
        }
    }

    if (Test-AppStoreUsesSqlite) {
        $dbPath = Get-BdSqliteDatabasePath
        $seedState = $null
        if (-not (Test-Path -LiteralPath $dbPath)) {
            $seedState = Get-JsonAppStateInternal
        }
        Initialize-BdSqliteStore -State $seedState
    }
}

function Get-SegmentDefault {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment
    )

    switch ($Segment) {
        'Workspace' { return (New-DefaultWorkspace) }
        'Settings' { return (New-DefaultSettings) }
        default { return ,([object[]]@()) }
    }
}

function Convert-SegmentData {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment,
        $Data
    )

    switch ($Segment) {
        'Workspace' {
            return (Convert-ToShallowPlainObject $Data)
        }
        'Settings' {
            return (Convert-ToShallowPlainObject $Data)
        }
        'Companies' {
            $defaults = Get-CompanyRecordDefaults
            return @(
                Ensure-Collection $Data | ForEach-Object {
                    $item = Convert-ToShallowPlainObject $_
                    Ensure-RecordDefaults -Record $item -Defaults $defaults | Out-Null
                    $item
                }
            )
        }
        'Contacts' {
            $defaults = Get-ContactRecordDefaults
            return @(
                Ensure-Collection $Data | ForEach-Object {
                    $item = Convert-ToShallowPlainObject $_
                    Ensure-RecordDefaults -Record $item -Defaults $defaults | Out-Null
                    $item
                }
            )
        }
        'Jobs' {
            $defaults = Get-JobRecordDefaults
            return @(
                Ensure-Collection $Data | ForEach-Object {
                    $item = Convert-ToShallowPlainObject $_
                    Ensure-RecordDefaults -Record $item -Defaults $defaults | Out-Null
                    $item
                }
            )
        }
        'BoardConfigs' {
            $defaults = Get-BoardConfigDefaults
            return @(
                Ensure-Collection $Data | ForEach-Object {
                    $item = Convert-ToShallowPlainObject $_
                    Ensure-RecordDefaults -Record $item -Defaults $defaults | Out-Null
                    $item
                }
            )
        }
        default {
            return @(
                Ensure-Collection $Data | ForEach-Object {
                    Convert-ToShallowPlainObject $_
                }
            )
        }
    }
}

function Read-JsonAppSegmentInternal {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment
    )

    $map = Get-StorageMap
    $data = Read-JsonFile -Path $map[$Segment] -Default (Get-SegmentDefault -Segment $Segment)
    return (Convert-SegmentData -Segment $Segment -Data $data)
}

function Read-AppSegment {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment
    )

    Initialize-DataStore
    if (Test-AppStoreUsesSqlite) {
        return (Get-BdSqliteSegment -Segment $Segment)
    }

    return (Read-JsonAppSegmentInternal -Segment $Segment)
}

function Read-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        $Default = $null
    )

    if (-not (Test-Path $Path)) {
        return (Get-DefaultClone -Default $Default)
    }

    $raw = Get-Content -LiteralPath $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return (Get-DefaultClone -Default $Default)
    }

    $serializer = Get-JsonSerializer
    $parsed = $serializer.DeserializeObject($raw)
    if ($null -eq $parsed) {
        return (Get-DefaultClone -Default $Default)
    }

    return $parsed
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        $Data
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }

    if ($Data -is [System.Collections.IEnumerable] -and $Data -isnot [string] -and $Data -isnot [System.Collections.IDictionary]) {
        $items = @($Data)
        if ($items.Count -eq 0) {
            $json = '[]'
        } elseif ($items.Count -eq 1) {
            $json = '[' + ($items[0] | ConvertTo-Json -Depth 100 -Compress) + ']'
        } else {
            $json = $items | ConvertTo-Json -Depth 100 -Compress
        }
    } else {
        $json = $Data | ConvertTo-Json -Depth 100 -Compress
    }

    [System.IO.File]::WriteAllText($Path, $json, [System.Text.Encoding]::UTF8)
}

function Get-AppStateView {
    param(
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string[]]$Segments = @()
    )

    $requested = @{}
    foreach ($segment in @($Segments)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$segment)) {
            $requested[[string]$segment] = $true
        }
    }

    return [ordered]@{
        workspace = if ($requested.ContainsKey('Workspace')) { Get-AppSegment -Segment 'Workspace' } else { New-DefaultWorkspace }
        settings = if ($requested.ContainsKey('Settings')) { Get-AppSegment -Segment 'Settings' } else { New-DefaultSettings }
        companies = if ($requested.ContainsKey('Companies')) { @(Get-AppSegment -Segment 'Companies') } else { @() }
        contacts = if ($requested.ContainsKey('Contacts')) { @(Get-AppSegment -Segment 'Contacts') } else { @() }
        jobs = if ($requested.ContainsKey('Jobs')) { @(Get-AppSegment -Segment 'Jobs') } else { @() }
        boardConfigs = if ($requested.ContainsKey('BoardConfigs')) { @(Get-AppSegment -Segment 'BoardConfigs') } else { @() }
        activities = if ($requested.ContainsKey('Activities')) { @(Get-AppSegment -Segment 'Activities') } else { @() }
        importRuns = if ($requested.ContainsKey('ImportRuns')) { @(Get-AppSegment -Segment 'ImportRuns') } else { @() }
    }
}

function Get-AppScopedStateForAccounts {
    param(
        [string[]]$AccountIds,
        [switch]$IncludeActivities
    )

    Initialize-DataStore
    if (Test-AppStoreUsesSqlite) {
        return (Get-BdSqliteScopedStateForAccountIds -AccountIds $AccountIds -IncludeActivities:$IncludeActivities)
    }

    $requestedSegments = @('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs')
    if ($IncludeActivities) {
        $requestedSegments += 'Activities'
    }
    $state = Get-AppStateView -Segments $requestedSegments
    $accountSet = @{}
    foreach ($accountId in @($AccountIds)) {
        if ($accountId) {
            $accountSet[[string]$accountId] = $true
        }
    }

    $state.companies = @($state.companies | Where-Object { $accountSet.ContainsKey([string]$_.id) })
    $normalizedSet = @{}
    foreach ($company in @($state.companies)) {
        if ($company.normalizedName) {
            $normalizedSet[[string]$company.normalizedName] = $true
        }
    }
    $state.contacts = @($state.contacts | Where-Object { $accountSet.ContainsKey([string]$_.accountId) -or ($_.normalizedCompanyName -and $normalizedSet.ContainsKey([string]$_.normalizedCompanyName)) })
    $state.jobs = @($state.jobs | Where-Object { $accountSet.ContainsKey([string]$_.accountId) -or ($_.normalizedCompanyName -and $normalizedSet.ContainsKey([string]$_.normalizedCompanyName)) })
    $state.boardConfigs = @($state.boardConfigs | Where-Object { $accountSet.ContainsKey([string]$_.accountId) -or ($_.normalizedCompanyName -and $normalizedSet.ContainsKey([string]$_.normalizedCompanyName)) })
    if ($IncludeActivities) {
        $state.activities = @($state.activities | Where-Object { $accountSet.ContainsKey([string]$_.accountId) -or ($_.normalizedCompanyName -and $normalizedSet.ContainsKey([string]$_.normalizedCompanyName)) })
    }
    return $state
}

function Get-AppScopedStateForConfigs {
    param([string[]]$ConfigIds)

    Initialize-DataStore
    if (Test-AppStoreUsesSqlite) {
        return (Get-BdSqliteScopedStateForConfigIds -ConfigIds $ConfigIds)
    }

    $state = Get-AppStateView -Segments @('Workspace', 'Settings', 'Companies', 'BoardConfigs')
    $configSet = @{}
    foreach ($configId in @($ConfigIds)) {
        if ($configId) {
            $configSet[[string]$configId] = $true
        }
    }

    $state.boardConfigs = @($state.boardConfigs | Where-Object { $configSet.ContainsKey([string]$_.id) })
    $accountSet = @{}
    $normalizedSet = @{}
    foreach ($config in @($state.boardConfigs)) {
        if ($config.accountId) {
            $accountSet[[string]$config.accountId] = $true
        }
        if ($config.normalizedCompanyName) {
            $normalizedSet[[string]$config.normalizedCompanyName] = $true
        }
    }
    $state.companies = @($state.companies | Where-Object { $accountSet.ContainsKey([string]$_.id) -or ($_.normalizedName -and $normalizedSet.ContainsKey([string]$_.normalizedName)) })
    return $state
}

function Get-AppScopedStateForCompanyKeys {
    param([string[]]$CompanyKeys)

    Initialize-DataStore
    if (Test-AppStoreUsesSqlite) {
        return (Get-BdSqliteScopedStateForCompanyKeys -CompanyKeys $CompanyKeys)
    }

    $state = Get-AppStateView -Segments @('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities')
    $companyKeySet = @{}
    foreach ($companyKey in @($CompanyKeys)) {
        if ($companyKey) {
            $companyKeySet[[string]$companyKey] = $true
        }
    }

    $state.companies = @($state.companies | Where-Object { $_.normalizedName -and $companyKeySet.ContainsKey([string]$_.normalizedName) })
    $state.contacts = @($state.contacts | Where-Object { $_.normalizedCompanyName -and $companyKeySet.ContainsKey([string]$_.normalizedCompanyName) })
    $state.jobs = @($state.jobs | Where-Object { $_.normalizedCompanyName -and $companyKeySet.ContainsKey([string]$_.normalizedCompanyName) })
    $state.boardConfigs = @($state.boardConfigs | Where-Object { $_.normalizedCompanyName -and $companyKeySet.ContainsKey([string]$_.normalizedCompanyName) })
    $state.activities = @($state.activities | Where-Object { $_.normalizedCompanyName -and $companyKeySet.ContainsKey([string]$_.normalizedCompanyName) })
    return $state
}

function Get-AppResolverProbeCacheRecords {
    param(
        [string[]]$Urls,
        [switch]$IncludeExpired
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return @()
    }

    return @(Get-BdSqliteResolverProbeCacheRecords -Urls $Urls -IncludeExpired:$IncludeExpired)
}

function Save-AppResolverProbeCacheRecords {
    param([object[]]$Records)

    if (-not (Test-AppStoreUsesSqlite)) {
        return 0
    }

    return (Save-BdSqliteResolverProbeCacheRecords -Records $Records)
}

function Clear-AppResolverProbeCacheExpired {
    param([string]$Before = '')

    if (-not (Test-AppStoreUsesSqlite)) {
        return 0
    }

    return (Clear-BdSqliteExpiredResolverProbeCache -Before $Before)
}

function Get-AppResolverSearchCacheRecord {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CacheKey,
        [switch]$IncludeExpired
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteResolverSearchCacheRecord -CacheKey $CacheKey -IncludeExpired:$IncludeExpired)
}

function Save-AppResolverSearchCacheRecord {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CacheKey,
        [string[]]$Urls = @(),
        [string]$FetchedAt = '',
        [string]$ExpiresAt = ''
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return 0
    }

    return (Save-BdSqliteResolverSearchCacheRecord -CacheKey $CacheKey -Urls $Urls -FetchedAt $FetchedAt -ExpiresAt $ExpiresAt)
}

function Clear-AppResolverSearchCacheExpired {
    param([string]$Before = '')

    if (-not (Test-AppStoreUsesSqlite)) {
        return 0
    }

    return (Clear-BdSqliteExpiredResolverSearchCache -Before $Before)
}

function Get-AppResolverSeedCooldownRecords {
    param(
        [string[]]$SeedKeys,
        [switch]$IncludeExpired
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return @()
    }

    return @(Get-BdSqliteResolverSeedCooldownRecords -SeedKeys $SeedKeys -IncludeExpired:$IncludeExpired)
}

function Save-AppResolverSeedCooldownRecords {
    param([object[]]$Records)

    if (-not (Test-AppStoreUsesSqlite)) {
        return 0
    }

    return (Save-BdSqliteResolverSeedCooldownRecords -Records $Records)
}

function Remove-AppResolverSeedCooldownRecords {
    param([string[]]$SeedKeys)

    if (-not (Test-AppStoreUsesSqlite)) {
        return 0
    }

    return (Remove-BdSqliteResolverSeedCooldownRecords -SeedKeys $SeedKeys)
}

function Clear-AppResolverSeedCooldownsExpired {
    param([string]$Before = '')

    if (-not (Test-AppStoreUsesSqlite)) {
        return 0
    }

    return (Clear-BdSqliteExpiredResolverSeedCooldowns -Before $Before)
}

function Get-JsonAppStateInternal {
    $map = Get-StorageMap
    $workspace = Read-JsonFile -Path $map.Workspace -Default (New-DefaultWorkspace)
    $settings = Read-JsonFile -Path $map.Settings -Default (New-DefaultSettings)
    $companies = Read-JsonFile -Path $map.Companies -Default $null
    $contacts = Read-JsonFile -Path $map.Contacts -Default $null
    $jobs = Read-JsonFile -Path $map.Jobs -Default $null
    $boardConfigs = Read-JsonFile -Path $map.BoardConfigs -Default $null
    $activities = Read-JsonFile -Path $map.Activities -Default $null
    $importRuns = Read-JsonFile -Path $map.ImportRuns -Default $null

    $companies = @($companies | ForEach-Object { Convert-ToShallowPlainObject $_ })
    $contacts = @($contacts | ForEach-Object { Convert-ToShallowPlainObject $_ })
    $jobs = @($jobs | ForEach-Object { Convert-ToShallowPlainObject $_ })
    $boardConfigs = @($boardConfigs | ForEach-Object { Convert-ToShallowPlainObject $_ })
    $activities = @($activities | ForEach-Object { Convert-ToShallowPlainObject $_ })
    $importRuns = @($importRuns | ForEach-Object { Convert-ToShallowPlainObject $_ })

    if (-not (Test-CollectionHasFields -Items $companies -Fields @('priority', 'scoreBreakdown', 'atsTypes', 'nextAction', 'jobsLast30Days', 'engagementScore', 'hiringVelocity', 'targetScoreExplanation'))) {
        $companyDefaults = Get-CompanyRecordDefaults
        foreach ($company in @($companies)) {
            Ensure-RecordDefaults -Record $company -Defaults $companyDefaults | Out-Null
        }
    }

    if (-not (Test-CollectionHasFields -Items $contacts -Fields @('priorityScore', 'outreachStatus', 'notes'))) {
        $contactDefaults = Get-ContactRecordDefaults
        foreach ($contact in @($contacts)) {
            Ensure-RecordDefaults -Record $contact -Defaults $contactDefaults | Out-Null
        }
    }

    if (-not (Test-CollectionHasFields -Items $jobs -Fields @('sourceUrl', 'isNew', 'active', 'retrievedAt'))) {
        $jobDefaults = Get-JobRecordDefaults
        foreach ($job in @($jobs)) {
            Ensure-RecordDefaults -Record $job -Defaults $jobDefaults | Out-Null
        }
    }
    foreach ($job in @($jobs)) {
        if (-not $job.url -and $job.jobUrl) {
            $job.url = $job.jobUrl
        }
    }

    $boardConfigDefaults = Get-BoardConfigDefaults
    foreach ($config in @($boardConfigs)) {
        Ensure-RecordDefaults -Record $config -Defaults $boardConfigDefaults | Out-Null
    }

    return [ordered]@{
        workspace = $workspace
        settings = $settings
        companies = $companies
        contacts = $contacts
        jobs = $jobs
        boardConfigs = $boardConfigs
        activities = $activities
        importRuns = $importRuns
    }
}

function Get-AppState {
    Initialize-DataStore

    $signature = Get-StorageSignature
    if ($script:CachedState -and $script:CachedSignature -eq $signature) {
        return $script:CachedState
    }

    $state = if (Test-AppStoreUsesSqlite) { Get-BdSqliteState } else { Get-JsonAppStateInternal }

    $script:CachedState = $state
    $script:CachedSignature = $signature
    $script:CachedSegments = @{
        Workspace = $state.workspace
        Settings = $state.settings
        Companies = @($state.companies)
        Contacts = @($state.contacts)
        Jobs = @($state.jobs)
        BoardConfigs = @($state.boardConfigs)
        Activities = @($state.activities)
        ImportRuns = @($state.importRuns)
    }
    $script:CachedSegmentSignatures = @{
        Workspace = Get-SegmentStorageSignature -Segment 'Workspace'
        Settings = Get-SegmentStorageSignature -Segment 'Settings'
        Companies = Get-SegmentStorageSignature -Segment 'Companies'
        Contacts = Get-SegmentStorageSignature -Segment 'Contacts'
        Jobs = Get-SegmentStorageSignature -Segment 'Jobs'
        BoardConfigs = Get-SegmentStorageSignature -Segment 'BoardConfigs'
        Activities = Get-SegmentStorageSignature -Segment 'Activities'
        ImportRuns = Get-SegmentStorageSignature -Segment 'ImportRuns'
    }
    return $state
}

function Get-AppStateSignature {
    $signature = Get-StorageSignature

    if ($script:CachedState -and $script:CachedSignature -ne $signature) {
        $script:CachedState = $null
        $script:CachedSignature = ''
        $script:CachedSegments = @{}
        $script:CachedSegmentSignatures = @{}
    }

    return $signature
}

function Get-AppSegment {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment
    )

    if ($script:CachedState) {
        $signature = Get-StorageSignature
        if ($script:CachedSignature -eq $signature) {
            $state = $script:CachedState
            switch ($Segment) {
                'Workspace' { return $state.workspace }
                'Settings' { return $state.settings }
                'Companies' { return @($state.companies) }
                'Contacts' { return @($state.contacts) }
                'Jobs' { return @($state.jobs) }
                'BoardConfigs' { return @($state.boardConfigs) }
                'Activities' { return @($state.activities) }
                'ImportRuns' { return @($state.importRuns) }
            }
        }

        $script:CachedState = $null
        $script:CachedSignature = ''
    }

    $segmentSignature = Get-SegmentStorageSignature -Segment $Segment
    if ($script:CachedSegments.ContainsKey($Segment) -and $script:CachedSegmentSignatures[$Segment] -eq $segmentSignature) {
        return $script:CachedSegments[$Segment]
    }

    $data = Read-AppSegment -Segment $Segment
    $script:CachedSegments[$Segment] = $data
    $script:CachedSegmentSignatures[$Segment] = $segmentSignature
    return $data
}

function Set-AppStateCache {
    param(
        [Parameter(Mandatory = $true)]
        $State
    )

    $script:CachedState = $State
    $script:CachedSignature = Get-StorageSignature
    $script:CachedSegments = @{
        Workspace = $State.workspace
        Settings = $State.settings
        Companies = @($State.companies)
        Contacts = @($State.contacts)
        Jobs = @($State.jobs)
        BoardConfigs = @($State.boardConfigs)
        Activities = @($State.activities)
        ImportRuns = @($State.importRuns)
    }
    $script:CachedSegmentSignatures = @{
        Workspace = Get-SegmentStorageSignature -Segment 'Workspace'
        Settings = Get-SegmentStorageSignature -Segment 'Settings'
        Companies = Get-SegmentStorageSignature -Segment 'Companies'
        Contacts = Get-SegmentStorageSignature -Segment 'Contacts'
        Jobs = Get-SegmentStorageSignature -Segment 'Jobs'
        BoardConfigs = Get-SegmentStorageSignature -Segment 'BoardConfigs'
        Activities = Get-SegmentStorageSignature -Segment 'Activities'
        ImportRuns = Get-SegmentStorageSignature -Segment 'ImportRuns'
    }
}

function Set-AppSegmentCache {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment,
        [Parameter(Mandatory = $true)]
        $Data
    )

    $state = if ($script:CachedState) { $script:CachedState } else { Get-AppState }
    switch ($Segment) {
        'Workspace' { $state.workspace = $Data }
        'Settings' { $state.settings = $Data }
        'Companies' { $state.companies = @($Data) }
        'Contacts' { $state.contacts = @($Data) }
        'Jobs' { $state.jobs = @($Data) }
        'BoardConfigs' { $state.boardConfigs = @($Data) }
        'Activities' { $state.activities = @($Data) }
        'ImportRuns' { $state.importRuns = @($Data) }
    }

    $script:CachedState = $state
    $script:CachedSignature = Get-StorageSignature
    $script:CachedSegments[$Segment] = $Data
    $script:CachedSegmentSignatures[$Segment] = Get-SegmentStorageSignature -Segment $Segment
}

function Sync-AppState {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [switch]$SkipSnapshots
    )

    Initialize-DataStore
    if (Test-AppStoreUsesSqlite) {
        $result = Sync-BdSqliteState -State $State -SkipSnapshots:$SkipSnapshots
    } else {
        $map = Get-StorageMap
        Write-JsonFile -Path $map.Workspace -Data $State.workspace
        Write-JsonFile -Path $map.Settings -Data $State.settings
        Write-JsonFile -Path $map.Companies -Data $State.companies
        Write-JsonFile -Path $map.Contacts -Data $State.contacts
        Write-JsonFile -Path $map.Jobs -Data $State.jobs
        Write-JsonFile -Path $map.BoardConfigs -Data $State.boardConfigs
        Write-JsonFile -Path $map.Activities -Data $State.activities
        Write-JsonFile -Path $map.ImportRuns -Data $State.importRuns
        $result = [ordered]@{
            ok = $true
            mode = 'broad_rewrite'
            dataRevision = Get-StorageSignature
            segments = @()
            snapshot = $null
            updatedAt = (Get-Date).ToString('o')
        }
    }

    Set-AppStateCache -State $State
    return $result
}

function Sync-AppStateSegments {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string[]]$Segments,
        [switch]$SkipSnapshots
    )

    Initialize-DataStore
    $uniqueSegments = @($Segments | Select-Object -Unique)
    if (Test-AppStoreUsesSqlite) {
        $result = Sync-BdSqliteStateSegments -State $State -Segments $uniqueSegments -SkipSnapshots:$SkipSnapshots
    } else {
        foreach ($segment in @($uniqueSegments)) {
            $value = switch ($segment) {
                'Workspace' { $State.workspace }
                'Settings' { $State.settings }
                'Companies' { $State.companies }
                'Contacts' { $State.contacts }
                'Jobs' { $State.jobs }
                'BoardConfigs' { $State.boardConfigs }
                'Activities' { $State.activities }
                'ImportRuns' { $State.importRuns }
            }
            Save-AppSegment -Segment $segment -Data $value -SkipSnapshots:$SkipSnapshots
        }

        $result = [ordered]@{
            ok = $true
            mode = 'broad_rewrite'
            dataRevision = Get-StorageSignature
            segments = @()
            snapshot = $null
            updatedAt = (Get-Date).ToString('o')
        }
    }

    Set-AppStateCache -State $State
    return $result
}

function Sync-AppStateSegmentsPartial {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string[]]$Segments,
        [switch]$SkipSnapshots
    )

    Initialize-DataStore
    $uniqueSegments = @($Segments | Select-Object -Unique)
    if (Test-AppStoreUsesSqlite) {
        $result = Sync-BdSqliteStateSegmentsPartial -State $State -Segments $uniqueSegments -SkipSnapshots:$SkipSnapshots
    } else {
        foreach ($segment in @($uniqueSegments)) {
            $existingSegment = Read-AppSegment -Segment $segment
            $incomingValue = switch ($segment) {
                'Companies' { $State.companies }
                'Contacts' { $State.contacts }
                'Jobs' { $State.jobs }
                'BoardConfigs' { $State.boardConfigs }
                'Activities' { $State.activities }
                'ImportRuns' { $State.importRuns }
            }

            $mergedById = @{}
            foreach ($record in @($existingSegment)) {
                $recordId = if ($record -is [System.Collections.IDictionary]) { [string]$record['id'] } elseif ($record.PSObject.Properties['id']) { [string]$record.PSObject.Properties['id'].Value } else { '' }
                if ($recordId) {
                    $mergedById[$recordId] = $record
                }
            }
            foreach ($record in @($incomingValue)) {
                $recordId = if ($record -is [System.Collections.IDictionary]) { [string]$record['id'] } elseif ($record.PSObject.Properties['id']) { [string]$record.PSObject.Properties['id'].Value } else { '' }
                if ($recordId) {
                    $mergedById[$recordId] = $record
                }
            }
            Save-AppSegment -Segment $segment -Data @($mergedById.Values) -SkipSnapshots:$SkipSnapshots
        }

        $result = [ordered]@{
            ok = $true
            mode = 'partial_upsert'
            dataRevision = Get-StorageSignature
            segments = @()
            snapshot = $null
            updatedAt = (Get-Date).ToString('o')
        }
    }

    return $result
}

function Sync-AppSegment {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment,
        [Parameter(Mandatory = $true)]
        $Data,
        [switch]$SkipSnapshots
    )

    Initialize-DataStore
    if (Test-AppStoreUsesSqlite) {
        $result = Sync-BdSqliteSegment -Segment $Segment -Data $Data -SkipSnapshots:$SkipSnapshots
    } else {
        $map = Get-StorageMap
        Write-JsonFile -Path $map[$Segment] -Data $Data
        $result = [ordered]@{
            ok = $true
            mode = 'broad_rewrite'
            segment = $Segment
            snapshot = $null
            updatedAt = (Get-Date).ToString('o')
        }
    }

    Set-AppSegmentCache -Segment $Segment -Data $Data
    return $result
}

function Save-AppState {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [switch]$SkipSnapshots
    )

    Sync-AppState -State $State -SkipSnapshots:$SkipSnapshots | Out-Null
}

function Save-AppSegment {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment,
        [Parameter(Mandatory = $true)]
        $Data,
        [switch]$SkipSnapshots
    )

    Sync-AppSegment -Segment $Segment -Data $Data -SkipSnapshots:$SkipSnapshots | Out-Null
}

function Get-AppDashboardModelFast {
    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteDashboardModel)
}

function Get-AppDashboardExtendedFast {
    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteDashboardExtendedModel)
}

function Get-AppDashboardSnapshotResult {
    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteDashboardSnapshotResult)
}

function Get-AppFilterOptionsFast {
    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteFilterOptions)
}

function Get-AppFilterSnapshotResult {
    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteFilterSnapshotResult)
}

function Update-AppSqliteSnapshots {
    param(
        [string[]]$Names = @('filters', 'dashboard')
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Update-BdSqliteSnapshots -Names $Names)
}

function Mark-AppSnapshotsDirty {
    param(
        [string[]]$Names,
        [string]$Reason = '',
        [string]$DataRevision = ''
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Set-BdSqliteSnapshotsDirty -Names $Names -Reason $Reason -DataRevision $DataRevision)
}

function Get-AppSnapshotDirtyState {
    param([string]$Name)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteSnapshotDirtyStateRecord -Name $Name)
}

function New-AppBackgroundJob {
    param(
        [Parameter(Mandatory = $true)]
        [string]$JobId,
        [Parameter(Mandatory = $true)]
        [string]$JobType,
        [Parameter(Mandatory = $true)]
        $Payload,
        [string]$Summary = '',
        [string]$ProgressMessage = 'Queued'
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Add-BdSqliteBackgroundJob -JobId $JobId -JobType $JobType -Payload $Payload -Summary $Summary -ProgressMessage $ProgressMessage)
}

function Get-AppBackgroundJob {
    param([string]$JobId)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteBackgroundJob -JobId $JobId)
}

function Get-AppBackgroundJobPayload {
    param([string]$JobId)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteBackgroundJobPayload -JobId $JobId)
}

function Find-AppBackgroundJobs {
    param(
        [hashtable]$Query,
        [switch]$IncludeResult
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Find-BdSqliteBackgroundJobs -Query $Query -IncludeResult:$IncludeResult)
}

function Update-AppBackgroundJobProgress {
    param(
        [string]$JobId,
        [string]$ProgressMessage
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Update-BdSqliteBackgroundJobProgress -JobId $JobId -ProgressMessage $ProgressMessage)
}

function Update-AppBackgroundJobCheckpoint {
    param(
        [string]$JobId,
        $Payload,
        [string]$ProgressMessage = '',
        [int]$RecordsAffected = 0
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Update-BdSqliteBackgroundJobCheckpoint -JobId $JobId -Payload $Payload -ProgressMessage $ProgressMessage -RecordsAffected $RecordsAffected)
}

function Start-AppBackgroundJob {
    param([string]$JobId)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Start-BdSqliteBackgroundJob -JobId $JobId)
}

function Resume-AppBackgroundJob {
    param(
        [string]$JobId,
        $Payload = $null,
        [string]$ProgressMessage = 'Queued to resume'
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Requeue-BdSqliteBackgroundJob -JobId $JobId -Payload $Payload -ProgressMessage $ProgressMessage)
}

function Complete-AppBackgroundJob {
    param(
        [string]$JobId,
        $Result,
        [int]$RecordsAffected = 0,
        [string]$ProgressMessage = 'Completed'
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Complete-BdSqliteBackgroundJob -JobId $JobId -Result $Result -RecordsAffected $RecordsAffected -ProgressMessage $ProgressMessage)
}

function Fail-AppBackgroundJob {
    param(
        [string]$JobId,
        [string]$ErrorMessage,
        $Result = $null
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Fail-BdSqliteBackgroundJob -JobId $JobId -ErrorMessage $ErrorMessage -Result $Result)
}

function Cancel-AppBackgroundJob {
    param([string]$JobId)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Cancel-BdSqliteBackgroundJob -JobId $JobId)
}

function Find-AppAccountsFast {
    param([hashtable]$Query)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Find-BdSqliteAccounts -Query $Query)
}

function Get-AppTargetScoreBackfillAccountIds {
    param([int]$Limit = 250)

    if (-not (Test-AppStoreUsesSqlite)) {
        return @()
    }

    return @(Get-BdSqliteTargetScoreBackfillAccountIds -Limit $Limit)
}

function Get-AppTargetScoreBackfillCount {
    if (-not (Test-AppStoreUsesSqlite)) {
        return 0
    }

    return (Get-BdSqliteTargetScoreBackfillCount)
}

function Find-AppContactsFast {
    param([hashtable]$Query)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Find-BdSqliteContacts -Query $Query)
}

function Find-AppJobsFast {
    param([hashtable]$Query)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Find-BdSqliteJobs -Query $Query)
}

function Find-AppConfigsFast {
    param([hashtable]$Query)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Find-BdSqliteConfigs -Query $Query)
}

function Get-AppResolverCoverageReportFast {
    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteResolverCoverageReport)
}

function Get-AppEnrichmentCoverageReportFast {
    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteEnrichmentCoverageReport)
}

function Find-AppEnrichmentQueueFast {
    param([hashtable]$Query)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Find-BdSqliteEnrichmentQueue -Query $Query)
}

function Get-AppEnrichmentCandidateCompanyIdsFast {
    param(
        [int]$Limit = 50,
        [string]$AccountId = '',
        [switch]$ForceRefresh
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return @()
    }

    return @(Get-BdSqliteEnrichmentCandidateCompanyIds -Limit $Limit -AccountId $AccountId -ForceRefresh:$ForceRefresh)
}

function Get-AppDiscoveryCandidateConfigIdsFast {
    param(
        [int]$Limit = 75,
        [string]$ConfigId = '',
        [switch]$OnlyMissing,
        [switch]$ForceRefresh
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return @()
    }

    return @(Get-BdSqliteDiscoveryCandidateConfigIds -Limit $Limit -ConfigId $ConfigId -OnlyMissing:$OnlyMissing -ForceRefresh:$ForceRefresh)
}

function Find-AppActivityFast {
    param([hashtable]$Query)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Find-BdSqliteActivity -Query $Query)
}

function Get-AppAccountDetailFast {
    param([string]$AccountId)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteAccountDetail -AccountId $AccountId)
}

function Get-AppAccountResolutionContextFast {
    param([string]$AccountId)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Get-BdSqliteAccountResolutionContext -AccountId $AccountId)
}

function Find-AppSearchResultsFast {
    param([string]$Query)

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    return (Find-BdSqliteSearchResults -Query $Query)
}

function Invoke-AppJsonToSqliteMigration {
    $state = Get-JsonAppStateInternal
    Save-BdSqliteState -State $state
    return [ordered]@{
        ok = $true
        databasePath = Get-BdSqliteDatabasePath
        signature = Get-BdSqliteStoreSignature
    }
}

function New-DeterministicId {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Prefix,
        [Parameter(Mandatory = $true)]
        [string]$Seed
    )

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Seed)
    $md5 = [System.Security.Cryptography.MD5]::Create()
    try {
        $hash = $md5.ComputeHash($bytes)
    } finally {
        $md5.Dispose()
    }

    $hex = ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    return '{0}-{1}' -f $Prefix, $hex.Substring(0, 12)
}

function New-RandomId {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Prefix
    )

    return '{0}-{1}' -f $Prefix, ([guid]::NewGuid().ToString('n').Substring(0, 12))
}

function Invoke-AppLocalEnrichmentPassFast {
    param(
        [string]$AccountId = '',
        [switch]$ForceRefresh
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        return $null
    }

    $limit = if ([string]::IsNullOrWhiteSpace([string]$AccountId)) { 5000 } else { 1 }
    return (Invoke-BdSqliteLocalEnrichmentPass -Limit $limit -AccountId $AccountId -ForceRefresh:$ForceRefresh)
}

Export-ModuleMember -Function *-*

