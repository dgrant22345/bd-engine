Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot

Import-Module (Join-Path $PSScriptRoot 'Modules\BdEngine.BackgroundJobs.psm1') -Force -DisableNameChecking

Set-Location $projectRoot
Start-BackgroundWorkerLoop
