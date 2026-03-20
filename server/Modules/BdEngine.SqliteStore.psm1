Set-StrictMode -Version Latest

$script:SqliteAssemblyLoaded = $false
$script:JsonSerializer = $null
$script:SqliteSchemaInitialized = $false
$script:CompanySummaryColumns = 'id, sort_order, normalized_name, display_name, display_name_normalized, industry, location, domain, careers_url, owner, owner_normalized, priority, priority_tier, status, outreach_status, connection_count, senior_contact_count, talent_contact_count, buyer_title_count, target_score, target_score_explanation_json, daily_score, follow_up_score, job_count, open_role_count, jobs_last_30_days, jobs_last_90_days, new_role_count_7d, stale_role_count_30d, avg_role_seniority_score, hiring_spike_ratio, external_recruiter_likelihood_score, company_growth_signal_score, company_growth_signal_summary, engagement_score, engagement_summary, hiring_velocity, department_focus, department_focus_count, department_concentration, hiring_spike_score, network_strength, hiring_status, last_job_posted_at, last_contacted_at, days_since_contact, stale_flag, next_action, next_action_at, recommended_action, outreach_draft, top_contact_name, top_contact_title, ats_types_text, tags_text, notes, search_text, canonical_domain, linkedin_company_slug, aliases_text, enrichment_status, enrichment_source, enrichment_confidence, enrichment_confidence_score, enrichment_notes, enrichment_evidence, enrichment_failure_reason, enrichment_attempted_urls_text, last_enriched_at, last_verified_at, next_enrichment_attempt_at'

function Get-BdSqliteProjectRoot {
    return (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

function Get-BdSqliteDataRoot {
    return (Join-Path (Get-BdSqliteProjectRoot) 'data')
}

function Get-BdSqliteVendorRoot {
    return (Join-Path (Split-Path -Parent $PSScriptRoot) 'vendor\sqlite')
}

function Get-BdSqliteDatabasePath {
    return (Join-Path (Get-BdSqliteDataRoot) 'bd-engine.db')
}

function Test-BdSqliteStoreEnabled {
    if ($env:BD_ENGINE_DISABLE_SQLITE -eq '1') {
        return $false
    }

    $dllPath = Join-Path (Get-BdSqliteVendorRoot) 'System.Data.SQLite.dll'
    return (Test-Path -LiteralPath $dllPath)
}

function Import-BdSqliteAssembly {
    if ($script:SqliteAssemblyLoaded) {
        return
    }

    $dllPath = Join-Path (Get-BdSqliteVendorRoot) 'System.Data.SQLite.dll'
    if (-not (Test-Path -LiteralPath $dllPath)) {
        throw "System.Data.SQLite.dll was not found at $dllPath"
    }

    Add-Type -Path $dllPath
    $script:SqliteAssemblyLoaded = $true
}

function Get-BdSqliteJsonSerializer {
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

function ConvertTo-BdSqlitePlainObject {
    param($InputObject)

    if ($null -eq $InputObject) {
        return $null
    }

    if ($InputObject -is [string] -or $InputObject -is [ValueType]) {
        return $InputObject
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
        $hash = [ordered]@{}
        foreach ($key in @($InputObject.Keys)) {
            $hash[[string]$key] = ConvertTo-BdSqlitePlainObject -InputObject $InputObject[$key]
        }
        return $hash
    }

    if ($InputObject -is [System.Collections.IEnumerable]) {
        $list = New-Object System.Collections.ArrayList
        foreach ($item in $InputObject) {
            [void]$list.Add((ConvertTo-BdSqlitePlainObject -InputObject $item))
        }
        return ,($list.ToArray())
    }

    $result = [ordered]@{}
    foreach ($property in $InputObject.PSObject.Properties) {
        $result[$property.Name] = ConvertTo-BdSqlitePlainObject -InputObject $property.Value
    }
    return $result
}

function ConvertFrom-BdSqliteJsonText {
    param([string]$JsonText)

    if ([string]::IsNullOrWhiteSpace($JsonText)) {
        return $null
    }

    $serializer = Get-BdSqliteJsonSerializer
    return (ConvertTo-BdSqlitePlainObject -InputObject ($serializer.DeserializeObject($JsonText)))
}

function ConvertTo-BdSqliteJsonText {
    param($Data)

    return ($Data | ConvertTo-Json -Depth 100 -Compress)
}

function Normalize-BdSqliteText {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }

    $normalized = $Value.ToLowerInvariant()
    $normalized = $normalized -replace '&', ' and '
    $normalized = $normalized -replace '[^a-z0-9]+', ' '
    return $normalized.Trim()
}

function Get-BdSqliteRecordValue {
    param(
        $Record,
        [string]$Name,
        $Default = $null
    )

    if ($null -eq $Record -or [string]::IsNullOrWhiteSpace($Name)) {
        return $Default
    }

    if ($Record -is [System.Collections.Generic.Dictionary[string, object]]) {
        if ($Record.ContainsKey($Name)) {
            return $Record[$Name]
        }
        return $Default
    }

    if ($Record -is [System.Collections.IDictionary]) {
        if ($Record.Contains($Name)) {
            return $Record[$Name]
        }
        return $Default
    }

    $property = $Record.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }

    return $Default
}

function ConvertTo-BdSqliteNumber {
    param($Value)

    if ($null -eq $Value -or $Value -eq '') {
        return 0
    }

    $parsed = 0.0
    if ([double]::TryParse([string]$Value, [ref]$parsed)) {
        return $parsed
    }

    return 0
}

function ConvertTo-BdSqliteBoolInt {
    param($Value)

    if ($Value -is [bool]) {
        return $(if ($Value) { 1 } else { 0 })
    }

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return 0
    }

    return $(if (@('1', 'true', 'yes', 'y', 'active') -contains $text.Trim().ToLowerInvariant()) { 1 } else { 0 })
}

function ConvertTo-BdSqliteNullIfBlank {
    param($Value)

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    return $text.Trim()
}

function Get-BdSqliteFallbackTargetScoreExplanation {
    param($Row)

    $jobsLast30Days = [int](ConvertTo-BdSqliteNumber $Row.jobs_last_30_days)
    $jobsLast90Days = [int](ConvertTo-BdSqliteNumber $Row.jobs_last_90_days)
    $avgRoleSeniorityScore = [double](ConvertTo-BdSqliteNumber $Row.avg_role_seniority_score)
    $hiringSpikeRatio = [double](ConvertTo-BdSqliteNumber $Row.hiring_spike_ratio)
    $externalRecruiterLikelihoodScore = [double](ConvertTo-BdSqliteNumber $Row.external_recruiter_likelihood_score)
    $companyGrowthSignalScore = [double](ConvertTo-BdSqliteNumber $Row.company_growth_signal_score)
    $engagementScore = [double](ConvertTo-BdSqliteNumber $Row.engagement_score)
    $volumeScore = [Math]::Min(100, [Math]::Round(([Math]::Min(70, ($jobsLast30Days * 10))) + ([Math]::Min(30, ($jobsLast90Days * 2))), 0))
    $spikeScore = [Math]::Min(100, [Math]::Round(([Math]::Max(0, $hiringSpikeRatio) * 50), 0))

    $components = @(
        [ordered]@{
            key = 'hiringVolume'
            label = 'Fresh hiring volume'
            score = $volumeScore
            weight = 0.26
            summary = '{0} jobs in 30d and {1} in 90d' -f $jobsLast30Days, $jobsLast90Days
        },
        [ordered]@{
            key = 'roleSeniority'
            label = 'Role seniority mix'
            score = $avgRoleSeniorityScore
            weight = 0.14
            summary = 'Average role seniority {0}/100' -f ([string]([Math]::Round($avgRoleSeniorityScore, 1)))
        },
        [ordered]@{
            key = 'hiringSpike'
            label = 'Hiring spike'
            score = $spikeScore
            weight = 0.18
            summary = '{0}x versus the 90-day baseline' -f ([string]([Math]::Round($hiringSpikeRatio, 2)))
        },
        [ordered]@{
            key = 'externalRecruiter'
            label = 'External recruiter fit'
            score = $externalRecruiterLikelihoodScore
            weight = 0.16
            summary = 'JD patterns suggest a {0}/100 partner-likelihood' -f ([string]([Math]::Round($externalRecruiterLikelihoodScore, 1)))
        },
        [ordered]@{
            key = 'growthSignals'
            label = 'Growth signals'
            score = $companyGrowthSignalScore
            weight = 0.14
            summary = [string]$(if ([string]::IsNullOrWhiteSpace([string]$Row.company_growth_signal_summary)) { 'Signals driven mainly by hiring volume' } else { [string]$Row.company_growth_signal_summary })
        },
        [ordered]@{
            key = 'engagement'
            label = 'Engagement'
            score = $engagementScore
            weight = 0.12
            summary = [string]$(if ([string]::IsNullOrWhiteSpace([string]$Row.engagement_summary)) { 'No live engagement captured yet' } else { [string]$Row.engagement_summary })
        }
    )

    $topDrivers = @(
        @($components | ForEach-Object {
                $contribution = [int][Math]::Round(([double](ConvertTo-BdSqliteNumber $_.score) * [double]$_.weight))
                [ordered]@{
                    key = [string]$_.key
                    label = [string]$_.label
                    contribution = $contribution
                    score = [int][Math]::Round([double](ConvertTo-BdSqliteNumber $_.score))
                    summary = [string]$_.summary
                }
            } |
            Sort-Object @{ Expression = { [double](ConvertTo-BdSqliteNumber $_.contribution) }; Descending = $true } |
            Select-Object -First 3)
    )

    $summary = if ($topDrivers.Count -gt 0) {
        [string]::Join('; ', @($topDrivers | ForEach-Object { '{0}: {1}' -f $_.label, $_.summary }))
    } else {
        'No strong target-score drivers yet.'
    }

    return [ordered]@{
        model = 'target-score-v2'
        generatedAt = (Get-Date).ToString('o')
        topDrivers = $topDrivers
        summary = $summary
    }
}

function Get-BdSqliteStringList {
    param($Value)

    if ($null -eq $Value) {
        return @()
    }

    if ($Value -is [string]) {
        if ([string]::IsNullOrWhiteSpace($Value)) {
            return @()
        }
        return @($Value)
    }

    if ($Value -is [System.Collections.IDictionary]) {
        return @($Value.Values | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    if ($Value -is [System.Collections.IEnumerable]) {
        return @($Value | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    return @([string]$Value)
}

function ConvertTo-BdSqliteDelimitedList {
    param($Value)

    $items = @(Get-BdSqliteStringList $Value | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ } | Sort-Object -Unique)
    if ($items.Count -eq 0) {
        return ''
    }

    return '|' + ($items -join '|') + '|'
}

function ConvertFrom-BdSqliteDelimitedList {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return @()
    }

    return @($Value.Trim('|').Split('|') | Where-Object { $_ })
}

function Get-BdSqliteSearchText {
    param([string[]]$Parts)

    $builder = New-Object System.Collections.ArrayList
    foreach ($part in @($Parts)) {
        $normalized = Normalize-BdSqliteText $part
        if ($normalized) {
            [void]$builder.Add($normalized)
        }
    }

    return [string]::Join(' ', @($builder))
}

function Open-BdSqliteConnection {
    Import-BdSqliteAssembly

    $dataRoot = Get-BdSqliteDataRoot
    if (-not (Test-Path -LiteralPath $dataRoot)) {
        New-Item -ItemType Directory -Path $dataRoot | Out-Null
    }

    $dbPath = Get-BdSqliteDatabasePath
    $connectionString = "Data Source=$dbPath;Version=3;Pooling=True;Journal Mode=WAL;Synchronous=Normal;"
    $connection = New-Object System.Data.SQLite.SQLiteConnection($connectionString)
    $connection.Open()

    foreach ($pragma in @(
            'PRAGMA journal_mode=WAL;',
            'PRAGMA synchronous=NORMAL;',
            'PRAGMA busy_timeout=1000;',
            'PRAGMA temp_store=MEMORY;',
            'PRAGMA foreign_keys=OFF;'
        )) {
        $command = $connection.CreateCommand()
        try {
            $command.CommandText = $pragma
            [void]$command.ExecuteNonQuery()
        } finally {
            $command.Dispose()
        }
    }

    if (-not $script:SqliteSchemaInitialized) {
        Initialize-BdSqliteSchema -Connection $connection
        $script:SqliteSchemaInitialized = $true
    }

    return $connection
}

function New-BdSqliteCommand {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$Sql,
        [hashtable]$Parameters,
        [System.Data.SQLite.SQLiteTransaction]$Transaction
    )

    $command = $Connection.CreateCommand()
    $command.CommandText = $Sql
    if ($Transaction) {
        $command.Transaction = $Transaction
    }

    foreach ($name in @($Parameters.Keys)) {
        $parameter = $command.CreateParameter()
        $parameter.ParameterName = "@$name"
        $value = $Parameters[$name]
        $parameter.Value = if ($null -eq $value) { [DBNull]::Value } else { $value }
        [void]$command.Parameters.Add($parameter)
    }

    return $command
}

function Invoke-BdSqliteNonQuery {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$Sql,
        [hashtable]$Parameters = @{},
        [System.Data.SQLite.SQLiteTransaction]$Transaction
    )

    $command = New-BdSqliteCommand -Connection $Connection -Sql $Sql -Parameters $Parameters -Transaction $Transaction
    try {
        return $command.ExecuteNonQuery()
    } finally {
        $command.Dispose()
    }
}

function Invoke-BdSqliteScalar {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$Sql,
        [hashtable]$Parameters = @{},
        [System.Data.SQLite.SQLiteTransaction]$Transaction
    )

    $command = New-BdSqliteCommand -Connection $Connection -Sql $Sql -Parameters $Parameters -Transaction $Transaction
    try {
        $value = $command.ExecuteScalar()
        if ($value -is [DBNull]) {
            return $null
        }
        return $value
    } finally {
        $command.Dispose()
    }
}

function Invoke-BdSqliteRows {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$Sql,
        [hashtable]$Parameters = @{},
        [System.Data.SQLite.SQLiteTransaction]$Transaction
    )

    $command = New-BdSqliteCommand -Connection $Connection -Sql $Sql -Parameters $Parameters -Transaction $Transaction
    try {
        $reader = $command.ExecuteReader()
        try {
            $rows = New-Object System.Collections.ArrayList
            while ($reader.Read()) {
                $row = [ordered]@{}
                for ($index = 0; $index -lt $reader.FieldCount; $index++) {
                    $value = if ($reader.IsDBNull($index)) { $null } else { $reader.GetValue($index) }
                    $row[$reader.GetName($index)] = $value
                }
                [void]$rows.Add($row)
            }
            return @($rows)
        } finally {
            $reader.Dispose()
        }
    } finally {
        $command.Dispose()
    }
}

function New-BdSqliteInClauseParts {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Prefix,
        [object[]]$Values
    )

    $parameters = @{}
    $placeholders = New-Object System.Collections.ArrayList
    $uniqueValues = @($Values | Where-Object { $null -ne $_ -and -not [string]::IsNullOrWhiteSpace([string]$_) } | ForEach-Object { [string]$_ } | Select-Object -Unique)

    for ($index = 0; $index -lt $uniqueValues.Count; $index++) {
        $parameterName = '{0}{1}' -f $Prefix, $index
        $parameters[$parameterName] = [string]$uniqueValues[$index]
        [void]$placeholders.Add(('@{0}' -f $parameterName))
    }

    return [ordered]@{
        clause = if ($placeholders.Count -gt 0) { [string]::Join(', ', @($placeholders.ToArray())) } else { 'NULL' }
        parameters = $parameters
        count = $placeholders.Count
    }
}

function Set-BdSqliteMetaValue {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$Key,
        [string]$Value,
        [System.Data.SQLite.SQLiteTransaction]$Transaction
    )

    Invoke-BdSqliteNonQuery -Connection $Connection -Transaction $Transaction -Sql @'
INSERT INTO meta([key], value)
VALUES (@key, @value)
ON CONFLICT([key]) DO UPDATE SET value = excluded.value
'@ -Parameters @{
        key = $Key
        value = [string]$Value
    } | Out-Null
}

function Get-BdSqliteMetaValue {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    return [string](Invoke-BdSqliteScalar -Connection $Connection -Sql 'SELECT value FROM meta WHERE [key] = @key;' -Parameters @{ key = $Key })
}

function Get-BdSqliteResolverProbeCacheRecords {
    param(
        [string[]]$Urls,
        [switch]$IncludeExpired
    )

    $normalizedUrls = @($Urls | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ } | Select-Object -Unique)
    if ($normalizedUrls.Count -eq 0) {
        return @()
    }

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection

        $urlClause = New-BdSqliteInClauseParts -Prefix 'probeUrl' -Values $normalizedUrls
        $parameters = @{}
        foreach ($key in @($urlClause.parameters.Keys)) {
            $parameters[$key] = $urlClause.parameters[$key]
        }

        $sql = "SELECT url, response_json, fetched_at, expires_at, last_accessed_at, hit_count FROM resolver_probe_cache WHERE url IN ($($urlClause.clause))"
        if (-not $IncludeExpired) {
            $sql += ' AND expires_at >= @now'
            $parameters.now = (Get-Date).ToString('o')
        }
        $sql += ';'

        $rows = @(Invoke-BdSqliteRows -Connection $connection -Sql $sql -Parameters $parameters)
        if ($rows.Count -gt 0) {
            $hitClause = New-BdSqliteInClauseParts -Prefix 'hitUrl' -Values @($rows | ForEach-Object { [string]$_.url })
            if ($hitClause.count -gt 0) {
                $hitParameters = @{ accessedAt = (Get-Date).ToString('o') }
                foreach ($key in @($hitClause.parameters.Keys)) {
                    $hitParameters[$key] = $hitClause.parameters[$key]
                }
                Invoke-BdSqliteNonQuery -Connection $connection -Sql ("UPDATE resolver_probe_cache SET last_accessed_at = @accessedAt, hit_count = hit_count + 1 WHERE url IN ({0});" -f $hitClause.clause) -Parameters $hitParameters | Out-Null
            }
        }

        $records = New-Object System.Collections.ArrayList
        foreach ($row in @($rows)) {
            $response = $null
            try {
                $response = ConvertFrom-BdSqliteJsonText ([string]$row.response_json)
            } catch {
                continue
            }

            [void]$records.Add([ordered]@{
                    url = [string]$row.url
                    response = $response
                    fetchedAt = [string]$row.fetched_at
                    expiresAt = [string]$row.expires_at
                    lastAccessedAt = [string]$row.last_accessed_at
                    hitCount = [int](ConvertTo-BdSqliteNumber $row.hit_count)
                })
        }

        return @($records.ToArray())
    } finally {
        $connection.Dispose()
    }
}

function Save-BdSqliteResolverProbeCacheRecords {
    param([object[]]$Records)

    $entries = New-Object System.Collections.ArrayList
    foreach ($record in @($Records)) {
        $url = ([string]$(if ($record) { $record.url } else { '' })).Trim()
        if (-not $url) {
            continue
        }

        $response = if ($record) { $record.response } else { $null }
        if ($null -eq $response) {
            continue
        }

        $fetchedAt = [string]$(if ($record.fetchedAt) { $record.fetchedAt } else { (Get-Date).ToString('o') })
        $expiresAt = [string]$(if ($record.expiresAt) { $record.expiresAt } else { (Get-Date).AddHours(6).ToString('o') })
        [void]$entries.Add([ordered]@{
                url = $url
                responseJson = (ConvertTo-BdSqliteJsonText $response)
                fetchedAt = $fetchedAt
                expiresAt = $expiresAt
            })
    }

    if ($entries.Count -eq 0) {
        return 0
    }

    $connection = Open-BdSqliteConnection
    $transaction = $connection.BeginTransaction()
    try {
        Initialize-BdSqliteSchema -Connection $connection
        $savedCount = 0
        foreach ($entry in @($entries.ToArray())) {
            $savedCount += [int](Invoke-BdSqliteNonQuery -Connection $connection -Transaction $transaction -Sql @'
INSERT INTO resolver_probe_cache(url, response_json, fetched_at, expires_at, last_accessed_at, hit_count)
VALUES (@url, @responseJson, @fetchedAt, @expiresAt, @lastAccessedAt, 0)
ON CONFLICT(url) DO UPDATE SET
    response_json = excluded.response_json,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at,
    last_accessed_at = excluded.last_accessed_at
'@ -Parameters @{
                    url = [string]$entry.url
                    responseJson = [string]$entry.responseJson
                    fetchedAt = [string]$entry.fetchedAt
                    expiresAt = [string]$entry.expiresAt
                    lastAccessedAt = [string]$entry.fetchedAt
                })
        }

        $transaction.Commit()
        return $savedCount
    } catch {
        try { $transaction.Rollback() } catch {}
        throw
    } finally {
        $transaction.Dispose()
        $connection.Dispose()
    }
}

function Clear-BdSqliteExpiredResolverProbeCache {
    param([string]$Before = '')

    $cutoff = if ($Before) { [string]$Before } else { (Get-Date).ToString('o') }
    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        return [int](Invoke-BdSqliteNonQuery -Connection $connection -Sql 'DELETE FROM resolver_probe_cache WHERE expires_at < @cutoff;' -Parameters @{ cutoff = $cutoff })
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteResolverSearchCacheRecord {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CacheKey,
        [switch]$IncludeExpired
    )

    $normalizedKey = ([string]$CacheKey).Trim()
    if (-not $normalizedKey) {
        return $null
    }

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        $parameters = @{ cacheKey = $normalizedKey }
        $sql = 'SELECT cache_key, urls_json, fetched_at, expires_at, last_accessed_at, hit_count FROM resolver_search_cache WHERE cache_key = @cacheKey'
        if (-not $IncludeExpired) {
            $sql += ' AND expires_at >= @now'
            $parameters.now = (Get-Date).ToString('o')
        }
        $sql += ' LIMIT 1;'

        $row = @(Invoke-BdSqliteRows -Connection $connection -Sql $sql -Parameters $parameters | Select-Object -First 1)
        if (-not $row) {
            return $null
        }

        Invoke-BdSqliteNonQuery -Connection $connection -Sql 'UPDATE resolver_search_cache SET last_accessed_at = @accessedAt, hit_count = hit_count + 1 WHERE cache_key = @cacheKey;' -Parameters @{
            cacheKey = $normalizedKey
            accessedAt = (Get-Date).ToString('o')
        } | Out-Null

        return [ordered]@{
            cacheKey = [string]$row.cache_key
            urls = @(
                if ([string]::IsNullOrWhiteSpace([string]$row.urls_json)) {
                    @()
                } else {
                    $parsedUrls = ConvertFrom-BdSqliteJsonText ([string]$row.urls_json)
                    if ($null -eq $parsedUrls) { @() } else { @($parsedUrls) }
                }
            )
            fetchedAt = [string]$row.fetched_at
            expiresAt = [string]$row.expires_at
            lastAccessedAt = [string]$row.last_accessed_at
            hitCount = [int](ConvertTo-BdSqliteNumber $row.hit_count)
        }
    } finally {
        $connection.Dispose()
    }
}

function Save-BdSqliteResolverSearchCacheRecord {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CacheKey,
        [string[]]$Urls = @(),
        [string]$FetchedAt = '',
        [string]$ExpiresAt = ''
    )

    $normalizedKey = ([string]$CacheKey).Trim()
    if (-not $normalizedKey) {
        return 0
    }

    $urlValues = @($Urls | Where-Object { $_ } | ForEach-Object { [string]$_ } | Select-Object -Unique)
    $urlsJson = if ($urlValues.Count -eq 0) { '[]' } else { [string](ConvertTo-BdSqliteJsonText @($urlValues)) }
    $fetchedValue = if ($FetchedAt) { [string]$FetchedAt } else { (Get-Date).ToString('o') }
    $expiresValue = if ($ExpiresAt) { [string]$ExpiresAt } else { (Get-Date).AddHours(6).ToString('o') }

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        return [int](Invoke-BdSqliteNonQuery -Connection $connection -Sql @'
INSERT INTO resolver_search_cache(cache_key, urls_json, fetched_at, expires_at, last_accessed_at, hit_count)
VALUES (@cacheKey, @urlsJson, @fetchedAt, @expiresAt, @lastAccessedAt, 0)
ON CONFLICT(cache_key) DO UPDATE SET
    urls_json = excluded.urls_json,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at,
    last_accessed_at = excluded.last_accessed_at
'@ -Parameters @{
                cacheKey = $normalizedKey
                urlsJson = $urlsJson
                fetchedAt = $fetchedValue
                expiresAt = $expiresValue
                lastAccessedAt = $fetchedValue
            })
    } finally {
        $connection.Dispose()
    }
}

function Clear-BdSqliteExpiredResolverSearchCache {
    param([string]$Before = '')

    $cutoff = if ($Before) { [string]$Before } else { (Get-Date).ToString('o') }
    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        return [int](Invoke-BdSqliteNonQuery -Connection $connection -Sql 'DELETE FROM resolver_search_cache WHERE expires_at < @cutoff;' -Parameters @{ cutoff = $cutoff })
    } finally {
        $connection.Dispose()
    }
}

