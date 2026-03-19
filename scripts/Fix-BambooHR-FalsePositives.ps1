$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()

# Find entries that were incorrectly marked as BambooHR by the Extra probe
# These are companies where discovery_method is 'candidate_probe_extra' and ats_type is 'bamboohr'
# We need to revert them to no_match_supported_ats
$cmd.CommandText = @"
SELECT COUNT(*) as cnt FROM board_configs
WHERE ats_type = 'bamboohr' AND discovery_method = 'candidate_probe_extra'
"@
$r = $cmd.ExecuteReader()
$r.Read()
$count = [int]$r['cnt']
$r.Close()
Write-Host "Found $count BambooHR entries from Extra probe to revert"

# Revert them all back to no_match
$now = (Get-Date).ToString('o')
$next = (Get-Date).AddDays(30).ToString('o')
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
WHERE ats_type = 'bamboohr' AND discovery_method = 'candidate_probe_extra'
"@
$reverted = $updateCmd.ExecuteNonQuery()
Write-Host "Reverted $reverted entries"

# Now re-apply known enterprise mappings for any that were just reverted
# but actually have known mappings
$conn.Close()
Write-Host ""
Write-Host "Now re-running Apply-Known-Enterprise to fix any that have known mappings..."
