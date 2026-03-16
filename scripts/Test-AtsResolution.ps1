<#
.SYNOPSIS
    Deterministic test harness for the ATS resolution and job discovery pipeline.
    Tests 12 known companies across different ATS providers to validate detection,
    careers URL resolution, and job fetching.

.DESCRIPTION
    Run this script to verify the end-to-end ATS discovery pipeline is working.
    Set $env:BD_ENGINE_DIAGNOSTICS = '1' before running for verbose trace output.

.EXAMPLE
    $env:BD_ENGINE_DIAGNOSTICS = '1'
    .\scripts\Test-AtsResolution.ps1
#>

param(
    [switch]$Verbose,
    [switch]$SkipJobFetch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\server\Modules'
Import-Module (Join-Path $modulePath 'BdEngine.State.psm1') -DisableNameChecking -Force
Import-Module (Join-Path $modulePath 'BdEngine.Domain.psm1') -DisableNameChecking -Force
Import-Module (Join-Path $modulePath 'BdEngine.JobImport.psm1') -DisableNameChecking -Force

if ($Verbose) {
    $env:BD_ENGINE_DIAGNOSTICS = '1'
}

# --- Test cases: known companies with expected ATS ---
$testCases = @(
    @{ company = 'Stripe'; domain = 'stripe.com'; careersUrl = 'https://stripe.com/jobs'; expectedAts = 'greenhouse'; expectedBoardId = 'stripe' }
    @{ company = 'Plaid'; domain = 'plaid.com'; careersUrl = 'https://plaid.com/careers'; expectedAts = 'lever'; expectedBoardId = 'plaid' }
    @{ company = 'OpenAI'; domain = 'openai.com'; careersUrl = 'https://openai.com/careers'; expectedAts = 'ashby'; expectedBoardId = 'openai' }
    @{ company = 'Lightspeed'; domain = 'careers.lightspeedhq.com'; careersUrl = 'https://careers.lightspeedhq.com'; expectedAts = 'greenhouse'; expectedBoardId = 'lightspeedhq' }
    @{ company = 'Instacart'; domain = 'instacart.careers'; careersUrl = 'https://instacart.careers'; expectedAts = 'greenhouse'; expectedBoardId = 'instacart' }
    @{ company = 'Datadog'; domain = 'datadoghq.com'; careersUrl = 'https://careers.datadoghq.com'; expectedAts = 'greenhouse'; expectedBoardId = 'datadog' }
    @{ company = 'Figma'; domain = 'figma.com'; careersUrl = 'https://www.figma.com/careers'; expectedAts = 'greenhouse'; expectedBoardId = 'figma' }
    @{ company = 'Gusto'; domain = 'gusto.com'; careersUrl = 'https://gusto.com/careers'; expectedAts = 'greenhouse'; expectedBoardId = 'gusto' }
    @{ company = 'Asana'; domain = 'asana.com'; careersUrl = 'https://asana.com/jobs'; expectedAts = 'greenhouse'; expectedBoardId = 'asana' }
    @{ company = 'Samsara'; domain = 'samsara.com'; careersUrl = 'https://www.samsara.com/company/careers'; expectedAts = 'greenhouse'; expectedBoardId = 'samsara' }
    @{ company = 'Notion'; domain = 'notion.so'; careersUrl = 'https://www.notion.so/careers'; expectedAts = 'ashby'; expectedBoardId = 'notion' }
    @{ company = 'Brex'; domain = 'brex.com'; careersUrl = 'https://www.brex.com/careers'; expectedAts = 'greenhouse'; expectedBoardId = 'brex' }
)

# --- Run tests ---
Write-Host "`n=== ATS Resolution Test Harness ===" -ForegroundColor Cyan
Write-Host "Testing $($testCases.Count) companies...`n"

Clear-PipelineDiagnostics

$results = @()
$passed = 0
$failed = 0

foreach ($tc in $testCases) {
    $startTime = Get-Date

    # Build minimal company and config objects
    $company = [ordered]@{
        id = "test-$($tc.company.ToLower())"
        displayName = $tc.company
        normalizedName = (Normalize-TextKey $tc.company)
        domain = $tc.domain
        careersUrl = $tc.careersUrl
        canonicalDomain = $tc.domain
        aliases = @()
    }
    $config = [ordered]@{
        id = "cfg-test-$($tc.company.ToLower())"
        accountId = $company.id
        companyName = $tc.company
        normalizedCompanyName = $company.normalizedName
        atsType = ''
        boardId = ''
        domain = $tc.domain
        careersUrl = $tc.careersUrl
        discoveryStatus = ''
        discoveryMethod = ''
        confidenceScore = 0
        confidenceBand = 'unresolved'
    }

    # Run discovery
    $result = Get-DiscoveryResultForConfig -Company $company -Config $config
    $elapsed = ((Get-Date) - $startTime).TotalMilliseconds

    $detectedAts = [string]$result.atsType
    $detectedBoardId = [string]$result.boardId
    $resolvedCareersUrl = [string]$result.careersUrl
    $confidence = [double]$result.confidenceScore
    $band = [string]$result.confidenceBand
    $method = [string]$result.discoveryMethod

    # Check job fetch if enabled
    $jobCount = 0
    $jobFetchError = ''
    if (-not $SkipJobFetch -and $detectedAts -and $result.supportedImport) {
        try {
            $importConfig = [ordered]@{
                atsType = $detectedAts
                boardId = $detectedBoardId
                careersUrl = $resolvedCareersUrl
                source = [string]$result.source
            }
            $jobs = Get-JobsForConfig -Config $importConfig
            $jobCount = @($jobs).Count
        } catch {
            $jobFetchError = $_.Exception.Message
        }
    }

    # Evaluate pass/fail
    $atsMatch = ($detectedAts -eq $tc.expectedAts)
    $boardMatch = ($detectedBoardId -eq $tc.expectedBoardId)
    $pass = $atsMatch -and $boardMatch

    if ($pass) { $passed++ } else { $failed++ }

    $status = if ($pass) { 'PASS' } else { 'FAIL' }
    $statusColor = if ($pass) { 'Green' } else { 'Red' }

    Write-Host "[$status] $($tc.company)" -ForegroundColor $statusColor -NoNewline
    Write-Host " | ATS: $detectedAts (expected: $($tc.expectedAts))" -NoNewline
    Write-Host " | Board: $detectedBoardId (expected: $($tc.expectedBoardId))" -NoNewline
    Write-Host " | Confidence: $confidence ($band)" -NoNewline
    Write-Host " | Jobs: $jobCount" -NoNewline
    Write-Host " | $([int]$elapsed)ms"

    if (-not $pass) {
        Write-Host "  Failure reason: $([string]$result.failureReason)" -ForegroundColor Yellow
        Write-Host "  Method: $method | Evidence: $([string]$result.evidenceSummary)" -ForegroundColor Yellow
        if ($result.attemptedUrls) {
            Write-Host "  Attempted URLs: $([string]::Join(', ', @($result.attemptedUrls | Select-Object -First 5)))" -ForegroundColor DarkYellow
        }
    }

    if ($jobFetchError) {
        Write-Host "  Job fetch error: $jobFetchError" -ForegroundColor Yellow
    }

    $results += [ordered]@{
        company = $tc.company
        expectedAts = $tc.expectedAts
        detectedAts = $detectedAts
        expectedBoardId = $tc.expectedBoardId
        detectedBoardId = $detectedBoardId
        resolvedCareersUrl = $resolvedCareersUrl
        confidence = $confidence
        band = $band
        method = $method
        jobCount = $jobCount
        jobFetchError = $jobFetchError
        pass = $pass
        elapsedMs = [int]$elapsed
    }
}

# --- Summary ---
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "Total: $($testCases.Count) | Passed: $passed | Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Yellow' })

if ($Verbose) {
    Write-Host "`n=== Diagnostics Log ($($script:DiagnosticsLog.Count) entries) ===" -ForegroundColor DarkCyan
    foreach ($entry in (Get-PipelineDiagnostics)) {
        $dataStr = ''
        $entryKeys = @($entry.Keys | Where-Object { $_ -notin 'timestamp', 'stage', 'company', 'message' })
        if ($entryKeys.Count -gt 0) {
            $dataParts = @()
            foreach ($key in $entryKeys) { $dataParts += "$key=$($entry[$key])" }
            $dataStr = " | $($dataParts -join ', ')"
        }
        Write-Host "  [$($entry.stage)] $($entry.company) - $($entry.message)$dataStr" -ForegroundColor DarkGray
    }
}

# Return results for programmatic use
return $results
