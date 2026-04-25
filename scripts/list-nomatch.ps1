$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = @"
SELECT normalized_company_name, json_extract(data_json, '$.domain') as domain
FROM board_configs
WHERE discovery_status = 'no_match_supported_ats'
ORDER BY normalized_company_name
"@
$r = $cmd.ExecuteReader()
$count = 0
while ($r.Read()) {
    Write-Host "$($r['normalized_company_name']) | $($r['domain'])"
    $count++
}
$r.Close()
Write-Host ""
Write-Host "Total no-match: $count"
$conn.Close()
