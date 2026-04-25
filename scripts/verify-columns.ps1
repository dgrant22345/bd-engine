$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = @"
SELECT normalized_company_name, discovery_status, ats_type, discovery_method,
  json_extract(data_json, '$.discoveryStatus') as json_status
FROM board_configs
WHERE discovery_method = 'candidate_probe' AND discovery_status = 'discovered'
LIMIT 5
"@
$r = $cmd.ExecuteReader()
while ($r.Read()) {
    Write-Host "$($r['normalized_company_name']): col=$($r['discovery_status'])/$($r['ats_type']) json=$($r['json_status'])"
}
$r.Close()
$conn.Close()
