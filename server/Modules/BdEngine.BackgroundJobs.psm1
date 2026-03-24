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

function Test-BackgroundJobSupportsResume {
    param(
        [string]$JobType,
        $Payload = $null
    )

    switch ([string]$JobType) {
        'company-enrichment' { return $true }
        default { return $false }
    }
}

function Get-BackgroundJobResumeAttemptCount {
    param($Payload)

    return [int](Convert-ToNumber (Get-ObjectValue -Object $Payload -Name 'resumeCount' -Default 0))
}

function New-CompanyEnrichmentStats {
    return [ordered]@{
        checked = 0
        verified = 0
        enriched = 0
        unresolved = 0
        missingInputs = 0
    }
}

function Merge-CompanyEnrichmentStats {
    param(
        $BaseStats,
        $DeltaStats
    )

    $merged = New-CompanyEnrichmentStats
    foreach ($key in @($merged.Keys)) {
        $baseValue = [int](Convert-ToNumber (Get-ObjectValue -Object $BaseStats -Name $key -Default 0))
        $deltaValue = [int](Convert-ToNumber (Get-ObjectValue -Object $DeltaStats -Name $key -Default 0))
        $merged[$key] = $baseValue + $deltaValue
    }

    return $merged
}

function Fail-OrphanedBackgroundJobs {
    $worker = Get-BackgroundWorkerProcess
    if ($worker) {
        return
    }

    $running = Find-AppBackgroundJobs -Query @{ status = 'running'; page = 1; pageSize = 50 } -IncludeResult:$false
    foreach ($job in @($running.items)) {
        $payload = Get-AppBackgroundJobPayload -JobId $job.id
        if (Test-BackgroundJobSupportsResume -JobType ([string]$job.type) -Payload $payload) {
            if ($null -eq $payload) {
                $payload = [ordered]@{}
            }
            $resumeCount = (Get-BackgroundJobResumeAttemptCount -Payload $payload) + 1
            [void](Set-ObjectValue -Object $payload -Name 'resumeCount' -Value $resumeCount)
            [void](Set-ObjectValue -Object $payload -Name 'resumeRequestedAt' -Value ((Get-Date).ToString('o')))
            if ($resumeCount -le 5) {
                Resume-AppBackgroundJob -JobId $job.id -Payload $payload -ProgressMessage ('Queued to resume after worker exit ({0}/5)' -f $resumeCount) | Out-Null
                Write-BackgroundJobLog ("JOB recover-requeue id={0} type={1} resumeCount={2}" -f $job.id, $job.type, $resumeCount)
                continue
            }
        }
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

function Get-BackgroundJobDedupeSignature {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Type,
        $Payload
    )

    switch ([string]$Type) {
        'config-sync' {
            return 'config-sync|global'
        }
        'target-score-rollout' {
            return 'target-score-rollout|global'
        }
        'live-job-import' {
            $discoverFirst = [bool](Test-Truthy (Get-ObjectValue -Object $Payload -Name 'discoverFirst' -Default $false))
            return ('live-job-import|discoverFirst={0}' -f [int]$discoverFirst)
        }
        'company-enrichment' {
            $accountId = [string](Get-ObjectValue -Object $Payload -Name 'accountId' -Default '')
            $limit = [int](Convert-ToNumber (Get-ObjectValue -Object $Payload -Name 'limit' -Default 0))
            $forceRefresh = [bool](Test-Truthy (Get-ObjectValue -Object $Payload -Name 'forceRefresh' -Default $false))
            $deepVerify = [bool](Test-Truthy (Get-ObjectValue -Object $Payload -Name 'deepVerify' -Default $false))
            return ('company-enrichment|accountId={0}|limit={1}|forceRefresh={2}|deepVerify={3}' -f $accountId, $limit, [int]$forceRefresh, [int]$deepVerify)
        }
        'ats-discovery' {
            $configId = [string](Get-ObjectValue -Object $Payload -Name 'configId' -Default '')
            $limit = [int](Convert-ToNumber (Get-ObjectValue -Object $Payload -Name 'limit' -Default 0))
            $onlyMissing = [bool](Test-Truthy (Get-ObjectValue -Object $Payload -Name 'onlyMissing' -Default $false))
            $forceRefresh = [bool](Test-Truthy (Get-ObjectValue -Object $Payload -Name 'forceRefresh' -Default $false))
            $deepVerify = [bool](Test-Truthy (Get-ObjectValue -Object $Payload -Name 'deepVerify' -Default $false))
            return ('ats-discovery|configId={0}|limit={1}|onlyMissing={2}|forceRefresh={3}|deepVerify={4}' -f $configId, $limit, [int]$onlyMissing, [int]$forceRefresh, [int]$deepVerify)
        }
        default {
            return ''
        }
    }
}

function Find-BackgroundJobDuplicate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Type,
        $Payload
    )

    $signature = Get-BackgroundJobDedupeSignature -Type $Type -Payload $Payload
    if (-not $signature) {
        return $null
    }

    $candidates = New-Object System.Collections.ArrayList
    foreach ($status in @('running', 'queued')) {
        $result = Find-AppBackgroundJobs -Query @{ status = $status; page = 1; pageSize = 100 }
        foreach ($job in @($(if ($result) { $result.items } else { @() }))) {
            if ([string](Get-ObjectValue -Object $job -Name 'type' -Default '') -ne $Type) {
                continue
            }
            if ([bool](Get-ObjectValue -Object $job -Name 'cancelRequested' -Default $false)) {
                continue
            }
            [void]$candidates.Add($job)
        }
    }

    foreach ($job in @($candidates.ToArray() | Sort-Object @(
                @{ Expression = { if ([string](Get-ObjectValue -Object $_ -Name 'status' -Default '') -eq 'running') { 0 } else { 1 } }; Descending = $false },
                @{ Expression = { Get-DateSortValue (Get-ObjectValue -Object $_ -Name 'queuedAt' -Default '') }; Descending = $false }
            ))) {
        $jobId = [string](Get-ObjectValue -Object $job -Name 'id' -Default '')
        if (-not $jobId) {
            continue
        }

        $jobPayload = Get-AppBackgroundJobPayload -JobId $jobId
        if ((Get-BackgroundJobDedupeSignature -Type $Type -Payload $jobPayload) -eq $signature) {
            return $job
        }
    }

    return $null
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

    $existingJob = Find-BackgroundJobDuplicate -Type $Type -Payload $Payload
    if ($existingJob) {
        Write-BackgroundJobLog ("JOB dedupe existingId={0} type={1} status={2}" -f [string]$existingJob.id, $Type, [string]$existingJob.status)
        [void](Ensure-BackgroundWorkerRunning)
        return $existingJob
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
    $running = Find-AppBackgroundJobs -Query @{ status = 'running'; page = 1; pageSize = 10 } -IncludeResult:$false
    $queued = Find-AppBackgroundJobs -Query @{ status = 'queued'; page = 1; pageSize = 10 } -IncludeResult:$false
    $recent = Find-AppBackgroundJobs -Query @{ page = 1; pageSize = 8 } -IncludeResult:$false
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
        $IncomingData,
        $ExistingData = $null
    )

    $existingData = if ($PSBoundParameters.ContainsKey('ExistingData')) {
        if ($null -ne $ExistingData) { @($ExistingData) } else { @() }
    } else {
        @(Get-AppSegment -Segment $Segment)
    }
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

