Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BdEngine.State.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BdEngine.Domain.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BdEngine.Import.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BdEngine.JobImport.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BdEngine.GoogleSheets.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BdEngine.GoogleSheetSync.psm1') -DisableNameChecking

function Get-AppProjectRootPath {
    return (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

function Get-AppDataRootPath {
    return (Join-Path (Get-AppProjectRootPath) 'data')
}

function Get-BackgroundWorkerScriptPath {
    return (Join-Path (Split-Path -Parent $PSScriptRoot) 'BackgroundJobWorker.ps1')
}

function Get-BackgroundWorkerPidPath {
    return (Join-Path (Get-AppDataRootPath) 'background-worker.pid')
}

function Get-BackgroundWorkerLogPath {
    return (Join-Path (Get-AppDataRootPath) 'background-jobs.log')
}

function Format-BackgroundDurationLabel {
    param($StartedAt)

    if (-not $StartedAt) {
        return ''
    }

    $parsed = [datetime]::MinValue
    if (-not [datetime]::TryParse([string]$StartedAt, [ref]$parsed)) {
        return ''
    }

    $elapsed = (Get-Date).ToUniversalTime() - $parsed.ToUniversalTime()
    if ($elapsed.TotalSeconds -lt 1) {
        return '0s'
    }

    if ($elapsed.TotalMinutes -ge 1) {
        return ('{0:mm\:ss}' -f $elapsed)
    }

    return ('{0}s' -f [int][Math]::Round($elapsed.TotalSeconds))
}

function New-BackgroundJobProgressCallback {
    param([string]$JobId)

    $updateProgressHandler = ${function:Update-AppBackgroundJobProgress}

    return {
        param($Progress)

        if ($null -eq $Progress) {
            return
        }

        $phase = [string]$Progress.phase
        $message = [string]$Progress.message
        $processed = 0
        $total = 0
        try { $processed = [int]$Progress.processed } catch {}
        try { $total = [int]$Progress.total } catch {}
        $elapsedLabel = ''
        $startedAtValue = [string]$Progress.startedAt
        if ($startedAtValue) {
            $parsed = [datetime]::MinValue
            if ([datetime]::TryParse($startedAtValue, [ref]$parsed)) {
                $elapsed = (Get-Date).ToUniversalTime() - $parsed.ToUniversalTime()
                if ($elapsed.TotalSeconds -lt 1) {
                    $elapsedLabel = '0s'
                } elseif ($elapsed.TotalMinutes -ge 1) {
                    $elapsedLabel = ('{0:mm\:ss}' -f $elapsed)
                } else {
                    $elapsedLabel = ('{0}s' -f [int][Math]::Round($elapsed.TotalSeconds))
                }
            }
        }

        $parts = New-Object System.Collections.ArrayList
        if ($phase) { [void]$parts.Add($phase) }
        if ($message) { [void]$parts.Add($message) }
        if ($total -gt 0) {
            [void]$parts.Add(('{0}/{1}' -f $processed, $total))
        } elseif ($processed -gt 0) {
            [void]$parts.Add(('{0} processed' -f $processed))
        }
        if ($elapsedLabel) {
            [void]$parts.Add($elapsedLabel)
        }

        $progressMessage = if ($parts.Count -gt 0) { [string]::Join(' - ', @($parts)) } else { 'Running' }
        & $updateProgressHandler -JobId $JobId -ProgressMessage $progressMessage | Out-Null
    }.GetNewClosure()
}

function Write-BackgroundJobLog {
    param([string]$Message)

    $logPath = Get-BackgroundWorkerLogPath
    $directory = Split-Path -Parent $logPath
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }

    Add-Content -LiteralPath $logPath -Value ("[{0}] {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message)
}

function Get-BackgroundWorkerProcess {
    $pidPath = Get-BackgroundWorkerPidPath
    if (-not (Test-Path -LiteralPath $pidPath)) {
        return $null
    }

    $pidText = ''
    try {
        $pidText = [string](Get-Content -LiteralPath $pidPath -ErrorAction Stop | Select-Object -First 1)
    } catch {
        return $null
    }

    $pid = 0
    if (-not [int]::TryParse($pidText, [ref]$pid)) {
        return $null
    }

    $processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $pid) -ErrorAction SilentlyContinue
    if (-not $processInfo) {
        return $null
    }

    $commandLine = [string]$processInfo.CommandLine
    $workerScript = (Get-BackgroundWorkerScriptPath).Replace('\', '/').ToLowerInvariant()
    $normalizedCommandLine = $commandLine.Replace('\', '/').ToLowerInvariant()
    if ($normalizedCommandLine -notlike ('*{0}*' -f $workerScript) -and $normalizedCommandLine -notlike '*backgroundjobworker.ps1*') {
        return $null
    }

    return [ordered]@{
        id = $pid
        commandLine = $commandLine
    }
}

function Fail-OrphanedBackgroundJobs {
    $worker = Get-BackgroundWorkerProcess
    if ($worker) {
        return
    }

    $running = Find-AppBackgroundJobs -Query @{ status = 'running'; page = 1; pageSize = 50 }
    foreach ($job in @($running.items)) {
        Fail-AppBackgroundJob -JobId $job.id -ErrorMessage 'Background worker exited before the job finished.' -Result ([ordered]@{
            recoveredAt = (Get-Date).ToString('o')
        }) | Out-Null
        Write-BackgroundJobLog ("JOB recover-fail id={0} type={1}" -f $job.id, $job.type)
    }
}

function Ensure-BackgroundWorkerRunning {
    Fail-OrphanedBackgroundJobs
    $existing = Get-BackgroundWorkerProcess
    if ($existing) {
        return $existing
    }

    $workerScript = Get-BackgroundWorkerScriptPath
    if (-not (Test-Path -LiteralPath $workerScript)) {
        throw "Background worker script not found at $workerScript"
    }

    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $workerScript
    ) -WindowStyle Hidden -WorkingDirectory (Get-AppProjectRootPath) -PassThru

    Set-Content -LiteralPath (Get-BackgroundWorkerPidPath) -Value ([string]$process.Id)
    Write-BackgroundJobLog ("WORKER start pid={0}" -f $process.Id)
    return [ordered]@{
        id = $process.Id
        commandLine = ''
    }
}

function Save-WorkerPid {
    Set-Content -LiteralPath (Get-BackgroundWorkerPidPath) -Value ([string]$PID)
}

function Clear-WorkerPid {
    $pidPath = Get-BackgroundWorkerPidPath
    if (-not (Test-Path -LiteralPath $pidPath)) {
        return
    }

    try {
        $currentValue = [string](Get-Content -LiteralPath $pidPath | Select-Object -First 1)
        if ($currentValue -eq [string]$PID) {
            Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
        }
    } catch {
    }
}

function Get-BackgroundJobAcceptedResult {
    param($Job)

    return [ordered]@{
        ok = $true
        accepted = $true
        jobId = $Job.id
        job = $Job
    }
}

function Enqueue-BackgroundJob {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Type,
        [Parameter(Mandatory = $true)]
        $Payload,
        [string]$Summary = '',
        [string]$ProgressMessage = 'Queued'
    )

    if (-not (Test-AppStoreUsesSqlite)) {
        throw 'Background jobs require the SQLite store.'
    }

    $jobId = New-RandomId -Prefix 'bg'
    $job = New-AppBackgroundJob -JobId $jobId -JobType $Type -Payload $Payload -Summary $Summary -ProgressMessage $ProgressMessage
    Write-BackgroundJobLog ("JOB enqueue id={0} type={1}" -f $jobId, $Type)
    [void](Ensure-BackgroundWorkerRunning)
    return $job
}

function Get-BackgroundRuntimeStatus {
    param(
        [string]$ServerStartedAt,
        [string]$ServerWarmedAt
    )

    Fail-OrphanedBackgroundJobs
    $running = Find-AppBackgroundJobs -Query @{ status = 'running'; page = 1; pageSize = 10 }
    $queued = Find-AppBackgroundJobs -Query @{ status = 'queued'; page = 1; pageSize = 10 }
    $recent = Find-AppBackgroundJobs -Query @{ page = 1; pageSize = 8 }
    $worker = Get-BackgroundWorkerProcess

    return [ordered]@{
        ok = $true
        serverStartedAt = $ServerStartedAt
        serverWarmedAt = $ServerWarmedAt
        warmed = [bool]$ServerWarmedAt
        workerRunning = [bool]$worker
        workerPid = if ($worker) { [int]$worker.id } else { $null }
        runningJobs = [int]$(if ($running) { $running.total } else { 0 })
        queuedJobs = [int]$(if ($queued) { $queued.total } else { 0 })
        activeJobs = @(
            @($(if ($running) { $running.items } else { @() })) +
            @($(if ($queued) { $queued.items } else { @() }))
        )
        recentJobs = @($(if ($recent) { $recent.items } else { @() }))
    }
}

function Merge-BackgroundStateSegmentData {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'Activities', 'ImportRuns')]
        [string]$Segment,
        [Parameter(Mandatory = $true)]
        $IncomingData
    )

    $existingData = @(Get-AppSegment -Segment $Segment)
    $mergedById = [ordered]@{}

    foreach ($record in @($existingData)) {
        $recordId = [string](Get-ObjectValue -Object $record -Name 'id')
        if (-not $recordId) {
            continue
        }
        $mergedById[$recordId] = $record
    }

    foreach ($record in @($IncomingData)) {
        $recordId = [string](Get-ObjectValue -Object $record -Name 'id')
        if (-not $recordId) {
            continue
        }
        $mergedById[$recordId] = $record
    }

    return @($mergedById.Values)
}