function New-BdSqliteDataRevision {
    return ('{0}-{1}' -f (Get-Date).ToUniversalTime().Ticks, [guid]::NewGuid().ToString('n'))
}

function Get-BdSqliteDataRevision {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [System.Data.SQLite.SQLiteTransaction]$Transaction
    )

    $revision = Get-BdSqliteMetaValue -Connection $Connection -Key 'data_revision'
    if (-not $revision) {
        $revision = New-BdSqliteDataRevision
        Set-BdSqliteMetaValue -Connection $Connection -Transaction $Transaction -Key 'data_revision' -Value $revision
    }

    return $revision
}

function Test-BdSqliteSnapshotSegment {
    param([string]$Segment)

    return @('Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities') -contains $Segment
}

function Get-BdSqliteSnapshotTtlSeconds {
    param([string]$Name)

    switch ($Name) {
        'dashboard' { return 900 }
        'filters' { return 21600 }
        default { return 0 }
    }
}

function Get-BdSqliteSnapshotRecord {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $row = @(Invoke-BdSqliteRows -Connection $Connection -Sql 'SELECT * FROM snapshots WHERE name = @name LIMIT 1;' -Parameters @{ name = $Name } | Select-Object -First 1)
    if (-not $row) {
        return $null
    }

    $payload = $null
    $payloadError = $null
    try {
        $payload = ConvertFrom-BdSqliteJsonText ([string]$row.payload_json)
    } catch {
        $payloadError = $_.Exception.Message
    }

    return [ordered]@{
        name = [string]$row.name
        payload = $payload
        payloadError = $payloadError
        sourceRevision = [string]$row.source_revision
        updatedAt = [string]$row.updated_at
        buildMs = [int](ConvertTo-BdSqliteNumber $row.build_ms)
    }
}

function Save-BdSqliteSnapshotRecord {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        $Payload,
        [Parameter(Mandatory = $true)]
        [string]$SourceRevision,
        [int]$BuildMs = 0
    )

    Invoke-BdSqliteNonQuery -Connection $Connection -Sql @'
INSERT INTO snapshots(name, payload_json, source_revision, updated_at, build_ms)
VALUES (@name, @payloadJson, @sourceRevision, @updatedAt, @buildMs)
ON CONFLICT(name) DO UPDATE SET
    payload_json = excluded.payload_json,
    source_revision = excluded.source_revision,
    updated_at = excluded.updated_at,
    build_ms = excluded.build_ms
'@ -Parameters @{
        name = $Name
        payloadJson = (ConvertTo-BdSqliteJsonText $Payload)
        sourceRevision = $SourceRevision
        updatedAt = (Get-Date).ToString('o')
        buildMs = [int]$BuildMs
    } | Out-Null
}

function Get-BdSqliteSnapshotAgeSeconds {
    param([string]$UpdatedAt)

    if ([string]::IsNullOrWhiteSpace($UpdatedAt)) {
        return $null
    }

    try {
        $timestamp = [datetimeoffset]::Parse($UpdatedAt)
        return [int][Math]::Max(0, [Math]::Round(([datetimeoffset]::UtcNow - $timestamp.ToUniversalTime()).TotalSeconds))
    } catch {
        return $null
    }
}

function Measure-BdSqliteSnapshotBuild {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Builder
    )

    $startedAt = Get-Date
    $payload = & $Builder
    $durationMs = [int][Math]::Round(((Get-Date) - $startedAt).TotalMilliseconds)
    return [ordered]@{
        payload = $payload
        buildMs = $durationMs
    }
}

function Invoke-BdSqliteTimedStep {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action,
        [System.Collections.IDictionary]$TimingBag
    )

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        return (& $Action)
    } finally {
        $stopwatch.Stop()
        if ($TimingBag) {
            $TimingBag[$Name] = [int]$stopwatch.ElapsedMilliseconds
        }
    }
}

function Get-BdSqliteSnapshotDirtyMetaKey {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [ValidateSet('dirty', 'reason', 'updated_at', 'data_revision')]
        [string]$Field
    )

    return ('snapshot_{0}_{1}' -f $Field, $Name)
}

function Set-BdSqliteSnapshotDirtyState {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string[]]$Names,
        [bool]$IsDirty = $true,
        [string]$Reason = '',
        [string]$DataRevision = '',
        [System.Data.SQLite.SQLiteTransaction]$Transaction
    )

    $timestamp = (Get-Date).ToString('o')
    foreach ($name in @($Names | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)) {
        $dirtyValue = if ($IsDirty) { '1' } else { '0' }
        Set-BdSqliteMetaValue -Connection $Connection -Transaction $Transaction -Key (Get-BdSqliteSnapshotDirtyMetaKey -Name $name -Field 'dirty') -Value $dirtyValue
        Set-BdSqliteMetaValue -Connection $Connection -Transaction $Transaction -Key (Get-BdSqliteSnapshotDirtyMetaKey -Name $name -Field 'reason') -Value ([string]$Reason)
        Set-BdSqliteMetaValue -Connection $Connection -Transaction $Transaction -Key (Get-BdSqliteSnapshotDirtyMetaKey -Name $name -Field 'updated_at') -Value $timestamp
        Set-BdSqliteMetaValue -Connection $Connection -Transaction $Transaction -Key (Get-BdSqliteSnapshotDirtyMetaKey -Name $name -Field 'data_revision') -Value ([string]$DataRevision)
    }
}

function Get-BdSqliteSnapshotDirtyState {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [ValidateSet('dashboard', 'filters')]
        [string]$Name
    )

    $dirtyRaw = Get-BdSqliteMetaValue -Connection $Connection -Key (Get-BdSqliteSnapshotDirtyMetaKey -Name $Name -Field 'dirty')
    $isDirty = ($dirtyRaw -eq '1' -or $dirtyRaw -eq 'true')
    return [ordered]@{
        name = $Name
        isDirty = $isDirty
        reason = [string](Get-BdSqliteMetaValue -Connection $Connection -Key (Get-BdSqliteSnapshotDirtyMetaKey -Name $Name -Field 'reason'))
        updatedAt = [string](Get-BdSqliteMetaValue -Connection $Connection -Key (Get-BdSqliteSnapshotDirtyMetaKey -Name $Name -Field 'updated_at'))
        dataRevision = [string](Get-BdSqliteMetaValue -Connection $Connection -Key (Get-BdSqliteSnapshotDirtyMetaKey -Name $Name -Field 'data_revision'))
    }
}

function Set-BdSqliteSnapshotsDirty {
    param(
        [string[]]$Names,
        [string]$Reason = '',
        [string]$DataRevision = ''
    )

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        Set-BdSqliteSnapshotDirtyState -Connection $connection -Names $Names -IsDirty:$true -Reason $Reason -DataRevision $DataRevision
        return [ordered]@{
            ok = $true
            names = @($Names | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
            reason = [string]$Reason
            dataRevision = [string]$DataRevision
            updatedAt = (Get-Date).ToString('o')
        }
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteSnapshotDirtyStateRecord {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('dashboard', 'filters')]
        [string]$Name
    )

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        return (Get-BdSqliteSnapshotDirtyState -Connection $connection -Name $Name)
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteTableColumnNames {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$TableName
    )

    return @(
        Invoke-BdSqliteRows -Connection $Connection -Sql ("PRAGMA table_info([{0}]);" -f $TableName) |
            ForEach-Object { [string]$_.name }
    )
}

function Add-BdSqliteTableColumnIfMissing {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$TableName,
        [Parameter(Mandatory = $true)]
        [string]$ColumnName,
        [Parameter(Mandatory = $true)]
        [string]$Definition
    )

    $columnNames = @(Get-BdSqliteTableColumnNames -Connection $Connection -TableName $TableName)
    if ($columnNames -contains $ColumnName) {
        return $false
    }

    Invoke-BdSqliteNonQuery -Connection $Connection -Sql ("ALTER TABLE [{0}] ADD COLUMN [{1}] {2};" -f $TableName, $ColumnName, $Definition) | Out-Null
    return $true
}

function Write-BdSqliteResolverCoverageHistory {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [string]$DataRevision = ''
    )

    $existing = if ($DataRevision) {
        [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $Connection -Sql 'SELECT COUNT(*) FROM resolver_coverage_history WHERE data_revision = @dataRevision;' -Parameters @{ dataRevision = $DataRevision }))
    } else {
        0
    }
    if ($existing -gt 0) {
        return
    }

    $summaryRow = @(Invoke-BdSqliteRows -Connection $Connection -Sql @'
SELECT
    COUNT(*) AS total_configs,
    SUM(CASE WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 1 ELSE 0 END) AS resolved_configs,
    SUM(CASE WHEN (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) = 'high' THEN 1 ELSE 0 END) AS high_confidence_count,
    SUM(CASE WHEN (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) = 'medium' THEN 1 ELSE 0 END) AS medium_confidence_count,
    SUM(CASE WHEN (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) = 'low' THEN 1 ELSE 0 END) AS low_confidence_count,
    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS auto_active_count
FROM board_configs;
'@ | Select-Object -First 1)
    if (-not $summaryRow) {
        return
    }

    $totalConfigs = [int](ConvertTo-BdSqliteNumber $summaryRow.total_configs)
    $resolvedConfigs = [int](ConvertTo-BdSqliteNumber $summaryRow.resolved_configs)
    $unresolvedConfigs = [int][Math]::Max(0, $totalConfigs - $resolvedConfigs)
    $highConfidenceCount = [int](ConvertTo-BdSqliteNumber $summaryRow.high_confidence_count)
    $mediumConfidenceCount = [int](ConvertTo-BdSqliteNumber $summaryRow.medium_confidence_count)
    $lowConfidenceCount = [int](ConvertTo-BdSqliteNumber $summaryRow.low_confidence_count)
    $autoActiveCount = [int](ConvertTo-BdSqliteNumber $summaryRow.auto_active_count)
    $coveragePct = if ($totalConfigs -gt 0) { [double][Math]::Round(($resolvedConfigs / $totalConfigs) * 100, 1) } else { 0 }

    Invoke-BdSqliteNonQuery -Connection $Connection -Sql @'
INSERT INTO resolver_coverage_history(
    captured_at,
    data_revision,
    total_configs,
    resolved_configs,
    unresolved_configs,
    high_confidence_count,
    medium_confidence_count,
    low_confidence_count,
    auto_active_count,
    coverage_pct
)
VALUES (
    @capturedAt,
    @dataRevision,
    @totalConfigs,
    @resolvedConfigs,
    @unresolvedConfigs,
    @highConfidenceCount,
    @mediumConfidenceCount,
    @lowConfidenceCount,
    @autoActiveCount,
    @coveragePct
);
'@ -Parameters @{
        capturedAt = (Get-Date).ToString('o')
        dataRevision = $DataRevision
        totalConfigs = $totalConfigs
        resolvedConfigs = $resolvedConfigs
        unresolvedConfigs = $unresolvedConfigs
        highConfidenceCount = $highConfidenceCount
        mediumConfidenceCount = $mediumConfidenceCount
        lowConfidenceCount = $lowConfidenceCount
        autoActiveCount = $autoActiveCount
        coveragePct = $coveragePct
    } | Out-Null
}

function Write-BdSqliteEnrichmentCoverageHistory {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [string]$DataRevision = ''
    )

    $existing = if ($DataRevision) {
        [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $Connection -Sql 'SELECT COUNT(*) FROM enrichment_coverage_history WHERE data_revision = @dataRevision;' -Parameters @{ dataRevision = $DataRevision }))
    } else {
        0
    }
    if ($existing -gt 0) {
        return
    }

    $summaryRow = @(Invoke-BdSqliteRows -Connection $Connection -Sql @'
SELECT
    COUNT(*) AS total_companies,
    SUM(CASE WHEN COALESCE(NULLIF(canonical_domain, ''), '') <> '' THEN 1 ELSE 0 END) AS canonical_domain_count,
    SUM(CASE WHEN COALESCE(NULLIF(careers_url, ''), '') <> '' THEN 1 ELSE 0 END) AS careers_url_count,
    SUM(CASE WHEN COALESCE(NULLIF(aliases_text, ''), '') <> '' THEN 1 ELSE 0 END) AS aliases_count,
    SUM(CASE WHEN COALESCE(NULLIF(enrichment_status, ''), '') IN ('enriched', 'verified', 'manual') THEN 1 ELSE 0 END) AS enriched_count,
    SUM(CASE WHEN COALESCE(bc.has_resolved, 0) = 1 AND COALESCE(NULLIF(c.canonical_domain, ''), '') <> '' THEN 1 ELSE 0 END) AS resolution_with_enrichment_count,
    SUM(CASE WHEN COALESCE(bc.has_resolved, 0) = 1 AND COALESCE(NULLIF(c.canonical_domain, ''), '') = '' AND COALESCE(NULLIF(c.careers_url, ''), '') = '' THEN 1 ELSE 0 END) AS resolution_without_enrichment_count
FROM companies c
LEFT JOIN (
    SELECT normalized_company_name, MAX(CASE WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 1 ELSE 0 END) AS has_resolved
    FROM board_configs
    GROUP BY normalized_company_name
) bc ON bc.normalized_company_name = c.normalized_name;
'@ | Select-Object -First 1)
    if (-not $summaryRow) {
        return
    }

    $totalCompanies = [int](ConvertTo-BdSqliteNumber $summaryRow.total_companies)
    $canonicalDomainCount = [int](ConvertTo-BdSqliteNumber $summaryRow.canonical_domain_count)
    $careersUrlCount = [int](ConvertTo-BdSqliteNumber $summaryRow.careers_url_count)
    $aliasesCount = [int](ConvertTo-BdSqliteNumber $summaryRow.aliases_count)
    $enrichedCount = [int](ConvertTo-BdSqliteNumber $summaryRow.enriched_count)
    $unenrichedCount = [int][Math]::Max(0, $totalCompanies - $enrichedCount)
    $resolutionWithEnrichmentCount = [int](ConvertTo-BdSqliteNumber $summaryRow.resolution_with_enrichment_count)
    $resolutionWithoutEnrichmentCount = [int](ConvertTo-BdSqliteNumber $summaryRow.resolution_without_enrichment_count)
    $coveragePct = if ($totalCompanies -gt 0) { [double][Math]::Round(($enrichedCount / $totalCompanies) * 100, 1) } else { 0 }

    Invoke-BdSqliteNonQuery -Connection $Connection -Sql @'
INSERT INTO enrichment_coverage_history(
    captured_at,
    data_revision,
    total_companies,
    canonical_domain_count,
    careers_url_count,
    aliases_count,
    enriched_count,
    unenriched_count,
    resolution_with_enrichment_count,
    resolution_without_enrichment_count,
    coverage_pct
)
VALUES (
    @capturedAt,
    @dataRevision,
    @totalCompanies,
    @canonicalDomainCount,
    @careersUrlCount,
    @aliasesCount,
    @enrichedCount,
    @unenrichedCount,
    @resolutionWithEnrichmentCount,
    @resolutionWithoutEnrichmentCount,
    @coveragePct
);
'@ -Parameters @{
        capturedAt = (Get-Date).ToString('o')
        dataRevision = $DataRevision
        totalCompanies = $totalCompanies
        canonicalDomainCount = $canonicalDomainCount
        careersUrlCount = $careersUrlCount
        aliasesCount = $aliasesCount
        enrichedCount = $enrichedCount
        unenrichedCount = $unenrichedCount
        resolutionWithEnrichmentCount = $resolutionWithEnrichmentCount
        resolutionWithoutEnrichmentCount = $resolutionWithoutEnrichmentCount
        coveragePct = $coveragePct
    } | Out-Null
}

function Initialize-BdSqliteSchema {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection
    )

    $statements = @(
@'
CREATE TABLE IF NOT EXISTS meta (
    [key] TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
'@,
@'
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    normalized_name TEXT,
    display_name TEXT,
    display_name_normalized TEXT,
    industry TEXT,
    location TEXT,
    domain TEXT,
    canonical_domain TEXT,
    careers_url TEXT,
    linkedin_company_slug TEXT,
    aliases_text TEXT,
    enrichment_status TEXT,
    enrichment_source TEXT,
    enrichment_confidence TEXT,
    enrichment_confidence_score REAL,
    enrichment_notes TEXT,
    enrichment_evidence TEXT,
    enrichment_failure_reason TEXT,
    enrichment_attempted_urls_text TEXT,
    last_enriched_at TEXT,
    last_verified_at TEXT,
    next_enrichment_attempt_at TEXT,
    owner TEXT,
    owner_normalized TEXT,
    priority TEXT,
    priority_tier TEXT,
    status TEXT,
    outreach_status TEXT,
    connection_count INTEGER,
    senior_contact_count INTEGER,
    talent_contact_count INTEGER,
    buyer_title_count INTEGER,
    target_score REAL,
    target_score_explanation_json TEXT,
    daily_score REAL,
    follow_up_score REAL,
    job_count INTEGER,
    open_role_count INTEGER,
    jobs_last_30_days INTEGER,
    jobs_last_90_days INTEGER,
    new_role_count_7d INTEGER,
    stale_role_count_30d INTEGER,
    avg_role_seniority_score REAL,
    hiring_spike_ratio REAL,
    external_recruiter_likelihood_score REAL,
    company_growth_signal_score REAL,
    company_growth_signal_summary TEXT,
    engagement_score REAL,
    engagement_summary TEXT,
    hiring_velocity REAL,
    department_focus TEXT,
    department_focus_count INTEGER,
    department_concentration REAL,
    hiring_spike_score REAL,
    network_strength TEXT,
    hiring_status TEXT,
    last_job_posted_at TEXT,
    last_contacted_at TEXT,
    days_since_contact INTEGER,
    stale_flag TEXT,
    next_action TEXT,
    next_action_at TEXT,
    recommended_action TEXT,
    outreach_draft TEXT,
    top_contact_name TEXT,
    top_contact_title TEXT,
    ats_types_text TEXT,
    tags_text TEXT,
    notes TEXT,
    search_text TEXT,
    data_json TEXT NOT NULL
);
'@,
@'
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    account_id TEXT,
    normalized_company_name TEXT,
    company_name TEXT,
    full_name TEXT,
    title TEXT,
    email TEXT,
    linkedin_url TEXT,
    connected_on TEXT,
    priority_score REAL,
    company_overlap_count INTEGER,
    outreach_status TEXT,
    notes TEXT,
    search_text TEXT,
    data_json TEXT NOT NULL
);
'@,
@'
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    account_id TEXT,
    normalized_company_name TEXT,
    company_name TEXT,
    title TEXT,
    normalized_title TEXT,
    department TEXT,
    location TEXT,
    employment_type TEXT,
    job_id TEXT,
    url TEXT,
    job_url TEXT,
    source_url TEXT,
    ats_type TEXT,
    posted_at TEXT,
    retrieved_at TEXT,
    imported_at TEXT,
    last_seen_at TEXT,
    dedupe_key TEXT,
    active INTEGER,
    is_new INTEGER,
    is_gta INTEGER,
    search_text TEXT,
    data_json TEXT NOT NULL
);
'@,
@'
CREATE TABLE IF NOT EXISTS board_configs (
    id TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    account_id TEXT,
    normalized_company_name TEXT,
    company_name TEXT,
    ats_type TEXT,
    board_id TEXT,
    domain TEXT,
    careers_url TEXT,
    resolved_board_url TEXT,
    source TEXT,
    notes TEXT,
    active INTEGER,
    supported_import INTEGER,
    last_checked_at TEXT,
    last_resolution_attempt_at TEXT,
    next_resolution_attempt_at TEXT,
    discovery_status TEXT,
    discovery_method TEXT,
    confidence_score REAL,
    confidence_band TEXT,
    evidence_summary TEXT,
    review_status TEXT,
    failure_reason TEXT,
    redirect_target TEXT,
    matched_signatures_text TEXT,
    last_import_at TEXT,
    last_import_status TEXT,
    search_text TEXT,
    data_json TEXT NOT NULL
);
'@,
@'
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    account_id TEXT,
    normalized_company_name TEXT,
    summary TEXT,
    type TEXT,
    notes TEXT,
    occurred_at TEXT,
    pipeline_stage TEXT,
    data_json TEXT NOT NULL
);
'@,
@'
CREATE TABLE IF NOT EXISTS import_runs (
    id TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL,
    run_type TEXT,
    status TEXT,
    started_at TEXT,
    completed_at TEXT,
    data_json TEXT NOT NULL
);
'@,
@'
CREATE TABLE IF NOT EXISTS snapshots (
    name TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    build_ms INTEGER NOT NULL
);
'@,
@'
CREATE TABLE IF NOT EXISTS background_jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    summary_text TEXT,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL,
    progress_message TEXT,
    error_message TEXT,
    records_affected INTEGER,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    result_json TEXT
);
'@,
@'
CREATE TABLE IF NOT EXISTS resolver_probe_cache (
    url TEXT PRIMARY KEY,
    response_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0
);
'@,
@'
CREATE TABLE IF NOT EXISTS resolver_search_cache (
    cache_key TEXT PRIMARY KEY,
    urls_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0
);
'@,
@'
CREATE TABLE IF NOT EXISTS resolver_coverage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at TEXT NOT NULL,
    data_revision TEXT,
    total_configs INTEGER NOT NULL,
    resolved_configs INTEGER NOT NULL,
    unresolved_configs INTEGER NOT NULL,
    high_confidence_count INTEGER NOT NULL,
    medium_confidence_count INTEGER NOT NULL,
    low_confidence_count INTEGER NOT NULL,
    auto_active_count INTEGER NOT NULL,
    coverage_pct REAL NOT NULL
);
'@,
@'
CREATE TABLE IF NOT EXISTS enrichment_coverage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at TEXT NOT NULL,
    data_revision TEXT,
    total_companies INTEGER NOT NULL,
    canonical_domain_count INTEGER NOT NULL,
    careers_url_count INTEGER NOT NULL,
    aliases_count INTEGER NOT NULL,
    enriched_count INTEGER NOT NULL,
    unenriched_count INTEGER NOT NULL,
    resolution_with_enrichment_count INTEGER NOT NULL,
    resolution_without_enrichment_count INTEGER NOT NULL,
    coverage_pct REAL NOT NULL
);
'@
    )

    foreach ($statement in $statements) {
        Invoke-BdSqliteNonQuery -Connection $Connection -Sql $statement | Out-Null
    }

    foreach ($statement in @(
            'CREATE INDEX IF NOT EXISTS idx_companies_status_daily ON companies(status, daily_score DESC);',
            'CREATE INDEX IF NOT EXISTS idx_companies_priority_daily ON companies(priority, daily_score DESC);',
            'CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(owner_normalized);',
            'CREATE INDEX IF NOT EXISTS idx_companies_outreach ON companies(outreach_status);',
            'CREATE INDEX IF NOT EXISTS idx_companies_job_daily ON companies(job_count, daily_score DESC);',
            'CREATE INDEX IF NOT EXISTS idx_companies_connections ON companies(connection_count DESC);',
            'CREATE INDEX IF NOT EXISTS idx_companies_last_job ON companies(last_job_posted_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_companies_follow_up ON companies(follow_up_score DESC, daily_score DESC);',
            'CREATE INDEX IF NOT EXISTS idx_companies_normalized_name ON companies(normalized_name);',
            'CREATE INDEX IF NOT EXISTS idx_contacts_account_priority ON contacts(account_id, priority_score DESC);',
            'CREATE INDEX IF NOT EXISTS idx_contacts_company_priority ON contacts(normalized_company_name, priority_score DESC);',
            'CREATE INDEX IF NOT EXISTS idx_contacts_outreach ON contacts(outreach_status);',
            'CREATE INDEX IF NOT EXISTS idx_jobs_posted ON jobs(posted_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_jobs_company_posted ON jobs(normalized_company_name, posted_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_jobs_account_posted ON jobs(account_id, posted_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_jobs_ats_active ON jobs(ats_type, active, posted_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_jobs_retrieved ON jobs(retrieved_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_jobs_imported ON jobs(imported_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_configs_company ON board_configs(normalized_company_name);',
            'CREATE INDEX IF NOT EXISTS idx_configs_status ON board_configs(discovery_status, active);',
            'CREATE INDEX IF NOT EXISTS idx_configs_ats_active ON board_configs(ats_type, active);',
            'CREATE INDEX IF NOT EXISTS idx_configs_checked ON board_configs(last_checked_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_activities_account_occurred ON activities(account_id, occurred_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_activities_company_occurred ON activities(normalized_company_name, occurred_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_background_jobs_status_queued ON background_jobs(status, queued_at ASC);',
            'CREATE INDEX IF NOT EXISTS idx_background_jobs_updated ON background_jobs(updated_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_resolver_probe_cache_expires ON resolver_probe_cache(expires_at);',
            'CREATE INDEX IF NOT EXISTS idx_resolver_probe_cache_accessed ON resolver_probe_cache(last_accessed_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_resolver_search_cache_expires ON resolver_search_cache(expires_at);',
            'CREATE INDEX IF NOT EXISTS idx_resolver_search_cache_accessed ON resolver_search_cache(last_accessed_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_resolver_coverage_captured ON resolver_coverage_history(captured_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_resolver_coverage_revision ON resolver_coverage_history(data_revision);',
            'CREATE INDEX IF NOT EXISTS idx_enrichment_coverage_captured ON enrichment_coverage_history(captured_at DESC);',
            'CREATE INDEX IF NOT EXISTS idx_enrichment_coverage_revision ON enrichment_coverage_history(data_revision);'
        )) {
        Invoke-BdSqliteNonQuery -Connection $Connection -Sql $statement | Out-Null
    }

    $companyColumnAdded = $false
    foreach ($columnSpec in @(
            @{ name = 'canonical_domain'; definition = 'TEXT' },
            @{ name = 'linkedin_company_slug'; definition = 'TEXT' },
            @{ name = 'aliases_text'; definition = 'TEXT' },
            @{ name = 'enrichment_status'; definition = 'TEXT' },
            @{ name = 'enrichment_source'; definition = 'TEXT' },
            @{ name = 'enrichment_confidence'; definition = 'TEXT' },
            @{ name = 'enrichment_confidence_score'; definition = 'REAL' },
            @{ name = 'enrichment_notes'; definition = 'TEXT' },
            @{ name = 'enrichment_evidence'; definition = 'TEXT' },
            @{ name = 'enrichment_failure_reason'; definition = 'TEXT' },
            @{ name = 'enrichment_attempted_urls_text'; definition = 'TEXT' },
            @{ name = 'last_enriched_at'; definition = 'TEXT' },
            @{ name = 'last_verified_at'; definition = 'TEXT' },
            @{ name = 'next_enrichment_attempt_at'; definition = 'TEXT' },
            @{ name = 'jobs_last_30_days'; definition = 'INTEGER' },
            @{ name = 'jobs_last_90_days'; definition = 'INTEGER' },
            @{ name = 'avg_role_seniority_score'; definition = 'REAL' },
            @{ name = 'hiring_spike_ratio'; definition = 'REAL' },
            @{ name = 'external_recruiter_likelihood_score'; definition = 'REAL' },
            @{ name = 'company_growth_signal_score'; definition = 'REAL' },
            @{ name = 'company_growth_signal_summary'; definition = 'TEXT' },
            @{ name = 'engagement_score'; definition = 'REAL' },
            @{ name = 'engagement_summary'; definition = 'TEXT' },
            @{ name = 'hiring_velocity'; definition = 'REAL' },
            @{ name = 'target_score_explanation_json'; definition = 'TEXT' }
        )) {
        if (Add-BdSqliteTableColumnIfMissing -Connection $Connection -TableName 'companies' -ColumnName ([string]$columnSpec.name) -Definition ([string]$columnSpec.definition)) {
            $companyColumnAdded = $true
        }
    }

    if ($companyColumnAdded) {
        $backfillRows = New-Object System.Collections.ArrayList
        foreach ($row in @(Invoke-BdSqliteRows -Connection $Connection -Sql 'SELECT data_json, sort_order FROM companies ORDER BY sort_order ASC;')) {
            $record = ConvertFrom-BdSqliteJsonText ([string]$row.data_json)
            if ($record) {
                [void]$backfillRows.Add((ConvertTo-BdSqliteCompanyRow -Record $record -SortOrder ([int](ConvertTo-BdSqliteNumber $row.sort_order))))
            }
        }
        if ($backfillRows.Count -gt 0) {
            $backfillTransaction = $Connection.BeginTransaction()
            try {
                Upsert-BdSqliteRows -Connection $Connection -Transaction $backfillTransaction -TableName 'companies' -Rows @($backfillRows.ToArray())
                $backfillTransaction.Commit()
            } catch {
                try { $backfillTransaction.Rollback() } catch {}
                throw
            } finally {
                $backfillTransaction.Dispose()
            }
        }
    }

    foreach ($statement in @(
            'CREATE INDEX IF NOT EXISTS idx_companies_canonical_domain ON companies(canonical_domain);',
            'CREATE INDEX IF NOT EXISTS idx_companies_enrichment_status ON companies(enrichment_status, enrichment_confidence);',
            'CREATE INDEX IF NOT EXISTS idx_companies_next_enrichment ON companies(next_enrichment_attempt_at ASC, target_score DESC);',
            'CREATE INDEX IF NOT EXISTS idx_companies_target_velocity ON companies(target_score DESC, hiring_velocity DESC, engagement_score DESC);',
            'CREATE INDEX IF NOT EXISTS idx_companies_status_target ON companies(status, target_score DESC, hiring_velocity DESC);'
        )) {
        Invoke-BdSqliteNonQuery -Connection $Connection -Sql $statement | Out-Null
    }

    $columnAdded = $false
    foreach ($columnSpec in @(
            @{ name = 'resolved_board_url'; definition = 'TEXT' },
            @{ name = 'supported_import'; definition = 'INTEGER' },
            @{ name = 'last_resolution_attempt_at'; definition = 'TEXT' },
            @{ name = 'next_resolution_attempt_at'; definition = 'TEXT' },
            @{ name = 'confidence_score'; definition = 'REAL' },
            @{ name = 'confidence_band'; definition = 'TEXT' },
            @{ name = 'evidence_summary'; definition = 'TEXT' },
            @{ name = 'review_status'; definition = 'TEXT' },
            @{ name = 'failure_reason'; definition = 'TEXT' },
            @{ name = 'redirect_target'; definition = 'TEXT' },
            @{ name = 'matched_signatures_text'; definition = 'TEXT' }
        )) {
        if (Add-BdSqliteTableColumnIfMissing -Connection $Connection -TableName 'board_configs' -ColumnName ([string]$columnSpec.name) -Definition ([string]$columnSpec.definition)) {
            $columnAdded = $true
        }
    }

    if ($columnAdded) {
        $backfillRows = New-Object System.Collections.ArrayList
        foreach ($row in @(Invoke-BdSqliteRows -Connection $Connection -Sql 'SELECT data_json, sort_order FROM board_configs ORDER BY sort_order ASC;')) {
            $record = ConvertFrom-BdSqliteJsonText ([string]$row.data_json)
            if ($record) {
                [void]$backfillRows.Add((ConvertTo-BdSqliteConfigRow -Record $record -SortOrder ([int](ConvertTo-BdSqliteNumber $row.sort_order))))
            }
        }
        if ($backfillRows.Count -gt 0) {
            $backfillTransaction = $Connection.BeginTransaction()
            try {
                Upsert-BdSqliteRows -Connection $Connection -Transaction $backfillTransaction -TableName 'board_configs' -Rows @($backfillRows.ToArray())
                $backfillTransaction.Commit()
            } catch {
                try { $backfillTransaction.Rollback() } catch {}
                throw
            } finally {
                $backfillTransaction.Dispose()
            }
        }
    }

    foreach ($statement in @(
            'CREATE INDEX IF NOT EXISTS idx_configs_confidence_review ON board_configs(confidence_band, review_status);',
            'CREATE INDEX IF NOT EXISTS idx_configs_next_attempt ON board_configs(next_resolution_attempt_at ASC);',
            'CREATE INDEX IF NOT EXISTS idx_configs_failure_reason ON board_configs(failure_reason);'
        )) {
        Invoke-BdSqliteNonQuery -Connection $Connection -Sql $statement | Out-Null
    }

    Set-BdSqliteMetaValue -Connection $Connection -Key 'schema_version' -Value '5'
}

