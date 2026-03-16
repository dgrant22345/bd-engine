Import-Module .\Modules\BdEngine.State.psm1
Import-Module .\Modules\BdEngine.JobImport.psm1
$state = Get-AppState
$candidates = @($state.companies | Where-Object { $_.enrichmentStatus -eq $null -or $_.enrichmentStatus -eq '' } | Select-Object -First 50)
$res = Invoke-CompanyEnrichment -State $state -AccountIds ($candidates | ForEach-Object { $_.id }) -Limit 50
$failures = @{}
foreach ($c in $candidates) {
    $reason = $c.enrichmentFailureReason
    if (-not $reason) { $reason = 'Success' }
    if ($c.enrichmentStatus -in 'verified', 'enriched') { $reason = 'Success' }
    if (!$failures.ContainsKey($reason)) { $failures[$reason] = 0 }
    $failures[$reason] += 1
}
$failures | ConvertTo-Json