function Get-BackgroundStateCompaniesByScope {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [string[]]$CompanyKeys = @(),
        [string[]]$AccountIds = @()
    )

    $companyKeySet = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($companyKey in @($CompanyKeys)) {
        $normalized = Get-CanonicalCompanyKey $companyKey
        if ($normalized) {
            [void]$companyKeySet.Add($normalized)
        }
    }

    $accountIdSet = @{}
    foreach ($accountId in @($AccountIds)) {
        if ($accountId) {
            $accountIdSet[[string]$accountId] = $true
        }
    }

    return @(
        $State.companies | Where-Object {
            $companyId = [string](Get-ObjectValue -Object $_ -Name 'id' -Default '')
            if ($companyId -and $accountIdSet.ContainsKey($companyId)) {
                return $true
            }

            $companyKey = Get-CanonicalCompanyKey $(if ($_.normalizedName) { $_.normalizedName } else { $_.displayName })
            return ($companyKey -and $companyKeySet.Contains($companyKey))
        }
    )
}

function Apply-LiveJobImportDelta {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        $JobRunResult,
        $AdditionalBoardConfigs = @(),
        [string[]]$AdditionalCompanyIds = @(),
        [string]$JobId = '',
        [string]$OperationName = 'live-job-import'
    )

    $incomingConfigs = Merge-BackgroundStateSegmentData -Segment 'BoardConfigs' -ExistingData @() -IncomingData (@(@($AdditionalBoardConfigs) + @($JobRunResult.changedConfigs)))
    $companyKeysToRefresh = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($companyKey in @($JobRunResult.companyKeys)) {
        $normalized = Get-CanonicalCompanyKey $companyKey
        if ($normalized) {
            [void]$companyKeysToRefresh.Add($normalized)
        }
    }
    foreach ($config in @($incomingConfigs)) {
        $companyKey = Get-CanonicalCompanyKey $(if ($config.normalizedCompanyName) { $config.normalizedCompanyName } else { $config.companyName })
        if ($companyKey) {
            [void]$companyKeysToRefresh.Add($companyKey)
        }
    }

    $mergeStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $State.jobs = Merge-BackgroundStateSegmentData -Segment 'Jobs' -ExistingData $State.jobs -IncomingData @($JobRunResult.changedJobs)
    $State.boardConfigs = Merge-BackgroundStateSegmentData -Segment 'BoardConfigs' -ExistingData $State.boardConfigs -IncomingData @($incomingConfigs)
    $State.importRuns = Merge-BackgroundStateSegmentData -Segment 'ImportRuns' -ExistingData $State.importRuns -IncomingData @($JobRunResult.importRun)
    $mergeStopwatch.Stop()

    if ($JobId) {
        Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Refreshing touched company projections' | Out-Null
    }

    $companySyncStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $State = Sync-ImportedCompanyData -State $State -CompanyKeys @($companyKeysToRefresh | Sort-Object)
    $companySyncStopwatch.Stop()

    $affectedCompanies = Get-BackgroundStateCompaniesByScope -State $State -CompanyKeys @($companyKeysToRefresh | Sort-Object) -AccountIds $AdditionalCompanyIds
    $deltaState = [ordered]@{
        jobs = @($JobRunResult.changedJobs)
        boardConfigs = @($incomingConfigs)
        importRuns = @($JobRunResult.importRun)
        companies = @($affectedCompanies)
    }

    $persistence = Save-BackgroundJobState -State $deltaState -Segments @('Jobs', 'BoardConfigs', 'ImportRuns', 'Companies') -MergeSegments @('Jobs', 'BoardConfigs', 'ImportRuns', 'Companies') -JobId $JobId -OperationName $OperationName

    return [ordered]@{
        state = $State
        persistence = $persistence
        timings = [ordered]@{
            mergeMs = [int]$mergeStopwatch.ElapsedMilliseconds
            companySyncMs = [int]$companySyncStopwatch.ElapsedMilliseconds
        }
        counts = [ordered]@{
            changedJobs = @($JobRunResult.changedJobs).Count
            changedConfigs = @($incomingConfigs).Count
            affectedCompanies = @($affectedCompanies).Count
        }
    }
}

