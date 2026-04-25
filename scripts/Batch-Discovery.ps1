param(
    [int]$BatchSize = 25,
    [int]$MaxBatches = 40,
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
    Import-Module "$root\server\Modules\BdEngine.State.psm1" -Force
    Import-Module "$root\server\Modules\BdEngine.Domain.psm1" -Force
    Import-Module "$root\server\Modules\BdEngine.JobImport.psm1" -Force
    Import-Module "$root\server\Modules\BdEngine.SqliteStore.psm1" -Force

    Write-Host "Loading app state..."
    $state = Get-AppState

    $unresolved = @($state.boardConfigs | Where-Object {
        $status = [string](Get-ObjectValue -Object $_ -Name 'discoveryStatus' -Default 'unresolved')
        $method = [string](Get-ObjectValue -Object $_ -Name 'discoveryMethod' -Default '')
        $status -eq 'unresolved' -or ($status -eq '' -and $method -eq 'account_seed')
    })

    Write-Host "Found $($unresolved.Count) unresolved board configs"

    if ($DryRun) {
        Write-Host "[DRY RUN] Would process $($unresolved.Count) configs in batches of $BatchSize"
        return
    }

    $totalProcessed = 0
    $totalDiscovered = 0
    $totalMapped = 0
    $batchNum = 0

    while ($unresolved.Count -gt 0 -and $batchNum -lt $MaxBatches) {
        $batchNum++
        $batch = @($unresolved | Select-Object -First $BatchSize)
        $batchIds = @($batch | ForEach-Object { [string](Get-ObjectValue -Object $_ -Name 'id') })

        Write-Host ""
        Write-Host "=== Batch ${batchNum}: Processing $($batch.Count) configs ==="

        try {
            $result = Invoke-AtsDiscovery -State $state -ConfigIds $batchIds -ForceRefresh -SkipDerivedData -SkipSync

            $state = $result.state
            $stats = $result.stats

            $totalProcessed += [int]$stats.checked
            $totalDiscovered += [int]$stats.discovered
            $totalMapped += [int]$stats.mapped

            Write-Host "  Checked: $($stats.checked) | Mapped: $($stats.mapped) | Discovered: $($stats.discovered) | No match: $($stats.noMatch) | Missing: $($stats.missingInputs) | Errors: $($stats.errors)"
            Write-Host "  High: $($stats.highConfidence) | Medium: $($stats.mediumConfidence) | Low: $($stats.lowConfidence)"

            # Save progress after each batch
            Write-Host "  Saving batch results..."
            try {
                Sync-AppStateSegmentsPartial -State $state -Segments @('BoardConfigs') | Out-Null
                Write-Host "  Saved."
            } catch {
                Write-Host "  WARNING: Save failed: $_"
            }
        } catch {
            Write-Host "  ERROR in batch: $_"
            Write-Host "  Continuing to next batch..."
        }

        # Refresh unresolved list
        $unresolved = @($state.boardConfigs | Where-Object {
            $status = [string](Get-ObjectValue -Object $_ -Name 'discoveryStatus' -Default 'unresolved')
            $method = [string](Get-ObjectValue -Object $_ -Name 'discoveryMethod' -Default '')
            $status -eq 'unresolved' -or ($status -eq '' -and $method -eq 'account_seed')
        })

        Write-Host "  Remaining unresolved: $($unresolved.Count)"
    }

    Write-Host ""
    Write-Host "=== FINAL SUMMARY ==="
    Write-Host "Total processed: $totalProcessed"
    Write-Host "Total mapped: $totalMapped"
    Write-Host "Total discovered: $totalDiscovered"
    Write-Host "Total resolved: $($totalMapped + $totalDiscovered)"

    $finalResolved = @($state.boardConfigs | Where-Object {
        $status = [string](Get-ObjectValue -Object $_ -Name 'discoveryStatus' -Default '')
        $status -in @('discovered', 'verified', 'mapped')
    })
    $total = [math]::Max(1, $state.boardConfigs.Count)
    $pct = [math]::Round($finalResolved.Count / $total * 100, 1)
    Write-Host "Overall resolved board configs: $($finalResolved.Count) / $($state.boardConfigs.Count) (${pct}%)"

} catch {
    Write-Host "FATAL ERROR: $_"
    Write-Host $_.ScriptStackTrace
} finally {
    Pop-Location
}
