Add-Type -Path '.\vendor\sqlite\System.Data.SQLite.dll'
$conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=.\data\bd-engine.db;Version=3;')
$conn.Open()

function Get-Scalar($sql) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    return $cmd.ExecuteScalar()
}

Write-Output "Total distinct: $((Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies"))"
Write-Output "Distinct canonical_domain: $((Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies WHERE json_extract(data_json, '$.canonicalDomain') IS NOT NULL AND json_extract(data_json, '$.canonicalDomain') != ''"))"
Write-Output "Distinct careers_url: $((Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies WHERE json_extract(data_json, '$.careersUrl') IS NOT NULL AND json_extract(data_json, '$.careersUrl') != ''"))"
Write-Output "Distinct aliases: $((Get-Scalar "SELECT COUNT(DISTINCT id) FROM companies WHERE json_extract(data_json, '$.aliases') IS NOT NULL AND json_extract(data_json, '$.aliases') != '[]' AND json_extract(data_json, '$.aliases') != ''"))"
Write-Output "Distinct resolved ats (in bc): $((Get-Scalar "SELECT COUNT(DISTINCT c.id) FROM companies c JOIN board_configs bc ON c.normalized_name = bc.normalized_company_name WHERE json_extract(bc.data_json, '$.discoveryStatus') IN ('mapped', 'discovered', 'verified')"))"
Write-Output "Distinct active board_url: $((Get-Scalar "SELECT COUNT(DISTINCT c.id) FROM companies c JOIN board_configs bc ON c.normalized_name = bc.normalized_company_name WHERE json_extract(bc.data_json, '$.resolvedBoardUrl') IS NOT NULL AND json_extract(bc.data_json, '$.resolvedBoardUrl') != ''"))"

$conn.Close()