function Get-BackgroundConfigSyncRecordKey {
    param($Config)

    $configId = [string](Get-ObjectValue -Object $Config -Name 'id' -Default '')
    if (-not [string]::IsNullOrWhiteSpace($configId)) {
        return $configId
    }

    $companyKey = Get-CanonicalCompanyKey $(if (Get-ObjectValue -Object $Config -Name 'normalizedCompanyName') { Get-ObjectValue -Object $Config -Name 'normalizedCompanyName' } else { Get-ObjectValue -Object $Config -Name 'companyName' })
    $atsType = [string](Get-ObjectValue -Object $Config -Name 'atsType' -Default '')
    $boardId = [string](Get-ObjectValue -Object $Config -Name 'boardId' -Default '')
    if (-not $companyKey -and -not $atsType -and -not $boardId) {
        return ''
    }

    return ('{0}|{1}|{2}' -f $companyKey, $atsType, $boardId)
}

function Get-BackgroundConfigProjectionFingerprint {
    param($Config)

    $companyKey = Get-CanonicalCompanyKey $(if (Get-ObjectValue -Object $Config -Name 'normalizedCompanyName') { Get-ObjectValue -Object $Config -Name 'normalizedCompanyName' } else { Get-ObjectValue -Object $Config -Name 'companyName' })
    return (
        [ordered]@{
            accountId = [string](Get-ObjectValue -Object $Config -Name 'accountId' -Default '')
            companyKey = [string]$companyKey
            companyName = [string](Get-ObjectValue -Object $Config -Name 'companyName' -Default '')
            atsType = [string](Get-ObjectValue -Object $Config -Name 'atsType' -Default '')
            active = [bool](Get-ObjectValue -Object $Config -Name 'active' -Default $true)
            supportedImport = [bool](Get-ObjectValue -Object $Config -Name 'supportedImport' -Default $false)
            domain = [string](Get-ObjectValue -Object $Config -Name 'domain' -Default '')
            careersUrl = [string](Get-ObjectValue -Object $Config -Name 'careersUrl' -Default '')
            resolvedBoardUrl = [string](Get-ObjectValue -Object $Config -Name 'resolvedBoardUrl' -Default '')
            discoveryStatus = [string](Get-ObjectValue -Object $Config -Name 'discoveryStatus' -Default '')
            confidenceBand = [string](Get-ObjectValue -Object $Config -Name 'confidenceBand' -Default '')
        } | ConvertTo-Json -Compress -Depth 4
    )
}