function Test-BdSqliteHasData {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection
    )

    $workspaceJson = Get-BdSqliteMetaValue -Connection $Connection -Key 'workspace_json'
    return (-not [string]::IsNullOrWhiteSpace($workspaceJson))
}

function ConvertTo-BdSqliteCompanyRow {
    param(
        [Parameter(Mandatory = $true)]
        $Record,
        [int]$SortOrder
    )

    return [ordered]@{
        id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'id')
        sort_order = $SortOrder
        normalized_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'normalizedName')
        display_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'displayName')
        display_name_normalized = Normalize-BdSqliteText ([string](Get-BdSqliteRecordValue -Record $Record -Name 'displayName'))
        industry = [string](Get-BdSqliteRecordValue -Record $Record -Name 'industry')
        location = [string](Get-BdSqliteRecordValue -Record $Record -Name 'location')
        domain = [string](Get-BdSqliteRecordValue -Record $Record -Name 'domain')
        canonical_domain = [string](Get-BdSqliteRecordValue -Record $Record -Name 'canonicalDomain')
        careers_url = [string](Get-BdSqliteRecordValue -Record $Record -Name 'careersUrl')
        linkedin_company_slug = [string](Get-BdSqliteRecordValue -Record $Record -Name 'linkedinCompanySlug')
        aliases_text = ConvertTo-BdSqliteDelimitedList (Get-BdSqliteRecordValue -Record $Record -Name 'aliases')
        enrichment_status = [string](Get-BdSqliteRecordValue -Record $Record -Name 'enrichmentStatus')
        enrichment_source = [string](Get-BdSqliteRecordValue -Record $Record -Name 'enrichmentSource')
        enrichment_confidence = [string](Get-BdSqliteRecordValue -Record $Record -Name 'enrichmentConfidence')
        enrichment_confidence_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'enrichmentConfidenceScore'))
        enrichment_notes = [string](Get-BdSqliteRecordValue -Record $Record -Name 'enrichmentNotes')
        enrichment_evidence = [string](Get-BdSqliteRecordValue -Record $Record -Name 'enrichmentEvidence')
        enrichment_failure_reason = [string](Get-BdSqliteRecordValue -Record $Record -Name 'enrichmentFailureReason')
        enrichment_attempted_urls_text = ConvertTo-BdSqliteDelimitedList (Get-BdSqliteRecordValue -Record $Record -Name 'enrichmentAttemptedUrls')
        last_enriched_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'lastEnrichedAt')
        last_verified_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'lastVerifiedAt')
        next_enrichment_attempt_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'nextEnrichmentAttemptAt')
        owner = [string](Get-BdSqliteRecordValue -Record $Record -Name 'owner')
        owner_normalized = Normalize-BdSqliteText ([string](Get-BdSqliteRecordValue -Record $Record -Name 'owner'))
        priority = [string](Get-BdSqliteRecordValue -Record $Record -Name 'priority')
        priority_tier = [string](Get-BdSqliteRecordValue -Record $Record -Name 'priorityTier')
        status = [string](Get-BdSqliteRecordValue -Record $Record -Name 'status')
        outreach_status = [string](Get-BdSqliteRecordValue -Record $Record -Name 'outreachStatus')
        connection_count = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'connectionCount'))
        senior_contact_count = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'seniorContactCount'))
        talent_contact_count = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'talentContactCount'))
        buyer_title_count = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'buyerTitleCount'))
        target_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'targetScore'))
        target_score_explanation_json = ConvertTo-BdSqliteJsonText (Get-BdSqliteRecordValue -Record $Record -Name 'targetScoreExplanation' -Default ([ordered]@{}))
        daily_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'dailyScore'))
        follow_up_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'followUpScore'))
        job_count = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'jobCount'))
        open_role_count = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'openRoleCount'))
        jobs_last_30_days = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'jobsLast30Days'))
        jobs_last_90_days = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'jobsLast90Days'))
        new_role_count_7d = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'newRoleCount7d'))
        stale_role_count_30d = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'staleRoleCount30d'))
        avg_role_seniority_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'avgRoleSeniorityScore'))
        hiring_spike_ratio = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'hiringSpikeRatio'))
        external_recruiter_likelihood_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'externalRecruiterLikelihoodScore'))
        company_growth_signal_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'companyGrowthSignalScore'))
        company_growth_signal_summary = [string](Get-BdSqliteRecordValue -Record $Record -Name 'companyGrowthSignalSummary')
        engagement_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'engagementScore'))
        engagement_summary = [string](Get-BdSqliteRecordValue -Record $Record -Name 'engagementSummary')
        hiring_velocity = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'hiringVelocity'))
        department_focus = [string](Get-BdSqliteRecordValue -Record $Record -Name 'departmentFocus')
        department_focus_count = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'departmentFocusCount'))
        department_concentration = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'departmentConcentration'))
        hiring_spike_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'hiringSpikeScore'))
        network_strength = [string](Get-BdSqliteRecordValue -Record $Record -Name 'networkStrength')
        hiring_status = [string](Get-BdSqliteRecordValue -Record $Record -Name 'hiringStatus')
        last_job_posted_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'lastJobPostedAt')
        last_contacted_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'lastContactedAt')
        days_since_contact = if ($null -eq (Get-BdSqliteRecordValue -Record $Record -Name 'daysSinceContact')) { $null } else { [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'daysSinceContact')) }
        stale_flag = [string](Get-BdSqliteRecordValue -Record $Record -Name 'staleFlag')
        next_action = [string](Get-BdSqliteRecordValue -Record $Record -Name 'nextAction')
        next_action_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'nextActionAt')
        recommended_action = [string](Get-BdSqliteRecordValue -Record $Record -Name 'recommendedAction')
        outreach_draft = [string](Get-BdSqliteRecordValue -Record $Record -Name 'outreachDraft')
        top_contact_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'topContactName')
        top_contact_title = [string](Get-BdSqliteRecordValue -Record $Record -Name 'topContactTitle')
        ats_types_text = ConvertTo-BdSqliteDelimitedList (Get-BdSqliteRecordValue -Record $Record -Name 'atsTypes')
        tags_text = ConvertTo-BdSqliteDelimitedList (Get-BdSqliteRecordValue -Record $Record -Name 'tags')
        notes = [string](Get-BdSqliteRecordValue -Record $Record -Name 'notes')
        search_text = Get-BdSqliteSearchText @(
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'displayName'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'domain'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'canonicalDomain'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'owner'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'notes'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'enrichmentEvidence'),
            ([string]::Join(' ', @(Get-BdSqliteStringList (Get-BdSqliteRecordValue -Record $Record -Name 'tags')))),
            ([string]::Join(' ', @(Get-BdSqliteStringList (Get-BdSqliteRecordValue -Record $Record -Name 'aliases'))))
        )
        data_json = ConvertTo-BdSqliteJsonText $Record
    }
}

function ConvertTo-BdSqliteContactRow {
    param(
        [Parameter(Mandatory = $true)]
        $Record,
        [int]$SortOrder
    )

    return [ordered]@{
        id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'id')
        sort_order = $SortOrder
        account_id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'accountId')
        normalized_company_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'normalizedCompanyName')
        company_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'companyName')
        full_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'fullName')
        title = [string](Get-BdSqliteRecordValue -Record $Record -Name 'title')
        email = [string](Get-BdSqliteRecordValue -Record $Record -Name 'email')
        linkedin_url = [string](Get-BdSqliteRecordValue -Record $Record -Name 'linkedinUrl')
        connected_on = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'connectedOn')
        priority_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'priorityScore'))
        company_overlap_count = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'companyOverlapCount'))
        outreach_status = [string](Get-BdSqliteRecordValue -Record $Record -Name 'outreachStatus')
        notes = [string](Get-BdSqliteRecordValue -Record $Record -Name 'notes')
        search_text = Get-BdSqliteSearchText @(
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'fullName'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'companyName'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'title'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'email')
        )
        data_json = ConvertTo-BdSqliteJsonText $Record
    }
}

function ConvertTo-BdSqliteJobRow {
    param(
        [Parameter(Mandatory = $true)]
        $Record,
        [int]$SortOrder
    )

    return [ordered]@{
        id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'id')
        sort_order = $SortOrder
        account_id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'accountId')
        normalized_company_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'normalizedCompanyName')
        company_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'companyName')
        title = [string](Get-BdSqliteRecordValue -Record $Record -Name 'title')
        normalized_title = [string](Get-BdSqliteRecordValue -Record $Record -Name 'normalizedTitle')
        department = [string](Get-BdSqliteRecordValue -Record $Record -Name 'department')
        location = [string](Get-BdSqliteRecordValue -Record $Record -Name 'location')
        employment_type = [string](Get-BdSqliteRecordValue -Record $Record -Name 'employmentType')
        job_id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'jobId')
        url = [string](Get-BdSqliteRecordValue -Record $Record -Name 'url')
        job_url = [string](Get-BdSqliteRecordValue -Record $Record -Name 'jobUrl')
        source_url = [string](Get-BdSqliteRecordValue -Record $Record -Name 'sourceUrl')
        ats_type = [string](Get-BdSqliteRecordValue -Record $Record -Name 'atsType')
        posted_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'postedAt')
        retrieved_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'retrievedAt')
        imported_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'importedAt')
        last_seen_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'lastSeenAt')
        dedupe_key = [string](Get-BdSqliteRecordValue -Record $Record -Name 'dedupeKey')
        active = ConvertTo-BdSqliteBoolInt (Get-BdSqliteRecordValue -Record $Record -Name 'active')
        is_new = ConvertTo-BdSqliteBoolInt (Get-BdSqliteRecordValue -Record $Record -Name 'isNew')
        is_gta = ConvertTo-BdSqliteBoolInt (Get-BdSqliteRecordValue -Record $Record -Name 'isGta')
        search_text = Get-BdSqliteSearchText @(
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'title'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'companyName'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'location')
        )
        data_json = ConvertTo-BdSqliteJsonText $Record
    }
}

function ConvertTo-BdSqliteConfigRow {
    param(
        [Parameter(Mandatory = $true)]
        $Record,
        [int]$SortOrder
    )

    return [ordered]@{
        id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'id')
        sort_order = $SortOrder
        account_id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'accountId')
        normalized_company_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'normalizedCompanyName')
        company_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'companyName')
        ats_type = [string](Get-BdSqliteRecordValue -Record $Record -Name 'atsType')
        board_id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'boardId')
        domain = [string](Get-BdSqliteRecordValue -Record $Record -Name 'domain')
        careers_url = [string](Get-BdSqliteRecordValue -Record $Record -Name 'careersUrl')
        resolved_board_url = [string](Get-BdSqliteRecordValue -Record $Record -Name 'resolvedBoardUrl')
        source = [string](Get-BdSqliteRecordValue -Record $Record -Name 'source')
        notes = [string](Get-BdSqliteRecordValue -Record $Record -Name 'notes')
        active = ConvertTo-BdSqliteBoolInt (Get-BdSqliteRecordValue -Record $Record -Name 'active')
        supported_import = ConvertTo-BdSqliteBoolInt (Get-BdSqliteRecordValue -Record $Record -Name 'supportedImport')
        last_checked_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'lastCheckedAt')
        last_resolution_attempt_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'lastResolutionAttemptAt')
        next_resolution_attempt_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'nextResolutionAttemptAt')
        discovery_status = [string](Get-BdSqliteRecordValue -Record $Record -Name 'discoveryStatus')
        discovery_method = [string](Get-BdSqliteRecordValue -Record $Record -Name 'discoveryMethod')
        confidence_score = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $Record -Name 'confidenceScore'))
        confidence_band = [string](Get-BdSqliteRecordValue -Record $Record -Name 'confidenceBand')
        evidence_summary = [string](Get-BdSqliteRecordValue -Record $Record -Name 'evidenceSummary')
        review_status = [string](Get-BdSqliteRecordValue -Record $Record -Name 'reviewStatus')
        failure_reason = [string](Get-BdSqliteRecordValue -Record $Record -Name 'failureReason')
        redirect_target = [string](Get-BdSqliteRecordValue -Record $Record -Name 'redirectTarget')
        matched_signatures_text = ConvertTo-BdSqliteDelimitedList (Get-BdSqliteRecordValue -Record $Record -Name 'matchedSignatures')
        last_import_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'lastImportAt')
        last_import_status = [string](Get-BdSqliteRecordValue -Record $Record -Name 'lastImportStatus')
        search_text = Get-BdSqliteSearchText @(
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'companyName'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'boardId'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'careersUrl'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'domain'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'evidenceSummary'),
            [string](Get-BdSqliteRecordValue -Record $Record -Name 'failureReason')
        )
        data_json = ConvertTo-BdSqliteJsonText $Record
    }
}

function ConvertTo-BdSqliteActivityRow {
    param(
        [Parameter(Mandatory = $true)]
        $Record,
        [int]$SortOrder
    )

    return [ordered]@{
        id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'id')
        sort_order = $SortOrder
        account_id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'accountId')
        normalized_company_name = [string](Get-BdSqliteRecordValue -Record $Record -Name 'normalizedCompanyName')
        summary = [string](Get-BdSqliteRecordValue -Record $Record -Name 'summary')
        type = [string](Get-BdSqliteRecordValue -Record $Record -Name 'type')
        notes = [string](Get-BdSqliteRecordValue -Record $Record -Name 'notes')
        occurred_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'occurredAt')
        pipeline_stage = [string](Get-BdSqliteRecordValue -Record $Record -Name 'pipelineStage')
        data_json = ConvertTo-BdSqliteJsonText $Record
    }
}

function ConvertTo-BdSqliteImportRunRow {
    param(
        [Parameter(Mandatory = $true)]
        $Record,
        [int]$SortOrder
    )

    return [ordered]@{
        id = [string](Get-BdSqliteRecordValue -Record $Record -Name 'id')
        sort_order = $SortOrder
        run_type = [string](Get-BdSqliteRecordValue -Record $Record -Name 'type')
        status = [string](Get-BdSqliteRecordValue -Record $Record -Name 'status')
        started_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'startedAt')
        completed_at = ConvertTo-BdSqliteNullIfBlank (Get-BdSqliteRecordValue -Record $Record -Name 'completedAt')
        data_json = ConvertTo-BdSqliteJsonText $Record
    }
}

function Write-BdSqliteRows {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteTransaction]$Transaction,
        [Parameter(Mandatory = $true)]
        [string]$TableName,
        [object[]]$Rows
    )

    Invoke-BdSqliteNonQuery -Connection $Connection -Transaction $Transaction -Sql ("DELETE FROM [{0}];" -f $TableName) | Out-Null

    if (-not $Rows -or $Rows.Count -eq 0) {
        return
    }

    $columns = @($Rows[0].Keys)
    $columnSql = [string]::Join(', ', @($columns | ForEach-Object { "[{0}]" -f $_ }))
    $valueSql = [string]::Join(', ', @($columns | ForEach-Object { "@{0}" -f $_ }))
    $insertSql = "INSERT OR REPLACE INTO [{0}] ({1}) VALUES ({2});" -f $TableName, $columnSql, $valueSql

    $command = $Connection.CreateCommand()
    $command.Transaction = $Transaction
    $command.CommandText = $insertSql

    foreach ($column in $columns) {
        $parameter = $command.CreateParameter()
        $parameter.ParameterName = "@$column"
        [void]$command.Parameters.Add($parameter)
    }

    try {
        foreach ($row in @($Rows)) {
            foreach ($column in $columns) {
                $value = $row[$column]
                $command.Parameters["@$column"].Value = if ($null -eq $value) { [DBNull]::Value } else { $value }
            }
            [void]$command.ExecuteNonQuery()
        }
    } finally {
        $command.Dispose()
    }
}

function Upsert-BdSqliteRows {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteTransaction]$Transaction,
        [Parameter(Mandatory = $true)]
        [string]$TableName,
        [object[]]$Rows
    )

    if (-not $Rows -or $Rows.Count -eq 0) {
        return
    }

    $columns = @($Rows[0].Keys)
    $columnSql = [string]::Join(', ', @($columns | ForEach-Object { "[{0}]" -f $_ }))
    $valueSql = [string]::Join(', ', @($columns | ForEach-Object { "@{0}" -f $_ }))
    $insertSql = "INSERT OR REPLACE INTO [{0}] ({1}) VALUES ({2});" -f $TableName, $columnSql, $valueSql

    $command = $Connection.CreateCommand()
    $command.Transaction = $Transaction
    $command.CommandText = $insertSql

    foreach ($column in $columns) {
        $parameter = $command.CreateParameter()
        $parameter.ParameterName = "@$column"
        [void]$command.Parameters.Add($parameter)
    }

    try {
        foreach ($row in @($Rows)) {
            foreach ($column in $columns) {
                $value = $row[$column]
                $command.Parameters["@$column"].Value = if ($null -eq $value) { [DBNull]::Value } else { $value }
            }
            [void]$command.ExecuteNonQuery()
        }
    } finally {
        $command.Dispose()
    }
}

function Remove-BdSqliteRowsByIds {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteTransaction]$Transaction,
        [Parameter(Mandatory = $true)]
        [string]$TableName,
        [string[]]$Ids
    )

    $items = @($Ids | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($items.Count -eq 0) {
        return
    }

    foreach ($batch in @(
            for ($offset = 0; $offset -lt $items.Count; $offset += 500) {
                ,$items[$offset..([Math]::Min($offset + 499, $items.Count - 1))]
            }
        )) {
        $parameters = @{}
        $placeholders = New-Object System.Collections.ArrayList
        for ($index = 0; $index -lt @($batch).Count; $index++) {
            $name = "id$index"
            $parameters[$name] = [string]$batch[$index]
            [void]$placeholders.Add("@$name")
        }

        $sql = "DELETE FROM [{0}] WHERE id IN ({1});" -f $TableName, ([string]::Join(', ', @($placeholders)))
        Invoke-BdSqliteNonQuery -Connection $Connection -Transaction $Transaction -Sql $sql -Parameters $parameters | Out-Null
    }
}

