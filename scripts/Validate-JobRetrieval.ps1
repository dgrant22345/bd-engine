param(
    [switch]$SkipImport
)

# Import the modules
$projectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Resolve-Path '.').Path }
Set-Location $projectRoot

Import-Module (Join-Path $projectRoot 'server/Modules/BdEngine.Domain.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'server/Modules/BdEngine.Data.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'server/Modules/BdEngine.SqliteStore.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'server/Modules/BdEngine.State.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'server/Modules/BdEngine.JobImport.psm1') -Force -DisableNameChecking

$env:BD_ENGINE_DIAGNOSTICS = '1'

# Load state
Write-Host "Loading state..." -ForegroundColor Cyan
$state = Get-AppStateView -Segments @('Workspace', 'Settings', 'Companies', 'BoardConfigs', 'Jobs')

$companyLookup = @{}
foreach ($c in @($state.companies)) {
    $companyLookup[[string]$c.id] = $c
}

$allConfigs = @($state.boardConfigs)
Write-Host "Total configs: $($allConfigs.Count)" -ForegroundColor Cyan

# Identify resolved configs (excluding the original 11 that were already resolved before our fixes)
$originalResolved = @('1password', 'amd', 'coinbase', 'databricks', 'datadog', 'deloitte', 'instacart', 'lightspeed commerce', 'robinhood', 'samsara', 'stripe')
$resolvedConfigs = @($allConfigs | Where-Object {
    $atsType = [string](Get-ObjectValue -Object $_ -Name 'atsType' -Default '')
    $atsType -and $atsType -ne 'unknown' -and $atsType -ne 'other'
})
$newlyResolved = @($resolvedConfigs | Where-Object {
    $name = [string](Get-ObjectValue -Object $_ -Name 'companyName' -Default '')
    $name.ToLowerInvariant() -notin $originalResolved
})
$originalConfigs = @($resolvedConfigs | Where-Object {
    $name = [string](Get-ObjectValue -Object $_ -Name 'companyName' -Default '')
    $name.ToLowerInvariant() -in $originalResolved
})

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  NEWLY DISCOVERED CONFIGS: $($newlyResolved.Count)" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

# Also find missing-input configs from recent discovery
$missingInputConfigs = @($allConfigs | Where-Object {
    $status = [string](Get-ObjectValue -Object $_ -Name 'discoveryStatus' -Default '')
    $failReason = [string](Get-ObjectValue -Object $_ -Name 'failureReason' -Default '')
    $status -eq 'unresolved' -and $failReason -match 'missing|Missing'
})

# ==============================
# PART 1: Job retrieval for newly resolved configs
# ==============================
Write-Host ""
Write-Host "=============================================" -ForegroundColor Yellow
Write-Host "  PART 1: JOB RETRIEVAL VALIDATION" -ForegroundColor Yellow
Write-Host "=============================================" -ForegroundColor Yellow

$importResults = @()
$allTestConfigs = @($newlyResolved) + @($originalConfigs)