function Get-BackgroundConfigSyncDelta {
    param(
        [object[]]$BeforeConfigs = @(),
        [object[]]$AfterConfigs = @()
    )

    $beforeMap = @{}
    foreach ($config in @($BeforeConfigs)) {
        $recordKey = Get-BackgroundConfigSyncRecordKey -Config $config
        if (-not $recordKey) {
            continue
        }

        $beforeMap[$recordKey] = [ordered]@{
            companyKey = Get-CanonicalCompanyKey $(if (Get-ObjectValue -Object $config -Name 'normalizedCompanyName') { Get-ObjectValue -Object $config -Name 'normalizedCompanyName' } else { Get-ObjectValue -Object $config -Name 'companyName' })
            fingerprint = Get-BackgroundConfigProjectionFingerprint -Config $config
        }
    }

    $afterMap = @{}
    foreach ($config in @($AfterConfigs)) {
        $recordKey = Get-BackgroundConfigSyncRecordKey -Config $config
        if (-not $recordKey) {
            continue
        }

        $afterMap[$recordKey] = [ordered]@{
            companyKey = Get-CanonicalCompanyKey $(if (Get-ObjectValue -Object $config -Name 'normalizedCompanyName') { Get-ObjectValue -Object $config -Name 'normalizedCompanyName' } else { Get-ObjectValue -Object $config -Name 'companyName' })
            fingerprint = Get-BackgroundConfigProjectionFingerprint -Config $config
        }
    }

    $allKeys = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($key in @($beforeMap.Keys + $afterMap.Keys)) {
        if ($key) {
            [void]$allKeys.Add([string]$key)
        }
    }

    $affectedCompanyKeys = New-Object 'System.Collections.Generic.HashSet[string]'
    $changedCount = 0
    $removedCount = 0
    foreach ($key in @($allKeys | Sort-Object)) {
        $beforeEntry = if ($beforeMap.ContainsKey([string]$key)) { $beforeMap[[string]$key] } else { $null }
        $afterEntry = if ($afterMap.ContainsKey([string]$key)) { $afterMap[[string]$key] } else { $null }
        $changed = $false
        if (-not $beforeEntry -or -not $afterEntry) {
            $changed = $true
        } elseif ([string]$beforeEntry.fingerprint -ne [string]$afterEntry.fingerprint) {
            $changed = $true
        }

        if (-not $changed) {
            continue
        }

        $changedCount += 1
        if (-not $afterEntry) {
            $removedCount += 1
        }

        foreach ($companyKey in @([string]$(if ($beforeEntry) { $beforeEntry.companyKey } else { '' }), [string]$(if ($afterEntry) { $afterEntry.companyKey } else { '' }))) {
            $normalized = Get-CanonicalCompanyKey $companyKey
            if ($normalized) {
                [void]$affectedCompanyKeys.Add($normalized)
            }
        }
    }

    return [ordered]@{
        companyKeys = @($affectedCompanyKeys | Sort-Object)
        changedCount = [int]$changedCount
        removedCount = [int]$removedCount
    }
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
    $state = Get-AppStateView -Segments @('Workspace', 'Companies', 'BoardConfigs')
    $loadStopwatch.Stop()

    Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Refreshing company enrichment before config sync' | Out-Null
    $enrichmentIds = @(Get-AppEnrichmentCandidateCompanyIdsFast -Limit 500)
    $companyKeysToRefresh = New-Object 'System.Collections.Generic.HashSet[string]'
    if ($enrichmentIds.Count -gt 0) {
        $enrichmentResult = Invoke-CompanyEnrichment -State $state -Limit 0 -AccountIds $enrichmentIds -ProgressCallback $progressCallback
        $state = $enrichmentResult.state
        foreach ($company in @($enrichmentResult.changedCompanies)) {
            $companyKey = Get-CanonicalCompanyKey $(if (Get-ObjectValue -Object $company -Name 'normalizedName') { Get-ObjectValue -Object $company -Name 'normalizedName' } else { Get-ObjectValue -Object $company -Name 'displayName' })
            if ($companyKey) {
                [void]$companyKeysToRefresh.Add($companyKey)
            }
        }
    }

    $beforeConfigs = @($state.boardConfigs | ForEach-Object { $_ })
    $syncStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $state = Sync-BoardConfigsFromCompanies -State $state -ProgressCallback $progressCallback
    $syncStopwatch.Stop()

    $compareStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $configDelta = Get-BackgroundConfigSyncDelta -BeforeConfigs $beforeConfigs -AfterConfigs $state.boardConfigs
    $compareStopwatch.Stop()

    foreach ($companyKey in @($configDelta.companyKeys)) {
        if ($companyKey) {
            [void]$companyKeysToRefresh.Add([string]$companyKey)
        }
    }

    $companyKeysSorted = @($companyKeysToRefresh | Sort-Object)
    $scopeLoadStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $scopeState = if ($companyKeysSorted.Count -gt 0) { Get-AppScopedStateForCompanyKeys -CompanyKeys $companyKeysSorted } else { $null }
    $scopeLoadStopwatch.Stop()

    $companySyncStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $affectedCompanies = @()
    if ($companyKeysToRefresh.Count -gt 0) {
        $scopedBoardConfigs = @(
            $state.boardConfigs | Where-Object {
                $companyKey = Get-CanonicalCompanyKey $(if ($_.normalizedCompanyName) { $_.normalizedCompanyName } else { $_.companyName })
                $companyKey -and $companyKeysToRefresh.Contains([string]$companyKey)
            }
        )
        $companySyncState = [ordered]@{
            workspace = $state.workspace
            settings = $(if ($scopeState) { $scopeState.settings } else { New-DefaultSettings })
            companies = @(Get-BackgroundStateCompaniesByScope -State $state -CompanyKeys $companyKeysSorted)
            contacts = @()
            jobs = $(if ($scopeState) { @($scopeState.jobs) } else { @() })
            boardConfigs = @($scopedBoardConfigs)
            activities = @()
            importRuns = @()
        }
        $companySyncState = Sync-ImportedCompanyData -State $companySyncState -CompanyKeys $companyKeysSorted
        $affectedCompanies = @($companySyncState.companies)
    }
    $companySyncStopwatch.Stop()

    $skipBoardConfigSnapshots = (@($affectedCompanies).Count -gt 0)
    $boardConfigState = [ordered]@{
        boardConfigs = @($state.boardConfigs)
    }
    $boardConfigPersistence = Save-BackgroundJobState -State $boardConfigState -Segments @('BoardConfigs') -JobId $JobId -OperationName 'config-sync-board-configs' -SkipSnapshots:$skipBoardConfigSnapshots
    $companyPersistence = $null
    if (@($affectedCompanies).Count -gt 0) {
        $companyState = [ordered]@{
            companies = @($affectedCompanies)
        }
        $companyPersistence = Save-BackgroundJobState -State $companyState -Segments @('Companies') -MergeSegments @('Companies') -JobId $JobId -OperationName 'config-sync-companies'
    }

    return [ordered]@{
        count = @($state.boardConfigs).Count
        companies = @($state.companies).Count
        timings = [ordered]@{
            loadMs = [int]$loadStopwatch.ElapsedMilliseconds
            syncMs = [int]$syncStopwatch.ElapsedMilliseconds
            compareMs = [int]$compareStopwatch.ElapsedMilliseconds
            scopeLoadMs = [int]$scopeLoadStopwatch.ElapsedMilliseconds
            deriveMs = [int]$companySyncStopwatch.ElapsedMilliseconds
            snapshotMs = [int]$(if ($companyPersistence -and $companyPersistence.snapshot -and $companyPersistence.snapshot.durationMs) { $companyPersistence.snapshot.durationMs } elseif ($boardConfigPersistence -and $boardConfigPersistence.snapshot -and $boardConfigPersistence.snapshot.durationMs) { $boardConfigPersistence.snapshot.durationMs } else { 0 })
        }
        counts = [ordered]@{
            changedConfigs = [int]$configDelta.changedCount
            removedConfigs = [int]$configDelta.removedCount
            affectedCompanies = @($affectedCompanies).Count
        }
        persistence = [ordered]@{
            boardConfigs = $boardConfigPersistence
            companies = $companyPersistence
        }
    }
}