function Save-BackgroundJobState {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [string[]]$Segments,
        [switch]$FullState,
        [string]$JobId = '',
        [string]$OperationName = 'state-sync',
        [string[]]$MergeSegments = @(),
        [switch]$SkipSnapshots
    )

    if ($JobId) {
        Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Persisting changes to SQLite' | Out-Null
    }

    $result = $null
    if ($FullState) {
        $result = Sync-AppState -State $State -SkipSnapshots:$SkipSnapshots
    } elseif (@($MergeSegments | Select-Object -Unique).Count -gt 0) {
        $result = Sync-AppStateSegmentsPartial -State $State -Segments @($MergeSegments | Select-Object -Unique) -SkipSnapshots:$SkipSnapshots
    } else {
        $result = Sync-AppStateSegments -State $State -Segments @($Segments | Select-Object -Unique) -SkipSnapshots:$SkipSnapshots
    }

    if (-not $result) {
        return $null
    }

    Write-BackgroundJobLog ("JOB persist id={0} operation={1} mode={2}" -f $JobId, $OperationName, [string]$result.mode)
    foreach ($segmentResult in @($result.segments)) {
        $timings = if ($segmentResult.timings) { $segmentResult.timings } else { @{} }
        Write-BackgroundJobLog ("JOB persist-segment id={0} operation={1} segment={2} mode={3} total={4} upserted={5} unchanged={6} deleted={7} loadMs={8} diffMs={9} writeMs={10} durationMs={11}" -f `
                $JobId,
                $OperationName,
                [string]$segmentResult.segment,
                [string]$segmentResult.mode,
                [int]$segmentResult.total,
                [int]$segmentResult.upserted,
                [int]$segmentResult.unchanged,
                [int]$segmentResult.deleted,
                [int]$(if ($timings.loadMs) { $timings.loadMs } else { 0 }),
                [int]$(if ($timings.diffMs) { $timings.diffMs } else { 0 }),
                [int]$(if ($timings.writeMs) { $timings.writeMs } else { 0 }),
                [int]$(if ($segmentResult.durationMs) { $segmentResult.durationMs } else { 0 }))
    }

    if ($result.snapshot) {
        Write-BackgroundJobLog ("JOB snapshot id={0} operation={1} filtersBuildMs={2} dashboardBuildMs={3} durationMs={4}" -f `
                $JobId,
                $OperationName,
                [int]$(if ($result.snapshot.filtersBuildMs) { $result.snapshot.filtersBuildMs } else { 0 }),
                [int]$(if ($result.snapshot.dashboardBuildMs) { $result.snapshot.dashboardBuildMs } else { 0 }),
                [int]$(if ($result.snapshot.durationMs) { $result.snapshot.durationMs } else { 0 }))
        if ($result.snapshot.details) {
            $detailParts = New-Object System.Collections.ArrayList
            foreach ($scopeName in @('filters', 'dashboard')) {
                $scope = $result.snapshot.details[$scopeName]
                if ($scope) {
                    foreach ($key in @($scope.Keys)) {
                        [void]$detailParts.Add(('{0}.{1}={2}' -f $scopeName, $key, [int]$scope[$key]))
                    }
                }
            }
            if ($result.snapshot.details.saves) {
                foreach ($key in @($result.snapshot.details.saves.Keys)) {
                    [void]$detailParts.Add(('saves.{0}={1}' -f $key, [int]$result.snapshot.details.saves[$key]))
                }
            }
            if ($detailParts.Count -gt 0) {
                Write-BackgroundJobLog ("JOB snapshot-detail id={0} operation={1} {2}" -f $JobId, $OperationName, ([string]::Join(' ', @($detailParts.ToArray()))))
            }
        }
    }

    if ($result.coverage) {
        $coverageParts = New-Object System.Collections.ArrayList
        foreach ($key in @($result.coverage.Keys)) {
            [void]$coverageParts.Add(('{0}={1}' -f $key, [int]$result.coverage[$key]))
        }
        if ($coverageParts.Count -gt 0) {
            Write-BackgroundJobLog ("JOB coverage id={0} operation={1} {2}" -f $JobId, $OperationName, ([string]::Join(' ', @($coverageParts.ToArray()))))
        }
    }

    return $result
}

