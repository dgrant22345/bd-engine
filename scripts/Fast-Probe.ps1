param(
    [int]$TimeoutSec = 3,
    [int]$MaxParallel = 10,
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

# Load SQLite
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"

# ATS probe URLs
$atsProbes = @(
    @{ type = 'greenhouse'; urlTemplate = 'https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true'; matchPattern = '"jobs"\s*:' }
    @{ type = 'lever'; urlTemplate = 'https://api.lever.co/v0/postings/{slug}?mode=json'; matchPattern = '^\s*\[' }
    @{ type = 'ashby'; urlTemplate = 'https://api.ashbyhq.com/posting-api/job-board/{slug}'; matchPattern = '"jobs"\s*:' }
    @{ type = 'smartrecruiters'; urlTemplate = 'https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=10'; matchPattern = '"totalFound"\s*:\s*[1-9]' }
    @{ type = 'jobvite'; urlTemplate = 'https://jobs.jobvite.com/api/job-list?company={slug}'; matchPattern = '"(jobs|requisitions)"\s*:' }
)

function Get-Slugs {
    param([string]$Name)
    $raw = $Name.ToLowerInvariant()
    $raw = $raw -replace '&', ' and '
    $raw = $raw -replace '\(.*?\)', ' '
    $raw = $raw -replace '\b(the|incorporated|inc|corp|corporation|company|co|limited|ltd|llc|llp|plc|group|holdings|technologies|technology|solutions|systems|services|financial)\b', ' '
    $raw = $raw -replace '[^a-z0-9]+', ' '
    $tokens = @($raw.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries))
    $slugs = @()
    if ($tokens.Count -gt 0) {
        $slugs += ($tokens -join '')
        if ($tokens.Count -ge 2) { $slugs += ($tokens -join '-') }
        $slugs += $tokens[0]
    }
    return @($slugs | Select-Object -Unique | Where-Object { $_ })
}

function Test-AtsProbe {
    param([string]$Url, [string]$MatchPattern, [int]$Timeout)
    try {
        $headers = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $Timeout -Headers $headers -ErrorAction Stop
        if ($response.StatusCode -eq 200 -and $response.Content -match $MatchPattern) {
            return $true
        }
    } catch {}
    return $false
}

# Get unresolved board configs
Write-Host "Loading unresolved board configs from SQLite..."
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()

$cmd.CommandText = @"
SELECT bc.id, bc.normalized_company_name,
  json_extract(bc.data_json, '$.companyName') as company_name
FROM board_configs bc
WHERE bc.discovery_status IN ('unresolved', 'missing_inputs', '')
  OR bc.discovery_status IS NULL
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

Write-Host "Found $($configs.Count) unresolved configs to probe"

if ($DryRun) {
    Write-Host "[DRY RUN] Would probe $($configs.Count) companies"
    $configs | Select-Object -First 20 | ForEach-Object { Write-Host "  $($_.normalizedName)" }
    $conn.Close()
    return
}

# Probe each company
$resolved = 0
$noMatch = 0
$errors = 0
$total = $configs.Count

$updateCmd = $conn.CreateCommand()

for ($i = 0; $i -lt $configs.Count; $i++) {
    $config = $configs[$i]
    $name = $config.normalizedName
    $pct = [math]::Round(($i + 1) / $total * 100, 0)

    $slugs = Get-Slugs -Name $name
    if ($slugs.Count -eq 0) {
        $noMatch++
        continue
    }

    $found = $false
    foreach ($slug in ($slugs | Select-Object -First 3)) {
        if ($found) { break }
        foreach ($probe in $atsProbes) {
            $url = $probe.urlTemplate -replace '\{slug\}', [uri]::EscapeDataString($slug)
            $match = Test-AtsProbe -Url $url -MatchPattern $probe.matchPattern -Timeout $TimeoutSec
            if ($match) {
                $atsType = $probe.type
                $boardUrl = switch ($atsType) {
                    'greenhouse' { "https://boards-api.greenhouse.io/v1/boards/$slug/jobs?content=true" }
                    'lever' { "https://jobs.lever.co/$slug" }
                    'ashby' { "https://jobs.ashbyhq.com/$slug" }
                    'smartrecruiters' { "https://careers.smartrecruiters.com/$slug" }
                    'jobvite' { "https://jobs.jobvite.com/$slug" }
                    default { $url }
                }

                Write-Host "  [${pct}%] FOUND: $name => $atsType ($slug)"

                # Update board_config in DB
                try {
                    $now = (Get-Date).ToString('o')
                    $next = (Get-Date).AddDays(90).ToString('o')
                    $updateCmd.CommandText = @"
UPDATE board_configs SET
  ats_type = '$atsType',
  board_id = '$slug',
  resolved_board_url = '$boardUrl',
  source = '$url',
  active = 1,
  supported_import = 1,
  discovery_status = 'discovered',
  discovery_method = 'candidate_probe',
  confidence_score = 92,
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
    '$.supportedImport', json('true'),
    '$.discoveryStatus', 'discovered',
    '$.discoveryMethod', 'candidate_probe',
    '$.confidenceScore', 92,
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
        # Update as checked but not found
        try {
            $now = (Get-Date).ToString('o')
            $next = (Get-Date).AddDays(30).ToString('o')
            $updateCmd.CommandText = @"
UPDATE board_configs SET
  discovery_status = 'no_match_supported_ats',
  discovery_method = 'candidate_probe',
  confidence_score = 0,
  confidence_band = 'unresolved',
  failure_reason = 'No supported ATS board found via slug probing',
  last_checked_at = '$now',
  last_resolution_attempt_at = '$now',
  next_resolution_attempt_at = '$next',
  data_json = json_set(data_json,
    '$.discoveryStatus', 'no_match_supported_ats',
    '$.discoveryMethod', 'candidate_probe',
    '$.confidenceScore', 0,
    '$.confidenceBand', 'unresolved',
    '$.failureReason', 'No supported ATS board found via slug probing',
    '$.lastCheckedAt', '$now',
    '$.lastResolutionAttemptAt', '$now',
    '$.nextResolutionAttemptAt', '$next'
  )
WHERE id = '$($config.id)'
"@
            $updateCmd.ExecuteNonQuery() | Out-Null
        } catch {
            $errors++
        }
        $noMatch++
    }

    if (($i + 1) % 25 -eq 0) {
        Write-Host "  [${pct}%] Progress: $($i + 1)/$total | Resolved: $resolved | No match: $noMatch | Errors: $errors"
    }
}

$conn.Close()

Write-Host ""
Write-Host "=== DISCOVERY COMPLETE ==="
Write-Host "Total probed: $total"
Write-Host "Resolved: $resolved ($([math]::Round($resolved / [math]::Max(1, $total) * 100, 1))%)"
Write-Host "No match: $noMatch"
Write-Host "Errors: $errors"

# Now query final stats
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
