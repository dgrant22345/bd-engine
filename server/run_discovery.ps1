Import-Module .\Modules\BdEngine.State.psm1
Import-Module .\Modules\BdEngine.JobImport.psm1
Import-Module .\Modules\BdEngine.SqliteStore.psm1

$state = Get-AppState

Write-Host "Fetching high priority candidates..."
$candidates = @($state.companies | Where-Object { $_.priority -in @('1', '2', '3') -or $_.priorityTier -in @('1', '2', '3') -or $_.priorityTier -eq 'high' }) 

if ($candidates.Count -eq 0) {
    $candidates = @($state.companies | Sort-Object @{ Expression = { $_.targetScore }; Descending = $true } | Select-Object -First 200)
} else {
    $candidates = $candidates | Sort-Object @{ Expression = { $_.targetScore }; Descending = $true } | Select-Object -First 200
}

Write-Host "Running Enrichment for $($candidates.Count) candidates..."
$res = Invoke-CompanyEnrichment -State $state -AccountIds ($candidates | ForEach-Object { $_.id }) -Limit 200
Sync-AppStateSegmentsPartial -State $res.state -Segments @('Companies') | Out-Null
Write-Host "Enrichment complete."

Write-Host "Running ATS Discovery on newly enriched..."
$res2 = Invoke-AtsDiscovery -State $res.state -Limit 100 -ForceRefresh:$true
Sync-AppStateSegmentsPartial -State $res2.state -Segments @('BoardConfigs', 'Companies') | Out-Null
Write-Host "Discovery complete."
