$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = @"
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN json_extract(data_json, '$.discoveryStatus') IN ('discovered', 'verified', 'mapped') THEN 1 ELSE 0 END) as resolved,
  SUM(CASE WHEN json_extract(data_json, '$.discoveryStatus') = 'no_match_supported_ats' THEN 1 ELSE 0 END) as no_match,
  SUM(CASE WHEN json_extract(data_json, '$.discoveryStatus') IN ('unresolved', 'missing_inputs', '') OR json_extract(data_json, '$.discoveryStatus') IS NULL THEN 1 ELSE 0 END) as still_unresolved
FROM board_configs
"@
$r = $cmd.ExecuteReader()
$r.Read() | Out-Null
Write-Host "Total board configs: $($r['total'])"
Write-Host "Resolved (discovered/verified/mapped): $($r['resolved'])"
Write-Host "No match (probed, no ATS found): $($r['no_match'])"
Write-Host "Still unresolved: $($r['still_unresolved'])"
$r.Close()

# Show ATS type breakdown for resolved
$cmd2 = $conn.CreateCommand()
$cmd2.CommandText = @"
SELECT json_extract(data_json, '$.atsType') as ats, COUNT(*) as cnt
FROM board_configs
WHERE json_extract(data_json, '$.discoveryStatus') IN ('discovered', 'verified', 'mapped')
GROUP BY ats ORDER BY cnt DESC
"@
$r2 = $cmd2.ExecuteReader()
Write-Host ""
Write-Host "=== ATS Type Breakdown (resolved) ==="
while ($r2.Read()) {
    Write-Host "  $($r2['ats']): $($r2['cnt'])"
}
$r2.Close()

# Show discovery method breakdown
$cmd3 = $conn.CreateCommand()
$cmd3.CommandText = @"
SELECT json_extract(data_json, '$.discoveryMethod') as method, COUNT(*) as cnt
FROM board_configs
GROUP BY method ORDER BY cnt DESC
"@
$r3 = $cmd3.ExecuteReader()
Write-Host ""
Write-Host "=== Discovery Method Breakdown ==="
while ($r3.Read()) {
    Write-Host "  $($r3['method']): $($r3['cnt'])"
}
$r3.Close()

$conn.Close()