foreach ($config in $allTestConfigs) {
    $companyName = [string](Get-ObjectValue -Object $config -Name 'companyName' -Default '?')
    $atsType = [string](Get-ObjectValue -Object $config -Name 'atsType' -Default '')
    $boardId = [string](Get-ObjectValue -Object $config -Name 'boardId' -Default '')
    $domain = [string](Get-ObjectValue -Object $config -Name 'domain' -Default '')
    $careersUrl = [string](Get-ObjectValue -Object $config -Name 'careersUrl' -Default '')
    $resolvedBoardUrl = [string](Get-ObjectValue -Object $config -Name 'resolvedBoardUrl' -Default '')
    $confidenceBand = [string](Get-ObjectValue -Object $config -Name 'confidenceBand' -Default '')
    $active = Get-ObjectValue -Object $config -Name 'active' -Default $false
    $isNew = $companyName.ToLowerInvariant() -notin $originalResolved

    $acct = $companyLookup[[string](Get-ObjectValue -Object $config -Name 'accountId' -Default '')]
    if (-not $domain -and $acct) {
        $domain = [string](Get-ObjectValue -Object $acct -Name 'domain' -Default '')
    }
    if (-not $careersUrl -and $acct) {
        $careersUrl = [string](Get-ObjectValue -Object $acct -Name 'careersUrl' -Default '')
    }

    $result = [ordered]@{
        companyName = $companyName
        isNewlyDiscovered = $isNew
        domain = $domain
        atsType = $atsType
        boardId = $boardId
        careersUrl = $careersUrl
        resolvedBoardUrl = $resolvedBoardUrl
        confidenceBand = $confidenceBand
        active = $active
        rawJobsFetched = 0
        jobsAfterFilter = 0
        canadaJobs = 0
        gtaJobs = 0
        finalJobsPersisted = 0
        terminalStatus = ''
        failureClassification = ''
        errorMessage = ''
        elapsed = 0
    }

    Write-Host ""
    Write-Host ("--- {0} (ats={1}, board={2}) ---" -f $companyName, $atsType, $boardId) -ForegroundColor Cyan

    if (-not $SkipImport) {
        try {
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $jobs = @(Get-JobsForConfig -Config $config)
            $sw.Stop()
            $result.elapsed = [int]$sw.ElapsedMilliseconds
            $result.rawJobsFetched = $jobs.Count

            Write-Host ("  Raw jobs fetched: {0} ({1}ms)" -f $jobs.Count, $result.elapsed)

            # Apply Canada filter
            $canadaJobs = @()
            $filteredOut = 0
            foreach ($job in $jobs) {
                $location = [string](Get-ObjectValue -Object $job -Name 'location' -Default '')
                if (Test-CanadaLocation -Location $location) {
                    $canadaJobs += $job
                    if (Test-GtaLocation -Location $location) {
                        $result.gtaJobs += 1
                    }
                } else {
                    $filteredOut += 1
                }
            }
            $result.jobsAfterFilter = $canadaJobs.Count
            $result.canadaJobs = $canadaJobs.Count

            Write-Host ("  After Canada filter: {0} kept, {1} filtered out" -f $canadaJobs.Count, $filteredOut)
            Write-Host ("  GTA jobs: {0}" -f $result.gtaJobs)

            # Count existing persisted jobs for this config
            $configId = [string](Get-ObjectValue -Object $config -Name 'id' -Default '')
            $existingJobs = @($state.jobs | Where-Object {
                ([string](Get-ObjectValue -Object $_ -Name 'configKey' -Default '')) -eq $configId -or
                ([string](Get-ObjectValue -Object $_ -Name 'normalizedCompanyName' -Default '')) -eq [string](Get-ObjectValue -Object $config -Name 'normalizedCompanyName' -Default '')
            })
            $result.finalJobsPersisted = $existingJobs.Count

            # Determine terminal status
            if ($jobs.Count -gt 0 -and $canadaJobs.Count -gt 0) {
                $result.terminalStatus = 'imported_jobs'
            } elseif ($jobs.Count -gt 0 -and $canadaJobs.Count -eq 0) {
                $result.terminalStatus = 'imported_zero_after_filter'
                $result.failureClassification = 'location_filter_removed_all'
            } elseif ($jobs.Count -eq 0) {
                $result.terminalStatus = 'no_jobs_fetched'
                $result.failureClassification = 'no_actual_openings'
            }

            Write-Host ("  Terminal status: {0}" -f $result.terminalStatus) -ForegroundColor $(if ($result.terminalStatus -eq 'imported_jobs') { 'Green' } else { 'Yellow' })

        } catch {
            $sw.Stop()
            $result.elapsed = [int]$sw.ElapsedMilliseconds
            $errMsg = [string]$_.Exception.Message
            $result.terminalStatus = 'fetch_error'
            $result.errorMessage = $errMsg
            Write-Host ("  ERROR: {0}" -f $errMsg) -ForegroundColor Red

            # Classify the error
            if ($errMsg -match '403|Forbidden|Access Denied|blocked|captcha') {
                $result.failureClassification = 'anti_bot_blocking'
            } elseif ($errMsg -match '404|Not Found') {
                $result.failureClassification = 'wrong_endpoint'
            } elseif ($errMsg -match '500|502|503|timeout|timed out') {
                $result.failureClassification = 'endpoint_unavailable'
            } elseif ($errMsg -match 'parse|JSON|convert|property.*cannot be found') {
                $result.failureClassification = 'parser_failure'
            } else {
                $result.failureClassification = 'unknown_fetch_error'
            }
        }
    }

    $importResults += $result
}

# ==============================
# PART 2: Report for newly discovered
# ==============================
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  REPORT: NEWLY DISCOVERED COMPANIES" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

