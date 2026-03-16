Add-Type -Path '.\vendor\sqlite\System.Data.SQLite.dll'
$conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=.\data\bd-engine.db;Version=3;')
$conn.Open()
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
Write-Host '--- ALL STATUS ---'
Get-Rows "SELECT enrichment_status, COUNT(*) as amount FROM companies GROUP BY enrichment_status" | ForEach-Object { Write-Host "$($_.enrichment_status): $($_.amount)" }
$conn.Close()
