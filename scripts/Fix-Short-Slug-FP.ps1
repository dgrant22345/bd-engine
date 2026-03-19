$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()

# False positives from short/generic slugs
$falsePositives = @(
    'cw global partners'
    'de havilland aircraft of canada limited'
    'confidential company'
    'shared services canada services partag s canada'
    'u s bank'
    'vertical staffing resources'
    'president s choice financial'
)

$now = (Get-Date).ToString('o')
$reverted = 0

foreach ($name in $falsePositives) {
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = @"
UPDATE board_configs SET
  ats_type = '', board_id = '', resolved_board_url = '', source = '',
  active = 0, supported_import = 0,
  discovery_status = 'no_match_supported_ats', discovery_method = 'candidate_probe',
  confidence_score = 0, confidence_band = 'unresolved', evidence_summary = '',
  failure_reason = 'No supported ATS board found via slug probing',
  last_checked_at = '$now',
  data_json = json_set(data_json,
    '$.atsType', '', '$.boardId', '', '$.resolvedBoardUrl', '',
    '$.active', json('false'), '$.supportedImport', json('false'),
    '$.discoveryStatus', 'no_match_supported_ats', '$.discoveryMethod', 'candidate_probe',
    '$.confidenceScore', 0, '$.confidenceBand', 'unresolved', '$.evidenceSummary', '',
    '$.failureReason', 'No supported ATS board found via slug probing',
    '$.lastCheckedAt', '$now')
WHERE normalized_company_name = '$name'
"@
    $affected = $cmd.ExecuteNonQuery()
    if ($affected -gt 0) { Write-Host "Reverted: $name"; $reverted++ }
}

$conn.Close()
Write-Host "Reverted $reverted false positives"