function ConvertTo-BdSqliteSegmentRows {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment,
        [Parameter(Mandatory = $true)]
        $Data
    )

    switch ($Segment) {
        'Companies' {
            return @(
                for ($index = 0; $index -lt @($Data).Count; $index++) {
                    ConvertTo-BdSqliteCompanyRow -Record $Data[$index] -SortOrder $index
                }
            )
        }
        'Contacts' {
            return @(
                for ($index = 0; $index -lt @($Data).Count; $index++) {
                    ConvertTo-BdSqliteContactRow -Record $Data[$index] -SortOrder $index
                }
            )
        }
        'Jobs' {
            return @(
                for ($index = 0; $index -lt @($Data).Count; $index++) {
                    ConvertTo-BdSqliteJobRow -Record $Data[$index] -SortOrder $index
                }
            )
        }
        'BoardConfigs' {
            return @(
                for ($index = 0; $index -lt @($Data).Count; $index++) {
                    ConvertTo-BdSqliteConfigRow -Record $Data[$index] -SortOrder $index
                }
            )
        }
        'Activities' {
            return @(
                for ($index = 0; $index -lt @($Data).Count; $index++) {
                    ConvertTo-BdSqliteActivityRow -Record $Data[$index] -SortOrder $index
                }
            )
        }
        'ImportRuns' {
            return @(
                for ($index = 0; $index -lt @($Data).Count; $index++) {
                    ConvertTo-BdSqliteImportRunRow -Record $Data[$index] -SortOrder $index
                }
            )
        }
    }
}

function Get-BdSqliteTableNameForSegment {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment
    )

    switch ($Segment) {
        'Companies' { return 'companies' }
        'Contacts' { return 'contacts' }
        'Jobs' { return 'jobs' }
        'BoardConfigs' { return 'board_configs' }
        'Activities' { return 'activities' }
        'ImportRuns' { return 'import_runs' }
    }
}

function Sync-BdSqliteSegmentRows {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteTransaction]$Transaction,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment,
        [Parameter(Mandatory = $true)]
        $Data
    )

    $tableName = Get-BdSqliteTableNameForSegment -Segment $Segment
    $rows = @(ConvertTo-BdSqliteSegmentRows -Segment $Segment -Data $Data)

    $loadStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $existingRows = @(Invoke-BdSqliteRows -Connection $Connection -Transaction $Transaction -Sql ("SELECT id, data_json FROM [{0}];" -f $tableName))
    $loadStopwatch.Stop()

    $existingById = @{}
    foreach ($existing in @($existingRows)) {
        $existingById[[string]$existing.id] = [string]$existing.data_json
    }

    $diffStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $incomingIds = New-Object 'System.Collections.Generic.HashSet[string]'
    $changedRows = New-Object System.Collections.ArrayList
    $unchangedCount = 0
    foreach ($row in @($rows)) {
        $rowId = [string]$row.id
        if (-not $rowId) {
            continue
        }
        [void]$incomingIds.Add($rowId)
        if ($existingById.ContainsKey($rowId) -and $existingById[$rowId] -eq [string]$row.data_json) {
            $unchangedCount += 1
            continue
        }
        [void]$changedRows.Add($row)
    }

    $deletedIds = New-Object System.Collections.ArrayList
    foreach ($existingId in @($existingById.Keys)) {
        if (-not $incomingIds.Contains([string]$existingId)) {
            [void]$deletedIds.Add([string]$existingId)
        }
    }

    $diffStopwatch.Stop()

    $writeStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    Upsert-BdSqliteRows -Connection $Connection -Transaction $Transaction -TableName $tableName -Rows @($changedRows.ToArray())
    Remove-BdSqliteRowsByIds -Connection $Connection -Transaction $Transaction -TableName $tableName -Ids @($deletedIds.ToArray())
    $writeStopwatch.Stop()

    return [ordered]@{
        segment = $Segment
        table = $tableName
        mode = 'upsert'
        total = @($rows).Count
        upserted = @($changedRows).Count
        unchanged = $unchangedCount
        deleted = @($deletedIds).Count
        timings = [ordered]@{
            loadMs = [int]$loadStopwatch.ElapsedMilliseconds
            diffMs = [int]$diffStopwatch.ElapsedMilliseconds
            writeMs = [int]$writeStopwatch.ElapsedMilliseconds
        }
    }
}

function Sync-BdSqliteSegmentRowsPartial {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteTransaction]$Transaction,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment,
        [Parameter(Mandatory = $true)]
        $Data
    )

    $tableName = Get-BdSqliteTableNameForSegment -Segment $Segment
    $rows = @(ConvertTo-BdSqliteSegmentRows -Segment $Segment -Data $Data)
    if (@($rows).Count -eq 0) {
        return [ordered]@{
            segment = $Segment
            table = $tableName
            mode = 'partial_upsert'
            total = 0
            upserted = 0
            unchanged = 0
            deleted = 0
            timings = [ordered]@{
                loadMs = 0
                diffMs = 0
                writeMs = 0
            }
        }
    }

    $rowIds = @($rows | ForEach-Object { [string]$_.id } | Where-Object { $_ } | Select-Object -Unique)
    $idClause = New-BdSqliteInClauseParts -Prefix 'rowId' -Values $rowIds

    $loadStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $existingRows = @()
    if ($idClause.count -gt 0) {
        $existingRows = @(Invoke-BdSqliteRows -Connection $Connection -Transaction $Transaction -Sql ("SELECT id, data_json FROM [{0}] WHERE id IN ({1});" -f $tableName, $idClause.clause) -Parameters $idClause.parameters)
    }
    $loadStopwatch.Stop()

    $existingById = @{}
    foreach ($existing in @($existingRows)) {
        $existingById[[string]$existing.id] = [string]$existing.data_json
    }

    $diffStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $changedRows = New-Object System.Collections.ArrayList
    $unchangedCount = 0
    foreach ($row in @($rows)) {
        $rowId = [string]$row.id
        if (-not $rowId) {
            continue
        }
        if ($existingById.ContainsKey($rowId) -and $existingById[$rowId] -eq [string]$row.data_json) {
            $unchangedCount += 1
            continue
        }
        [void]$changedRows.Add($row)
    }
    $diffStopwatch.Stop()

    $writeStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    Upsert-BdSqliteRows -Connection $Connection -Transaction $Transaction -TableName $tableName -Rows @($changedRows.ToArray())
    $writeStopwatch.Stop()

    return [ordered]@{
        segment = $Segment
        table = $tableName
        mode = 'partial_upsert'
        total = @($rows).Count
        upserted = @($changedRows).Count
        unchanged = $unchangedCount
        deleted = 0
        timings = [ordered]@{
            loadMs = [int]$loadStopwatch.ElapsedMilliseconds
            diffMs = [int]$diffStopwatch.ElapsedMilliseconds
            writeMs = [int]$writeStopwatch.ElapsedMilliseconds
        }
    }
}

function Sync-BdSqliteStateSegments {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string[]]$Segments,
        [switch]$SkipSnapshots
    )

    $uniqueSegments = @($Segments | Select-Object -Unique)
    if ($uniqueSegments.Count -eq 0) {
        return [ordered]@{
            ok = $true
            mode = 'targeted_upsert'
            dataRevision = ''
            segments = @()
            snapshot = $null
            updatedAt = (Get-Date).ToString('o')
        }
    }

    $connection = Open-BdSqliteConnection
    $transaction = $connection.BeginTransaction()
    $refreshSnapshots = @($uniqueSegments | Where-Object { Test-BdSqliteSnapshotSegment -Segment $_ }).Count -gt 0
    $dataRevision = if ($refreshSnapshots) { New-BdSqliteDataRevision } else { $null }
    $segmentResults = New-Object System.Collections.ArrayList

    try {
        Initialize-BdSqliteSchema -Connection $connection

        foreach ($segment in @($uniqueSegments)) {
            $segmentStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            $segmentResult = $null

            switch ($segment) {
                'Workspace' {
                    Set-BdSqliteMetaValue -Connection $connection -Transaction $transaction -Key 'workspace_json' -Value (ConvertTo-BdSqliteJsonText $State.workspace)
                    $segmentResult = [ordered]@{
                        segment = 'Workspace'
                        table = 'meta'
                        mode = 'meta'
                        total = 1
                        upserted = 1
                        unchanged = 0
                        deleted = 0
                        timings = [ordered]@{
                            loadMs = 0
                            diffMs = 0
                            writeMs = 0
                        }
                    }
                }
                'Settings' {
                    Set-BdSqliteMetaValue -Connection $connection -Transaction $transaction -Key 'settings_json' -Value (ConvertTo-BdSqliteJsonText $State.settings)
                    $segmentResult = [ordered]@{
                        segment = 'Settings'
                        table = 'meta'
                        mode = 'meta'
                        total = 1
                        upserted = 1
                        unchanged = 0
                        deleted = 0
                        timings = [ordered]@{
                            loadMs = 0
                            diffMs = 0
                            writeMs = 0
                        }
                    }
                }
                'Companies' {
                    $segmentResult = Sync-BdSqliteSegmentRows -Connection $connection -Transaction $transaction -Segment 'Companies' -Data $State.companies
                }
                'Contacts' {
                    $segmentResult = Sync-BdSqliteSegmentRows -Connection $connection -Transaction $transaction -Segment 'Contacts' -Data $State.contacts
                }
                'Jobs' {
                    $segmentResult = Sync-BdSqliteSegmentRows -Connection $connection -Transaction $transaction -Segment 'Jobs' -Data $State.jobs
                }
                'BoardConfigs' {
                    $segmentResult = Sync-BdSqliteSegmentRows -Connection $connection -Transaction $transaction -Segment 'BoardConfigs' -Data $State.boardConfigs
                }
                'Activities' {
                    $segmentResult = Sync-BdSqliteSegmentRows -Connection $connection -Transaction $transaction -Segment 'Activities' -Data $State.activities
                }
                'ImportRuns' {
                    $segmentResult = Sync-BdSqliteSegmentRows -Connection $connection -Transaction $transaction -Segment 'ImportRuns' -Data $State.importRuns
                }
            }

            $segmentStopwatch.Stop()
            if ($segmentResult) {
                $segmentResult.durationMs = [int]$segmentStopwatch.ElapsedMilliseconds
                [void]$segmentResults.Add($segmentResult)
            }
        }

        Set-BdSqliteMetaValue -Connection $connection -Transaction $transaction -Key 'updated_at' -Value ((Get-Date).ToString('o'))
        if ($refreshSnapshots) {
            Set-BdSqliteMetaValue -Connection $connection -Transaction $transaction -Key 'data_revision' -Value $dataRevision
        }
        if ($uniqueSegments -contains 'Workspace' -or $uniqueSegments -contains 'Settings') {
            Set-BdSqliteMetaValue -Connection $connection -Transaction $transaction -Key 'migrated_at' -Value ((Get-Date).ToString('o'))
        }

        $transaction.Commit()
    } catch {
        try { $transaction.Rollback() } catch {}
        throw
    } finally {
        $transaction.Dispose()
        $connection.Dispose()
    }

    $snapshotResult = $null
    if ($refreshSnapshots -and -not $SkipSnapshots) {
        $snapshotStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $snapshotResult = Update-BdSqliteSnapshots -DataRevision $dataRevision
        } finally {
            $snapshotStopwatch.Stop()
        }

        if ($snapshotResult) {
            $snapshotResult.durationMs = [int]$snapshotStopwatch.ElapsedMilliseconds
        }
    }

    $coverageResult = $null
    if ($uniqueSegments -contains 'BoardConfigs') {
        $coverageResult = [ordered]@{}
        $coverageConnection = Open-BdSqliteConnection
        try {
            Initialize-BdSqliteSchema -Connection $coverageConnection
            $resolverCoverageStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                Write-BdSqliteResolverCoverageHistory -Connection $coverageConnection -DataRevision $dataRevision
            } finally {
                $resolverCoverageStopwatch.Stop()
            }
            $enrichmentCoverageStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                Write-BdSqliteEnrichmentCoverageHistory -Connection $coverageConnection -DataRevision $dataRevision
            } finally {
                $enrichmentCoverageStopwatch.Stop()
            }
            $coverageResult.resolverCoverageMs = [int]$resolverCoverageStopwatch.ElapsedMilliseconds
            $coverageResult.enrichmentCoverageMs = [int]$enrichmentCoverageStopwatch.ElapsedMilliseconds
        } finally {
            $coverageConnection.Dispose()
        }
    } elseif ($uniqueSegments -contains 'Companies') {
        $coverageResult = [ordered]@{}
        $coverageConnection = Open-BdSqliteConnection
        try {
            Initialize-BdSqliteSchema -Connection $coverageConnection
            $enrichmentCoverageStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                Write-BdSqliteEnrichmentCoverageHistory -Connection $coverageConnection -DataRevision $dataRevision
            } finally {
                $enrichmentCoverageStopwatch.Stop()
            }
            $coverageResult.enrichmentCoverageMs = [int]$enrichmentCoverageStopwatch.ElapsedMilliseconds
        } finally {
            $coverageConnection.Dispose()
        }
    }

    return [ordered]@{
        ok = $true
        mode = 'targeted_upsert'
        dataRevision = if ($refreshSnapshots) { $dataRevision } else { '' }
        segments = @($segmentResults.ToArray())
        snapshot = $snapshotResult
        coverage = $coverageResult
        updatedAt = (Get-Date).ToString('o')
    }
}

function Sync-BdSqliteStateSegmentsPartial {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string[]]$Segments,
        [switch]$SkipSnapshots
    )

    $uniqueSegments = @($Segments | Select-Object -Unique)
    if ($uniqueSegments.Count -eq 0) {
        return [ordered]@{
            ok = $true
            mode = 'partial_upsert'
            dataRevision = ''
            segments = @()
            snapshot = $null
            updatedAt = (Get-Date).ToString('o')
        }
    }

    $connection = Open-BdSqliteConnection
    $transaction = $connection.BeginTransaction()
    $refreshSnapshots = @($uniqueSegments | Where-Object { Test-BdSqliteSnapshotSegment -Segment $_ }).Count -gt 0
    $dataRevision = if ($refreshSnapshots) { New-BdSqliteDataRevision } else { $null }
    $segmentResults = New-Object System.Collections.ArrayList

    try {
        Initialize-BdSqliteSchema -Connection $connection

        foreach ($segment in @($uniqueSegments)) {
            $segmentStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            $segmentResult = $null
            switch ($segment) {
                'Companies' { $segmentResult = Sync-BdSqliteSegmentRowsPartial -Connection $connection -Transaction $transaction -Segment 'Companies' -Data $State.companies }
                'Contacts' { $segmentResult = Sync-BdSqliteSegmentRowsPartial -Connection $connection -Transaction $transaction -Segment 'Contacts' -Data $State.contacts }
                'Jobs' { $segmentResult = Sync-BdSqliteSegmentRowsPartial -Connection $connection -Transaction $transaction -Segment 'Jobs' -Data $State.jobs }
                'BoardConfigs' { $segmentResult = Sync-BdSqliteSegmentRowsPartial -Connection $connection -Transaction $transaction -Segment 'BoardConfigs' -Data $State.boardConfigs }
                'Activities' { $segmentResult = Sync-BdSqliteSegmentRowsPartial -Connection $connection -Transaction $transaction -Segment 'Activities' -Data $State.activities }
                'ImportRuns' { $segmentResult = Sync-BdSqliteSegmentRowsPartial -Connection $connection -Transaction $transaction -Segment 'ImportRuns' -Data $State.importRuns }
            }

            $segmentStopwatch.Stop()
            if ($segmentResult) {
                $segmentResult.durationMs = [int]$segmentStopwatch.ElapsedMilliseconds
                [void]$segmentResults.Add($segmentResult)
            }
        }

        Set-BdSqliteMetaValue -Connection $connection -Transaction $transaction -Key 'updated_at' -Value ((Get-Date).ToString('o'))
        if ($refreshSnapshots) {
            Set-BdSqliteMetaValue -Connection $connection -Transaction $transaction -Key 'data_revision' -Value $dataRevision
        }

        $transaction.Commit()
    } catch {
        try { $transaction.Rollback() } catch {}
        throw
    } finally {
        $transaction.Dispose()
        $connection.Dispose()
    }

    $snapshotResult = $null
    if ($refreshSnapshots -and -not $SkipSnapshots) {
        $snapshotStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $snapshotResult = Update-BdSqliteSnapshots -DataRevision $dataRevision
        } finally {
            $snapshotStopwatch.Stop()
        }

        if ($snapshotResult) {
            $snapshotResult.durationMs = [int]$snapshotStopwatch.ElapsedMilliseconds
        }
    }

    $coverageResult = $null
    if ($uniqueSegments -contains 'BoardConfigs') {
        $coverageResult = [ordered]@{}
        $coverageConnection = Open-BdSqliteConnection
        try {
            Initialize-BdSqliteSchema -Connection $coverageConnection
            $resolverCoverageStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                Write-BdSqliteResolverCoverageHistory -Connection $coverageConnection -DataRevision $dataRevision
            } finally {
                $resolverCoverageStopwatch.Stop()
            }
            $enrichmentCoverageStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                Write-BdSqliteEnrichmentCoverageHistory -Connection $coverageConnection -DataRevision $dataRevision
            } finally {
                $enrichmentCoverageStopwatch.Stop()
            }
            $coverageResult.resolverCoverageMs = [int]$resolverCoverageStopwatch.ElapsedMilliseconds
            $coverageResult.enrichmentCoverageMs = [int]$enrichmentCoverageStopwatch.ElapsedMilliseconds
        } finally {
            $coverageConnection.Dispose()
        }
    } elseif ($uniqueSegments -contains 'Companies') {
        $coverageResult = [ordered]@{}
        $coverageConnection = Open-BdSqliteConnection
        try {
            Initialize-BdSqliteSchema -Connection $coverageConnection
            $enrichmentCoverageStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                Write-BdSqliteEnrichmentCoverageHistory -Connection $coverageConnection -DataRevision $dataRevision
            } finally {
                $enrichmentCoverageStopwatch.Stop()
            }
            $coverageResult.enrichmentCoverageMs = [int]$enrichmentCoverageStopwatch.ElapsedMilliseconds
        } finally {
            $coverageConnection.Dispose()
        }
    }

    return [ordered]@{
        ok = $true
        mode = 'partial_upsert'
        dataRevision = if ($refreshSnapshots) { $dataRevision } else { '' }
        segments = @($segmentResults.ToArray())
        snapshot = $snapshotResult
        coverage = $coverageResult
        updatedAt = (Get-Date).ToString('o')
    }
}

function Initialize-BdSqliteStore {
    param($State)

    if (-not (Test-BdSqliteStoreEnabled)) {
        return
    }

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        if (Test-BdSqliteHasData -Connection $connection) {
            [void](Get-BdSqliteDataRevision -Connection $connection)
        }
        if ($State -and -not (Test-BdSqliteHasData -Connection $connection)) {
            Save-BdSqliteState -State $State
        }
    } finally {
        $connection.Dispose()
    }
}

function Sync-BdSqliteState {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [switch]$SkipSnapshots
    )

    return (Sync-BdSqliteStateSegments -State $State -Segments @(
            'Workspace',
            'Settings',
            'Companies',
            'Contacts',
            'Jobs',
            'BoardConfigs',
            'Activities',
            'ImportRuns'
        ) -SkipSnapshots:$SkipSnapshots)
}

function Save-BdSqliteState {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [switch]$SkipSnapshots
    )

    Sync-BdSqliteState -State $State -SkipSnapshots:$SkipSnapshots | Out-Null
}

function Sync-BdSqliteSegment {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment,
        [Parameter(Mandatory = $true)]
        $Data,
        [switch]$SkipSnapshots
    )

    $state = [ordered]@{
        workspace = $null
        settings = $null
        companies = @()
        contacts = @()
        jobs = @()
        boardConfigs = @()
        activities = @()
        importRuns = @()
    }

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

    return (Sync-BdSqliteStateSegments -State $state -Segments @($Segment) -SkipSnapshots:$SkipSnapshots)
}

function Save-BdSqliteSegment {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment,
        [Parameter(Mandatory = $true)]
        $Data,
        [switch]$SkipSnapshots
    )

    Sync-BdSqliteSegment -Segment $Segment -Data $Data -SkipSnapshots:$SkipSnapshots | Out-Null
}

