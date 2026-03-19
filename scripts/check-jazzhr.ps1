$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = @"
SELECT normalized_company_name, board_id, resolved_board_url
FROM board_configs
WHERE ats_type = 'jazzhr' AND discovery_method = 'candidate_probe_more'
LIMIT 10
"@
$r = $cmd.ExecuteReader()
while ($r.Read()) {
    Write-Host "$($r['normalized_company_name']) => $($r['board_id'])"
}
$r.Close()
$conn.Close()

# Test a few URLs
Write-Host ""
Write-Host "Testing JazzHR URLs..."
$testSlugs = @('adp', 'amazon', 'nonexistentcompany123xyz')
foreach ($slug in $testSlugs) {
    $url = "https://$slug.applytojob.com/apply"
    try {
        $headers = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -Headers $headers -ErrorAction Stop -MaximumRedirection 3
        $hasMatch = $resp.Content -match 'JazzHR|applytojob|job'
        Write-Host "  $slug : status=$($resp.StatusCode), match=$hasMatch, length=$($resp.Content.Length)"
    } catch {
        Write-Host "  $slug : ERROR $_"
    }
}
