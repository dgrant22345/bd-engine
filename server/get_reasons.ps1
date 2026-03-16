Add-Type -Path '.\vendor\sqlite\System.Data.SQLite.dll'
$conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=.\data\bd-engine.db;Version=3;')
$conn.Open()

$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT enrichment_status, enrichment_failure_reason, COUNT(*) as amount FROM companies GROUP BY enrichment_status, enrichment_failure_reason ORDER BY amount DESC"
$reader = $cmd.ExecuteReader()
while ($reader.Read()) {
    $status = if ($reader.IsDBNull(0)) { 'NULL' } else { $reader.GetString(0) }
    $reason = if ($reader.IsDBNull(1)) { 'NULL' } else { $reader.GetString(1) }
    $amount = $reader.GetInt32(2)
    Write-Host "$status | $reason | $amount"
}

$conn.Close()
