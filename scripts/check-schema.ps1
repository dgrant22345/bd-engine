$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "PRAGMA table_info(board_configs)"
$r = $cmd.ExecuteReader()
Write-Host "=== board_configs columns ==="
while ($r.Read()) {
    Write-Host "  $($r['name']) ($($r['type']))"
}
$r.Close()

# Check a sample row to see what data_json vs columns look like
$cmd2 = $conn.CreateCommand()
$cmd2.CommandText = @"
SELECT id, normalized_company_name, ats_type, discovery_status, discovery_method,
  json_extract(data_json, '$.discoveryStatus') as json_status,
  json_extract(data_json, '$.discoveryMethod') as json_method,
  json_extract(data_json, '$.atsType') as json_ats
FROM board_configs
WHERE json_extract(data_json, '$.discoveryStatus') = 'discovered'
LIMIT 5
"@
$r2 = $cmd2.ExecuteReader()
Write-Host ""
Write-Host "=== Sample discovered rows (column vs JSON) ==="
while ($r2.Read()) {
    Write-Host "  $($r2['normalized_company_name'])"
    Write-Host "    col.ats_type=$($r2['ats_type']) | json.atsType=$($r2['json_ats'])"
    Write-Host "    col.discovery_status=$($r2['discovery_status']) | json.discoveryStatus=$($r2['json_status'])"
    Write-Host "    col.discovery_method=$($r2['discovery_method']) | json.discoveryMethod=$($r2['json_method'])"
}
$r2.Close()

# Also check if check-stats query uses column or JSON
$cmd3 = $conn.CreateCommand()
$cmd3.CommandText = @"
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN discovery_status IN ('discovered', 'verified', 'mapped') THEN 1 ELSE 0 END) as col_resolved,
  SUM(CASE WHEN json_extract(data_json, '$.discoveryStatus') IN ('discovered', 'verified', 'mapped') THEN 1 ELSE 0 END) as json_resolved
FROM board_configs
"@
$r3 = $cmd3.ExecuteReader()
$r3.Read() | Out-Null
Write-Host ""
Write-Host "=== Column vs JSON resolution count ==="
Write-Host "Total: $($r3['total'])"
Write-Host "Column-based resolved: $($r3['col_resolved'])"
Write-Host "JSON-based resolved: $($r3['json_resolved'])"
$r3.Close()

$conn.Close()
