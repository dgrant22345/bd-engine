param()

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$stateModule = Join-Path $projectRoot 'server\Modules\BdEngine.State.psm1'

Import-Module $stateModule -Force -DisableNameChecking

$result = Invoke-AppJsonToSqliteMigration
$result | ConvertTo-Json -Depth 10