function Get-BdSqliteStoreSignature {
    $dbPath = Get-BdSqliteDatabasePath
    if (-not (Test-Path -LiteralPath $dbPath)) {
        return "$dbPath:missing"
    }

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        $revision = Get-BdSqliteDataRevision -Connection $connection
        return '{0}:{1}' -f $dbPath, $revision
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteSegment {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Workspace', 'Settings', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment
    )

    $connection = Open-BdSqliteConnection
    try {
        switch ($Segment) {
            'Workspace' {
                return (ConvertFrom-BdSqliteJsonText (Get-BdSqliteMetaValue -Connection $connection -Key 'workspace_json'))
            }
            'Settings' {
                return (ConvertFrom-BdSqliteJsonText (Get-BdSqliteMetaValue -Connection $connection -Key 'settings_json'))
            }
            'Companies' {
                return @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT data_json FROM companies ORDER BY sort_order ASC;') | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
            }
            'Contacts' {
                return @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT data_json FROM contacts ORDER BY sort_order ASC;') | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
            }
            'Jobs' {
                return @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT data_json FROM jobs ORDER BY sort_order ASC;') | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
            }
            'BoardConfigs' {
                return @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT data_json FROM board_configs ORDER BY sort_order ASC;') | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
            }
            'Activities' {
                return @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT data_json FROM activities ORDER BY sort_order ASC;') | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
            }
            'ImportRuns' {
                return @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT data_json FROM import_runs ORDER BY sort_order ASC;') | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
            }
        }
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteScopedStateForAccountIds {
    param([string[]]$AccountIds)

    $connection = Open-BdSqliteConnection
    try {
        $workspace = ConvertFrom-BdSqliteJsonText (Get-BdSqliteMetaValue -Connection $connection -Key 'workspace_json')
        $settings = ConvertFrom-BdSqliteJsonText (Get-BdSqliteMetaValue -Connection $connection -Key 'settings_json')
        $accountClause = New-BdSqliteInClauseParts -Prefix 'accountId' -Values $AccountIds
        if ($accountClause.count -eq 0) {
            return [ordered]@{
                workspace = $workspace
                settings = $settings
                companies = @()
                contacts = @()
                jobs = @()
                boardConfigs = @()
                activities = @()
                importRuns = @()
            }
        }

        $companyRows = @(
            Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json, normalized_name FROM companies WHERE id IN ({0}) ORDER BY sort_order ASC;" -f $accountClause.clause) -Parameters $accountClause.parameters
        )
        $companies = @($companyRows | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
        $normalizedNames = @($companyRows | ForEach-Object { [string]$_.normalized_name } | Where-Object { $_ } | Select-Object -Unique)
        $nameClause = New-BdSqliteInClauseParts -Prefix 'normalizedName' -Values $normalizedNames

        $sharedParams = @{}
        foreach ($key in @($accountClause.parameters.Keys)) { $sharedParams[$key] = $accountClause.parameters[$key] }
        foreach ($key in @($nameClause.parameters.Keys)) { $sharedParams[$key] = $nameClause.parameters[$key] }

        $whereParts = @("account_id IN ($($accountClause.clause))")
        if ($nameClause.count -gt 0) {
            $whereParts += "normalized_company_name IN ($($nameClause.clause))"
        }
        $sharedWhere = [string]::Join(' OR ', $whereParts)

        $contacts = @((Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json FROM contacts WHERE {0} ORDER BY sort_order ASC;" -f $sharedWhere) -Parameters $sharedParams) | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
        $jobs = @((Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json FROM jobs WHERE {0} ORDER BY sort_order ASC;" -f $sharedWhere) -Parameters $sharedParams) | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
        $boardConfigs = @((Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json FROM board_configs WHERE {0} ORDER BY sort_order ASC;" -f $sharedWhere) -Parameters $sharedParams) | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })

        return [ordered]@{
            workspace = $workspace
            settings = $settings
            companies = $companies
            contacts = $contacts
            jobs = $jobs
            boardConfigs = $boardConfigs
            activities = @()
            importRuns = @()
        }
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteScopedStateForConfigIds {
    param([string[]]$ConfigIds)

    $connection = Open-BdSqliteConnection
    try {
        $workspace = ConvertFrom-BdSqliteJsonText (Get-BdSqliteMetaValue -Connection $connection -Key 'workspace_json')
        $settings = ConvertFrom-BdSqliteJsonText (Get-BdSqliteMetaValue -Connection $connection -Key 'settings_json')
        $configClause = New-BdSqliteInClauseParts -Prefix 'configId' -Values $ConfigIds
        if ($configClause.count -eq 0) {
            return [ordered]@{
                workspace = $workspace
                settings = $settings
                companies = @()
                contacts = @()
                jobs = @()
                boardConfigs = @()
                activities = @()
                importRuns = @()
            }
        }

        $configRows = @(
            Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json, account_id, normalized_company_name FROM board_configs WHERE id IN ({0}) ORDER BY sort_order ASC;" -f $configClause.clause) -Parameters $configClause.parameters
        )
        $boardConfigs = @($configRows | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
        $accountIds = @($configRows | ForEach-Object { [string]$_.account_id } | Where-Object { $_ } | Select-Object -Unique)
        $normalizedNames = @($configRows | ForEach-Object { [string]$_.normalized_company_name } | Where-Object { $_ } | Select-Object -Unique)
        $accountClause = New-BdSqliteInClauseParts -Prefix 'companyId' -Values $accountIds
        $nameClause = New-BdSqliteInClauseParts -Prefix 'companyName' -Values $normalizedNames

        $companyParams = @{}
        foreach ($key in @($accountClause.parameters.Keys)) { $companyParams[$key] = $accountClause.parameters[$key] }
        foreach ($key in @($nameClause.parameters.Keys)) { $companyParams[$key] = $nameClause.parameters[$key] }

        $companyWhere = @()
        if ($accountClause.count -gt 0) {
            $companyWhere += "id IN ($($accountClause.clause))"
        }
        if ($nameClause.count -gt 0) {
            $companyWhere += "normalized_name IN ($($nameClause.clause))"
        }

        $companies = @()
        if ($companyWhere.Count -gt 0) {
            $companies = @((Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json FROM companies WHERE {0} ORDER BY sort_order ASC;" -f [string]::Join(' OR ', $companyWhere)) -Parameters $companyParams) | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
        }

        return [ordered]@{
            workspace = $workspace
            settings = $settings
            companies = $companies
            contacts = @()
            jobs = @()
            boardConfigs = $boardConfigs
            activities = @()
            importRuns = @()
        }
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteScopedStateForCompanyKeys {
    param([string[]]$CompanyKeys)

    $connection = Open-BdSqliteConnection
    try {
        $workspace = ConvertFrom-BdSqliteJsonText (Get-BdSqliteMetaValue -Connection $connection -Key 'workspace_json')
        $settings = ConvertFrom-BdSqliteJsonText (Get-BdSqliteMetaValue -Connection $connection -Key 'settings_json')
        $nameClause = New-BdSqliteInClauseParts -Prefix 'companyKey' -Values $CompanyKeys
        if ($nameClause.count -eq 0) {
            return [ordered]@{
                workspace = $workspace
                settings = $settings
                companies = @()
                contacts = @()
                jobs = @()
                boardConfigs = @()
                activities = @()
                importRuns = @()
            }
        }

        $companies = @((Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json FROM companies WHERE normalized_name IN ({0}) ORDER BY sort_order ASC;" -f $nameClause.clause) -Parameters $nameClause.parameters) | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
        $contacts = @((Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json FROM contacts WHERE normalized_company_name IN ({0}) ORDER BY sort_order ASC;" -f $nameClause.clause) -Parameters $nameClause.parameters) | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
        $jobs = @((Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json FROM jobs WHERE normalized_company_name IN ({0}) ORDER BY sort_order ASC;" -f $nameClause.clause) -Parameters $nameClause.parameters) | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
        $boardConfigs = @((Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json FROM board_configs WHERE normalized_company_name IN ({0}) ORDER BY sort_order ASC;" -f $nameClause.clause) -Parameters $nameClause.parameters) | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })
        $activities = @((Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT data_json FROM activities WHERE normalized_company_name IN ({0}) ORDER BY sort_order ASC;" -f $nameClause.clause) -Parameters $nameClause.parameters) | ForEach-Object { ConvertFrom-BdSqliteJsonText $_.data_json })

        return [ordered]@{
            workspace = $workspace
            settings = $settings
            companies = $companies
            contacts = $contacts
            jobs = $jobs
            boardConfigs = $boardConfigs
            activities = $activities
            importRuns = @()
        }
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteState {
    return [ordered]@{
        workspace = Get-BdSqliteSegment -Segment 'Workspace'
        settings = Get-BdSqliteSegment -Segment 'Settings'
        companies = @(Get-BdSqliteSegment -Segment 'Companies')
        contacts = @(Get-BdSqliteSegment -Segment 'Contacts')
        jobs = @(Get-BdSqliteSegment -Segment 'Jobs')
        boardConfigs = @(Get-BdSqliteSegment -Segment 'BoardConfigs')
        activities = @(Get-BdSqliteSegment -Segment 'Activities')
        importRuns = @(Get-BdSqliteSegment -Segment 'ImportRuns')
    }
}

function Get-BdSqlitePageSpec {
    param(
        [hashtable]$Query,
        [int]$DefaultPageSize = 25
    )

    $page = 1
    $pageSize = $DefaultPageSize

    if ($Query.ContainsKey('page')) {
        $page = [int](ConvertTo-BdSqliteNumber $Query['page'])
    }
    if ($Query.ContainsKey('pageSize')) {
        $pageSize = [int](ConvertTo-BdSqliteNumber $Query['pageSize'])
    }

    if ($page -lt 1) { $page = 1 }
    if ($pageSize -lt 1) { $pageSize = $DefaultPageSize }
    if ($pageSize -gt 250) { $pageSize = 250 }

    return [ordered]@{
        page = $page
        pageSize = $pageSize
        offset = ($page - 1) * $pageSize
    }
}

function Get-BdSqliteQueryValue {
    param(
        [hashtable]$Query,
        [string]$Name,
        $Default = ''
    )

    if ($Query -and $Query.ContainsKey($Name)) {
        return $Query[$Name]
    }

    return $Default
}

function ConvertFrom-BdSqliteIntBool {
    param($Value)

    return ([int](ConvertTo-BdSqliteNumber $Value) -ne 0)
}

function Convert-BdSqliteCompanyRowToSummary {
    param($Row)

    $targetScoreExplanation = ConvertTo-BdSqlitePlainObject (ConvertFrom-BdSqliteJsonText ([string]$Row.target_score_explanation_json))
    $hasExplanation = $false
    if ($targetScoreExplanation -is [System.Collections.IDictionary]) {
        $hasExplanation = ($targetScoreExplanation.Count -gt 0)
    } elseif ($null -ne $targetScoreExplanation) {
        $hasExplanation = $true
    }
    if (-not $hasExplanation) {
        $targetScoreExplanation = Get-BdSqliteFallbackTargetScoreExplanation -Row $Row
    }

    return [ordered]@{
        id = [string]$Row.id
        normalizedName = [string]$Row.normalized_name
        displayName = [string]$Row.display_name
        domain = [string]$Row.domain
        canonicalDomain = [string]$(if ($Row.canonical_domain) { $Row.canonical_domain } else { $Row.domain })
        careersUrl = [string]$Row.careers_url
        linkedinCompanySlug = [string]$Row.linkedin_company_slug
        aliases = @(ConvertFrom-BdSqliteDelimitedList $Row.aliases_text)
        enrichmentStatus = [string]$Row.enrichment_status
        enrichmentSource = [string]$Row.enrichment_source
        enrichmentConfidence = [string]$Row.enrichment_confidence
        enrichmentConfidenceScore = [int](ConvertTo-BdSqliteNumber $Row.enrichment_confidence_score)
        enrichmentNotes = [string]$Row.enrichment_notes
        enrichmentEvidence = [string]$Row.enrichment_evidence
        enrichmentFailureReason = [string]$Row.enrichment_failure_reason
        nextEnrichmentAttemptAt = $Row.next_enrichment_attempt_at
        lastEnrichedAt = $Row.last_enriched_at
        lastVerifiedAt = $Row.last_verified_at
        owner = [string]$Row.owner
        priority = [string]$Row.priority
        status = [string]$Row.status
        outreachStatus = [string]$Row.outreach_status
        nextAction = [string]$Row.next_action
        nextActionAt = $Row.next_action_at
        dailyScore = [int](ConvertTo-BdSqliteNumber $Row.daily_score)
        targetScore = [int](ConvertTo-BdSqliteNumber $Row.target_score)
        normalizedTargetScore = [int](ConvertTo-BdSqliteNumber $Row.target_score)
        targetScoreExplanation = $targetScoreExplanation
        connectionCount = [int](ConvertTo-BdSqliteNumber $Row.connection_count)
        seniorContactCount = [int](ConvertTo-BdSqliteNumber $Row.senior_contact_count)
        talentContactCount = [int](ConvertTo-BdSqliteNumber $Row.talent_contact_count)
        jobCount = [int](ConvertTo-BdSqliteNumber $Row.job_count)
        openRoleCount = [int](ConvertTo-BdSqliteNumber $Row.open_role_count)
        jobsLast30Days = [int](ConvertTo-BdSqliteNumber $Row.jobs_last_30_days)
        jobsLast90Days = [int](ConvertTo-BdSqliteNumber $Row.jobs_last_90_days)
        newRoleCount7d = [int](ConvertTo-BdSqliteNumber $Row.new_role_count_7d)
        staleRoleCount30d = [int](ConvertTo-BdSqliteNumber $Row.stale_role_count_30d)
        avgRoleSeniorityScore = [double](ConvertTo-BdSqliteNumber $Row.avg_role_seniority_score)
        hiringSpikeRatio = [double](ConvertTo-BdSqliteNumber $Row.hiring_spike_ratio)
        externalRecruiterLikelihoodScore = [double](ConvertTo-BdSqliteNumber $Row.external_recruiter_likelihood_score)
        companyGrowthSignalScore = [double](ConvertTo-BdSqliteNumber $Row.company_growth_signal_score)
        companyGrowthSignalSummary = [string]$Row.company_growth_signal_summary
        engagementScore = [double](ConvertTo-BdSqliteNumber $Row.engagement_score)
        engagementSummary = [string]$Row.engagement_summary
        hiringVelocity = [double](ConvertTo-BdSqliteNumber $Row.hiring_velocity)
        departmentFocus = [string]$Row.department_focus
        networkStrength = [string]$Row.network_strength
        hiringStatus = [string]$Row.hiring_status
        lastJobPostedAt = $Row.last_job_posted_at
        followUpScore = [int](ConvertTo-BdSqliteNumber $Row.follow_up_score)
        daysSinceContact = if ($null -eq $Row.days_since_contact) { $null } else { [int](ConvertTo-BdSqliteNumber $Row.days_since_contact) }
        staleFlag = [string]$Row.stale_flag
        recommendedAction = [string]$Row.recommended_action
        outreachDraft = [string]$Row.outreach_draft
        atsTypes = @(ConvertFrom-BdSqliteDelimitedList $Row.ats_types_text)
        topContactName = [string]$Row.top_contact_name
        topContactTitle = [string]$Row.top_contact_title
    }
}

function Convert-BdSqliteContactRowToSummary {
    param($Row)

    return [ordered]@{
        id = [string]$Row.id
        accountId = [string]$Row.account_id
        companyName = [string]$Row.company_name
        fullName = [string]$Row.full_name
        title = [string]$Row.title
        linkedinUrl = [string]$Row.linkedin_url
        connectedOn = $Row.connected_on
        priorityScore = [int](ConvertTo-BdSqliteNumber $Row.priority_score)
        outreachStatus = [string]$Row.outreach_status
        notes = [string]$Row.notes
    }
}

function Convert-BdSqliteJobRowToSummary {
    param($Row)

    return [ordered]@{
        id = [string]$Row.id
        accountId = [string]$Row.account_id
        companyName = [string]$Row.company_name
        title = [string]$Row.title
        department = [string]$Row.department
        location = [string]$Row.location
        employmentType = [string]$Row.employment_type
        jobId = [string]$Row.job_id
        url = [string]$Row.url
        jobUrl = [string]$Row.job_url
        sourceUrl = [string]$Row.source_url
        atsType = [string]$Row.ats_type
        postedAt = $Row.posted_at
        retrievedAt = $Row.retrieved_at
        importedAt = $Row.imported_at
        lastSeenAt = $Row.last_seen_at
        active = ConvertFrom-BdSqliteIntBool $Row.active
        isGta = ConvertFrom-BdSqliteIntBool $Row.is_gta
        isNew = ConvertFrom-BdSqliteIntBool $Row.is_new
    }
}

function Test-BdSqliteImportCapableAtsType {
    param([string]$AtsType)

    return ([string]$AtsType).ToLowerInvariant() -in @(
        'greenhouse',
        'lever',
        'ashby',
        'smartrecruiters',
        'workday',
        'jobvite'
    )
}

function Convert-BdSqliteConfigRowToSummary {
    param($Row)

    $record = $null
    try {
        $record = ConvertFrom-BdSqliteJsonText ([string]$Row.data_json)
    } catch {
        $record = $null
    }

    $discoveryStatus = [string]$Row.discovery_status
    if (-not $discoveryStatus -and $record) {
        $discoveryStatus = [string](Get-BdSqliteRecordValue -Record $record -Name 'discoveryStatus')
    }

    $confidenceBand = [string]$Row.confidence_band
    if (-not $confidenceBand) {
        $confidenceBand = if ($record) { [string](Get-BdSqliteRecordValue -Record $record -Name 'confidenceBand') } else { '' }
    }
    if (-not $confidenceBand) {
        $confidenceBand = if ($discoveryStatus -in @('mapped', 'discovered', 'verified')) { 'high' } else { 'unresolved' }
    }

    $confidenceScore = [double](ConvertTo-BdSqliteNumber $Row.confidence_score)
    if ($confidenceScore -le 0 -and $record) {
        $confidenceScore = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $record -Name 'confidenceScore'))
    }
    if ($confidenceScore -le 0 -and $confidenceBand -eq 'high') {
        $confidenceScore = 100
    }

    $reviewStatus = [string]$Row.review_status
    if (-not $reviewStatus -and $record) {
        $reviewStatus = [string](Get-BdSqliteRecordValue -Record $record -Name 'reviewStatus')
    }
    if (-not $reviewStatus) {
        $reviewStatus = if ($confidenceBand -eq 'high') { 'auto' } else { 'pending' }
    }

    $supportedImport = ConvertFrom-BdSqliteIntBool $Row.supported_import
    if (-not $supportedImport -and $record) {
        $supportedImport = [bool](Get-BdSqliteRecordValue -Record $record -Name 'supportedImport')
    }
    if (-not $supportedImport) {
        $supportedImport = Test-BdSqliteImportCapableAtsType -AtsType ([string]$Row.ats_type)
    }

    return [ordered]@{
        id = [string]$Row.id
        accountId = [string]$Row.account_id
        companyName = [string]$Row.company_name
        atsType = [string]$Row.ats_type
        boardId = [string]$Row.board_id
        domain = [string]$Row.domain
        careersUrl = [string]$Row.careers_url
        resolvedBoardUrl = [string]$(if ($Row.PSObject.Properties.Name -contains 'resolved_board_url') { $Row.resolved_board_url } elseif ($record) { Get-BdSqliteRecordValue -Record $record -Name 'resolvedBoardUrl' } else { '' })
        source = [string]$Row.source
        notes = [string]$Row.notes
        active = ConvertFrom-BdSqliteIntBool $Row.active
        supportedImport = $supportedImport
        lastCheckedAt = $Row.last_checked_at
        lastResolutionAttemptAt = $Row.last_resolution_attempt_at
        nextResolutionAttemptAt = $Row.next_resolution_attempt_at
        discoveryStatus = $discoveryStatus
        discoveryMethod = [string]$Row.discovery_method
        confidenceScore = $confidenceScore
        confidenceBand = $confidenceBand
        evidenceSummary = [string]$(if ($Row.evidence_summary) { $Row.evidence_summary } elseif ($record) { Get-BdSqliteRecordValue -Record $record -Name 'evidenceSummary' } else { '' })
        reviewStatus = $reviewStatus
        failureReason = [string]$(if ($Row.failure_reason) { $Row.failure_reason } elseif ($record) { Get-BdSqliteRecordValue -Record $record -Name 'failureReason' } else { '' })
        redirectTarget = [string]$Row.redirect_target
        matchedSignatures = if ($record) { @(Get-BdSqliteStringList (Get-BdSqliteRecordValue -Record $record -Name 'matchedSignatures')) } else { @(ConvertFrom-BdSqliteDelimitedList ([string]$Row.matched_signatures_text)) }
        attemptedUrls = if ($record) { @(Get-BdSqliteStringList (Get-BdSqliteRecordValue -Record $record -Name 'attemptedUrls')) } else { @() }
        httpSummary = if ($record) { @(Get-BdSqliteRecordValue -Record $record -Name 'httpSummary' -Default @()) } else { @() }
        lastImportAt = $Row.last_import_at
        lastImportStatus = [string]$Row.last_import_status
    }
}

function Convert-BdSqliteActivityRowToSummary {
    param($Row)

    return [ordered]@{
        id = [string]$Row.id
        summary = [string]$Row.summary
        type = [string]$Row.type
        notes = [string]$Row.notes
        occurredAt = $Row.occurred_at
        pipelineStage = [string]$Row.pipeline_stage
        accountId = [string]$Row.account_id
    }
}

function Invoke-BdSqlitePagedSelect {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [Parameter(Mandatory = $true)]
        [string]$TableName,
        [string]$SelectColumns = '*',
        [string[]]$WhereClauses = @(),
        [hashtable]$Parameters = @{},
        [string]$OrderBy = 'sort_order ASC',
        [int]$Page = 1,
        [int]$PageSize = 25
    )

    $whereSql = if ($WhereClauses.Count -gt 0) { ' WHERE ' + ([string]::Join(' AND ', $WhereClauses)) } else { '' }
    $countSql = "SELECT COUNT(*) FROM [{0}]{1};" -f $TableName, $whereSql
    $total = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $Connection -Sql $countSql -Parameters $Parameters))

    $pageSpec = Get-BdSqlitePageSpec -Query @{ page = $Page; pageSize = $PageSize } -DefaultPageSize $PageSize
    $pagedParameters = @{}
    foreach ($key in @($Parameters.Keys)) {
        $pagedParameters[$key] = $Parameters[$key]
    }
    $pagedParameters.limit = $pageSpec.pageSize
    $pagedParameters.offset = $pageSpec.offset

    $sql = "SELECT {0} FROM [{1}]{2} ORDER BY {3} LIMIT @limit OFFSET @offset;" -f $SelectColumns, $TableName, $whereSql, $OrderBy
    $items = @(Invoke-BdSqliteRows -Connection $Connection -Sql $sql -Parameters $pagedParameters)

    return [ordered]@{
        page = $pageSpec.page
        pageSize = $pageSpec.pageSize
        total = $total
        items = $items
    }
}

function Get-BdSqliteFilterOptionsInternal {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [System.Collections.IDictionary]$TimingBag
    )

    return [ordered]@{
        atsTypes = @((Invoke-BdSqliteTimedStep -Name 'atsTypesMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT ats_type AS value FROM board_configs WHERE ats_type IS NOT NULL AND ats_type <> '' ORDER BY ats_type ASC;"
                }) | ForEach-Object { [string]$_.value })
        priorityTiers = @((Invoke-BdSqliteTimedStep -Name 'priorityTiersMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT priority_tier AS value FROM companies WHERE priority_tier IS NOT NULL AND priority_tier <> '' ORDER BY priority_tier ASC;"
                }) | ForEach-Object { [string]$_.value })
        priorities = @((Invoke-BdSqliteTimedStep -Name 'prioritiesMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT priority AS value FROM companies WHERE priority IS NOT NULL AND priority <> '' ORDER BY priority ASC;"
                }) | ForEach-Object { [string]$_.value })
        statuses = @((Invoke-BdSqliteTimedStep -Name 'statusesMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT status AS value FROM companies WHERE status IS NOT NULL AND status <> '' ORDER BY status ASC;"
                }) | ForEach-Object { [string]$_.value })
        owners = @(
                    @(try { (Get-OwnerRoster) | ForEach-Object { [string]$_.displayName } } catch { @() }) +
                    @((Invoke-BdSqliteTimedStep -Name 'ownersMs' -TimingBag $TimingBag -Action {
                        Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT owner AS value FROM companies WHERE owner IS NOT NULL AND owner <> '' ORDER BY owner ASC;"
                    }) | ForEach-Object { [string]$_.value }) | Select-Object -Unique
                )
        outreachStatuses = @((Invoke-BdSqliteTimedStep -Name 'outreachStatusesMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT outreach_status AS value FROM companies WHERE outreach_status IS NOT NULL AND outreach_status <> '' ORDER BY outreach_status ASC;"
                }) | ForEach-Object { [string]$_.value })
        enrichmentStatuses = @((Invoke-BdSqliteTimedStep -Name 'enrichmentStatusesMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT enrichment_status AS value FROM companies WHERE enrichment_status IS NOT NULL AND enrichment_status <> '' ORDER BY enrichment_status ASC;"
                }) | ForEach-Object { [string]$_.value })
        enrichmentConfidences = @((Invoke-BdSqliteTimedStep -Name 'enrichmentConfidencesMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT enrichment_confidence AS value FROM companies WHERE enrichment_confidence IS NOT NULL AND enrichment_confidence <> '' ORDER BY CASE enrichment_confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, enrichment_confidence ASC;"
                }) | ForEach-Object { [string]$_.value })
        configDiscoveryStatuses = @((Invoke-BdSqliteTimedStep -Name 'configDiscoveryStatusesMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT discovery_status AS value FROM board_configs WHERE discovery_status IS NOT NULL AND discovery_status <> '' ORDER BY discovery_status ASC;"
                }) | ForEach-Object { [string]$_.value })
        configConfidenceBands = @((Invoke-BdSqliteTimedStep -Name 'configConfidenceBandsMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END AS value FROM board_configs ORDER BY CASE value WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, value ASC;"
                }) | ForEach-Object { [string]$_.value })
        configReviewStatuses = @((Invoke-BdSqliteTimedStep -Name 'configReviewStatusesMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT COALESCE(NULLIF(review_status, ''), CASE WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'auto' ELSE 'pending' END) AS value FROM board_configs ORDER BY value ASC;"
                }) | ForEach-Object { [string]$_.value })
        configImportStatuses = @((Invoke-BdSqliteTimedStep -Name 'configImportStatusesMs' -TimingBag $TimingBag -Action {
                    Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT DISTINCT last_import_status AS value FROM board_configs WHERE last_import_status IS NOT NULL AND last_import_status <> '' ORDER BY last_import_status ASC;"
                }) | ForEach-Object { [string]$_.value })
    }
}

function Get-BdSqliteFilterOptions {
    $connection = Open-BdSqliteConnection
    try {
        return (Get-BdSqliteFilterOptionsInternal -Connection $connection)
    } finally {
        $connection.Dispose()
    }
}

function Find-BdSqliteAccounts {
    param([hashtable]$Query)

    $connection = Open-BdSqliteConnection
    try {
        $whereClauses = New-Object System.Collections.ArrayList
        $parameters = @{}
        $searchQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'q')
        $hiringQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'hiring')
        $atsQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'ats')
        $minContactsQuery = Get-BdSqliteQueryValue -Query $Query -Name 'minContacts'
        $priorityTierQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'priorityTier')
        $priorityQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'priority')
        $statusQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'status')
        $ownerQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'owner')
        $outreachStatusQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'outreachStatus')
        $recencyDaysQuery = Get-BdSqliteQueryValue -Query $Query -Name 'recencyDays'
        $sortByQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'sortBy')
        $pageQuery = Get-BdSqliteQueryValue -Query $Query -Name 'page'
        $pageSizeQuery = Get-BdSqliteQueryValue -Query $Query -Name 'pageSize'

        if ($searchQuery) {
            [void]$whereClauses.Add('search_text LIKE @search')
            $parameters.search = '%' + (Normalize-BdSqliteText $searchQuery) + '%'
        }
        if ($hiringQuery -eq 'true') {
            [void]$whereClauses.Add('job_count > 0')
        }
        if ($atsQuery) {
            [void]$whereClauses.Add('ats_types_text LIKE @ats')
            $parameters.ats = '%|' + $atsQuery.Trim().ToLowerInvariant() + '|%'
        }
        if ($minContactsQuery) {
            [void]$whereClauses.Add('connection_count >= @minContacts')
            $parameters.minContacts = [int](ConvertTo-BdSqliteNumber $minContactsQuery)
        }
        if ($priorityTierQuery) {
            [void]$whereClauses.Add('priority_tier = @priorityTier')
            $parameters.priorityTier = $priorityTierQuery
        }
        if ($priorityQuery) {
            [void]$whereClauses.Add('priority = @priority')
            $parameters.priority = $priorityQuery
        }
        if ($statusQuery) {
            [void]$whereClauses.Add('status = @status')
            $parameters.status = $statusQuery
        }
        if ($ownerQuery) {
            [void]$whereClauses.Add('owner_normalized LIKE @owner')
            $parameters.owner = '%' + (Normalize-BdSqliteText $ownerQuery) + '%'
        }
        if ($outreachStatusQuery) {
            [void]$whereClauses.Add('outreach_status = @outreachStatus')
            $parameters.outreachStatus = $outreachStatusQuery
        }
        if ($recencyDaysQuery) {
            [void]$whereClauses.Add('last_job_posted_at >= @recencyCutoff')
            $parameters.recencyCutoff = (Get-Date).AddDays(-1 * (ConvertTo-BdSqliteNumber $recencyDaysQuery)).ToString('o')
        }

        $orderBy = switch ($sortByQuery) {
            'new_roles' { 'new_role_count_7d DESC, target_score DESC, hiring_velocity DESC, display_name ASC' }
            'connections' { 'connection_count DESC, target_score DESC, hiring_velocity DESC, display_name ASC' }
            'follow_up' { 'follow_up_score DESC, target_score DESC, hiring_velocity DESC, display_name ASC' }
            'recent_jobs' { 'last_job_posted_at DESC, target_score DESC, hiring_velocity DESC, display_name ASC' }
            default { 'target_score DESC, hiring_velocity DESC, engagement_score DESC, display_name ASC' }
        }

        $result = Invoke-BdSqlitePagedSelect -Connection $connection -TableName 'companies' -SelectColumns $script:CompanySummaryColumns -WhereClauses @($whereClauses) -Parameters $parameters -OrderBy $orderBy -Page ([int](ConvertTo-BdSqliteNumber $pageQuery)) -PageSize ([int](ConvertTo-BdSqliteNumber $pageSizeQuery))
        $result.items = @($result.items | ForEach-Object { Convert-BdSqliteCompanyRowToSummary $_ })
        return $result
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteTargetScoreBackfillAccountIds {
    param([int]$Limit = 250)

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        return @(
            (Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT id
FROM companies
WHERE COALESCE(target_score, 0) > 100
   OR hiring_velocity IS NULL
   OR jobs_last_30_days IS NULL
   OR jobs_last_90_days IS NULL
   OR avg_role_seniority_score IS NULL
   OR hiring_spike_ratio IS NULL
   OR external_recruiter_likelihood_score IS NULL
   OR company_growth_signal_score IS NULL
   OR engagement_score IS NULL
   OR COALESCE(target_score_explanation_json, '') = ''
ORDER BY COALESCE(target_score, 0) DESC, sort_order ASC
LIMIT @limit;
'@ -Parameters @{ limit = $Limit }) |
                ForEach-Object { [string]$_.id } |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
    } finally {
        $connection.Dispose()
    }
}

function Find-BdSqliteContacts {
    param([hashtable]$Query)

    $connection = Open-BdSqliteConnection
    try {
        $whereClauses = New-Object System.Collections.ArrayList
        $parameters = @{}
        $searchQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'q')
        $minScoreQuery = Get-BdSqliteQueryValue -Query $Query -Name 'minScore'
        $outreachStatusQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'outreachStatus')
        $pageQuery = Get-BdSqliteQueryValue -Query $Query -Name 'page'
        $pageSizeQuery = Get-BdSqliteQueryValue -Query $Query -Name 'pageSize'

        if ($searchQuery) {
            [void]$whereClauses.Add('search_text LIKE @search')
            $parameters.search = '%' + (Normalize-BdSqliteText $searchQuery) + '%'
        }
        if ($minScoreQuery) {
            [void]$whereClauses.Add('priority_score >= @minScore')
            $parameters.minScore = [double](ConvertTo-BdSqliteNumber $minScoreQuery)
        }
        if ($outreachStatusQuery) {
            [void]$whereClauses.Add('outreach_status = @outreachStatus')
            $parameters.outreachStatus = $outreachStatusQuery
        }

        $result = Invoke-BdSqlitePagedSelect -Connection $connection -TableName 'contacts' -SelectColumns '*' -WhereClauses @($whereClauses) -Parameters $parameters -OrderBy 'priority_score DESC, company_overlap_count DESC, full_name ASC' -Page ([int](ConvertTo-BdSqliteNumber $pageQuery)) -PageSize ([int](ConvertTo-BdSqliteNumber $pageSizeQuery))
        $result.items = @($result.items | ForEach-Object { Convert-BdSqliteContactRowToSummary $_ })
        return $result
    } finally {
        $connection.Dispose()
    }
}

function Find-BdSqliteJobs {
    param([hashtable]$Query)

    $connection = Open-BdSqliteConnection
    try {
        $whereClauses = New-Object System.Collections.ArrayList
        $parameters = @{}
        $searchQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'q')
        $atsQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'ats')
        $companyQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'company')
        $activeQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'active')
        $isNewQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'isNew')
        $recencyDaysQuery = Get-BdSqliteQueryValue -Query $Query -Name 'recencyDays'
        $sortByQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'sortBy')
        $pageQuery = Get-BdSqliteQueryValue -Query $Query -Name 'page'
        $pageSizeQuery = Get-BdSqliteQueryValue -Query $Query -Name 'pageSize'

        if ($searchQuery) {
            [void]$whereClauses.Add('search_text LIKE @search')
            $parameters.search = '%' + (Normalize-BdSqliteText $searchQuery) + '%'
        }
        if ($atsQuery) {
            [void]$whereClauses.Add('ats_type = @ats')
            $parameters.ats = $atsQuery
        }
        if ($companyQuery) {
            [void]$whereClauses.Add('search_text LIKE @company')
            $parameters.company = '%' + (Normalize-BdSqliteText $companyQuery) + '%'
        }
        if ($activeQuery -ne '') {
            [void]$whereClauses.Add('active = @active')
            $parameters.active = ConvertTo-BdSqliteBoolInt $activeQuery
        }
        if ($isNewQuery -ne '') {
            [void]$whereClauses.Add('is_new = @isNew')
            $parameters.isNew = ConvertTo-BdSqliteBoolInt $isNewQuery
        }
        if ($recencyDaysQuery) {
            [void]$whereClauses.Add('posted_at >= @postedCutoff')
            $parameters.postedCutoff = (Get-Date).AddDays(-1 * (ConvertTo-BdSqliteNumber $recencyDaysQuery)).ToString('o')
        }

        $orderBy = switch ($sortByQuery) {
            'retrieved' { 'COALESCE(retrieved_at, imported_at) DESC, posted_at DESC, company_name ASC' }
            default { 'posted_at DESC, company_name ASC, title ASC' }
        }

        $result = Invoke-BdSqlitePagedSelect -Connection $connection -TableName 'jobs' -SelectColumns '*' -WhereClauses @($whereClauses) -Parameters $parameters -OrderBy $orderBy -Page ([int](ConvertTo-BdSqliteNumber $pageQuery)) -PageSize ([int](ConvertTo-BdSqliteNumber $pageSizeQuery))
        $result.items = @($result.items | ForEach-Object { Convert-BdSqliteJobRowToSummary $_ })
        return $result
    } finally {
        $connection.Dispose()
    }
}

