$root = Split-Path $PSScriptRoot -Parent
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"
$db = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$db.Open()

$supportedTypes = "('greenhouse','lever','ashby','smartrecruiters','workday','jobvite')"

$total = $db.ExecuteScalar("SELECT COUNT(*) FROM board_configs")
$ready = $db.ExecuteScalar("SELECT COUNT(*) FROM board_configs WHERE ats_type IN $supportedTypes AND board_id IS NOT NULL AND board_id != ''")
$typNoBoardId = $db.ExecuteScalar("SELECT COUNT(*) FROM board_configs WHERE ats_type IN $supportedTypes AND (board_id IS NULL OR board_id = '')")
$enterprise = $db.ExecuteScalar("SELECT COUNT(*) FROM board_configs WHERE ats_type = 'custom_enterprise'")
$bamboo = $db.ExecuteScalar("SELECT COUNT(*) FROM board_configs WHERE ats_type = 'bamboohr'")

Write-Output "Total configs: $total"
Write-Output "Import-ready (supported type + boardId): $ready"
Write-Output "Supported type but missing boardId: $typNoBoardId"
Write-Output "Custom enterprise (not importable): $enterprise"
Write-Output "BambooHR (not importable): $bamboo"
Write-Output ""

# Show breakdown by type for ready configs
$cmd = $db.CreateCommand()
$cmd.CommandText = "SELECT ats_type, COUNT(*) as cnt FROM board_configs WHERE ats_type IN $supportedTypes AND board_id IS NOT NULL AND board_id != '' GROUP BY ats_type ORDER BY cnt DESC"
$reader = $cmd.ExecuteReader()
Write-Output "=== Import-ready by ATS type ==="
while ($reader.Read()) {
    Write-Output ("  {0}: {1}" -f $reader['ats_type'], $reader['cnt'])
}
$reader.Close()

Write-Output ""

# Show some ready examples
$cmd2 = $db.CreateCommand()
$cmd2.CommandText = "SELECT company_name, ats_type, board_id FROM board_configs WHERE ats_type IN $supportedTypes AND board_id IS NOT NULL AND board_id != '' LIMIT 5"
$reader2 = $cmd2.ExecuteReader()
Write-Output "=== Sample import-ready configs ==="
while ($reader2.Read()) {
    Write-Output ("  {0} | {1} | {2}" -f $reader2['company_name'], $reader2['ats_type'], $reader2['board_id'])
}
$reader2.Close()

# Show configs with supported type but no boardId
$cmd3 = $db.CreateCommand()
$cmd3.CommandText = "SELECT company_name, ats_type, board_id, career_url FROM board_configs WHERE ats_type IN $supportedTypes AND (board_id IS NULL OR board_id = '') LIMIT 10"
$reader3 = $cmd3.ExecuteReader()
Write-Output ""
Write-Output "=== Supported type but missing boardId (sample) ==="
$count = 0
while ($reader3.Read()) {
    $count++
    Write-Output ("  {0} | {1} | boardId='{2}' | url={3}" -f $reader3['company_name'], $reader3['ats_type'], $reader3['board_id'], $reader3['career_url'])
}
if ($count -eq 0) { Write-Output "  (none)" }
$reader3.Close()

$db.Close()
