param(
    [int]$TimeoutSec = 3,
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

# Load SQLite
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"

# Additional ATS probe URLs (Workday variants + BambooHR)
# Workday is a supported import type, so these are high value
$atsProbes = @(
    @{ type = 'workday'; urlTemplate = 'https://{slug}.wd1.myworkdayjobs.com/en-US/External'; matchPattern = 'workday|Workday|job'; supported = $true }
    @{ type = 'workday'; urlTemplate = 'https://{slug}.wd3.myworkdayjobs.com/en-US/External'; matchPattern = 'workday|Workday|job'; supported = $true }
    @{ type = 'workday'; urlTemplate = 'https://{slug}.wd5.myworkdayjobs.com/en-US/External'; matchPattern = 'workday|Workday|job'; supported = $true }
    @{ type = 'workday'; urlTemplate = 'https://{slug}.wd2.myworkdayjobs.com/en-US/External'; matchPattern = 'workday|Workday|job'; supported = $true }
    @{ type = 'workday'; urlTemplate = 'https://{slug}.wd12.myworkdayjobs.com/en-US/External'; matchPattern = 'workday|Workday|job'; supported = $true }
    # BambooHR removed - returns 200 with matching content for ANY slug (false positives)
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
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $Timeout -Headers $headers -ErrorAction Stop -MaximumRedirection 3
        if ($response.StatusCode -eq 200 -and $response.Content -match $MatchPattern) {
            return $true
        }
    } catch {}
    return $false
}

# Get configs that were probed but found no match in the first pass
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

Write-Host "Found $($configs.Count) no-match configs to probe with extra ATS types"

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
                    'bamboohr' { "https://$slug.bamboohr.com/careers/list" }
                    'workday' { $url }
                    'icims' { "https://careers-$slug.icims.com/jobs/search" }
                    default { $url }
                }

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
  discovery_method = 'candidate_probe_extra',
  confidence_score = 85,
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
    '$.discoveryMethod', 'candidate_probe_extra',
    '$.confidenceScore', 85,
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
Write-Host "=== EXTRA PROBE COMPLETE ==="
Write-Host "Total probed: $total"
Write-Host "Resolved: $resolved ($([math]::Round($resolved / [math]::Max(1, $total) * 100, 1))%)"
Write-Host "No match: $noMatch"
Write-Host "Errors: $errors"