function Find-BdSqliteConfigs {
    param([hashtable]$Query)

    $connection = Open-BdSqliteConnection
    try {
        $whereClauses = New-Object System.Collections.ArrayList
        $parameters = @{}
        $searchQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'q')
        $atsQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'ats')
        $discoveryStatusQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'discoveryStatus')
        $confidenceBandQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'confidenceBand')
        $reviewStatusQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'reviewStatus')
        $activeQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'active')
        $pageQuery = Get-BdSqliteQueryValue -Query $Query -Name 'page'
        $pageSizeQuery = Get-BdSqliteQueryValue -Query $Query -Name 'pageSize'

        if ($searchQuery) {
            [void]$whereClauses.Add('search_text LIKE @search')
            $parameters.search = '%' + (Normalize-BdSqliteText $searchQuery) + '%'
        }
        if ($atsQuery) {
            [void]$whereClauses.Add('ats_type = @ats')
            $parameters.ats = $atsQuery
        }
        if ($discoveryStatusQuery) {
            [void]$whereClauses.Add('discovery_status = @discoveryStatus')
            $parameters.discoveryStatus = $discoveryStatusQuery
        }
        if ($confidenceBandQuery) {
            [void]$whereClauses.Add("(CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) = @confidenceBand")
            $parameters.confidenceBand = $confidenceBandQuery
        }
        if ($reviewStatusQuery) {
            [void]$whereClauses.Add("(COALESCE(NULLIF(review_status, ''), CASE WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'auto' ELSE 'pending' END)) = @reviewStatus")
            $parameters.reviewStatus = $reviewStatusQuery
        }
        if ($activeQuery -ne '') {
            [void]$whereClauses.Add('active = @active')
            $parameters.active = ConvertTo-BdSqliteBoolInt $activeQuery
        }

        $result = Invoke-BdSqlitePagedSelect -Connection $connection -TableName 'board_configs' -SelectColumns '*' -WhereClauses @($whereClauses) -Parameters $parameters -OrderBy "CASE (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, company_name ASC" -Page ([int](ConvertTo-BdSqliteNumber $pageQuery)) -PageSize ([int](ConvertTo-BdSqliteNumber $pageSizeQuery))
        $result.items = @($result.items | ForEach-Object { Convert-BdSqliteConfigRowToSummary $_ })
        return $result
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteResolverCoverageReport {
    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection

        $summary = @(Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT
    COUNT(*) AS total_configs,
    SUM(CASE WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 1 ELSE 0 END) AS resolved_count,
    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_count,
    SUM(CASE WHEN (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) = 'high' THEN 1 ELSE 0 END) AS high_confidence_count,
    SUM(CASE WHEN (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) = 'medium' THEN 1 ELSE 0 END) AS medium_confidence_count,
    SUM(CASE WHEN (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) = 'low' THEN 1 ELSE 0 END) AS low_confidence_count,
    SUM(CASE WHEN (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) = 'unresolved' THEN 1 ELSE 0 END) AS unresolved_band_count,
    SUM(CASE WHEN COALESCE(NULLIF(review_status, ''), CASE WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'auto' ELSE 'pending' END) = 'pending' AND (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) = 'medium' THEN 1 ELSE 0 END) AS medium_review_queue_count,
    SUM(CASE WHEN COALESCE(NULLIF(review_status, ''), CASE WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'auto' ELSE 'pending' END) <> 'rejected' AND (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) = 'unresolved' THEN 1 ELSE 0 END) AS unresolved_review_queue_count
FROM board_configs;
'@ | Select-Object -First 1)
        if (-not $summary) {
            $summary = [ordered]@{}
        }

        $totalConfigs = [int](ConvertTo-BdSqliteNumber $summary.total_configs)
        $resolvedCount = [int](ConvertTo-BdSqliteNumber $summary.resolved_count)
        $unresolvedCount = [int][Math]::Max(0, $totalConfigs - $resolvedCount)
        $coveragePct = if ($totalConfigs -gt 0) { [double][Math]::Round(($resolvedCount / $totalConfigs) * 100, 1) } else { 0 }

        return [ordered]@{
            summary = [ordered]@{
                totalCompanies = $totalConfigs
                resolvedCount = $resolvedCount
                unresolvedCount = $unresolvedCount
                activeCount = [int](ConvertTo-BdSqliteNumber $summary.active_count)
                coveragePercent = $coveragePct
                mediumReviewQueueCount = [int](ConvertTo-BdSqliteNumber $summary.medium_review_queue_count)
                unresolvedReviewQueueCount = [int](ConvertTo-BdSqliteNumber $summary.unresolved_review_queue_count)
            }
            byAtsType = @(
                Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT
    COALESCE(NULLIF(ats_type, ''), 'unknown') AS ats_type,
    COUNT(*) AS count
FROM board_configs
GROUP BY COALESCE(NULLIF(ats_type, ''), 'unknown')
ORDER BY count DESC, ats_type ASC;
'@ | ForEach-Object {
                    [ordered]@{
                        atsType = [string]$_.ats_type
                        count = [int](ConvertTo-BdSqliteNumber $_.count)
                    }
                }
            )
            byConfidenceBand = @(
                Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT
    CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END AS confidence_band,
    COUNT(*) AS count
FROM board_configs
GROUP BY CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END
ORDER BY CASE confidence_band WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, confidence_band ASC;
'@ | ForEach-Object {
                    [ordered]@{
                        confidenceBand = [string]$_.confidence_band
                        count = [int](ConvertTo-BdSqliteNumber $_.count)
                    }
                }
            )
            topFailureReasons = @(
                Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT
    COALESCE(NULLIF(failure_reason, ''), 'No failure reason logged') AS failure_reason,
    COUNT(*) AS count
FROM board_configs
WHERE (CASE WHEN COALESCE(NULLIF(confidence_band, ''), '') <> '' THEN confidence_band WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 'high' ELSE 'unresolved' END) IN ('low', 'unresolved')
GROUP BY COALESCE(NULLIF(failure_reason, ''), 'No failure reason logged')
ORDER BY count DESC, failure_reason ASC
LIMIT 8;
'@ | ForEach-Object {
                    [ordered]@{
                        failureReason = [string]$_.failure_reason
                        count = [int](ConvertTo-BdSqliteNumber $_.count)
                    }
                }
            )
            history = @(
                Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT *
FROM resolver_coverage_history
ORDER BY captured_at DESC
LIMIT 14;
'@ | ForEach-Object {
                    [ordered]@{
                        capturedAt = [string]$_.captured_at
                        dataRevision = [string]$_.data_revision
                        totalConfigs = [int](ConvertTo-BdSqliteNumber $_.total_configs)
                        resolvedCount = [int](ConvertTo-BdSqliteNumber $_.resolved_configs)
                        unresolvedCount = [int](ConvertTo-BdSqliteNumber $_.unresolved_configs)
                        coveragePercent = [double](ConvertTo-BdSqliteNumber $_.coverage_pct)
                        highConfidenceCount = [int](ConvertTo-BdSqliteNumber $_.high_confidence_count)
                        mediumConfidenceCount = [int](ConvertTo-BdSqliteNumber $_.medium_confidence_count)
                        lowConfidenceCount = [int](ConvertTo-BdSqliteNumber $_.low_confidence_count)
                        activeCount = [int](ConvertTo-BdSqliteNumber $_.auto_active_count)
                    }
                }
            )
        }
    } finally {
        $connection.Dispose()
    }
}

function Invoke-BdSqliteLocalEnrichmentPass {
    <#
    .SYNOPSIS
    Derives canonical_domain and careers_url from existing local data (contact emails,
    board_config domains, board_config careers URLs) without any HTTP probing.
    Updates company rows directly in SQLite and returns counts of what changed.
    #>
    param(
        [int]$Limit = 2000,
        [switch]$ForceRefresh
    )

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection

        $now = (Get-Date).ToString('o')
        $highCooldown = (Get-Date).AddDays(30).ToString('o')
        $medCooldown  = (Get-Date).AddDays(3).ToString('o')

        # ---------------------------------------------------------------
        # FREE-EMAIL exclusion list (shared with JobImport module)
        # ---------------------------------------------------------------
        $freeEmailDomains = @('gmail.com','googlemail.com','outlook.com','hotmail.com',
            'live.com','icloud.com','me.com','mac.com','yahoo.com','yahoo.ca','yahoo.co.uk',
            'protonmail.com','aol.com','msn.com','comcast.net','rogers.com','shaw.ca',
            'bell.net','telus.net','sympatico.ca','cogeco.ca','videotron.ca','eastlink.ca',
            'ymail.com','rocketmail.com','live.ca','hotmail.ca','outlook.ca')
        $freeExclusion = ($freeEmailDomains | ForEach-Object { "'$_'" }) -join ','

        # Hosted ATS domains to exclude from canonical domain candidates
        $hostedAtsDomains = @('greenhouse.io','lever.co','jobvite.com','myworkdayjobs.com',
            'workday.com','icims.com','taleo.net','successfactors.com','bamboohr.com',
            'ashbyhq.com','rippling.com','breezy.hr','smartrecruiters.com','recruiterbox.com',
            'pinpointhq.com','teamtailor.com','applytojob.com','recruitee.com','workable.com',
            'jazz.co','comeet.com','hirebridge.com','silkroad.com','kenexa.com',
            'careers.linkedin.com','indeed.com','glassdoor.com','ziprecruiter.com')
        $atsExclusion = ($hostedAtsDomains | ForEach-Object { "'$_'" }) -join ','

        $stats = [ordered]@{
            contactEmailDomainApplied = 0
            boardConfigDomainApplied  = 0
            boardConfigCareersApplied = 0
            skippedAlreadyEnriched    = 0
            totalUpdated              = 0
        }

        # ---------------------------------------------------------------
        # PASS 1: Derive canonical_domain from corporate contact emails
        # Finds the most common non-free, non-ATS email domain per company
        # and sets it as canonical_domain for any company with no domain yet.
        # ---------------------------------------------------------------
        $pass1Sql = @"
SELECT co.id, co.display_name,
       LOWER(SUBSTR(ct.email, INSTR(ct.email,'@')+1)) AS email_domain,
       COUNT(*) AS domain_count
FROM companies co
JOIN contacts ct ON ct.account_id = co.id
WHERE ct.email LIKE '%@%.%'
  AND LOWER(SUBSTR(ct.email,INSTR(ct.email,'@')+1)) NOT IN ($freeExclusion)
  AND LOWER(SUBSTR(ct.email,INSTR(ct.email,'@')+1)) NOT IN ($atsExclusion)
  AND LOWER(SUBSTR(ct.email,INSTR(ct.email,'@')+1)) NOT LIKE '%.edu'
  AND (co.canonical_domain IS NULL OR co.canonical_domain = '')
  $(if (-not $ForceRefresh) { "AND (co.next_enrichment_attempt_at IS NULL OR co.next_enrichment_attempt_at = '' OR co.next_enrichment_attempt_at <= '$now')" } else { '' })
GROUP BY co.id, LOWER(SUBSTR(ct.email,INSTR(ct.email,'@')+1))
ORDER BY co.id, domain_count DESC
LIMIT $Limit;
"@
        $pass1Rows = @(Invoke-BdSqliteRows -Connection $connection -Sql $pass1Sql)
        $seenIds = @{}
        $domainUpdates = [System.Collections.ArrayList]::new()
        foreach ($row in $pass1Rows) {
            $id = [string]$row.id
            if ($seenIds.ContainsKey($id)) { continue }  # take only top domain per company
            $seenIds[$id] = $true
            [void]$domainUpdates.Add([ordered]@{ id = $id; domain = [string]$row.email_domain })
        }

        if ($domainUpdates.Count -gt 0) {
            $txn = $connection.BeginTransaction()
            try {
                foreach ($upd in $domainUpdates) {
                    $cmd = $connection.CreateCommand()
                    $cmd.Transaction = $txn
                    $cmd.CommandText = @"
UPDATE companies
SET canonical_domain = @domain,
    enrichment_status = 'enriched',
    enrichment_source = 'contact_email',
    enrichment_confidence = 'medium',
    enrichment_confidence_score = 70,
    enrichment_evidence = 'Canonical domain derived from corporate contact email domain',
    enrichment_notes = 'Auto-derived from contact email; verify and probe careers page',
    last_enriched_at = @now,
    next_enrichment_attempt_at = @cooldown
WHERE id = @id
  AND (canonical_domain IS NULL OR canonical_domain = '');
"@
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@domain';   $p.Value = $upd.domain;   [void]$cmd.Parameters.Add($p)
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@now';      $p.Value = $now;          [void]$cmd.Parameters.Add($p)
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@cooldown'; $p.Value = $medCooldown;  [void]$cmd.Parameters.Add($p)
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@id';       $p.Value = $upd.id;       [void]$cmd.Parameters.Add($p)
                    $affected = $cmd.ExecuteNonQuery()
                    $stats.contactEmailDomainApplied += $affected
                }
                $txn.Commit()
            } catch {
                try { $txn.Rollback() } catch {}
                throw
            } finally { $txn.Dispose() }
        }

        # ---------------------------------------------------------------
        # PASS 2: Derive canonical_domain from board_configs.domain
        # Uses the company's best-confidence config domain where it's not
        # a hosted ATS and no canonical_domain is set yet.
        # ---------------------------------------------------------------
        $pass2Sql = @"
SELECT co.id, co.display_name, bc.domain,
       MAX(CASE bc.confidence_band WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS conf_rank
FROM companies co
JOIN board_configs bc ON bc.normalized_company_name = co.normalized_name
WHERE bc.domain IS NOT NULL AND bc.domain != ''
  AND LOWER(bc.domain) NOT IN ($atsExclusion)
  AND (co.canonical_domain IS NULL OR co.canonical_domain = '')
  $(if (-not $ForceRefresh) { "AND (co.next_enrichment_attempt_at IS NULL OR co.next_enrichment_attempt_at = '' OR co.next_enrichment_attempt_at <= '$now')" } else { '' })
GROUP BY co.id
ORDER BY conf_rank DESC
LIMIT $Limit;
"@
        $pass2Rows = @(Invoke-BdSqliteRows -Connection $connection -Sql $pass2Sql)
        if ($pass2Rows.Count -gt 0) {
            $txn = $connection.BeginTransaction()
            try {
                foreach ($row in $pass2Rows) {
                    $cmd = $connection.CreateCommand()
                    $cmd.Transaction = $txn
                    $cmd.CommandText = @"
UPDATE companies
SET canonical_domain = @domain,
    enrichment_status = 'enriched',
    enrichment_source = 'board_config',
    enrichment_confidence = 'medium',
    enrichment_confidence_score = 68,
    enrichment_evidence = 'Canonical domain derived from board config domain field',
    last_enriched_at = @now,
    next_enrichment_attempt_at = @cooldown
WHERE id = @id
  AND (canonical_domain IS NULL OR canonical_domain = '');
"@
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@domain';   $p.Value = [string]$row.domain;    [void]$cmd.Parameters.Add($p)
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@now';      $p.Value = $now;                  [void]$cmd.Parameters.Add($p)
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@cooldown'; $p.Value = $medCooldown;          [void]$cmd.Parameters.Add($p)
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@id';       $p.Value = [string]$row.id;       [void]$cmd.Parameters.Add($p)
                    $affected = $cmd.ExecuteNonQuery()
                    $stats.boardConfigDomainApplied += $affected
                }
                $txn.Commit()
            } catch {
                try { $txn.Rollback() } catch {}
                throw
            } finally { $txn.Dispose() }
        }

        # ---------------------------------------------------------------
        # PASS 3: Derive careers_url from board_configs.careers_url or
        # resolved_board_url where the company has no careers_url yet.
        # ---------------------------------------------------------------
        $pass3Sql = @"
SELECT co.id, co.display_name,
       COALESCE(NULLIF(bc.careers_url,''), bc.resolved_board_url) AS best_careers_url,
       MAX(CASE bc.confidence_band WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS conf_rank
FROM companies co
JOIN board_configs bc ON bc.normalized_company_name = co.normalized_name
WHERE (bc.careers_url IS NOT NULL AND bc.careers_url != '' OR bc.resolved_board_url IS NOT NULL AND bc.resolved_board_url != '')
  AND (co.careers_url IS NULL OR co.careers_url = '')
GROUP BY co.id
ORDER BY conf_rank DESC
LIMIT $Limit;
"@
        $pass3Rows = @(Invoke-BdSqliteRows -Connection $connection -Sql $pass3Sql)
        if ($pass3Rows.Count -gt 0) {
            $txn = $connection.BeginTransaction()
            try {
                foreach ($row in $pass3Rows) {
                    $bestUrl = [string]$row.best_careers_url
                    if (-not $bestUrl) { continue }
                    $cmd = $connection.CreateCommand()
                    $cmd.Transaction = $txn
                    $cmd.CommandText = @"
UPDATE companies
SET careers_url = @url,
    enrichment_status = CASE WHEN enrichment_status IS NULL OR enrichment_status = '' THEN 'enriched' ELSE enrichment_status END,
    enrichment_source = CASE WHEN enrichment_source IS NULL OR enrichment_source = '' THEN 'board_config' ELSE enrichment_source END,
    enrichment_evidence = CASE WHEN enrichment_evidence IS NULL OR enrichment_evidence = '' THEN 'Careers URL derived from board config' ELSE enrichment_evidence || '; Careers URL from board config' END,
    last_enriched_at = @now,
    next_enrichment_attempt_at = CASE WHEN next_enrichment_attempt_at IS NULL OR next_enrichment_attempt_at = '' THEN @cooldown ELSE next_enrichment_attempt_at END
WHERE id = @id
  AND (careers_url IS NULL OR careers_url = '');
"@
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@url';      $p.Value = $bestUrl;         [void]$cmd.Parameters.Add($p)
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@now';      $p.Value = $now;             [void]$cmd.Parameters.Add($p)
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@cooldown'; $p.Value = $medCooldown;     [void]$cmd.Parameters.Add($p)
                    $p = $cmd.CreateParameter(); $p.ParameterName = '@id';       $p.Value = [string]$row.id;  [void]$cmd.Parameters.Add($p)
                    $affected = $cmd.ExecuteNonQuery()
                    $stats.boardConfigCareersApplied += $affected
                }
                $txn.Commit()
            } catch {
                try { $txn.Rollback() } catch {}
                throw
            } finally { $txn.Dispose() }
        }

        $stats.totalUpdated = $stats.contactEmailDomainApplied + $stats.boardConfigDomainApplied + $stats.boardConfigCareersApplied
        return $stats
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteEnrichmentCoverageReport {
    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection

        $summary = @(Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT
    COUNT(*) AS total_companies,
    SUM(CASE WHEN COALESCE(NULLIF(canonical_domain, ''), '') <> '' THEN 1 ELSE 0 END) AS canonical_domain_count,
    SUM(CASE WHEN COALESCE(NULLIF(careers_url, ''), '') <> '' THEN 1 ELSE 0 END) AS careers_url_count,
    SUM(CASE WHEN COALESCE(NULLIF(aliases_text, ''), '') <> '' THEN 1 ELSE 0 END) AS aliases_count,
    SUM(CASE WHEN COALESCE(NULLIF(enrichment_status, ''), '') IN ('enriched', 'verified', 'manual') THEN 1 ELSE 0 END) AS enriched_count,
    SUM(CASE WHEN COALESCE(NULLIF(enrichment_status, ''), '') NOT IN ('enriched', 'verified', 'manual') THEN 1 ELSE 0 END) AS unenriched_count
FROM companies;
'@ | Select-Object -First 1)

        $coverageSplit = @(Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT
    CASE WHEN COALESCE(NULLIF(c.canonical_domain, ''), '') <> '' OR COALESCE(NULLIF(c.careers_url, ''), '') <> '' THEN 'enriched' ELSE 'unenriched' END AS enrichment_presence,
    COUNT(*) AS total_companies,
    SUM(CASE WHEN COALESCE(bc.has_resolved, 0) = 1 THEN 1 ELSE 0 END) AS resolved_count
FROM companies c
LEFT JOIN (
    SELECT normalized_company_name, MAX(CASE WHEN discovery_status IN ('mapped', 'discovered', 'verified') THEN 1 ELSE 0 END) AS has_resolved
    FROM board_configs
    GROUP BY normalized_company_name
) bc ON bc.normalized_company_name = c.normalized_name
GROUP BY CASE WHEN COALESCE(NULLIF(c.canonical_domain, ''), '') <> '' OR COALESCE(NULLIF(c.careers_url, ''), '') <> '' THEN 'enriched' ELSE 'unenriched' END;
'@)

        $totalCompanies = [int](ConvertTo-BdSqliteNumber $summary.total_companies)
        $enrichedCount = [int](ConvertTo-BdSqliteNumber $summary.enriched_count)
        $coveragePct = if ($totalCompanies -gt 0) { [double][Math]::Round(($enrichedCount / $totalCompanies) * 100, 1) } else { 0 }

        return [ordered]@{
            summary = [ordered]@{
                totalCompanies = $totalCompanies
                canonicalDomainCount = [int](ConvertTo-BdSqliteNumber $summary.canonical_domain_count)
                careersUrlCount = [int](ConvertTo-BdSqliteNumber $summary.careers_url_count)
                aliasesCount = [int](ConvertTo-BdSqliteNumber $summary.aliases_count)
                enrichedCount = $enrichedCount
                unenrichedCount = [int](ConvertTo-BdSqliteNumber $summary.unenriched_count)
                enrichmentCoveragePercent = $coveragePct
            }
            byConfidence = @(
                Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT
    COALESCE(NULLIF(enrichment_confidence, ''), 'unresolved') AS enrichment_confidence,
    COUNT(*) AS count
FROM companies
GROUP BY COALESCE(NULLIF(enrichment_confidence, ''), 'unresolved')
ORDER BY CASE enrichment_confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, enrichment_confidence ASC;
'@ | ForEach-Object {
                    [ordered]@{
                        confidence = [string]$_.enrichment_confidence
                        count = [int](ConvertTo-BdSqliteNumber $_.count)
                    }
                }
            )
            bySource = @(
                Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT
    COALESCE(NULLIF(enrichment_source, ''), 'unknown') AS enrichment_source,
    COUNT(*) AS count
FROM companies
GROUP BY COALESCE(NULLIF(enrichment_source, ''), 'unknown')
ORDER BY count DESC, enrichment_source ASC;
'@ | ForEach-Object {
                    [ordered]@{
                        source = [string]$_.enrichment_source
                        count = [int](ConvertTo-BdSqliteNumber $_.count)
                    }
                }
            )
            resolutionByEnrichmentPresence = @(
                foreach ($row in @($coverageSplit)) {
                    $rowTotal = [int](ConvertTo-BdSqliteNumber $row.total_companies)
                    $resolved = [int](ConvertTo-BdSqliteNumber $row.resolved_count)
                    [ordered]@{
                        enrichmentPresence = [string]$row.enrichment_presence
                        totalCompanies = $rowTotal
                        resolvedCount = $resolved
                        coveragePercent = if ($rowTotal -gt 0) { [double][Math]::Round(($resolved / $rowTotal) * 100, 1) } else { 0 }
                    }
                }
            )
            topUnresolvedReasons = @(
                @(
                    [ordered]@{ reason = 'No domain'; count = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $connection -Sql "SELECT COUNT(*) FROM companies WHERE COALESCE(NULLIF(canonical_domain, ''), '') = '';")) }
                    [ordered]@{ reason = 'No careers page'; count = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $connection -Sql "SELECT COUNT(*) FROM companies WHERE COALESCE(NULLIF(canonical_domain, ''), '') <> '' AND COALESCE(NULLIF(careers_url, ''), '') = '';")) }
                    [ordered]@{ reason = 'Custom careers site'; count = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $connection -Sql "SELECT COUNT(*) FROM companies c JOIN board_configs bc ON bc.normalized_company_name = c.normalized_name WHERE COALESCE(NULLIF(c.careers_url, ''), '') <> '' AND bc.discovery_status = 'no_match_supported_ats';")) }
                    [ordered]@{ reason = 'Unsupported ATS'; count = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $connection -Sql "SELECT COUNT(*) FROM board_configs WHERE COALESCE(NULLIF(ats_type, ''), '') <> '' AND supported_import = 0;")) }
                    [ordered]@{ reason = 'Blocked or timeout'; count = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $connection -Sql "SELECT COUNT(*) FROM board_configs WHERE LOWER(COALESCE(failure_reason, '')) LIKE '%timed out%' OR LOWER(COALESCE(failure_reason, '')) LIKE '%timeout%' OR LOWER(COALESCE(failure_reason, '')) LIKE '%forbidden%' OR LOWER(COALESCE(failure_reason, '')) LIKE '%blocked%';")) }
                    [ordered]@{ reason = 'Ambiguous match'; count = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $connection -Sql "SELECT COUNT(*) FROM board_configs WHERE COALESCE(NULLIF(confidence_band, ''), '') IN ('medium', 'low');")) }
                ) | Sort-Object @{ Expression = { [int]$_.count }; Descending = $true }, @{ Expression = { [string]$_.reason }; Descending = $false }
            )
            history = @(
                Invoke-BdSqliteRows -Connection $connection -Sql @'
SELECT *
FROM enrichment_coverage_history
ORDER BY captured_at DESC
LIMIT 14;
'@ | ForEach-Object {
                    [ordered]@{
                        capturedAt = [string]$_.captured_at
                        dataRevision = [string]$_.data_revision
                        totalCompanies = [int](ConvertTo-BdSqliteNumber $_.total_companies)
                        canonicalDomainCount = [int](ConvertTo-BdSqliteNumber $_.canonical_domain_count)
                        careersUrlCount = [int](ConvertTo-BdSqliteNumber $_.careers_url_count)
                        aliasesCount = [int](ConvertTo-BdSqliteNumber $_.aliases_count)
                        enrichedCount = [int](ConvertTo-BdSqliteNumber $_.enriched_count)
                        unenrichedCount = [int](ConvertTo-BdSqliteNumber $_.unenriched_count)
                        resolutionWithEnrichmentCount = [int](ConvertTo-BdSqliteNumber $_.resolution_with_enrichment_count)
                        resolutionWithoutEnrichmentCount = [int](ConvertTo-BdSqliteNumber $_.resolution_without_enrichment_count)
                        coveragePercent = [double](ConvertTo-BdSqliteNumber $_.coverage_pct)
                    }
                }
            )
        }
    } finally {
        $connection.Dispose()
    }
}

