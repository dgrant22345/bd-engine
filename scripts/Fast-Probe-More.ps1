param(
    [int]$TimeoutSec = 3,
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

# Load SQLite
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"

# Additional ATS probe URLs beyond the main 5 + Workday/BambooHR
# Only use probes that DON'T return 200 for nonexistent slugs
# JazzHR, BreezyHR, Personio all return false positives for any slug
$atsProbes = @(
    # Workable - returns proper error for nonexistent accounts
    @{ type = 'workable'; urlTemplate = 'https://apply.workable.com/api/v3/accounts/{slug}/jobs'; matchPattern = '"results"\s*:'; supported = $false }
    # Recruitee - JSON API, returns error for bad slugs
    @{ type = 'recruitee'; urlTemplate = 'https://{slug}.recruitee.com/api/offers/'; matchPattern = '"offers"\s*:'; supported = $false }
    # Rippling - API endpoint
    @{ type = 'rippling'; urlTemplate = 'https://ats.rippling.com/api/public/{slug}/jobs'; matchPattern = '"jobs"\s*:|"data"\s*:'; supported = $false }
    # Greenhouse retry with hyphenated/multi-word slug variants not tried before
    @{ type = 'greenhouse'; urlTemplate = 'https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true'; matchPattern = '"jobs"\s*:'; supported = $true }
    # Lever retry with different slug variants
    @{ type = 'lever'; urlTemplate = 'https://api.lever.co/v0/postings/{slug}?mode=json'; matchPattern = '^\s*\['; supported = $true }
    # Ashby retry
    @{ type = 'ashby'; urlTemplate = 'https://api.ashbyhq.com/posting-api/job-board/{slug}'; matchPattern = '"jobs"\s*:'; supported = $true }
)

function Get-ExpandedSlugs {
    param([string]$Name)
    $raw = $Name.ToLowerInvariant()
    $raw = $raw -replace '&', ' and '
    $raw = $raw -replace '\(.*?\)', ' '

    # Keep a version before stripping suffixes
    $preStrip = $raw -replace '[^a-z0-9]+', ' '
    $preStripTokens = @($preStrip.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries))

    $raw = $raw -replace '\b(the|incorporated|inc|corp|corporation|company|co|limited|ltd|llc|llp|plc|group|holdings|technologies|technology|solutions|systems|services|financial|consulting|canada|canadian|us|usa|international|global|digital|realty|brokerage)\b', ' '
    $raw = $raw -replace '[^a-z0-9]+', ' '
    $tokens = @($raw.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries))

    $slugs = @()
    if ($tokens.Count -gt 0) {
        $slugs += ($tokens -join '')
        if ($tokens.Count -ge 2) { $slugs += ($tokens -join '-') }
        $slugs += $tokens[0]
        # Try first two tokens
        if ($tokens.Count -ge 2) {
            $slugs += ($tokens[0..1] -join '')
            $slugs += ($tokens[0..1] -join '-')
        }
    }
    # Also try pre-strip variants
    if ($preStripTokens.Count -gt 0) {
        $slugs += ($preStripTokens -join '')
        if ($preStripTokens.Count -ge 2) { $slugs += ($preStripTokens -join '-') }
    }

    return @($slugs | Select-Object -Unique | Where-Object { $_ -and $_.Length -ge 2 })
}

function Test-AtsProbe {
    param([string]$Url, [string]$MatchPattern, [int]$Timeout)
    try {
        $headers = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $Timeout -Headers $headers -ErrorAction Stop -MaximumRedirection 3
        if ($response.StatusCode -eq 200 -and $response.Content -match $MatchPattern) {
            return $true
        }
    } catch {}
    return $false
}

# Get configs that were probed but found no match
Write-Host "Loading no_match configs from SQLite..."
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()

$cmd.CommandText = @"
SELECT bc.id, bc.normalized_company_name,
  json_extract(bc.data_json, '$.companyName') as company_name
FROM board_configs bc
WHERE bc.discovery_status = 'no_match_supported_ats'
ORDER BY bc.normalized_company_name
"@
$reader = $cmd.ExecuteReader()
$configs = @()
while ($reader.Read()) {
    $configs += @{
        id = [string]$reader['id']
        normalizedName = [string]$reader['normalized_company_name']
        companyName = [string]$reader['company_name']
    }
}
$reader.Close()

Write-Host "Found $($configs.Count) no-match configs to probe with additional ATS types"