function Invoke-BackgroundCompanyEnrichmentJobLegacy {
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

function Invoke-BackgroundCompanyEnrichmentJob {
    param($Payload, [string]$JobId)

    if ($null -eq $Payload) {
        $Payload = [ordered]@{}
    }

    $limit = [int](Convert-ToNumber (Get-ObjectValue -Object $Payload -Name 'limit' -Default 0))
    if ($limit -lt 1) { $limit = 500 }
    [void](Set-ObjectValue -Object $Payload -Name 'limit' -Value $limit)

    $forceRefresh = [bool](Get-ObjectValue -Object $Payload -Name 'forceRefresh' -Default $false)
    [void](Set-ObjectValue -Object $Payload -Name 'forceRefresh' -Value $forceRefresh)
    $deepVerify = [bool](Get-ObjectValue -Object $Payload -Name 'deepVerify' -Default $false)
    [void](Set-ObjectValue -Object $Payload -Name 'deepVerify' -Value $deepVerify)
    $targetAccountId = [string](Get-ObjectValue -Object $Payload -Name 'accountId' -Default '')
    $isTargetedAccount = -not [string]::IsNullOrWhiteSpace($targetAccountId)

    $chunkSize = [int](Convert-ToNumber (Get-ObjectValue -Object $Payload -Name 'chunkSize' -Default 0))
    if ($chunkSize -lt 1) {
        $chunkSize = [Math]::Min(10, [Math]::Max(1, $limit))
    }
    [void](Set-ObjectValue -Object $Payload -Name 'chunkSize' -Value $chunkSize)

    $progressCallback = if ($JobId) { New-BackgroundJobProgressCallback -JobId $JobId } else { $null }
    $timings = Get-ObjectValue -Object $Payload -Name 'timings' -Default ([ordered]@{})
    if ($null -eq $timings) {
        $timings = [ordered]@{}
    }
    foreach ($timingName in @('localMs', 'candidateMs', 'loadMs', 'enrichmentMs', 'persistMs', 'checkpointMs', 'snapshotMs')) {
        [void](Set-ObjectValue -Object $timings -Name $timingName -Value ([int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name $timingName -Default 0))))
    }
    [void](Set-ObjectValue -Object $Payload -Name 'timings' -Value $timings)

    $aggregateStats = Get-ObjectValue -Object $Payload -Name 'aggregateStats' -Default $null
    if ($null -eq $aggregateStats) {
        $aggregateStats = New-CompanyEnrichmentStats
    }
    [void](Set-ObjectValue -Object $Payload -Name 'aggregateStats' -Value $aggregateStats)

    $localStats = Get-ObjectValue -Object $Payload -Name 'localStats' -Default $null
    $currentIndex = [int](Convert-ToNumber (Get-ObjectValue -Object $Payload -Name 'currentIndex' -Default 0))
    if ($currentIndex -lt 0) {
        $currentIndex = 0
    }
    [void](Set-ObjectValue -Object $Payload -Name 'currentIndex' -Value $currentIndex)

    $lastPersistence = $null

    if (-not [bool](Get-ObjectValue -Object $Payload -Name 'localStageCompleted' -Default $false)) {
        $localStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        if ($isTargetedAccount) {
            Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Skipping global local enrichment pass for targeted account run' | Out-Null
            if ($null -eq $localStats) {
                $localStats = [ordered]@{
                    contactEmailDomainApplied = 0
                    boardConfigDomainApplied = 0
                    boardConfigCareersApplied = 0
                    skippedAlreadyEnriched = 0
                    totalUpdated = 0
                    jobDomainApplied = 0
                }
            }
            Write-BackgroundJobLog ("JOB local-enrich-skip id={0} reason=targeted-account accountId={1}" -f $JobId, $targetAccountId)
        } else {
            Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Running local SQL enrichment pass (contact emails, board config domains)' | Out-Null
            if (Test-AppStoreUsesSqlite) {
                try {
                    $localStats = Invoke-BdSqliteLocalEnrichmentPass -Limit ([Math]::Max(2000, $limit * 4)) -ForceRefresh:$forceRefresh
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
        }
        $localStopwatch.Stop()
        [void](Set-ObjectValue -Object $timings -Name 'localMs' -Value ([int]$localStopwatch.ElapsedMilliseconds))
        [void](Set-ObjectValue -Object $Payload -Name 'timings' -Value $timings)
        [void](Set-ObjectValue -Object $Payload -Name 'localStats' -Value $localStats)
        [void](Set-ObjectValue -Object $Payload -Name 'localStageCompleted' -Value $true)
        [void](Set-ObjectValue -Object $Payload -Name 'localCompletedAt' -Value ((Get-Date).ToString('o')))
        if ($JobId) {
            $checkpointStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            Update-AppBackgroundJobCheckpoint -JobId $JobId -Payload $Payload -ProgressMessage 'Local enrichment complete - selecting candidate accounts' -RecordsAffected $currentIndex | Out-Null
            $checkpointStopwatch.Stop()
            [void](Set-ObjectValue -Object $timings -Name 'checkpointMs' -Value ([int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'checkpointMs' -Default 0)) + [int]$checkpointStopwatch.ElapsedMilliseconds))
            [void](Set-ObjectValue -Object $Payload -Name 'timings' -Value $timings)
        }
    }

    $candidateIds = @(
        @(Get-ObjectValue -Object $Payload -Name 'candidateIds' -Default @()) |
            Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
            ForEach-Object { [string]$_ }
    )
    if ($candidateIds.Count -eq 0) {
        Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Selecting prioritized companies for enrichment' | Out-Null
        $candidateStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $candidateIds = @(Get-AppEnrichmentCandidateCompanyIdsFast -Limit $limit -AccountId $targetAccountId -ForceRefresh:$forceRefresh)
        $candidateStopwatch.Stop()
        [void](Set-ObjectValue -Object $timings -Name 'candidateMs' -Value ([int]$candidateStopwatch.ElapsedMilliseconds))
        [void](Set-ObjectValue -Object $Payload -Name 'timings' -Value $timings)
        [void](Set-ObjectValue -Object $Payload -Name 'candidateIds' -Value @($candidateIds))
        [void](Set-ObjectValue -Object $Payload -Name 'candidateCount' -Value @($candidateIds).Count)
        [void](Set-ObjectValue -Object $Payload -Name 'candidateSelectedAt' -Value ((Get-Date).ToString('o')))
        if ($isTargetedAccount) {
            Write-BackgroundJobLog ("JOB candidate-select id={0} type=company-enrichment accountId={1} count={2} candidateMs={3}" -f `
                $JobId,
                $targetAccountId,
                @($candidateIds).Count,
                [int]$candidateStopwatch.ElapsedMilliseconds)
        }
        if ($JobId) {
            $checkpointStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            Update-AppBackgroundJobCheckpoint -JobId $JobId -Payload $Payload -ProgressMessage ('Selected {0} candidate companies' -f @($candidateIds).Count) -RecordsAffected $currentIndex | Out-Null
            $checkpointStopwatch.Stop()
            [void](Set-ObjectValue -Object $timings -Name 'checkpointMs' -Value ([int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'checkpointMs' -Default 0)) + [int]$checkpointStopwatch.ElapsedMilliseconds))
            [void](Set-ObjectValue -Object $Payload -Name 'timings' -Value $timings)
        }
    }

    $totalCount = @($candidateIds).Count
    [void](Set-ObjectValue -Object $Payload -Name 'candidateCount' -Value $totalCount)
    if ($currentIndex -gt $totalCount) {
        $currentIndex = $totalCount
        [void](Set-ObjectValue -Object $Payload -Name 'currentIndex' -Value $currentIndex)
    }

    if ($totalCount -eq 0) {
        return [ordered]@{
            localStats = $localStats
            stats = $aggregateStats
            companies = 0
            chunkSize = $chunkSize
            currentIndex = $currentIndex
            totalCount = $totalCount
            timings = [ordered]@{
                localMs = [int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'localMs' -Default 0))
                candidateMs = [int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'candidateMs' -Default 0))
                loadMs = 0
                enrichmentMs = 0
                persistMs = 0
                checkpointMs = [int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'checkpointMs' -Default 0))
                snapshotMs = 0
            }
            persistence = $null
        }
    }

    $chunkOrdinal = [int][Math]::Floor($currentIndex / [Math]::Max(1, $chunkSize))
    while ($currentIndex -lt $totalCount) {
        $chunkOrdinal += 1
        $chunkIds = @($candidateIds | Select-Object -Skip $currentIndex -First $chunkSize)
        if ($chunkIds.Count -eq 0) {
            break
        }

        $chunkTotal = [int][Math]::Ceiling($totalCount / [double][Math]::Max(1, $chunkSize))
        Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage ('Enriching company batch {0}/{1}' -f $chunkOrdinal, $chunkTotal) | Out-Null

        $chunkLoadStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $chunkState = Get-AppScopedStateForAccounts -AccountIds $chunkIds
        $chunkLoadStopwatch.Stop()
        [void](Set-ObjectValue -Object $timings -Name 'loadMs' -Value ([int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'loadMs' -Default 0)) + [int]$chunkLoadStopwatch.ElapsedMilliseconds))

        $chunkEnrichmentStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $chunkResult = Invoke-CompanyEnrichment -State $chunkState -Limit 0 -AccountIds $chunkIds -ForceRefresh:$forceRefresh -DeepVerify:$deepVerify -ProgressCallback $progressCallback -ProcessedOffset $currentIndex -TotalOverride $totalCount
        $chunkEnrichmentStopwatch.Stop()
        [void](Set-ObjectValue -Object $timings -Name 'enrichmentMs' -Value ([int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'enrichmentMs' -Default 0)) + [int]$chunkEnrichmentStopwatch.ElapsedMilliseconds))

        $aggregateStats = Merge-CompanyEnrichmentStats -BaseStats $aggregateStats -DeltaStats $chunkResult.stats
        [void](Set-ObjectValue -Object $Payload -Name 'aggregateStats' -Value $aggregateStats)

        $chunkPersistenceStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $lastPersistence = Save-BackgroundJobState -State ([ordered]@{
                companies = @($chunkResult.state.companies)
            }) -Segments @('Companies') -MergeSegments @('Companies') -JobId $JobId -OperationName ('company-enrichment-chunk-{0}' -f $chunkOrdinal) -SkipSnapshots
        $chunkPersistenceStopwatch.Stop()
        [void](Set-ObjectValue -Object $timings -Name 'persistMs' -Value ([int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'persistMs' -Default 0)) + [int]$chunkPersistenceStopwatch.ElapsedMilliseconds))

        $currentIndex += $chunkIds.Count
        [void](Set-ObjectValue -Object $Payload -Name 'currentIndex' -Value $currentIndex)
        [void](Set-ObjectValue -Object $Payload -Name 'candidateCount' -Value $totalCount)
        [void](Set-ObjectValue -Object $Payload -Name 'timings' -Value $timings)
        [void](Set-ObjectValue -Object $Payload -Name 'localStats' -Value $localStats)
        [void](Set-ObjectValue -Object $Payload -Name 'lastChunkCompletedAt' -Value ((Get-Date).ToString('o')))
        [void](Set-ObjectValue -Object $Payload -Name 'lastChunk' -Value ([ordered]@{
                chunkNumber = $chunkOrdinal
                chunkTotal = $chunkTotal
                processed = $currentIndex
                total = $totalCount
                loadMs = [int]$chunkLoadStopwatch.ElapsedMilliseconds
                enrichmentMs = [int]$chunkEnrichmentStopwatch.ElapsedMilliseconds
                persistMs = [int]$chunkPersistenceStopwatch.ElapsedMilliseconds
                companies = @($chunkResult.state.companies).Count
            }))

        if ($JobId) {
            $checkpointStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            Update-AppBackgroundJobCheckpoint -JobId $JobId -Payload $Payload -ProgressMessage ('Checkpoint saved - {0}/{1} companies enriched' -f $currentIndex, $totalCount) -RecordsAffected $currentIndex | Out-Null
            $checkpointStopwatch.Stop()
            [void](Set-ObjectValue -Object $timings -Name 'checkpointMs' -Value ([int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'checkpointMs' -Default 0)) + [int]$checkpointStopwatch.ElapsedMilliseconds))
            [void](Set-ObjectValue -Object $Payload -Name 'timings' -Value $timings)
            Write-BackgroundJobLog ("JOB checkpoint id={0} type=company-enrichment chunk={1}/{2} processed={3}/{4} loadMs={5} enrichmentMs={6} persistMs={7} checkpointMs={8}" -f `
                $JobId,
                $chunkOrdinal,
                $chunkTotal,
                $currentIndex,
                $totalCount,
                [int]$chunkLoadStopwatch.ElapsedMilliseconds,
                [int]$chunkEnrichmentStopwatch.ElapsedMilliseconds,
                [int]$chunkPersistenceStopwatch.ElapsedMilliseconds,
                [int]$checkpointStopwatch.ElapsedMilliseconds)
        }
    }

    $deferredSnapshots = $null
    $hasPersistenceMutations = $false
    if ($lastPersistence) {
        foreach ($segmentResult in @($lastPersistence.segments)) {
            if ([int](Convert-ToNumber (Get-ObjectValue -Object $segmentResult -Name 'upserted' -Default 0)) -gt 0 -or
                [int](Convert-ToNumber (Get-ObjectValue -Object $segmentResult -Name 'deleted' -Default 0)) -gt 0) {
                $hasPersistenceMutations = $true
                break
            }
        }
    }
    if ($lastPersistence -and $hasPersistenceMutations) {
        $deferredSnapshots = Mark-AppSnapshotsDirty -Names @('filters') -Reason 'company-enrichment' -DataRevision ([string]$lastPersistence.dataRevision)
        Write-BackgroundJobLog ("JOB snapshot-deferred id={0} operation=company-enrichment names={1} reason={2} dataRevision={3}" -f $JobId, ([string]::Join(',', @($deferredSnapshots.names))), [string]$deferredSnapshots.reason, [string]$deferredSnapshots.dataRevision)
    } elseif ($lastPersistence) {
        Write-BackgroundJobLog ("JOB snapshot-skip id={0} operation=company-enrichment reason=no_mutations" -f $JobId)
    }

    return [ordered]@{
        localStats = $localStats
        stats = $aggregateStats
        companies = $currentIndex
        chunkSize = $chunkSize
        currentIndex = $currentIndex
        totalCount = $totalCount
        timings = [ordered]@{
            localMs = [int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'localMs' -Default 0))
            candidateMs = [int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'candidateMs' -Default 0))
            loadMs = [int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'loadMs' -Default 0))
            enrichmentMs = [int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'enrichmentMs' -Default 0))
            persistMs = [int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'persistMs' -Default 0))
            checkpointMs = [int](Convert-ToNumber (Get-ObjectValue -Object $timings -Name 'checkpointMs' -Default 0))
            snapshotMs = 0
        }
        deferredSnapshots = $deferredSnapshots
        persistence = $lastPersistence
    }
}