function Find-BdSqliteEnrichmentQueue {
    param([hashtable]$Query)

    $connection = Open-BdSqliteConnection
    try {
        $whereClauses = New-Object System.Collections.ArrayList
        $parameters = @{}
        $statusQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'status')
        $confidenceQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'confidence')
        $forceRefresh = [string](Get-BdSqliteQueryValue -Query $Query -Name 'forceRefresh')
        $missingDomain = [string](Get-BdSqliteQueryValue -Query $Query -Name 'missingDomain')
        $missingCareersUrl = [string](Get-BdSqliteQueryValue -Query $Query -Name 'missingCareersUrl')
        $hasConnections = [string](Get-BdSqliteQueryValue -Query $Query -Name 'hasConnections')
        $minTargetScore = [string](Get-BdSqliteQueryValue -Query $Query -Name 'minTargetScore')
        $topN = [string](Get-BdSqliteQueryValue -Query $Query -Name 'topN')
        $pageQuery = Get-BdSqliteQueryValue -Query $Query -Name 'page'
        $pageSizeQuery = Get-BdSqliteQueryValue -Query $Query -Name 'pageSize'

        [void]$whereClauses.Add("(COALESCE(NULLIF(canonical_domain, ''), '') = '' OR COALESCE(NULLIF(careers_url, ''), '') = '' OR COALESCE(NULLIF(enrichment_status, ''), '') NOT IN ('enriched', 'verified', 'manual') OR COALESCE(NULLIF(enrichment_confidence, ''), 'unresolved') IN ('medium', 'low', 'unresolved'))")
        if ($statusQuery) {
            [void]$whereClauses.Add("COALESCE(NULLIF(enrichment_status, ''), 'missing_inputs') = @status")
            $parameters.status = $statusQuery
        }
        if ($confidenceQuery) {
            [void]$whereClauses.Add("COALESCE(NULLIF(enrichment_confidence, ''), 'unresolved') = @confidence")
            $parameters.confidence = $confidenceQuery
        }
        if ($missingDomain -eq 'true') {
            [void]$whereClauses.Add("COALESCE(NULLIF(canonical_domain, ''), '') = ''")
        }
        if ($missingCareersUrl -eq 'true') {
            [void]$whereClauses.Add("COALESCE(NULLIF(careers_url, ''), '') = ''")
        }
        if ($hasConnections -eq 'true') {
            [void]$whereClauses.Add("COALESCE(connection_count, 0) > 0")
        }
        if ($minTargetScore) {
            [void]$whereClauses.Add("COALESCE(target_score, 0) >= @minTargetScore")
            $parameters.minTargetScore = [double]$minTargetScore
        }
        if ($forceRefresh -ne 'true') {
            [void]$whereClauses.Add("(next_enrichment_attempt_at IS NULL OR next_enrichment_attempt_at = '' OR next_enrichment_attempt_at <= @now)")
            $parameters.now = (Get-Date).ToString('o')
        }

        $companyCols = ($script:CompanySummaryColumns -split ',\s*' | ForEach-Object { "companies.$_" }) -join ', '
        $selectColumns = @"
$companyCols,
cfg.config_id AS primary_config_id,
cfg.discovery_status AS config_discovery_status,
cfg.review_status AS config_review_status,
cfg.ats_type AS config_ats_type
"@

        $fromSql = @'
companies
LEFT JOIN (
    SELECT
        normalized_company_name,
        MIN(id) AS config_id,
        MAX(discovery_status) AS discovery_status,
        MAX(review_status) AS review_status,
        MAX(ats_type) AS ats_type
    FROM board_configs
    GROUP BY normalized_company_name
) cfg ON cfg.normalized_company_name = companies.normalized_name
'@

        $whereSql = if ($whereClauses.Count -gt 0) { ' WHERE ' + ([string]::Join(' AND ', @($whereClauses))) } else { '' }
        $countSql = "SELECT COUNT(*) FROM $fromSql$whereSql;"
        $total = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $connection -Sql $countSql -Parameters $parameters))

        # topN overrides pagination and caps result set
        if ($topN) {
            $effectivePageSize = [int]$topN
            $pageSpec = @{ page = 1; pageSize = $effectivePageSize; offset = 0 }
        } else {
            $pageSpec = Get-BdSqlitePageSpec -Query @{ page = $pageQuery; pageSize = $pageSizeQuery } -DefaultPageSize 20
        }
        $parameters.limit = $pageSpec.pageSize
        $parameters.offset = $pageSpec.offset

        $sql = "SELECT $selectColumns FROM $fromSql$whereSql ORDER BY COALESCE(target_score, 0) DESC, COALESCE(hiring_velocity, 0) DESC, COALESCE(engagement_score, 0) DESC, CASE WHEN COALESCE(NULLIF(canonical_domain, ''), '') = '' AND COALESCE(NULLIF(careers_url, ''), '') = '' THEN 1 WHEN COALESCE(NULLIF(canonical_domain, ''), '') = '' OR COALESCE(NULLIF(careers_url, ''), '') = '' THEN 2 WHEN COALESCE(NULLIF(enrichment_confidence, ''), 'unresolved') = 'unresolved' THEN 3 WHEN COALESCE(NULLIF(enrichment_confidence, ''), 'unresolved') = 'low' THEN 4 ELSE 5 END, COALESCE(last_enriched_at, '') ASC, display_name ASC LIMIT @limit OFFSET @offset;"
        $rows = @(Invoke-BdSqliteRows -Connection $connection -Sql $sql -Parameters $parameters)

        $items = @(
            foreach ($row in @($rows)) {
                $summary = Convert-BdSqliteCompanyRowToSummary $row
                $summary.primaryConfigId = [string]$row.primary_config_id
                $summary.configDiscoveryStatus = [string]$row.config_discovery_status
                $summary.configReviewStatus = [string]$row.config_review_status
                $summary.configAtsType = [string]$row.config_ats_type
                $summary.reviewReason = if (-not $summary.canonicalDomain -and -not $summary.careersUrl) {
                    'Missing domain and careers URL'
                } elseif (-not $summary.canonicalDomain) {
                    'Missing canonical domain'
                } elseif (-not $summary.careersUrl) {
                    'Missing careers URL'
                } elseif ($summary.enrichmentFailureReason) {
                    $summary.enrichmentFailureReason
                } else {
                    'Needs enrichment verification'
                }
                $summary
            }
        )

        return [ordered]@{
            page = $pageSpec.page
            pageSize = $pageSpec.pageSize
            total = $total
            items = $items
        }
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteEnrichmentCandidateCompanyIds {
    param(
        [int]$Limit = 50,
        [string]$AccountId = '',
        [switch]$ForceRefresh
    )

    $connection = Open-BdSqliteConnection
    try {
        $whereClauses = New-Object System.Collections.ArrayList
        $parameters = @{ limit = if ($Limit -gt 0) { $Limit } else { 50 } }
        if ($AccountId) {
            [void]$whereClauses.Add('id = @accountId')
            $parameters.accountId = $AccountId
        } else {
            [void]$whereClauses.Add("(COALESCE(NULLIF(canonical_domain, ''), '') = '' OR COALESCE(NULLIF(careers_url, ''), '') = '' OR COALESCE(NULLIF(enrichment_status, ''), '') NOT IN ('enriched', 'verified', 'manual') OR COALESCE(NULLIF(enrichment_confidence, ''), 'unresolved') IN ('medium', 'low', 'unresolved'))")
        }
        if (-not $ForceRefresh) {
            [void]$whereClauses.Add("(next_enrichment_attempt_at IS NULL OR next_enrichment_attempt_at = '' OR next_enrichment_attempt_at <= @now)")
            $parameters.now = (Get-Date).ToString('o')
        }

        $whereSql = if ($whereClauses.Count -gt 0) { ' WHERE ' + ([string]::Join(' AND ', @($whereClauses))) } else { '' }
        return @(
            (Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT id FROM companies{0} ORDER BY COALESCE(target_score, 0) DESC, COALESCE(hiring_velocity, 0) DESC, COALESCE(engagement_score, 0) DESC, CASE WHEN COALESCE(NULLIF(canonical_domain, ''), '') = '' AND COALESCE(NULLIF(careers_url, ''), '') = '' THEN 1 WHEN COALESCE(NULLIF(canonical_domain, ''), '') = '' OR COALESCE(NULLIF(careers_url, ''), '') = '' THEN 2 WHEN COALESCE(NULLIF(enrichment_confidence, ''), 'unresolved') = 'unresolved' THEN 3 WHEN COALESCE(NULLIF(enrichment_confidence, ''), 'unresolved') = 'low' THEN 4 ELSE 5 END, COALESCE(last_enriched_at, '') ASC LIMIT @limit;" -f $whereSql) -Parameters $parameters) |
                ForEach-Object { [string]$_.id }
        )
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteDiscoveryCandidateConfigIds {
    param(
        [int]$Limit = 75,
        [string]$ConfigId = '',
        [switch]$OnlyMissing,
        [switch]$ForceRefresh
    )

    $connection = Open-BdSqliteConnection
    try {
        $whereClauses = New-Object System.Collections.ArrayList
        $parameters = @{ limit = if ($Limit -gt 0) { $Limit } else { 75 } }

        if ($ConfigId) {
            [void]$whereClauses.Add('bc.id = @configId')
            $parameters.configId = $ConfigId
        } elseif ($OnlyMissing) {
            [void]$whereClauses.Add("((COALESCE(NULLIF(bc.discovery_status, ''), 'missing_inputs') NOT IN ('mapped', 'discovered', 'verified')) OR (COALESCE(NULLIF(bc.confidence_band, ''), 'unresolved') IN ('medium', 'low', 'unresolved')))")
        }
        if (-not $ForceRefresh) {
            [void]$whereClauses.Add("(bc.next_resolution_attempt_at IS NULL OR bc.next_resolution_attempt_at = '' OR bc.next_resolution_attempt_at <= @now)")
            $parameters.now = (Get-Date).ToString('o')
        }

        $whereSql = if ($whereClauses.Count -gt 0) { ' WHERE ' + ([string]::Join(' AND ', @($whereClauses))) } else { '' }
        return @(
            (Invoke-BdSqliteRows -Connection $connection -Sql ("SELECT bc.id FROM board_configs bc LEFT JOIN companies c ON c.normalized_name = bc.normalized_company_name{0} ORDER BY COALESCE(c.target_score, 0) DESC, COALESCE(c.hiring_velocity, 0) DESC, COALESCE(c.engagement_score, 0) DESC, CASE WHEN COALESCE(NULLIF(c.canonical_domain, ''), '') = '' AND COALESCE(NULLIF(c.careers_url, ''), '') = '' THEN 1 WHEN COALESCE(NULLIF(c.canonical_domain, ''), '') = '' OR COALESCE(NULLIF(c.careers_url, ''), '') = '' THEN 2 WHEN COALESCE(NULLIF(bc.confidence_band, ''), 'unresolved') = 'unresolved' THEN 3 WHEN COALESCE(NULLIF(bc.confidence_band, ''), 'unresolved') = 'low' THEN 4 WHEN COALESCE(NULLIF(bc.confidence_band, ''), 'unresolved') = 'medium' THEN 5 ELSE 6 END, COALESCE(bc.last_resolution_attempt_at, '') ASC, bc.company_name ASC LIMIT @limit;" -f $whereSql) -Parameters $parameters) |
                ForEach-Object { [string]$_.id }
        )
    } finally {
        $connection.Dispose()
    }
}

function Find-BdSqliteActivity {
    param([hashtable]$Query)

    $connection = Open-BdSqliteConnection
    try {
        $whereClauses = New-Object System.Collections.ArrayList
        $parameters = @{}
        $accountIdQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'accountId')
        $pageQuery = Get-BdSqliteQueryValue -Query $Query -Name 'page'
        $pageSizeQuery = Get-BdSqliteQueryValue -Query $Query -Name 'pageSize'

        if ($accountIdQuery) {
            [void]$whereClauses.Add('account_id = @accountId')
            $parameters.accountId = $accountIdQuery
        }

        $result = Invoke-BdSqlitePagedSelect -Connection $connection -TableName 'activities' -SelectColumns '*' -WhereClauses @($whereClauses) -Parameters $parameters -OrderBy 'occurred_at DESC' -Page ([int](ConvertTo-BdSqliteNumber $pageQuery)) -PageSize ([int](ConvertTo-BdSqliteNumber $pageSizeQuery))
        $result.items = @($result.items | ForEach-Object { Convert-BdSqliteActivityRowToSummary $_ })
        return $result
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteDashboardModelInternal {
    param(
        [Parameter(Mandatory = $true)]
        [System.Data.SQLite.SQLiteConnection]$Connection,
        [System.Collections.IDictionary]$TimingBag
    )

    $settings = Invoke-BdSqliteTimedStep -Name 'settingsLoadMs' -TimingBag $TimingBag -Action {
        ConvertFrom-BdSqliteJsonText (Get-BdSqliteMetaValue -Connection $Connection -Key 'settings_json')
    }
    if (-not $settings) {
        $settings = [ordered]@{
            minCompanyConnections = 3
            minJobsPosted = 2
            maxCompaniesToReview = 25
        }
    }

    $minConnections = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $settings -Name 'minCompanyConnections' -Default 3))
    $minJobs = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $settings -Name 'minJobsPosted' -Default 2))
    $maxCompanies = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $settings -Name 'maxCompaniesToReview' -Default 25))
    if ($maxCompanies -lt 1) { $maxCompanies = 25 }

    $summary = Invoke-BdSqliteTimedStep -Name 'summaryMs' -TimingBag $TimingBag -Action {
        [ordered]@{
            accountCount = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $Connection -Sql 'SELECT COUNT(*) FROM companies;'))
            hiringAccountCount = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $Connection -Sql 'SELECT COUNT(*) FROM companies WHERE job_count > 0;'))
            contactCount = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $Connection -Sql 'SELECT COUNT(*) FROM contacts;'))
            jobCount = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $Connection -Sql 'SELECT COUNT(*) FROM jobs;'))
            newJobsLast24h = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $Connection -Sql 'SELECT COUNT(*) FROM jobs WHERE imported_at IS NOT NULL AND imported_at >= @cutoff;' -Parameters @{ cutoff = (Get-Date).AddHours(-24).ToString('o') }))
            staleAccountCount = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $Connection -Sql "SELECT COUNT(*) FROM companies WHERE stale_flag = 'STALE';"))
            discoveredBoardCount = [int](ConvertTo-BdSqliteNumber (Invoke-BdSqliteScalar -Connection $Connection -Sql "SELECT COUNT(*) FROM board_configs WHERE discovery_status IN ('mapped', 'discovered');"))
        }
    }
    $todayQueue = Invoke-BdSqliteTimedStep -Name 'todayQueueMs' -TimingBag $TimingBag -Action {
        @((Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT $($script:CompanySummaryColumns) FROM companies WHERE status NOT IN ('paused', 'client') AND connection_count >= @minConnections AND job_count >= @minJobs ORDER BY target_score DESC, hiring_velocity DESC, engagement_score DESC LIMIT @limit;" -Parameters @{ minConnections = $minConnections; minJobs = $minJobs; limit = $maxCompanies }) | Select-Object -First 10 | ForEach-Object { Convert-BdSqliteCompanyRowToSummary $_ })
    }
    $newJobsToday = Invoke-BdSqliteTimedStep -Name 'newJobsTodayMs' -TimingBag $TimingBag -Action {
        @((Invoke-BdSqliteRows -Connection $Connection -Sql 'SELECT * FROM jobs WHERE imported_at IS NOT NULL AND imported_at >= @cutoff ORDER BY COALESCE(retrieved_at, imported_at) DESC, posted_at DESC LIMIT 12;' -Parameters @{ cutoff = (Get-Date).AddHours(-24).ToString('o') }) | ForEach-Object { Convert-BdSqliteJobRowToSummary $_ })
    }
    $recentlyDiscoveredBoards = Invoke-BdSqliteTimedStep -Name 'recentlyDiscoveredBoardsMs' -TimingBag $TimingBag -Action {
        @((Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT * FROM board_configs WHERE last_checked_at IS NOT NULL AND discovery_status IN ('mapped', 'discovered') ORDER BY last_checked_at DESC LIMIT 8;") | ForEach-Object { Convert-BdSqliteConfigRowToSummary $_ })
    }
    $followUpAccounts = Invoke-BdSqliteTimedStep -Name 'followUpAccountsMs' -TimingBag $TimingBag -Action {
        @((Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT $($script:CompanySummaryColumns) FROM companies WHERE status NOT IN ('client', 'paused') AND ((next_action_at IS NOT NULL AND next_action_at <= @nextActionCutoff) OR stale_flag = 'STALE' OR follow_up_score > 0) ORDER BY follow_up_score DESC, target_score DESC, hiring_velocity DESC LIMIT 8;" -Parameters @{ nextActionCutoff = (Get-Date).AddDays(2).ToString('o') }) | ForEach-Object { Convert-BdSqliteCompanyRowToSummary $_ })
    }
    $networkLeaders = Invoke-BdSqliteTimedStep -Name 'networkLeadersMs' -TimingBag $TimingBag -Action {
        @((Invoke-BdSqliteRows -Connection $Connection -Sql "SELECT $($script:CompanySummaryColumns) FROM companies ORDER BY connection_count DESC, target_score DESC, hiring_velocity DESC LIMIT 8;") | ForEach-Object { Convert-BdSqliteCompanyRowToSummary $_ })
    }
    $recommendedActions = Invoke-BdSqliteTimedStep -Name 'recommendedActionsMs' -TimingBag $TimingBag -Action {
        @((Invoke-BdSqliteRows -Connection $Connection -Sql 'SELECT id, display_name, recommended_action, target_score, outreach_status FROM companies ORDER BY target_score DESC, hiring_velocity DESC, engagement_score DESC LIMIT 8;') | ForEach-Object {
                [ordered]@{
                    accountId = [string]$_.id
                    company = [string]$_.display_name
                    text = [string]$_.recommended_action
                    score = [int](ConvertTo-BdSqliteNumber $_.target_score)
                    outreachStatus = [string]$_.outreach_status
                }
            })
    }

    return [ordered]@{
        summary = $summary
        todayQueue = $todayQueue
        newJobsToday = $newJobsToday
        recentlyDiscoveredBoards = $recentlyDiscoveredBoards
        followUpAccounts = $followUpAccounts
        networkLeaders = $networkLeaders
        recommendedActions = $recommendedActions
    }
}

function Get-BdSqliteDashboardModel {
    $connection = Open-BdSqliteConnection
    try {
        return (Get-BdSqliteDashboardModelInternal -Connection $connection)
    } finally {
        $connection.Dispose()
    }
}

function Update-BdSqliteSnapshots {
    param(
        [string]$DataRevision,
        [ValidateSet('dashboard', 'filters')]
        [string[]]$Names = @('filters', 'dashboard')
    )

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        if (-not $DataRevision) {
            $DataRevision = Get-BdSqliteDataRevision -Connection $connection
        }

        $requestedNames = @($Names | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
        if ($requestedNames.Count -eq 0) {
            $requestedNames = @('filters', 'dashboard')
        }

        $filterSnapshot = $null
        $dashboardSnapshot = $null
        $filterTimings = [ordered]@{}
        $dashboardTimings = [ordered]@{}
        $saveTimings = [ordered]@{}

        if ($requestedNames -contains 'filters') {
            $filterSnapshot = Measure-BdSqliteSnapshotBuild -Builder {
                Get-BdSqliteFilterOptionsInternal -Connection $connection -TimingBag $filterTimings
            }
            $filterSaveStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                Save-BdSqliteSnapshotRecord -Connection $connection -Name 'filters' -Payload $filterSnapshot.payload -SourceRevision $DataRevision -BuildMs $filterSnapshot.buildMs
            } finally {
                $filterSaveStopwatch.Stop()
            }
            $saveTimings.filtersSaveMs = [int]$filterSaveStopwatch.ElapsedMilliseconds
        }

        if ($requestedNames -contains 'dashboard') {
            $dashboardSnapshot = Measure-BdSqliteSnapshotBuild -Builder {
                Get-BdSqliteDashboardModelInternal -Connection $connection -TimingBag $dashboardTimings
            }
            $dashboardSaveStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                Save-BdSqliteSnapshotRecord -Connection $connection -Name 'dashboard' -Payload $dashboardSnapshot.payload -SourceRevision $DataRevision -BuildMs $dashboardSnapshot.buildMs
            } finally {
                $dashboardSaveStopwatch.Stop()
            }
            $saveTimings.dashboardSaveMs = [int]$dashboardSaveStopwatch.ElapsedMilliseconds
        }

        Set-BdSqliteSnapshotDirtyState -Connection $connection -Names $requestedNames -IsDirty:$false -Reason '' -DataRevision $DataRevision

        return [ordered]@{
            ok = $true
            dataRevision = $DataRevision
            names = @($requestedNames)
            filtersBuildMs = if ($filterSnapshot) { [int]$filterSnapshot.buildMs } else { 0 }
            dashboardBuildMs = if ($dashboardSnapshot) { [int]$dashboardSnapshot.buildMs } else { 0 }
            details = [ordered]@{
                filters = if ($filterSnapshot) { $filterTimings } else { $null }
                dashboard = if ($dashboardSnapshot) { $dashboardTimings } else { $null }
                saves = $saveTimings
            }
            updatedAt = (Get-Date).ToString('o')
        }
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteSnapshotResult {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('dashboard', 'filters')]
        [string]$Name
    )

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        $dataRevision = Get-BdSqliteDataRevision -Connection $connection
        $record = Get-BdSqliteSnapshotRecord -Connection $connection -Name $Name
        $dirtyState = Get-BdSqliteSnapshotDirtyState -Connection $connection -Name $Name
        $snapshotAgeSeconds = if ($record) { Get-BdSqliteSnapshotAgeSeconds -UpdatedAt $record.updatedAt } else { $null }
        $ttlSeconds = Get-BdSqliteSnapshotTtlSeconds -Name $Name
        $isExpired = ($ttlSeconds -gt 0 -and $snapshotAgeSeconds -ne $null -and $snapshotAgeSeconds -gt $ttlSeconds)
        $loadFailed = ($record -and $record.payloadError)
        $revisionMatch = ($record -and $record.sourceRevision -eq $dataRevision)
        $hasUsablePayload = ($record -and $null -ne $record.payload -and -not $loadFailed)

        if ($hasUsablePayload -and $revisionMatch -and -not $isExpired -and -not $dirtyState.isDirty) {
            return [ordered]@{
                payload = $record.payload
                source = 'snapshot'
                hit = $true
                snapshotAgeSeconds = $snapshotAgeSeconds
                rebuildDurationMs = [int]$record.buildMs
                sourceRevision = $dataRevision
                dirty = $false
                dirtyReason = ''
            }
        }

        if ($hasUsablePayload -and -not $isExpired -and -not $dirtyState.isDirty) {
            return [ordered]@{
                payload = $record.payload
                source = 'stale_snapshot'
                hit = $true
                snapshotAgeSeconds = $snapshotAgeSeconds
                rebuildDurationMs = [int]$record.buildMs
                sourceRevision = [string]$record.sourceRevision
                currentRevision = $dataRevision
                dirty = $false
                dirtyReason = ''
            }
        }

        $buildTimings = [ordered]@{}
        $build = Measure-BdSqliteSnapshotBuild -Builder {
            switch ($Name) {
                'dashboard' { Get-BdSqliteDashboardModelInternal -Connection $connection -TimingBag $buildTimings }
                'filters' { Get-BdSqliteFilterOptionsInternal -Connection $connection -TimingBag $buildTimings }
            }
        }

        $saveStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            Save-BdSqliteSnapshotRecord -Connection $connection -Name $Name -Payload $build.payload -SourceRevision $dataRevision -BuildMs $build.buildMs
            Set-BdSqliteSnapshotDirtyState -Connection $connection -Names @($Name) -IsDirty:$false -Reason '' -DataRevision $dataRevision
        } catch {
        } finally {
            $saveStopwatch.Stop()
        }

        return [ordered]@{
            payload = $build.payload
            source = $(if ($loadFailed) { 'fallback_live' } else { 'live_rebuild' })
            hit = $false
            snapshotAgeSeconds = $snapshotAgeSeconds
            rebuildDurationMs = [int]$build.buildMs
            sourceRevision = $dataRevision
            dirty = $false
            dirtyReason = [string]$dirtyState.reason
            details = [ordered]@{
                build = $buildTimings
                saveMs = [int]$saveStopwatch.ElapsedMilliseconds
            }
        }
    } catch {
        $message = $_.Exception.Message
        $fallbackPayload = switch ($Name) {
            'dashboard' { Get-BdSqliteDashboardModel }
            'filters' { Get-BdSqliteFilterOptions }
        }

        return [ordered]@{
            payload = $fallbackPayload
            source = 'fallback_live'
            hit = $false
            snapshotAgeSeconds = $null
            rebuildDurationMs = $null
            sourceRevision = ''
            error = $message
        }
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteDashboardSnapshotResult {
    return (Get-BdSqliteSnapshotResult -Name 'dashboard')
}

function Get-BdSqliteFilterSnapshotResult {
    return (Get-BdSqliteSnapshotResult -Name 'filters')
}

function Get-BdSqliteAccountDetail {
    param([string]$AccountId)

    $connection = Open-BdSqliteConnection
    try {
        $accountRow = @(Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT * FROM companies WHERE id = @id LIMIT 1;' -Parameters @{ id = $AccountId } | Select-Object -First 1)
        if (-not $accountRow) {
            return $null
        }

        $accountRecord = ConvertFrom-BdSqliteJsonText $accountRow.data_json
        $configs = @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT * FROM board_configs WHERE account_id = @accountId OR normalized_company_name = @normalizedName ORDER BY company_name ASC;' -Parameters @{ accountId = $AccountId; normalizedName = $accountRow.normalized_name }) | ForEach-Object { Convert-BdSqliteConfigRowToSummary $_ })
        $contacts = @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT * FROM contacts WHERE account_id = @accountId OR normalized_company_name = @normalizedName ORDER BY priority_score DESC LIMIT 20;' -Parameters @{ accountId = $AccountId; normalizedName = $accountRow.normalized_name }) | ForEach-Object { Convert-BdSqliteContactRowToSummary $_ })
        $jobs = @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT * FROM jobs WHERE account_id = @accountId OR normalized_company_name = @normalizedName ORDER BY posted_at DESC LIMIT 20;' -Parameters @{ accountId = $AccountId; normalizedName = $accountRow.normalized_name }) | ForEach-Object {
                $summary = Convert-BdSqliteJobRowToSummary $_
                $jobRecord = ConvertFrom-BdSqliteJsonText ([string]$_.data_json)
                $summary.rawPayload = Get-BdSqliteRecordValue -Record $jobRecord -Name 'rawPayload' -Default $null
                $summary
            })
        $activity = @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT * FROM activities WHERE account_id = @accountId OR normalized_company_name = @normalizedName ORDER BY occurred_at DESC LIMIT 12;' -Parameters @{ accountId = $AccountId; normalizedName = $accountRow.normalized_name }) | ForEach-Object { Convert-BdSqliteActivityRowToSummary $_ })

        $summary = Convert-BdSqliteCompanyRowToSummary $accountRow
        $summary.industry = [string](Get-BdSqliteRecordValue -Record $accountRecord -Name 'industry')
        $summary.location = [string](Get-BdSqliteRecordValue -Record $accountRecord -Name 'location')
        $summary.notes = [string](Get-BdSqliteRecordValue -Record $accountRecord -Name 'notes')
        $summary.tags = @(Get-BdSqliteStringList (Get-BdSqliteRecordValue -Record $accountRecord -Name 'tags'))
        $summary.enrichmentAttemptedUrls = @(Get-BdSqliteStringList (Get-BdSqliteRecordValue -Record $accountRecord -Name 'enrichmentAttemptedUrls'))
        $summary.enrichmentHttpSummary = ConvertTo-BdSqlitePlainObject (Get-BdSqliteRecordValue -Record $accountRecord -Name 'enrichmentHttpSummary' -Default @())
        $summary.priorityTier = [string](Get-BdSqliteRecordValue -Record $accountRecord -Name 'priorityTier')
        $summary.departmentFocusCount = [int](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $accountRecord -Name 'departmentFocusCount'))
        $summary.departmentConcentration = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $accountRecord -Name 'departmentConcentration'))
        $summary.hiringSpikeScore = [double](ConvertTo-BdSqliteNumber (Get-BdSqliteRecordValue -Record $accountRecord -Name 'hiringSpikeScore'))
        $summary.scoreBreakdown = ConvertTo-BdSqlitePlainObject (Get-BdSqliteRecordValue -Record $accountRecord -Name 'scoreBreakdown' -Default ([ordered]@{}))
        $summary.targetScoreExplanation = ConvertTo-BdSqlitePlainObject (Get-BdSqliteRecordValue -Record $accountRecord -Name 'targetScoreExplanation' -Default ([ordered]@{}))
        $summary.companyGrowthSignalSummary = [string](Get-BdSqliteRecordValue -Record $accountRecord -Name 'companyGrowthSignalSummary' -Default '')
        $summary.engagementSummary = [string](Get-BdSqliteRecordValue -Record $accountRecord -Name 'engagementSummary' -Default '')
        $summary.lastContactedAt = Get-BdSqliteRecordValue -Record $accountRecord -Name 'lastContactedAt'

        return [ordered]@{
            account = $summary
            contacts = $contacts
            jobs = $jobs
            activity = $activity
            configs = $configs
            stats = [ordered]@{
                contactCount = [int](ConvertTo-BdSqliteNumber $accountRow.connection_count)
                jobCount = [int](ConvertTo-BdSqliteNumber $accountRow.open_role_count)
                configCount = @($configs).Count
            }
        }
    } finally {
        $connection.Dispose()
    }
}