function Invoke-JobScriptSync {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,
        [string[]]$Arguments = @()
    )

    $rawOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1
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

function Invoke-BackgroundWorkbookImportJob {
    param($Payload, [string]$JobId)

    $workbookPath = [string]$Payload.workbookPath
    $progressCallback = if ($JobId) { New-BackgroundJobProgressCallback -JobId $JobId } else { $null }
    $result = Import-BdWorkbook -WorkbookPath $workbookPath -SkipPersistence -ProgressCallback $progressCallback
    $persistence = Save-BackgroundJobState -State $result.state -FullState -JobId $JobId -OperationName 'workbook-import'
    return [ordered]@{
        importRun = $result.importRun
        stats = $result.importRun.stats
        persistence = $persistence
    }
}

function Invoke-BackgroundConnectionsCsvImportJob {
    param($Payload, [string]$JobId)

    $progressCallback = if ($JobId) { New-BackgroundJobProgressCallback -JobId $JobId } else { $null }
    $result = Import-BdConnectionsCsv -CsvPath ([string]$Payload.csvPath) -SourceLabel 'linkedin-connections-csv' -SkipPersistence -ProgressCallback $progressCallback

    # Clean up temp file created from uploaded CSV content
    if ($Payload.isTempFile -and (Test-Path -LiteralPath ([string]$Payload.csvPath))) {
        Remove-Item -LiteralPath ([string]$Payload.csvPath) -Force -ErrorAction SilentlyContinue
    }

    $persistence = Save-BackgroundJobState -State $result.state -Segments @('Contacts', 'Companies', 'BoardConfigs', 'ImportRuns') -JobId $JobId -OperationName 'connections-csv-import'
    return [ordered]@{
        importRun = $result.importRun
        stats = $result.importRun.stats
        persistence = $persistence
    }
}

