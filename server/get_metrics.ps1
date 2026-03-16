Add-Type -Path '.\vendor\sqlite\System.Data.SQLite.dll'
$conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=.\data\bd-engine.db;Version=3;')
$conn.Open()

function Get-Scalar($sql) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    return $cmd.ExecuteScalar()
}

function Get-Rows($sql) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $reader = $cmd.ExecuteReader()
    $results = @()
    while ($reader.Read()) {
        $row = @{}
        for ($i=0; $i -lt $reader.FieldCount; $i++) {
            $val = if ($reader.IsDBNull($i)) { $null } else { $reader.GetValue($i) }
            $row[$reader.GetName($i)] = $val
        }
        $results += New-Object PSObject -Property $row
    }
    return $results
}

Write-Host '--- 1. METRICS BREAKDOWN ---'
Write-Host "Total distinct companies: " (Get-Scalar 'SELECT COUNT(DISTINCT id) FROM companies')
Write-Host "Distinct companies with canonical_domain: " (Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies WHERE canonical_domain IS NOT NULL AND canonical_domain != ''")
Write-Host "Distinct companies with careers_url: " (Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies WHERE careers_url IS NOT NULL AND careers_url != ''")
Write-Host "Distinct companies with aliases: " (Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies WHERE aliases_text IS NOT NULL AND aliases_text != ''")
Write-Host "Distinct companies with ats_type resolved: " (Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies WHERE ats_types_text IS NOT NULL AND ats_types_text != ''")
Write-Host "Distinct companies with resolved_board_url: " (Get-Scalar "SELECT COUNT(DISTINCT c.id) FROM companies c JOIN board_configs b ON c.normalized_name = b.normalized_company_name WHERE b.resolved_board_url IS NOT NULL AND b.resolved_board_url != ''")

Write-Host "`n--- 2. FAILURE BREAKDOWN ---"
$failures = Get-Rows "SELECT enrichment_failure_reason, COUNT(*) as amount FROM companies WHERE enrichment_status = 'failed' OR enrichment_status = 'unresolved' GROUP BY enrichment_failure_reason ORDER BY amount DESC"
foreach ($f in $failures) {
    Write-Host "$($f.enrichment_failure_reason): $($f.amount)"
}

Write-Host "`n--- TOP COHORTS ---"
$cohorts = @(25, 50, 100)
foreach ($limit in $cohorts) {
    Write-Host "TOP $limit Companies"
    $total = Get-Scalar "SELECT COUNT(*) FROM (SELECT id FROM companies ORDER BY sort_order ASC LIMIT $limit)"
    $domains = Get-Scalar "SELECT COUNT(*) FROM (SELECT id FROM companies WHERE canonical_domain IS NOT NULL AND canonical_domain != '' ORDER BY sort_order ASC LIMIT $limit)"
    $careers = Get-Scalar "SELECT COUNT(*) FROM (SELECT id FROM companies WHERE careers_url IS NOT NULL AND careers_url != '' ORDER BY sort_order ASC LIMIT $limit)"
    $ats = Get-Scalar "SELECT COUNT(*) FROM (SELECT c.id FROM companies c WHERE c.ats_types_text IS NOT NULL AND c.ats_types_text != '' ORDER BY c.sort_order ASC LIMIT $limit)"
    
    Write-Host "  Total: $total"
    Write-Host "  Domains: $domains"
    Write-Host "  Careers: $careers"
    Write-Host "  ATS/Board: $ats"
}

$conn.Close()
