$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()

# Check companies that Fast-Probe should have resolved
$companies = @('hubspot', 'okta', 'lyft', 'uber', 'visa', 'zapier', 'indeed')
foreach ($company in $companies) {
    $cmd.CommandText = @"
SELECT normalized_company_name,
  discovery_status as col_status, ats_type as col_ats,
  json_extract(data_json, '$.discoveryStatus') as json_status,
  json_extract(data_json, '$.atsType') as json_ats,
  json_extract(data_json, '$.discoveryMethod') as json_method
FROM board_configs
WHERE normalized_company_name LIKE '%$company%'
LIMIT 3
"@
    $r = $cmd.ExecuteReader()
    while ($r.Read()) {
        Write-Host "$($r['normalized_company_name']):"
        Write-Host "  col: status=$($r['col_status']), ats=$($r['col_ats'])"
        Write-Host "  json: status=$($r['json_status']), ats=$($r['json_ats']), method=$($r['json_method'])"
    }
    $r.Close()
}

# Count JSON-discovered entries from candidate_probe method
Write-Host ""
$cmd.CommandText = @"
SELECT COUNT(*) as cnt FROM board_configs
WHERE json_extract(data_json, '$.discoveryMethod') = 'candidate_probe'
  AND json_extract(data_json, '$.discoveryStatus') = 'discovered'
"@
$r2 = $cmd.ExecuteReader()
$r2.Read() | Out-Null
Write-Host "JSON: candidate_probe + discovered = $($r2['cnt'])"
$r2.Close()

$cmd.CommandText = @"
SELECT COUNT(*) as cnt FROM board_configs
WHERE discovery_method = 'candidate_probe'
  AND discovery_status = 'discovered'
"@
$r3 = $cmd.ExecuteReader()
$r3.Read() | Out-Null
Write-Host "Column: candidate_probe + discovered = $($r3['cnt'])"
$r3.Close()

$conn.Close()
