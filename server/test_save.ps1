Import-Module .\Modules\BdEngine.State.psm1
Import-Module .\Modules\BdEngine.JobImport.psm1
$state = Get-AppState
$candidates = @($state.companies | Where-Object { $_.enrichmentStatus -eq $null -or $_.enrichmentStatus -eq '' } | Select-Object -First 5)
$res = Invoke-CompanyEnrichment -State $state -AccountIds ($candidates | ForEach-Object { $_.id }) -Limit 5
Sync-AppStateSegmentsPartial -State $res.state -Segments @('Companies') | Out-Null
Write-Output "Enriched "
