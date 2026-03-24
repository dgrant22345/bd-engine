Add-Type -Path '.\server\vendor\sqlite\System.Data.SQLite.dll'
$conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=.\data\bd-engine.db;Version=3;')
$conn.Open()

function Get-Scalar($sql) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    try {
        return $cmd.ExecuteScalar()
    } catch {
        return $_.Exception.Message
    }
}

Write-Host "Jobs without domains:"
Write-Host "Jobs linked by account_id: " (Get-Scalar 'SELECT COUNT(DISTINCT co.id) FROM companies co JOIN jobs j ON j.account_id = co.id WHERE (co.canonical_domain IS NULL OR co.canonical_domain = '''')')

$conn.Close()
