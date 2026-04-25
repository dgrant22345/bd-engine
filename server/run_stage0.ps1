Import-Module .\server\Modules\BdEngine.SqliteStore.psm1 -Force
Invoke-BdSqliteLocalEnrichmentPass -ForceRefresh
