param(
    [switch]$Apply,
    [switch]$ShowDetails
)

$DryRun = -not $Apply
$projectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Resolve-Path '.').Path }
Set-Location $projectRoot

# ─── Load SQLite assembly directly ───
$dllPath = Join-Path $projectRoot 'server/vendor/sqlite/System.Data.SQLite.dll'
if (-not (Test-Path $dllPath)) {
    Write-Host "ERROR: SQLite DLL not found at $dllPath" -ForegroundColor Red
    exit 1
}
Add-Type -Path $dllPath

$dbPath = Join-Path $projectRoot 'data/bd-engine.db'
if (-not (Test-Path $dbPath)) {
    Write-Host "ERROR: Database not found at $dbPath" -ForegroundColor Red
    exit 1
}

function Open-Connection {
    $cs = "Data Source=$dbPath;Version=3;Journal Mode=WAL;"
    $conn = New-Object System.Data.SQLite.SQLiteConnection($cs)
    $conn.Open()
    return $conn
}

function Invoke-Query {
    param($Connection, [string]$Sql, [hashtable]$Params = @{})
    $cmd = $Connection.CreateCommand()
    $cmd.CommandText = $Sql
    foreach ($k in $Params.Keys) {
        $p = $cmd.CreateParameter()
        $p.ParameterName = $k
        $p.Value = $Params[$k]
        [void]$cmd.Parameters.Add($p)
    }
    $reader = $cmd.ExecuteReader()
    $results = @()
    while ($reader.Read()) {
        $row = [ordered]@{}
        for ($i = 0; $i -lt $reader.FieldCount; $i++) {
            $row[$reader.GetName($i)] = if ($reader.IsDBNull($i)) { $null } else { $reader.GetValue($i) }
        }
        $results += [PSCustomObject]$row
    }
    $reader.Close()
    $cmd.Dispose()
    return $results
}

function Invoke-NonQuery {
    param($Connection, $Transaction, [string]$Sql, [hashtable]$Params = @{})
    $cmd = $Connection.CreateCommand()
    if ($Transaction) { $cmd.Transaction = $Transaction }
    $cmd.CommandText = $Sql
    foreach ($k in $Params.Keys) {
        $p = $cmd.CreateParameter()
        $p.ParameterName = $k
        $p.Value = if ($null -eq $Params[$k]) { [DBNull]::Value } else { $Params[$k] }
        [void]$cmd.Parameters.Add($p)
    }
    $result = $cmd.ExecuteNonQuery()
    $cmd.Dispose()
    return $result
}

# ─── Load all classified board configs ───
$connection = Open-Connection

$allConfigs = @()
$rows = Invoke-Query -Connection $connection -Sql "SELECT id, company_name, ats_type, board_id, domain, careers_url, source, discovery_status, discovery_method, confidence_score, confidence_band, review_status, supported_import, failure_reason, data_json FROM board_configs WHERE ats_type IS NOT NULL AND ats_type != '' ORDER BY company_name"

foreach ($row in $rows) {
    $allConfigs += [ordered]@{
        id        = [string]$row.id
        company   = [string]$row.company_name
        atsType   = [string]$row.ats_type
        boardId   = [string]$row.board_id
        domain    = [string]$row.domain
        careersUrl = [string]$row.careers_url
        source    = [string]$row.source
        status    = [string]$row.discovery_status
        method    = [string]$row.discovery_method
        score     = if ($row.confidence_score) { [double]$row.confidence_score } else { 0 }
        band      = [string]$row.confidence_band
        review    = [string]$row.review_status
        supported = [bool]$row.supported_import
        failure   = [string]$row.failure_reason
        dataJson  = [string]$row.data_json
    }
}

Write-Host ''
Write-Host '=============================================' -ForegroundColor Cyan
Write-Host '  ATS CLASSIFICATION AUDIT' -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "  Total classified configs: $($allConfigs.Count)" -ForegroundColor Cyan
Write-Host '=============================================' -ForegroundColor Cyan

# ─── Categorization ───
$protected = [System.Collections.ArrayList]::new()
$valid = [System.Collections.ArrayList]::new()
$staleWorkday = [System.Collections.ArrayList]::new()
$staleCustomEnterprise = [System.Collections.ArrayList]::new()
$staleBamboohrBadSlug = [System.Collections.ArrayList]::new()
$staleOtherNoBoard = [System.Collections.ArrayList]::new()
$fixableScores = [System.Collections.ArrayList]::new()

