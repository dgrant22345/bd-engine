Add-Type -Path '.\vendor\sqlite\System.Data.SQLite.dll'
$conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=.\data\bd-engine.db;Version=3;')
$conn.Open()

function Get-Scalar($sql) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    return $cmd.ExecuteScalar()
}

Write-Host "Total distinct: " (Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies")
Write-Host "Distinct canonical_domain: " (Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies WHERE json_extract(data_json, '$.canonicalDomain') IS NOT NULL AND json_extract(data_json, '$.canonicalDomain') != ''")
Write-Host "Distinct careers_url: " (Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies WHERE json_extract(data_json, '$.careersUrl') IS NOT NULL AND json_extract(data_json, '$.careersUrl') != ''")
Write-Host "Distinct aliases: " (Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies WHERE json_extract(data_json, '$.aliases') IS NOT NULL AND json_extract(data_json, '$.aliases') != '[]'")
Write-Host "Distinct resolved ats: " (Get-Scalar "SELECT COUNT(DISTINCT c.id) FROM companies c JOIN board_configs bc ON c.normalized_name = bc.normalized_company_name WHERE json_extract(bc.data_json, '$.discoveryStatus') IN ('mapped', 'discovered', 'verified')")

$conn.Close()
