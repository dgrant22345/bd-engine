Import-Module .\Modules\BdEngine.State.psm1
Import-Module .\Modules\BdEngine.JobImport.psm1

$state = Get-AppState
Write-Host "Got state. Companies: $($state.companies.Count)"

$candidates = @($state.companies | Where-Object { $_.enrichmentStatus -eq $null -or $_.enrichmentStatus -eq '' } | Select-Object -First 50)
Write-Host "Running Enrichment for 50 unenriched candidates..."

$res = Invoke-CompanyEnrichment -State $state -AccountIds ($candidates | ForEach-Object { $_.id }) -Limit 50
Write-Host "Enrichment complete."

$failures = @{}
foreach ($c in $candidates) {
    $reason = $c.enrichmentFailureReason
    if (-not $reason) { $reason = 'Success' }
    if ($c.enrichmentStatus -in 'verified', 'enriched') { $reason = 'Success' }
    if (!$failures.ContainsKey($reason)) { $failures[$reason] = 0 }
    $failures[$reason] += 1
}

foreach ($kv in $failures.GetEnumerator()) {
    Write-Host "$($kv.Key): $($kv.Value)"
}