function Invoke-BackgroundConfigSyncJob {
    param($Payload, [string]$JobId)

    $progressCallback = if ($JobId) { New-BackgroundJobProgressCallback -JobId $JobId } else { $null }
    $loadStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $state = Get-AppState
    $loadStopwatch.Stop()

    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Refreshing company enrichment before config sync' | Out-Null
    $enrichmentIds = @(Get-AppEnrichmentCandidateCompanyIdsFast -Limit 500)
    if ($enrichmentIds.Count -gt 0) {
        $enrichmentResult = Invoke-CompanyEnrichment -State $state -Limit 0 -AccountIds $enrichmentIds -ProgressCallback $progressCallback
        $state = $enrichmentResult.state
    }

    $syncStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $state = Sync-BoardConfigsFromCompanies -State $state -ProgressCallback $progressCallback
    $syncStopwatch.Stop()

    $deriveStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $state = Update-DerivedData -State $state -ProgressCallback $progressCallback
    $deriveStopwatch.Stop()

    $persistence = Save-BackgroundJobState -State $state -Segments @('Companies', 'BoardConfigs') -JobId $JobId -OperationName 'config-sync'
    return [ordered]@{
        count = @($state.boardConfigs).Count
        companies = @($state.companies).Count
        timings = [ordered]@{
            loadMs = [int]$loadStopwatch.ElapsedMilliseconds
            syncMs = [int]$syncStopwatch.ElapsedMilliseconds
            deriveMs = [int]$deriveStopwatch.ElapsedMilliseconds
            snapshotMs = [int]$(if ($persistence.snapshot -and $persistence.snapshot.durationMs) { $persistence.snapshot.durationMs } else { 0 })
        }
        persistence = $persistence
    }
}

