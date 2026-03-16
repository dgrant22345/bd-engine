Add-Type -Path '.\vendor\sqlite\System.Data.SQLite.dll'
$conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=.\data\bd-engine.db;Version=3;')
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT id, display_name, domain FROM companies LIMIT 5;"
$reader = $cmd.ExecuteReader()
while ($reader.Read()) {
    Write-Host "$($reader.GetString(0)) | $($reader.GetString(1))"
}
$conn.Close()
