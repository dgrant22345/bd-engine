Add-Type -Path "$PSScriptRoot\..\server\vendor\sqlite\System.Data.SQLite.dll"
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$PSScriptRoot\..\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()

$cmd.CommandText = @"
SELECT bc.normalized_company_name,
  CAST(json_extract(c.data_json, '$.dailyScore') as INTEGER) as daily_score,
  CAST(json_extract(c.data_json, '$.openRoleCount') as INTEGER) as open_roles
FROM board_configs bc
JOIN companies c ON bc.normalized_company_name = c.normalized_name
WHERE json_extract(bc.data_json, '$.discoveryStatus') = 'unresolved'
ORDER BY CAST(json_extract(c.data_json, '$.dailyScore') as INTEGER) DESC
"@
$r = $cmd.ExecuteReader()
$count = 0
while($r.Read()) {
  $count++
  Write-Host "$($r['normalized_company_name'])|$($r['daily_score'])|$($r['open_roles'])"
}
Write-Host "---"
Write-Host "Total: $count"
$r.Close()
$conn.Close()
