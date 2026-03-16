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
            $row[$reader.GetName($i)] = if ($reader.IsDBNull($i)) { $null } else { $reader.GetValue($i) }
        }
        $results += New-Object PSObject -Property $row
    }
    return $results
}
Write-Host '--- BACKGROUND JOBS ---'
Get-Rows "SELECT id, job_type, status, error_message FROM background_jobs" | ft -AutoSize
$conn.Close()