$newResults = @($importResults | Where-Object { $_.isNewlyDiscovered })
foreach ($r in $newResults) {
    $statusColor = switch ($r.terminalStatus) {
        'imported_jobs' { 'Green' }
        'imported_zero_after_filter' { 'Yellow' }
        'no_jobs_fetched' { 'DarkYellow' }
        'fetch_error' { 'Red' }
        default { 'White' }
    }
    Write-Host ""
    Write-Host ("  {0}" -f $r.companyName) -ForegroundColor $statusColor
    Write-Host ("    domain={0}" -f $r.domain)
    Write-Host ("    ats={0} | boardId={1} | confidence={2}" -f $r.atsType, $r.boardId, $r.confidenceBand)
    Write-Host ("    careersUrl={0}" -f $r.careersUrl)
    Write-Host ("    rawFetched={0} | afterFilter={1} | canada={2} | gta={3}" -f $r.rawJobsFetched, $r.jobsAfterFilter, $r.canadaJobs, $r.gtaJobs)
    Write-Host ("    persisted={0} | elapsed={1}ms" -f $r.finalJobsPersisted, $r.elapsed)
    Write-Host ("    TERMINAL: {0}" -f $r.terminalStatus) -ForegroundColor $statusColor
    if ($r.failureClassification) {
        Write-Host ("    CLASSIFICATION: {0}" -f $r.failureClassification) -ForegroundColor Red
    }
    if ($r.errorMessage) {
        Write-Host ("    ERROR: {0}" -f $r.errorMessage) -ForegroundColor Red
    }
}

# ==============================
# PART 3: Report for original resolved
# ==============================
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  REPORT: ORIGINAL RESOLVED COMPANIES" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$origResults = @($importResults | Where-Object { -not $_.isNewlyDiscovered })
foreach ($r in $origResults) {
    $statusColor = switch ($r.terminalStatus) {
        'imported_jobs' { 'Green' }
        'imported_zero_after_filter' { 'Yellow' }
        'no_jobs_fetched' { 'DarkYellow' }
        'fetch_error' { 'Red' }
        default { 'White' }
    }
    Write-Host ""
    Write-Host ("  {0}" -f $r.companyName) -ForegroundColor $statusColor
    Write-Host ("    ats={0} | boardId={1} | rawFetched={2} | afterFilter={3} | gta={4}" -f $r.atsType, $r.boardId, $r.rawJobsFetched, $r.jobsAfterFilter, $r.gtaJobs)
    Write-Host ("    TERMINAL: {0}" -f $r.terminalStatus) -ForegroundColor $statusColor
    if ($r.failureClassification) {
        Write-Host ("    CLASSIFICATION: {0}" -f $r.failureClassification) -ForegroundColor Red
    }
}

# ==============================
# PART 4: Missing-input companies
# ==============================
Write-Host ""
Write-Host "=============================================" -ForegroundColor Magenta
Write-Host "  PART 4: MISSING-INPUT COMPANIES ($($missingInputConfigs.Count))" -ForegroundColor Magenta
Write-Host "=============================================" -ForegroundColor Magenta

$missingReport = @()
foreach ($config in ($missingInputConfigs | Select-Object -First 50)) {
    $companyName = [string](Get-ObjectValue -Object $config -Name 'companyName' -Default '?')
    $configDomain = [string](Get-ObjectValue -Object $config -Name 'domain' -Default '')
    $configCareers = [string](Get-ObjectValue -Object $config -Name 'careersUrl' -Default '')
    $accountId = [string](Get-ObjectValue -Object $config -Name 'accountId' -Default '')
    $acct = $companyLookup[$accountId]
    $acctDomain = if ($acct) { [string](Get-ObjectValue -Object $acct -Name 'domain' -Default '') } else { '' }
    $acctCareers = if ($acct) { [string](Get-ObjectValue -Object $acct -Name 'careersUrl' -Default '') } else { '' }
    $acctLinkedin = if ($acct) { [string](Get-ObjectValue -Object $acct -Name 'linkedinCompanySlug' -Default '') } else { '' }

    $missingFields = @()
    if (-not $configDomain -and -not $acctDomain) { $missingFields += 'domain' }
    if (-not $configCareers -and -not $acctCareers) { $missingFields += 'careersUrl' }
    if (-not $acctLinkedin) { $missingFields += 'linkedinSlug' }

    # Can domain be inferred from name?
    $inferrable = $false
    $inferMethod = ''
    $slug = ($companyName -replace '[^a-zA-Z0-9]', '').ToLowerInvariant()
    if ($companyName -match '^\w+$' -or $companyName -match '^\w+\s+(Inc|Ltd|Corp|Co|Group|Technologies|Software|Solutions|Digital|Canada)?\.?$') {
        $inferrable = $true
        $inferMethod = 'simple_name_to_domain (e.g. ' + $slug + '.com)'
    }

    $entry = [ordered]@{
        companyName = $companyName
        missingFields = $missingFields -join ', '
        hasDomain = [bool]($configDomain -or $acctDomain)
        hasCareers = [bool]($configCareers -or $acctCareers)
        hasLinkedin = [bool]$acctLinkedin
        inferrable = $inferrable
        inferMethod = $inferMethod
    }
    $missingReport += $entry

    Write-Host ("  {0}" -f $companyName) -ForegroundColor White
    Write-Host ("    missing: {0}" -f ($missingFields -join ', ')) -ForegroundColor Yellow
    if ($inferrable) {
        Write-Host ("    inferrable: {0}" -f $inferMethod) -ForegroundColor DarkCyan
    }
}