function Invoke-BackgroundAtsDiscoveryJob {
    param($Payload, [string]$JobId)

    $limit = [int]$Payload.limit
    if ($limit -lt 1) { $limit = 300 }
    $deepVerify = [bool](Get-ObjectValue -Object $Payload -Name 'deepVerify' -Default $false)
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
    $result = Invoke-AtsDiscovery -State $state -Limit $limit -OnlyMissing:([bool]$Payload.onlyMissing) -SkipSync -SkipDerivedData -ConfigId ([string]$Payload.configId) -ConfigIds $candidateConfigIds -ForceRefresh:([bool]$Payload.forceRefresh) -DeepVerify:$deepVerify -ProgressCallback $progressCallback
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

function Invoke-BackgroundTargetScoreRolloutJob {
    param($Payload, [string]$JobId)

    $limit = [int](Convert-ToNumber (Get-ObjectValue -Object $Payload -Name 'limit' -Default 150))
    if ($limit -lt 1) { $limit = 150 }
    $maxBatches = [int](Convert-ToNumber (Get-ObjectValue -Object $Payload -Name 'maxBatches' -Default 6))
    if ($maxBatches -lt 1) { $maxBatches = 6 }

    if ($JobId) {
        Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage ('Repairing target-score intelligence backlog - 0/{0}' -f $maxBatches) | Out-Null
    }

    $result = Repair-AppTargetScoreRollout -Limit $limit -Persist -MaxBatches $maxBatches -SkipSnapshots -BatchCallback {
        param($Batch)

        $deriveDetails = Get-ObjectValue -Object $Batch -Name 'deriveDetails' -Default $null
        Write-BackgroundJobLog ("JOB rollout-batch id={0} batch={1} accountCount={2} remaining={3} scopeLoadMs={4} deriveMs={5} persistMs={6} groupingMs={7} projectionMs={8} sortMs={9}" -f `
                $JobId,
                [int](Convert-ToNumber (Get-ObjectValue -Object $Batch -Name 'batch' -Default 0)),
                [int](Convert-ToNumber (Get-ObjectValue -Object $Batch -Name 'accountCount' -Default 0)),
                [int](Convert-ToNumber (Get-ObjectValue -Object $Batch -Name 'remainingCount' -Default 0)),
                [int](Convert-ToNumber (Get-ObjectValue -Object $Batch -Name 'scopeLoadMs' -Default 0)),
                [int](Convert-ToNumber (Get-ObjectValue -Object $Batch -Name 'deriveMs' -Default 0)),
                [int](Convert-ToNumber (Get-ObjectValue -Object $Batch -Name 'persistMs' -Default 0)),
                [int](Convert-ToNumber (Get-ObjectValue -Object $deriveDetails -Name 'groupingMs' -Default 0)),
                [int](Convert-ToNumber (Get-ObjectValue -Object $deriveDetails -Name 'projectionMs' -Default 0)),
                [int](Convert-ToNumber (Get-ObjectValue -Object $deriveDetails -Name 'sortMs' -Default 0)))

        if ($JobId) {
            Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage ('Repairing target-score intelligence backlog - batch {0}/{1} - {2} accounts - {3} remaining' -f `
                    [int](Convert-ToNumber (Get-ObjectValue -Object $Batch -Name 'batch' -Default 0)),
                    $maxBatches,
                    [int](Convert-ToNumber (Get-ObjectValue -Object $Batch -Name 'accountCount' -Default 0)),
                    [int](Convert-ToNumber (Get-ObjectValue -Object $Batch -Name 'remainingCount' -Default 0))) | Out-Null
        }
    }

    return [ordered]@{
        count = [int](Convert-ToNumber (Get-ObjectValue -Object $result -Name 'accountCount' -Default 0))
        accountCount = [int](Convert-ToNumber (Get-ObjectValue -Object $result -Name 'accountCount' -Default 0))
        batchCount = [int](Convert-ToNumber (Get-ObjectValue -Object $result -Name 'batchCount' -Default 0))
        remainingCount = [int](Convert-ToNumber (Get-ObjectValue -Object $result -Name 'remainingCount' -Default 0))
        maxTargetScore = [int](Convert-ToNumber (Get-ObjectValue -Object $result -Name 'maxTargetScore' -Default 0))
        batches = @(Get-ObjectValue -Object $result -Name 'batches' -Default @())
        timings = [ordered]@{
            scopeLoadMs = [int](Convert-ToNumber (Get-ObjectValue -Object $result -Name 'scopeLoadMs' -Default 0))
            deriveMs = [int](Convert-ToNumber (Get-ObjectValue -Object $result -Name 'deriveMs' -Default 0))
            persistMs = [int](Convert-ToNumber (Get-ObjectValue -Object $result -Name 'persistMs' -Default 0))
            snapshotRefreshMs = [int](Convert-ToNumber (Get-ObjectValue -Object $result -Name 'snapshotRefreshMs' -Default 0))
        }
    }
}