function Find-BdSqliteSearchResults {
    param([string]$Query)

    if ([string]::IsNullOrWhiteSpace($Query)) {
        return [ordered]@{
            accounts = @()
            contacts = @()
            jobs = @()
        }
    }

    $needle = '%' + (Normalize-BdSqliteText $Query) + '%'
    $connection = Open-BdSqliteConnection
    try {
        return [ordered]@{
            accounts = @((Invoke-BdSqliteRows -Connection $connection -Sql "SELECT $($script:CompanySummaryColumns) FROM companies WHERE search_text LIKE @search ORDER BY target_score DESC, hiring_velocity DESC, engagement_score DESC LIMIT 5;" -Parameters @{ search = $needle }) | ForEach-Object { Convert-BdSqliteCompanyRowToSummary $_ })
            contacts = @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT * FROM contacts WHERE search_text LIKE @search ORDER BY priority_score DESC LIMIT 5;' -Parameters @{ search = $needle }) | ForEach-Object { Convert-BdSqliteContactRowToSummary $_ })
            jobs = @((Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT * FROM jobs WHERE search_text LIKE @search ORDER BY posted_at DESC LIMIT 5;' -Parameters @{ search = $needle }) | ForEach-Object { Convert-BdSqliteJobRowToSummary $_ })
        }
    } finally {
        $connection.Dispose()
    }
}

function Convert-BdSqliteBackgroundJobRowToSummary {
    param($Row)

    $result = $null
    if ($Row.result_json) {
        try {
            $result = ConvertFrom-BdSqliteJsonText ([string]$Row.result_json)
        } catch {
            $result = $null
        }
    }

    return [ordered]@{
        id = [string]$Row.id
        type = [string]$Row.job_type
        status = [string]$Row.status
        summary = [string]$Row.summary_text
        queuedAt = [string]$Row.queued_at
        startedAt = [string]$Row.started_at
        finishedAt = [string]$Row.finished_at
        updatedAt = [string]$Row.updated_at
        progressMessage = [string]$Row.progress_message
        errorMessage = [string]$Row.error_message
        recordsAffected = [int](ConvertTo-BdSqliteNumber $Row.records_affected)
        cancelRequested = [bool](ConvertTo-BdSqliteNumber $Row.cancel_requested)
        result = $result
    }
}

function Add-BdSqliteBackgroundJob {
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

    $queuedAt = (Get-Date).ToString('o')
    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        Invoke-BdSqliteNonQuery -Connection $connection -Sql @'
INSERT INTO background_jobs(
    id,
    job_type,
    status,
    summary_text,
    queued_at,
    updated_at,
    progress_message,
    error_message,
    records_affected,
    cancel_requested,
    payload_json,
    result_json
)
VALUES (
    @id,
    @jobType,
    @status,
    @summaryText,
    @queuedAt,
    @updatedAt,
    @progressMessage,
    @errorMessage,
    @recordsAffected,
    @cancelRequested,
    @payloadJson,
    @resultJson
);
'@ -Parameters @{
            id = $JobId
            jobType = $JobType
            status = 'queued'
            summaryText = $Summary
            queuedAt = $queuedAt
            updatedAt = $queuedAt
            progressMessage = $ProgressMessage
            errorMessage = ''
            recordsAffected = 0
            cancelRequested = 0
            payloadJson = (ConvertTo-BdSqliteJsonText $Payload)
            resultJson = $null
        } | Out-Null

        return (Get-BdSqliteBackgroundJob -JobId $JobId)
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteBackgroundJob {
    param(
        [Parameter(Mandatory = $true)]
        [string]$JobId
    )

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        $row = @(Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT * FROM background_jobs WHERE id = @id LIMIT 1;' -Parameters @{ id = $JobId } | Select-Object -First 1)
        if (-not $row) {
            return $null
        }

        return (Convert-BdSqliteBackgroundJobRowToSummary -Row $row)
    } finally {
        $connection.Dispose()
    }
}

function Get-BdSqliteBackgroundJobPayload {
    param(
        [Parameter(Mandatory = $true)]
        [string]$JobId
    )

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        $row = @(Invoke-BdSqliteRows -Connection $connection -Sql 'SELECT payload_json FROM background_jobs WHERE id = @id LIMIT 1;' -Parameters @{ id = $JobId } | Select-Object -First 1)
        if (-not $row) {
            return $null
        }

        return (ConvertFrom-BdSqliteJsonText ([string]$row.payload_json))
    } finally {
        $connection.Dispose()
    }
}

function Find-BdSqliteBackgroundJobs {
    param([hashtable]$Query)

    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        $whereClauses = New-Object System.Collections.ArrayList
        $parameters = @{}
        $statusQuery = [string](Get-BdSqliteQueryValue -Query $Query -Name 'status')
        $pageQuery = Get-BdSqliteQueryValue -Query $Query -Name 'page'
        $pageSizeQuery = Get-BdSqliteQueryValue -Query $Query -Name 'pageSize'

        if ($statusQuery) {
            [void]$whereClauses.Add('status = @status')
            $parameters.status = $statusQuery
        }

        $result = Invoke-BdSqlitePagedSelect -Connection $connection -TableName 'background_jobs' -SelectColumns '*' -WhereClauses @($whereClauses) -Parameters $parameters -OrderBy 'updated_at DESC, queued_at DESC' -Page ([int](ConvertTo-BdSqliteNumber $pageQuery)) -PageSize ([int](ConvertTo-BdSqliteNumber $pageSizeQuery))
        $result.items = @($result.items | ForEach-Object { Convert-BdSqliteBackgroundJobRowToSummary -Row $_ })
        return $result
    } finally {
        $connection.Dispose()
    }
}

function Update-BdSqliteBackgroundJobProgress {
    param(
        [Parameter(Mandatory = $true)]
        [string]$JobId,
        [string]$ProgressMessage = ''
    )

    $updatedAt = (Get-Date).ToString('o')
    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        Invoke-BdSqliteNonQuery -Connection $connection -Sql @'
UPDATE background_jobs
SET progress_message = @progressMessage,
    updated_at = @updatedAt
WHERE id = @id;
'@ -Parameters @{
            id = $JobId
            progressMessage = $ProgressMessage
            updatedAt = $updatedAt
        } | Out-Null

        return (Get-BdSqliteBackgroundJob -JobId $JobId)
    } finally {
        $connection.Dispose()
    }
}

function Start-BdSqliteBackgroundJob {
    param([string]$JobId)

    $connection = Open-BdSqliteConnection
    $transaction = $connection.BeginTransaction()
    try {
        Initialize-BdSqliteSchema -Connection $connection
        $parameters = @{}
        $sql = 'SELECT id FROM background_jobs WHERE status = ''queued'' AND cancel_requested = 0'
        if ($JobId) {
            $sql += ' AND id = @id'
            $parameters.id = $JobId
        }
        $sql += ' ORDER BY queued_at ASC LIMIT 1;'
        $candidate = [string](Invoke-BdSqliteScalar -Connection $connection -Transaction $transaction -Sql $sql -Parameters $parameters)
        if (-not $candidate) {
            $transaction.Commit()
            return $null
        }

        $startedAt = (Get-Date).ToString('o')
        $rowsAffected = Invoke-BdSqliteNonQuery -Connection $connection -Transaction $transaction -Sql @'
UPDATE background_jobs
SET status = @status,
    started_at = COALESCE(started_at, @startedAt),
    updated_at = @updatedAt,
    progress_message = @progressMessage,
    error_message = ''
WHERE id = @id
  AND status = 'queued'
  AND cancel_requested = 0;
'@ -Parameters @{
            id = $candidate
            status = 'running'
            startedAt = $startedAt
            updatedAt = $startedAt
            progressMessage = 'Starting'
        }

        if ([int]$rowsAffected -le 0) {
            $transaction.Rollback()
            return $null
        }

        $transaction.Commit()
    } catch {
        try { $transaction.Rollback() } catch {}
        throw
    } finally {
        $transaction.Dispose()
        $connection.Dispose()
    }

    return (Get-BdSqliteBackgroundJob -JobId $candidate)
}

function Complete-BdSqliteBackgroundJob {
    param(
        [Parameter(Mandatory = $true)]
        [string]$JobId,
        $Result,
        [int]$RecordsAffected = 0,
        [string]$ProgressMessage = 'Completed'
    )

    $finishedAt = (Get-Date).ToString('o')
    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        Invoke-BdSqliteNonQuery -Connection $connection -Sql @'
UPDATE background_jobs
SET status = 'completed',
    finished_at = @finishedAt,
    updated_at = @updatedAt,
    progress_message = @progressMessage,
    error_message = '',
    records_affected = @recordsAffected,
    result_json = @resultJson
WHERE id = @id;
'@ -Parameters @{
            id = $JobId
            finishedAt = $finishedAt
            updatedAt = $finishedAt
            progressMessage = $ProgressMessage
            recordsAffected = $RecordsAffected
            resultJson = (ConvertTo-BdSqliteJsonText $Result)
        } | Out-Null

        return (Get-BdSqliteBackgroundJob -JobId $JobId)
    } finally {
        $connection.Dispose()
    }
}

function Fail-BdSqliteBackgroundJob {
    param(
        [Parameter(Mandatory = $true)]
        [string]$JobId,
        [string]$ErrorMessage,
        $Result = $null
    )

    $finishedAt = (Get-Date).ToString('o')
    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        Invoke-BdSqliteNonQuery -Connection $connection -Sql @'
UPDATE background_jobs
SET status = 'failed',
    finished_at = @finishedAt,
    updated_at = @updatedAt,
    progress_message = 'Failed',
    error_message = @errorMessage,
    result_json = @resultJson
WHERE id = @id;
'@ -Parameters @{
            id = $JobId
            finishedAt = $finishedAt
            updatedAt = $finishedAt
            errorMessage = $ErrorMessage
            resultJson = if ($null -ne $Result) { ConvertTo-BdSqliteJsonText $Result } else { $null }
        } | Out-Null

        return (Get-BdSqliteBackgroundJob -JobId $JobId)
    } finally {
        $connection.Dispose()
    }
}

function Cancel-BdSqliteBackgroundJob {
    param(
        [Parameter(Mandatory = $true)]
        [string]$JobId
    )

    $updatedAt = (Get-Date).ToString('o')
    $connection = Open-BdSqliteConnection
    try {
        Initialize-BdSqliteSchema -Connection $connection
        Invoke-BdSqliteNonQuery -Connection $connection -Sql @'
UPDATE background_jobs
SET status = 'cancelled',
    finished_at = COALESCE(finished_at, @finishedAt),
    updated_at = @updatedAt,
    progress_message = 'Cancelled',
    error_message = '',
    cancel_requested = 1
WHERE id = @id
  AND status = 'queued';
'@ -Parameters @{
            id = $JobId
            finishedAt = $updatedAt
            updatedAt = $updatedAt
        } | Out-Null

        return (Get-BdSqliteBackgroundJob -JobId $JobId)
    } finally {
        $connection.Dispose()
    }
}

Export-ModuleMember -Function @(
    'Test-BdSqliteStoreEnabled',
    'Get-BdSqliteDatabasePath',
    'Initialize-BdSqliteStore',
    'Get-BdSqliteStoreSignature',
    'Get-BdSqliteState',
    'Get-BdSqliteSegment',
    'Get-BdSqliteScopedStateForAccountIds',
    'Get-BdSqliteScopedStateForConfigIds',
    'Get-BdSqliteScopedStateForCompanyKeys',
    'Sync-BdSqliteState',
    'Sync-BdSqliteStateSegments',
    'Sync-BdSqliteStateSegmentsPartial',
    'Sync-BdSqliteSegment',
    'Save-BdSqliteState',
    'Save-BdSqliteSegment',
    'Update-BdSqliteSnapshots',
    'Set-BdSqliteSnapshotsDirty',
    'Get-BdSqliteSnapshotDirtyStateRecord',
    'Add-BdSqliteBackgroundJob',
    'Get-BdSqliteBackgroundJob',
    'Get-BdSqliteBackgroundJobPayload',
    'Get-BdSqliteResolverProbeCacheRecords',
    'Save-BdSqliteResolverProbeCacheRecords',
    'Clear-BdSqliteExpiredResolverProbeCache',
    'Get-BdSqliteResolverSearchCacheRecord',
    'Save-BdSqliteResolverSearchCacheRecord',
    'Clear-BdSqliteExpiredResolverSearchCache',
    'Find-BdSqliteBackgroundJobs',
    'Update-BdSqliteBackgroundJobProgress',
    'Start-BdSqliteBackgroundJob',
    'Complete-BdSqliteBackgroundJob',
    'Fail-BdSqliteBackgroundJob',
    'Cancel-BdSqliteBackgroundJob',
    'Get-BdSqliteFilterOptions',
    'Get-BdSqliteFilterSnapshotResult',
    'Get-BdSqliteTargetScoreBackfillAccountIds',
    'Find-BdSqliteAccounts',
    'Find-BdSqliteContacts',
    'Find-BdSqliteJobs',
    'Find-BdSqliteConfigs',
    'Get-BdSqliteResolverCoverageReport',
    'Get-BdSqliteEnrichmentCoverageReport',
    'Find-BdSqliteEnrichmentQueue',
    'Get-BdSqliteEnrichmentCandidateCompanyIds',
    'Get-BdSqliteDiscoveryCandidateConfigIds',
    'Invoke-BdSqliteLocalEnrichmentPass',
    'Find-BdSqliteActivity',
    'Get-BdSqliteDashboardModel',
    'Get-BdSqliteDashboardSnapshotResult',
    'Get-BdSqliteAccountDetail',
    'Find-BdSqliteSearchResults'
)
