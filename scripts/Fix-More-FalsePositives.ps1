$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()

$now = (Get-Date).ToString('o')

# Revert ALL candidate_probe_more entries (JazzHR + any other false positives from that run)
$cmd = $conn.CreateCommand()
$cmd.CommandText = @"
SELECT COUNT(*) as cnt FROM board_configs WHERE discovery_method = 'candidate_probe_more'
"@
$r = $cmd.ExecuteReader()
$r.Read()
Write-Host "Found $($r['cnt']) candidate_probe_more entries to revert"
$r.Close()

$updateCmd = $conn.CreateCommand()
$updateCmd.CommandText = @"
UPDATE board_configs SET
  ats_type = '',
  board_id = '',
  resolved_board_url = '',
  source = '',
  active = 0,
  supported_import = 0,
  discovery_status = 'no_match_supported_ats',
  discovery_method = 'candidate_probe',
  confidence_score = 0,
  confidence_band = 'unresolved',
  evidence_summary = '',
  failure_reason = 'No supported ATS board found via slug probing',
  last_checked_at = '$now',
  data_json = json_set(data_json,
    '$.atsType', '',
    '$.boardId', '',
    '$.resolvedBoardUrl', '',
    '$.active', json('false'),
    '$.supportedImport', json('false'),
    '$.discoveryStatus', 'no_match_supported_ats',
    '$.discoveryMethod', 'candidate_probe',
    '$.confidenceScore', 0,
    '$.confidenceBand', 'unresolved',
    '$.evidenceSummary', '',
    '$.failureReason', 'No supported ATS board found via slug probing',
    '$.lastCheckedAt', '$now'
  )
WHERE discovery_method = 'candidate_probe_more'
"@
$reverted = $updateCmd.ExecuteNonQuery()
Write-Host "Reverted $reverted entries"

$conn.Close()

# Re-apply known enterprise mappings
Write-Host ""
Write-Host "Re-applying known enterprise mappings..."