# ==============================
# PART 5: Summary
# ==============================
Write-Host ""
Write-Host "=============================================" -ForegroundColor White
Write-Host "  SUMMARY" -ForegroundColor White
Write-Host "=============================================" -ForegroundColor White

$successfulImports = @($importResults | Where-Object { $_.terminalStatus -eq 'imported_jobs' })
$filteredAll = @($importResults | Where-Object { $_.terminalStatus -eq 'imported_zero_after_filter' })
$noJobs = @($importResults | Where-Object { $_.terminalStatus -eq 'no_jobs_fetched' })
$fetchErrors = @($importResults | Where-Object { $_.terminalStatus -eq 'fetch_error' })

$newSuccess = @($newResults | Where-Object { $_.terminalStatus -eq 'imported_jobs' })
$newFilteredAll = @($newResults | Where-Object { $_.terminalStatus -eq 'imported_zero_after_filter' })
$newNoJobs = @($newResults | Where-Object { $_.terminalStatus -eq 'no_jobs_fetched' })
$newFetchErrors = @($newResults | Where-Object { $_.terminalStatus -eq 'fetch_error' })

Write-Host ""
Write-Host "  ALL RESOLVED CONFIGS ($($importResults.Count) total):" -ForegroundColor Cyan
Write-Host ("    Successful imports (jobs found + Canada match): {0}" -f $successfulImports.Count) -ForegroundColor Green
Write-Host ("    All filtered by location:                      {0}" -f $filteredAll.Count) -ForegroundColor Yellow
Write-Host ("    No jobs fetched:                                {0}" -f $noJobs.Count)
Write-Host ("    Fetch errors:                                   {0}" -f $fetchErrors.Count) -ForegroundColor Red

Write-Host ""
Write-Host "  NEWLY DISCOVERED ($($newResults.Count) total):" -ForegroundColor Cyan
Write-Host ("    Successful imports:  {0}" -f $newSuccess.Count) -ForegroundColor Green
Write-Host ("    Filtered by Canada:  {0}" -f $newFilteredAll.Count) -ForegroundColor Yellow
Write-Host ("    No jobs fetched:     {0}" -f $newNoJobs.Count)
Write-Host ("    Fetch errors:        {0}" -f $newFetchErrors.Count) -ForegroundColor Red

Write-Host ""
Write-Host "  MISSING INPUTS:" -ForegroundColor Cyan
$domainMissing = @($missingReport | Where-Object { $_.missingFields -match 'domain' }).Count
$careersOnlyMissing = @($missingReport | Where-Object { $_.missingFields -notmatch 'domain' -and $_.missingFields -match 'careersUrl' }).Count
$inferrableCount = @($missingReport | Where-Object { $_.inferrable }).Count
Write-Host ("    Total missing-input configs:  {0}" -f $missingInputConfigs.Count)
Write-Host ("    Missing domain:               {0}" -f $domainMissing)
Write-Host ("    Careers only missing:         {0}" -f $careersOnlyMissing)
Write-Host ("    Domain inferrable from name:  {0}" -f $inferrableCount)

Write-Host ""
$totalJobs = ($importResults | ForEach-Object { $_.rawJobsFetched } | Measure-Object -Sum).Sum
$totalCanada = ($importResults | ForEach-Object { $_.canadaJobs } | Measure-Object -Sum).Sum
$totalGta = ($importResults | ForEach-Object { $_.gtaJobs } | Measure-Object -Sum).Sum
Write-Host "  TOTAL JOBS:" -ForegroundColor Cyan
Write-Host ("    Raw fetched:    {0}" -f $totalJobs)
Write-Host ("    Canada kept:    {0}" -f $totalCanada)
Write-Host ("    GTA kept:       {0}" -f $totalGta)

Write-Host ""
Write-Host "  RECOMMENDATIONS:" -ForegroundColor Cyan
Write-Host "    1. Run web-search enrichment to populate domains for missing-input companies"
Write-Host "    2. Add name-to-domain inference (companyname.com, companyname.ca) as a fallback"
Write-Host "    3. Companies with all jobs filtered by location are working correctly - consider"
Write-Host "       adding 'Remote' as a Canada-eligible location to capture remote-friendly roles"
Write-Host "    4. For unsupported ATS types (workday, custom_enterprise), consider adding API"
Write-Host "       integrations or HTML scraping as a future enhancement"
Write-Host ""