function Invoke-BackgroundLiveJobImportJob {
    param($Payload, [string]$JobId)

    $progressCallback = if ($JobId) { New-BackgroundJobProgressCallback -JobId $JobId } else { $null }
    $loadStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $loadSegments = if ($Payload.discoverFirst) {
        @('Workspace', 'Companies', 'Contacts', 'Jobs', 'BoardConfigs', 'ImportRuns')
    } else {
        @('Workspace', 'Companies', 'Jobs', 'BoardConfigs', 'ImportRuns')
    }
    $state = Get-AppStateView -Segments $loadSegments
    $loadStopwatch.Stop()
    $enrichmentCompanyIds = @()
    $discoveryChangedConfigs = @()
    if ($Payload.discoverFirst) {
        Update-AppBackgroundJobProgress -JobId $JobId -ProgressMessage 'Refreshing company enrichment before ATS discovery' | Out-Null
        $enrichmentIds = @(Get-AppEnrichmentCandidateCompanyIdsFast -Limit 40)
        if ($enrichmentIds.Count -gt 0) {
            $enrichmentResult = Invoke-CompanyEnrichment -State $state -Limit 0 -AccountIds $enrichmentIds -ProgressCallback $progressCallback
            $state = $enrichmentResult.state
            $enrichmentCompanyIds = @(
                @($enrichmentResult.changedCompanies) |
                    ForEach-Object { [string](Get-ObjectValue -Object $_ -Name 'id' -Default '') } |
                    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
                    Select-Object -Unique
            )
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
        $discoveryChangedConfigs = @($discovery.changedConfigs)
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
    $applyResult = Apply-LiveJobImportDelta -State $state -JobRunResult $jobRunResult -AdditionalBoardConfigs $discoveryChangedConfigs -AdditionalCompanyIds $enrichmentCompanyIds -JobId $JobId -OperationName 'live-job-import'
    $state = $applyResult.state
    $persistence = $applyResult.persistence
    Write-BackgroundJobLog ("JOB live-import-refresh id={0} changedJobs={1} changedConfigs={2} affectedCompanies={3} mergeMs={4} companySyncMs={5}" -f `
            $JobId,
            [int]$applyResult.counts.changedJobs,
            [int]$applyResult.counts.changedConfigs,
            [int]$applyResult.counts.affectedCompanies,
            [int]$applyResult.timings.mergeMs,
            [int]$applyResult.timings.companySyncMs)

    return [ordered]@{
        importRun = $jobRunResult.importRun
        discoveryStats = $discoveryStats
        timings = [ordered]@{
            loadMs = [int]$loadStopwatch.ElapsedMilliseconds
            discoveryMs = $discoveryMs
            importMs = [int]$jobImportStopwatch.ElapsedMilliseconds
            mergeMs = [int]$applyResult.timings.mergeMs
            deriveMs = [int]$applyResult.timings.companySyncMs
            snapshotMs = [int]$(if ($persistence.snapshot -and $persistence.snapshot.durationMs) { $persistence.snapshot.durationMs } else { 0 })
        }
        counts = $applyResult.counts
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
            'target-score-rollout' {
                Update-AppBackgroundJobProgress -JobId $Job.id -ProgressMessage 'Repairing target-score intelligence backlog' | Out-Null
                Invoke-BackgroundTargetScoreRolloutJob -Payload $payload -JobId $Job.id
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

            Invoke-BackgroundJobHandler -Job $job
            $idleDeadline = (Get-Date).AddSeconds($IdleTimeoutSeconds)
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