foreach ($c in $allConfigs) {

    # ── Rule 1: Protected records ──
    $isProtected = (
        $c.method -in @('known_map', 'known_override', 'manual') -or
        $c.source -eq 'manual' -or
        $c.review -in @('approved', 'promoted', 'rejected') -or
        $c.status -eq 'mapped'
    )

    if ($isProtected) {
        if ($c.score -le 0 -and $c.atsType -notin @('other') -and $c.boardId) {
            [void]$fixableScores.Add($c)
        } else {
            [void]$protected.Add($c)
        }
        continue
    }

    # ── Rule 2: Workday false positives ──
    if ($c.atsType -eq 'workday' -and (-not $c.boardId -or $c.careersUrl -notmatch '/wday/cxs/')) {
        [void]$staleWorkday.Add($c)
        continue
    }

    # ── Rule 3: custom_enterprise ──
    if ($c.atsType -eq 'custom_enterprise') {
        [void]$staleCustomEnterprise.Add($c)
        continue
    }

    # ── Rule 4: 'other' with no board_id ──
    if ($c.atsType -eq 'other' -and -not $c.boardId) {
        [void]$staleOtherNoBoard.Add($c)
        continue
    }

    # ── Rule 5: BambooHR with suspect slug ──
    if ($c.atsType -eq 'bamboohr' -and $c.boardId) {
        $isSuspect = (
            $c.boardId.Length -le 2 -or
            ($c.boardId -eq 'royal' -and $c.company -match 'RBC') -or
            ($c.boardId -eq 'bc' -and $c.company -match 'BDO') -or
            ($c.boardId -eq 'cot' -and $c.company -match 'City of Toronto') -or
            ($c.boardId -eq 'sl' -and $c.company -match 'Sun Life')
        )
        if ($isSuspect) {
            Write-Host "  Probing BambooHR slug '$($c.boardId)' for $($c.company)..." -ForegroundColor DarkGray
            $probeUrl = "https://$($c.boardId).bamboohr.com/careers/list"
            try {
                $response = Invoke-WebRequest -Uri $probeUrl -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
                $hasJobs = $response.Content -match '"result"' -or $response.Content -match 'data-job-id' -or $response.Content -match '"id"\s*:\s*\d+'
                if (-not $hasJobs) {
                    [void]$staleBamboohrBadSlug.Add($c)
                    continue
                }
            } catch {
                [void]$staleBamboohrBadSlug.Add($c)
                continue
            }
        }
    }

    # ── Rule 6: Valid records with missing scores ──
    if ($c.score -le 0 -and $c.boardId -and $c.atsType -in @('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'bamboohr', 'workday', 'jobvite', 'icims', 'taleo')) {
        [void]$fixableScores.Add($c)
        continue
    }

    # ── Valid ──
    [void]$valid.Add($c)
}

# ─── Report ───
function Write-CategoryReport {
    param([string]$Title, [System.Collections.ArrayList]$Items, [string]$Color = 'White')
    Write-Host ''
    Write-Host "  $Title ($($Items.Count))" -ForegroundColor $Color
    Write-Host "  $('-' * ($Title.Length + $($Items.Count).ToString().Length + 3))" -ForegroundColor DarkGray
    foreach ($item in $Items) {
        $detail = "ats=$($item.atsType) | board=$($item.boardId) | method=$($item.method) | status=$($item.status) | score=$($item.score)"
        Write-Host "    $($item.company)" -ForegroundColor $Color -NoNewline
        Write-Host " - $detail" -ForegroundColor DarkGray
        if ($ShowDetails -and $item.careersUrl) {
            Write-Host "      careersUrl: $($item.careersUrl)" -ForegroundColor DarkGray
        }
    }
    if ($Items.Count -eq 0) { Write-Host '    (none)' -ForegroundColor DarkGray }
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Green
Write-Host '  PHASE 1: AUDIT RESULTS' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Green

Write-CategoryReport -Title 'PROTECTED (will not touch)' -Items $protected -Color Green
Write-CategoryReport -Title 'VALID (correctly classified)' -Items $valid -Color Cyan
Write-CategoryReport -Title 'FIXABLE SCORES (valid but score=0, will update)' -Items $fixableScores -Color Yellow
Write-CategoryReport -Title 'STALE: Workday false positives (will reset)' -Items $staleWorkday -Color Red
Write-CategoryReport -Title 'STALE: custom_enterprise (not real ATS, will reset)' -Items $staleCustomEnterprise -Color Red
Write-CategoryReport -Title 'STALE: BambooHR bad slugs (no jobs found, will reset)' -Items $staleBamboohrBadSlug -Color Red
Write-CategoryReport -Title "STALE: 'other' with no board_id (will reset)" -Items $staleOtherNoBoard -Color Red

$allStale = @()
$allStale += @($staleWorkday)
$allStale += @($staleCustomEnterprise)
$allStale += @($staleBamboohrBadSlug)
$allStale += @($staleOtherNoBoard)

Write-Host ''
Write-Host '==============================================' -ForegroundColor Yellow
Write-Host '  CLEANUP PLAN SUMMARY' -ForegroundColor Yellow
Write-Host '==============================================' -ForegroundColor Yellow
Write-Host ''
Write-Host "  Protected (no change):     $($protected.Count)" -ForegroundColor Green
Write-Host "  Valid (no change):         $($valid.Count)" -ForegroundColor Cyan
Write-Host "  Fix scores only:           $($fixableScores.Count)" -ForegroundColor Yellow
Write-Host "  Reset to unresolved:       $($allStale.Count)" -ForegroundColor Red
Write-Host "    - Workday false pos:     $($staleWorkday.Count)" -ForegroundColor DarkRed
Write-Host "    - custom_enterprise:     $($staleCustomEnterprise.Count)" -ForegroundColor DarkRed
Write-Host "    - BambooHR bad slugs:    $($staleBamboohrBadSlug.Count)" -ForegroundColor DarkRed
Write-Host "    - 'other' no board_id:   $($staleOtherNoBoard.Count)" -ForegroundColor DarkRed
Write-Host ''

if ($DryRun) {
    Write-Host '  MODE: DRY RUN (no changes made)' -ForegroundColor Magenta
    Write-Host '  To apply changes, run with -Apply flag:' -ForegroundColor Magenta
    Write-Host '    powershell -File scripts/Audit-AtsClassifications.ps1 -Apply' -ForegroundColor Magenta
    Write-Host ''

    if ($allStale.Count -gt 0) {
        Write-Host '  Records that WOULD be reset to unresolved:' -ForegroundColor Yellow
        foreach ($item in $allStale) {
            Write-Host "    $($item.company) (was: ats=$($item.atsType), board=$($item.boardId))" -ForegroundColor Yellow
        }
    }
    if ($fixableScores.Count -gt 0) {
        Write-Host ''
        Write-Host '  Records that WOULD get score updates:' -ForegroundColor Yellow
        foreach ($item in $fixableScores) {
            $newScore = switch ($item.method) {
                'known_map' { 100 }
                'known_override' { 95 }
                'candidate_probe' { if ($item.boardId) { 85 } else { 70 } }
                default { if ($item.boardId) { 82 } else { 65 } }
            }
            Write-Host "    $($item.company): score 0 -> $newScore (method=$($item.method))" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host '  MODE: APPLYING CHANGES' -ForegroundColor Red
    Write-Host ''

    $resetCount = 0
    $scoreFixCount = 0
    $now = (Get-Date).ToString('o')
    $transaction = $connection.BeginTransaction()

    try {
        # ── Reset stale records ──
        # We update targeted columns and rebuild data_json from the existing JSON + overrides
        foreach ($item in $allStale) {
            $failureNote = 'Cleared by audit: was ' + $item.atsType + '/' + $item.boardId + ' (stale/false positive)'

            # Update the data_json: parse existing, override fields, re-serialize
            $dataObj = $null
            if ($item.dataJson) {
                try { $dataObj = $item.dataJson | ConvertFrom-Json } catch {}
            }
            if (-not $dataObj) { $dataObj = New-Object PSObject }

            $overrides = @{
                atsType = ''; boardId = ''; source = ''; supportedImport = $false
                resolvedBoardUrl = ''; discoveryStatus = 'unresolved'
                confidenceScore = 0; confidenceBand = 'unresolved'
                evidenceSummary = ''; matchedSignatures = @()
                failureReason = $failureNote; reviewStatus = ''
                lastCheckedAt = $now; nextResolutionAttemptAt = ''
            }
            foreach ($field in $overrides.Keys) {
                if ($dataObj.PSObject.Properties.Name -contains $field) {
                    $dataObj.$field = $overrides[$field]
                } else {
                    $dataObj | Add-Member -NotePropertyName $field -NotePropertyValue $overrides[$field] -Force
                }
            }
            $newJson = $dataObj | ConvertTo-Json -Depth 10 -Compress

            Invoke-NonQuery -Connection $connection -Transaction $transaction -Sql @"
UPDATE board_configs SET
    ats_type = '', board_id = '', source = '', supported_import = 0,
    resolved_board_url = '', discovery_status = 'unresolved',
    confidence_score = 0, confidence_band = 'unresolved',
    evidence_summary = '', matched_signatures_text = '',
    failure_reason = @failure, review_status = '',
    last_checked_at = @now, next_resolution_attempt_at = NULL,
    data_json = @json
WHERE id = @id
"@ -Params @{ id = $item.id; failure = $failureNote; now = $now; json = $newJson }

            Write-Host "    RESET: $($item.company) (was: ats=$($item.atsType), board=$($item.boardId))" -ForegroundColor Red
            $resetCount++
        }

        # ── Fix missing scores ──
        foreach ($item in $fixableScores) {
            $newScore = switch ($item.method) {
                'known_map' { 100 }
                'known_override' { 95 }
                'candidate_probe' { if ($item.boardId) { 85 } else { 70 } }
                default { if ($item.boardId) { 82 } else { 65 } }
            }
            $newBand = if ($newScore -ge 85) { 'high' } elseif ($newScore -ge 65) { 'medium' } else { 'low' }

            # Update data_json too
            $dataObj = $null
            if ($item.dataJson) {
                try { $dataObj = $item.dataJson | ConvertFrom-Json } catch {}
            }
            if (-not $dataObj) { $dataObj = New-Object PSObject }

            foreach ($f in @(@{n='confidenceScore';v=$newScore}, @{n='confidenceBand';v=$newBand}, @{n='lastCheckedAt';v=$now})) {
                if ($dataObj.PSObject.Properties.Name -contains $f.n) { $dataObj.($f.n) = $f.v }
                else { $dataObj | Add-Member -NotePropertyName $f.n -NotePropertyValue $f.v -Force }
            }
            $newJson = $dataObj | ConvertTo-Json -Depth 10 -Compress

            Invoke-NonQuery -Connection $connection -Transaction $transaction -Sql @"
UPDATE board_configs SET
    confidence_score = @score, confidence_band = @band,
    last_checked_at = @now, data_json = @json
WHERE id = @id
"@ -Params @{ id = $item.id; score = $newScore; band = $newBand; now = $now; json = $newJson }

            Write-Host "    SCORE FIX: $($item.company): 0 -> $newScore ($newBand)" -ForegroundColor Yellow
            $scoreFixCount++
        }

        $transaction.Commit()
        Write-Host ''
        Write-Host '  DONE:' -ForegroundColor Green
        Write-Host "    Records reset to unresolved: $resetCount" -ForegroundColor Green
        Write-Host "    Records with fixed scores:   $scoreFixCount" -ForegroundColor Green
        Write-Host "    Total records modified:       $($resetCount + $scoreFixCount)" -ForegroundColor Green

    } catch {
        $transaction.Rollback()
        Write-Host "  ERROR: Transaction rolled back - $_" -ForegroundColor Red
    }
}

# ─── Post-audit stats ───
Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host '  RE-DISCOVERY ELIGIBILITY' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan

$unresolvedRows = Invoke-Query -Connection $connection -Sql "SELECT COUNT(*) as cnt FROM board_configs WHERE discovery_status = 'unresolved'"
$eligibleRows = Invoke-Query -Connection $connection -Sql "SELECT COUNT(*) as cnt FROM board_configs WHERE discovery_status = 'unresolved' AND (next_resolution_attempt_at IS NULL OR next_resolution_attempt_at = '' OR next_resolution_attempt_at <= @now)" -Params @{ now = (Get-Date).ToString('o') }

Write-Host ''
Write-Host "  Total unresolved configs:          $($unresolvedRows[0].cnt)"
Write-Host "  Eligible for immediate discovery:   $($eligibleRows[0].cnt)"
Write-Host ''
Write-Host '  To trigger re-discovery, run:' -ForegroundColor DarkGray
Write-Host '    POST http://localhost:8173/api/discovery/run' -ForegroundColor DarkGray
Write-Host ''

$connection.Close()
$connection.Dispose()