function Invoke-BackgroundCompanyEnrichmentJob {
    param($Payload, [string]$JobId)

    $limit = [int]$Payload.limit
    if ($limit -lt 1) { $limit = 500 }
    $progressCallback = if ($JobId) { New-BackgroundJobProgressCallback -JobId $JobId } else { $null }

    # ---------------------------------------------------------------
    # STAGE 0 — Local SQL enrichment pass (no HTTP, instant coverage)
    # Derives canonical_domain and careers_url from contact emails and
    # board config fields. Runs before the HTTP probe so the probe has
    # better inputs and cooldowns don't block the bulk of the dataset.
    # ---------------------------------------------------------------
    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Running local SQL enrichment pass (contact emails, board config domains)' | Out-Null
    $localStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $localStats = $null
    if (Test-AppStoreUsesSqlite) {
        try {
            $localStats = Invoke-BdSqliteLocalEnrichmentPass -Limit ([Math]::Max(2000, $limit * 4)) -ForceRefresh:([bool]$Payload.forceRefresh)
            Write-BackgroundJobLog ("JOB local-enrich id={0} contactEmail={1} boardDomain={2} boardCareers={3} total={4}" -f `
                $JobId,
                [int]$localStats.contactEmailDomainApplied,
                [int]$localStats.boardConfigDomainApplied,
                [int]$localStats.boardConfigCareersApplied,
                [int]$localStats.totalUpdated)
        } catch {
            Write-BackgroundJobLog ("JOB local-enrich-error id={0} error={1}" -f $JobId, [string]$_)
        }
    }
    $localStopwatch.Stop()

    # ---------------------------------------------------------------
    # STAGE 1 — HTTP-probe enrichment for prioritized candidates
    # ---------------------------------------------------------------
    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Selecting prioritized companies for enrichment' | Out-Null
    $candidateIds = @(Get-AppEnrichmentCandidateCompanyIdsFast -Limit $limit -AccountId ([string]$Payload.accountId) -ForceRefresh:([bool]$Payload.forceRefresh))
    if ($candidateIds.Count -eq 0) {
        return [ordered]@{
            localStats = $localStats
            stats = [ordered]@{ checked = 0; verified = 0; enriched = 0; unresolved = 0; missingInputs = 0 }
            companies = 0
            timings = [ordered]@{ localMs = [int]$localStopwatch.ElapsedMilliseconds; loadMs = 0; enrichmentMs = 0; snapshotMs = 0 }
            persistence = $null
        }
    }

    $loadStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $state = Get-AppScopedStateForAccounts -AccountIds $candidateIds
    $loadStopwatch.Stop()

    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Running company enrichment (HTTP probe)' | Out-Null
    $enrichmentStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $result = Invoke-CompanyEnrichment -State $state -Limit 0 -AccountIds $candidateIds -ForceRefresh:([bool]$Payload.forceRefresh) -ProgressCallback $progressCallback
    $enrichmentStopwatch.Stop()

    $persistence = Save-BackgroundJobState -State $result.state -Segments @('Companies') -MergeSegments @('Companies') -JobId $JobId -OperationName 'company-enrichment' -SkipSnapshots
    $deferredSnapshots = Mark-AppSnapshotsDirty -Names @('filters') -Reason 'company-enrichment' -DataRevision ([string]$persistence.dataRevision)
    Write-BackgroundJobLog ("JOB snapshot-deferred id={0} operation=company-enrichment names={1} reason={2} dataRevision={3}" -f $JobId, ([string]::Join(',', @($deferredSnapshots.names))), [string]$deferredSnapshots.reason, [string]$deferredSnapshots.dataRevision)
    return [ordered]@{
        localStats = $localStats
        stats = $result.stats
        companies = @($result.state.companies).Count
        timings = [ordered]@{
            localMs = [int]$localStopwatch.ElapsedMilliseconds
            loadMs = [int]$loadStopwatch.ElapsedMilliseconds
            enrichmentMs = [int]$enrichmentStopwatch.ElapsedMilliseconds
            snapshotMs = [int]$(if ($persistence.snapshot -and $persistence.snapshot.durationMs) { $persistence.snapshot.durationMs } else { 0 })
        }
        deferredSnapshots = $deferredSnapshots
        persistence = $persistence
    }
}

function Invoke-BackgroundAtsDiscoveryJob {
    param($Payload, [string]$JobId)

    $limit = [int]$Payload.limit
    if ($limit -lt 1) { $limit = 300 }
    $progressCallback = if ($JobId) { New-BackgroundJobProgressCallback -JobId $JobId } else { $null }
    $candidateConfigIds = @()
    if ([string]$Payload.configId) {
        $candidateConfigIds = @([string]$Payload.configId)
    } else {
        $candidateConfigIds = @(Get-AppDiscoveryCandidateConfigIdsFast -Limit $limit -OnlyMissing:([bool]$Payload.onlyMissing) -ForceRefresh:([bool]$Payload.forceRefresh))
    }
    if ($candidateConfigIds.Count -eq 0 -and -not [string]$Payload.configId) {
        return [ordered]@{
            stats = [ordered]@{
                checked = 0
                mapped = 0
                discovered = 0
                noMatch = 0
                missingInputs = 0
                errors = 0
                highConfidence = 0
                mediumConfidence = 0
                lowConfidence = 0
                unresolved = 0
            }
            count = 0
            timings = [ordered]@{
                loadMs = 0
                discoveryMs = 0
                snapshotMs = 0
            }
            persistence = $null
        }
    }
    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Loading configs and company inputs for ATS discovery' | Out-Null
    $loadStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $state = Get-AppScopedStateForConfigs -ConfigIds $candidateConfigIds
    $loadStopwatch.Stop()
    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Running ATS discovery' | Out-Null
    $discoveryStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $result = Invoke-AtsDiscovery -State $state -Limit $limit -OnlyMissing:([bool]$Payload.onlyMissing) -SkipSync -SkipDerivedData -ConfigId ([string]$Payload.configId) -ConfigIds $candidateConfigIds -ForceRefresh:([bool]$Payload.forceRefresh) -ProgressCallback $progressCallback
    $discoveryStopwatch.Stop()
    $persistence = Save-BackgroundJobState -State $result.state -Segments @('BoardConfigs') -MergeSegments @('BoardConfigs') -JobId $JobId -OperationName 'ats-discovery'
    return [ordered]@{
        stats = $result.stats
        count = @($result.state.boardConfigs).Count
        timings = [ordered]@{
            loadMs = [int]$loadStopwatch.ElapsedMilliseconds
            discoveryMs = [int]$discoveryStopwatch.ElapsedMilliseconds
            snapshotMs = [int]$(if ($persistence.snapshot -and $persistence.snapshot.durationMs) { $persistence.snapshot.durationMs } else { 0 })
        }
        persistence = $persistence
    }
}

function Invoke-BackgroundLiveJobImportJob {
    param($Payload, [string]$JobId)

    $progressCallback = if ($JobId) { New-BackgroundJobProgressCallback -JobId $JobId } else { $null }
    $loadStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $state = Get-AppState
    $loadStopwatch.Stop()
    if ($Payload.discoverFirst) {
        Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Refreshing company enrichment before ATS discovery' | Out-Null
        $enrichmentIds = @(Get-AppEnrichmentCandidateCompanyIdsFast -Limit 40)
        if ($enrichmentIds.Count -gt 0) {
            $enrichmentResult = Invoke-CompanyEnrichment -State $state -Limit 0 -AccountIds $enrichmentIds -ProgressCallback $progressCallback
            $state = $enrichmentResult.state
        }
    }
    $discoveryStats = $null
    $discoveryMs = 0
    if ($Payload.discoverFirst) {
        Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Discovering ATS configs before job import' | Out-Null
        $discoveryStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $discovery = Invoke-AtsDiscovery -State $state -Limit 50 -OnlyMissing -SkipSync -ProgressCallback $progressCallback
        $discoveryStopwatch.Stop()
        $discoveryMs = [int]$discoveryStopwatch.ElapsedMilliseconds
        $state = $discovery.state
        $discoveryStats = $discovery.stats
    }

    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Fetching active ATS job feeds' | Out-Null
    $jobState = [ordered]@{
        workspace = $state.workspace
        jobs = @($state.jobs)
        boardConfigs = @($state.boardConfigs)
        importRuns = @($state.importRuns)
    }
    $jobImportStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $jobRunResult = Invoke-LiveJobImport -State $jobState -SkipPersistence -ProgressCallback $progressCallback
    $jobImportStopwatch.Stop()
    $state.jobs = @($jobRunResult.state.jobs)
    $state.boardConfigs = @($jobRunResult.state.boardConfigs)
    $state.importRuns = @($jobRunResult.state.importRuns)
    $deriveStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $state = Update-DerivedData -State $state -ProgressCallback $progressCallback
    $deriveStopwatch.Stop()
    $persistence = Save-BackgroundJobState -State $state -Segments @('Jobs', 'BoardConfigs', 'ImportRuns', 'Companies') -JobId $JobId -OperationName 'live-job-import'

    return [ordered]@{
        importRun = $jobRunResult.importRun
        discoveryStats = $discoveryStats
        timings = [ordered]@{
            loadMs = [int]$loadStopwatch.ElapsedMilliseconds
            discoveryMs = $discoveryMs
            importMs = [int]$jobImportStopwatch.ElapsedMilliseconds
            deriveMs = [int]$deriveStopwatch.ElapsedMilliseconds
            snapshotMs = [int]$(if ($persistence.snapshot -and $persistence.snapshot.durationMs) { $persistence.snapshot.durationMs } else { 0 })
        }
        persistence = $persistence
    }
}

function Invoke-BackgroundGoogleSheetsConfigSyncJob {
    param($Payload)

    $spreadsheetId = [string]$Payload.spreadsheetId
    $scriptPath = Join-Path (Get-AppProjectRootPath) 'scripts\Sync-LiveJobBoardsConfig.ps1'
    $args = @(
        '-SpreadsheetId', $spreadsheetId,
        '-ProbeLimit', '0',
        '-SkipHttpProbe'
    )
    if ($Payload.seedBackupPath) {
        $args += @('-SeedBackupPath', [string]$Payload.seedBackupPath)
    }

    return (Invoke-JobScriptSync -ScriptPath $scriptPath -Arguments $args)
}

function Invoke-BackgroundGoogleSheetsRunEngineJob {
    param($Payload, [string]$JobId)

    $spreadsheetId = [string]$Payload.spreadsheetId
    $progressCallback = if ($JobId) { New-BackgroundJobProgressCallback -JobId $JobId } else { $null }
    $state = Get-AppState
    $connectionsImported = $false

    if ($Payload.connectionsCsvPath -and (Test-Path -LiteralPath ([string]$Payload.connectionsCsvPath))) {
        Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Importing LinkedIn connections CSV' | Out-Null
        $importResult = Import-BdConnectionsCsv -CsvPath ([string]$Payload.connectionsCsvPath) -SkipPersistence -ProgressCallback $progressCallback
        $state = $importResult.state
        $connectionsImported = $true
    }

    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Refreshing company enrichment' | Out-Null
    $enrichmentIds = @(Get-AppEnrichmentCandidateCompanyIdsFast -Limit 75)
    if ($enrichmentIds.Count -gt 0) {
        $enrichmentResult = Invoke-CompanyEnrichment -State $state -Limit 0 -AccountIds $enrichmentIds -ProgressCallback $progressCallback
        $state = $enrichmentResult.state
    }

    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Syncing ATS configs and derived scoring' | Out-Null
    $state = Sync-BoardConfigsFromCompanies -State $state -ProgressCallback $progressCallback
    $state = Update-DerivedData -State $state -ProgressCallback $progressCallback

    $jobRun = $null
    if (-not $Payload.skipJobImport) {
        Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Importing live ATS jobs' | Out-Null
        $jobState = [ordered]@{
            workspace = $state.workspace
            jobs = @($state.jobs)
            boardConfigs = @($state.boardConfigs)
            importRuns = @($state.importRuns)
        }
        $jobRunResult = Invoke-LiveJobImport -State $jobState -SkipPersistence -ProgressCallback $progressCallback
        $jobRun = $jobRunResult.importRun
        $state.jobs = @($jobRunResult.state.jobs)
        $state.boardConfigs = @($jobRunResult.state.boardConfigs)
        $state.importRuns = @($jobRunResult.state.importRuns)
        $state = Update-DerivedData -State $state -ProgressCallback $progressCallback
    }

    $persistence = Save-BackgroundJobState -State $state -Segments @('Contacts', 'Companies', 'Jobs', 'BoardConfigs', 'ImportRuns') -JobId $JobId -OperationName 'google-sheets-run-engine'

    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Exporting state to Google Sheets' | Out-Null
    $sheetWrites = Export-BdStateToGoogleSheets -SpreadsheetId $spreadsheetId -State $state
    Start-Sleep -Seconds 2

    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Running live sheet config sync' | Out-Null
    $configSync = $null
    try {
        $configSync = Invoke-BackgroundGoogleSheetsConfigSyncJob -Payload ([ordered]@{ spreadsheetId = $spreadsheetId })
    } catch {
        $configSync = [ordered]@{
            ok = $false
            error = [string]$_.Exception.Message
        }
    }

    return [ordered]@{
        ok = $true
        spreadsheetId = $spreadsheetId
        connectionsImported = $connectionsImported
        companies = @($state.companies).Count
        contacts = @($state.contacts).Count
        jobs = @($state.jobs).Count
        jobRun = $jobRun
        tabsWritten = $sheetWrites
        configSync = $configSync
        persistence = $persistence
    }
}

function Invoke-BackgroundJobHandler {
    param(
        [Parameter(Mandatory = $true)]
        $Job
    )

    $payload = Get-AppBackgroundJobPayload -JobId $Job.id
    $startedAt = Get-Date
    Write-BackgroundJobLog ("JOB start id={0} type={1}" -f $Job.id, $Job.type)

    try {
        $result = switch ([string]$Job.type) {
            'workbook-import' {
                Update-AppBackgroundJobProgress -JobId $Job.id -ProgressMessage 'Reading workbook and rebuilding state' | Out-Null
                Invoke-BackgroundWorkbookImportJob -Payload $payload -JobId $Job.id
            }
            'connections-csv-import' {
                Update-AppBackgroundJobProgress -JobId $Job.id -ProgressMessage 'Importing LinkedIn connections CSV' | Out-Null
                Invoke-BackgroundConnectionsCsvImportJob -Payload $payload -JobId $Job.id
            }
            'config-sync' {
                Update-AppBackgroundJobProgress -JobId $Job.id -ProgressMessage 'Rebuilding ATS config records' | Out-Null
                Invoke-BackgroundConfigSyncJob -Payload $payload -JobId $Job.id
            }
            'company-enrichment' {
                Update-AppBackgroundJobProgress -JobId $Job.id -ProgressMessage 'Refreshing company identity inputs' | Out-Null
                Invoke-BackgroundCompanyEnrichmentJob -Payload $payload -JobId $Job.id
            }
            'ats-discovery' {
                Invoke-BackgroundAtsDiscoveryJob -Payload $payload -JobId $Job.id
            }
            'live-job-import' {
                Invoke-BackgroundLiveJobImportJob -Payload $payload -JobId $Job.id
            }
            'google-sheets-config-sync' {
                Update-AppBackgroundJobProgress -JobId $Job.id -ProgressMessage 'Syncing live Google Sheet config tab' | Out-Null
                Invoke-BackgroundGoogleSheetsConfigSyncJob -Payload $payload
            }
            'google-sheets-run-engine' {
                Invoke-BackgroundGoogleSheetsRunEngineJob -Payload $payload -JobId $Job.id
            }
            default {
                throw "Unsupported background job type: $($Job.type)"
            }
        }

        $durationMs = [int][Math]::Round(((Get-Date) - $startedAt).TotalMilliseconds)
        $recordsAffected = 0
        if ($result -is [System.Collections.IDictionary]) {
            if (@($result.Keys) -contains 'count') {
                $recordsAffected = [int]$result.count
            } elseif (@($result.Keys) -contains 'companies') {
                $recordsAffected = [int]$result.companies
            } elseif (@($result.Keys) -contains 'stats' -and $result.stats -and @($result.stats.Keys) -contains 'checked') {
                $recordsAffected = [int]$result.stats.checked
            } elseif (@($result.Keys) -contains 'jobs') {
                $recordsAffected = [int]$result.jobs
            } elseif (@($result.Keys) -contains 'stats' -and $result.stats -and @($result.stats.Keys) -contains 'contacts') {
                $recordsAffected = [int]$result.stats.contacts
            } elseif (@($result.Keys) -contains 'importRun' -and $result.importRun -and $result.importRun.stats) {
                $runStats = $result.importRun.stats
                if ($runStats.imported) {
                    $recordsAffected = [int]$runStats.imported
                } elseif ($runStats.contacts) {
                    $recordsAffected = [int]$runStats.contacts
                } elseif ($runStats.companies) {
                    $recordsAffected = [int]$runStats.companies
                }
            }
        }

        if ($result -isnot [System.Collections.IDictionary]) {
            $result = [ordered]@{ value = $result }
        }
        $result.durationMs = $durationMs

        if ($result.timings) {
            $phaseParts = New-Object System.Collections.ArrayList
            foreach ($name in @($result.timings.Keys)) {
                [void]$phaseParts.Add(('{0}={1}ms' -f $name, [int]$result.timings[$name]))
            }
            if ($phaseParts.Count -gt 0) {
                Write-BackgroundJobLog ("JOB timings id={0} type={1} {2}" -f $Job.id, $Job.type, ([string]::Join(' ', @($phaseParts))))
            }
        }

        Complete-AppBackgroundJob -JobId $Job.id -Result $result -RecordsAffected $recordsAffected -ProgressMessage 'Completed' | Out-Null
        Write-BackgroundJobLog ("JOB finish id={0} type={1} durationMs={2} records={3}" -f $Job.id, $Job.type, $durationMs, $recordsAffected)
    } catch {
        $message = [string]$_.Exception.Message
        Fail-AppBackgroundJob -JobId $Job.id -ErrorMessage $message -Result ([ordered]@{ failedAt = (Get-Date).ToString('o') }) | Out-Null
        Write-BackgroundJobLog ("JOB fail id={0} type={1} error={2}" -f $Job.id, $Job.type, $message)
    }
}

function Start-BackgroundWorkerLoop {
    param([int]$IdleTimeoutSeconds = 12)

    Save-WorkerPid
    Write-BackgroundJobLog ("WORKER heartbeat pid={0}" -f $PID)

    try {
        $idleDeadline = (Get-Date).AddSeconds($IdleTimeoutSeconds)
        while ((Get-Date) -lt $idleDeadline) {
            $job = Start-AppBackgroundJob
            if (-not $job) {
                Start-Sleep -Milliseconds 750
                continue
            }

            $idleDeadline = (Get-Date).AddSeconds($IdleTimeoutSeconds)
            Invoke-BackgroundJobHandler -Job $job
        }
    } finally {
        Write-BackgroundJobLog ("WORKER stop pid={0}" -f $PID)
        Clear-WorkerPid
    }
}

Export-ModuleMember -Function @(
    'Enqueue-BackgroundJob',
    'Ensure-BackgroundWorkerRunning',
    'Get-BackgroundRuntimeStatus',
    'Get-BackgroundWorkerProcess',
    'Start-BackgroundWorkerLoop',
    'Write-BackgroundJobLog',
    'Get-BackgroundJobAcceptedResult'
)