if ($DryRun) {
    Write-Host "[DRY RUN] Would probe $($configs.Count) companies"
    $configs | Select-Object -First 20 | ForEach-Object { Write-Host "  $($_.normalizedName)" }
    $conn.Close()
    return
}

$resolved = 0
$noMatch = 0
$errors = 0
$total = $configs.Count

$updateCmd = $conn.CreateCommand()

for ($i = 0; $i -lt $configs.Count; $i++) {
    $config = $configs[$i]
    $name = $config.normalizedName
    $pct = [math]::Round(($i + 1) / $total * 100, 0)

    $slugs = Get-ExpandedSlugs -Name $name
    if ($slugs.Count -eq 0) {
        $noMatch++
        continue
    }

    $found = $false
    foreach ($slug in ($slugs | Select-Object -First 5)) {
        if ($found) { break }
        foreach ($probe in $atsProbes) {
            $url = $probe.urlTemplate -replace '\{slug\}', [uri]::EscapeDataString($slug)
            $match = Test-AtsProbe -Url $url -MatchPattern $probe.matchPattern -Timeout $TimeoutSec
            if ($match) {
                $atsType = $probe.type
                $boardUrl = $url

                Write-Host "  [${pct}%] FOUND: $name => $atsType ($slug)"

                try {
                    $now = (Get-Date).ToString('o')
                    $next = (Get-Date).AddDays(90).ToString('o')
                    $supportedInt = if ($probe.supported) { 1 } else { 0 }
                    $supportedJson = if ($probe.supported) { "true" } else { "false" }
                    $updateCmd.CommandText = @"
UPDATE board_configs SET
  ats_type = '$atsType',
  board_id = '$slug',
  resolved_board_url = '$boardUrl',
  source = '$url',
  active = 1,
  supported_import = $supportedInt,
  discovery_status = 'discovered',
  discovery_method = 'candidate_probe_more',
  confidence_score = 80,
  confidence_band = 'high',
  evidence_summary = '$atsType probe matched slug $slug',
  review_status = 'auto',
  failure_reason = '',
  last_checked_at = '$now',
  last_resolution_attempt_at = '$now',
  next_resolution_attempt_at = '$next',
  data_json = json_set(data_json,
    '$.atsType', '$atsType',
    '$.boardId', '$slug',
    '$.resolvedBoardUrl', '$boardUrl',
    '$.source', '$url',
    '$.active', json('true'),
    '$.supportedImport', json('$supportedJson'),
    '$.discoveryStatus', 'discovered',
    '$.discoveryMethod', 'candidate_probe_more',
    '$.confidenceScore', 80,
    '$.confidenceBand', 'high',
    '$.evidenceSummary', '$atsType probe matched slug $slug',
    '$.reviewStatus', 'auto',
    '$.failureReason', '',
    '$.lastCheckedAt', '$now',
    '$.lastResolutionAttemptAt', '$now',
    '$.nextResolutionAttemptAt', '$next'
  )
WHERE id = '$($config.id)'
"@
                    $updateCmd.ExecuteNonQuery() | Out-Null
                } catch {
                    Write-Host "    DB update error: $_"
                    $errors++
                }

                $resolved++
                $found = $true
                break
            }
        }
    }

    if (-not $found) {
        $noMatch++
    }

    if (($i + 1) % 25 -eq 0) {
        Write-Host "  [${pct}%] Progress: $($i + 1)/$total | Resolved: $resolved | No match: $noMatch | Errors: $errors"
    }
}

$conn.Close()

Write-Host ""
Write-Host "=== MORE PROBE COMPLETE ==="
Write-Host "Total probed: $total"
Write-Host "Resolved: $resolved ($([math]::Round($resolved / [math]::Max(1, $total) * 100, 1))%)"
Write-Host "No match: $noMatch"
Write-Host "Errors: $errors"

# Final stats
$conn2 = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn2.Open()
$cmd2 = $conn2.CreateCommand()
$cmd2.CommandText = @"
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN discovery_status IN ('discovered', 'verified', 'mapped') THEN 1 ELSE 0 END) as resolved
FROM board_configs
"@
$r = $cmd2.ExecuteReader()
$r.Read()
$totalConfigs = [int]$r['total']
$totalResolved = [int]$r['resolved']
$r.Close()
$conn2.Close()
$finalPct = [math]::Round($totalResolved / [math]::Max(1, $totalConfigs) * 100, 1)
Write-Host ""
Write-Host "=== OVERALL BOARD RESOLUTION ==="
Write-Host "Resolved: $totalResolved / $totalConfigs (${finalPct}%)"
