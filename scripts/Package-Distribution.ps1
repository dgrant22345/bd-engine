$ErrorActionPreference = 'Stop'

$projectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Resolve-Path '.').Path }
$zipName = 'BD-Engine.zip'
$zipPath = Join-Path $projectRoot $zipName
$tempDir = Join-Path $env:TEMP 'BD-Engine-pkg'

# Items to exclude from the commercial package
$excludeTopLevel = @(
    '.claude'
    '.git'
    'data_backup_before_reseed'
    'node_modules'
    'scratch.txt'
    'server-test.log'
    'Package-BDEngine.bat'
    'BD-Engine.zip'
    'AGENTS.md'
    'google-apps-script'
    'docs'
)

# Scripts that should NOT be shipped (vendor-only tools)
$excludeScripts = @(
    'Generate-License.ps1'
)

$excludeDataFiles = @(
    'background-worker.pid'
    'diagnostic.txt'
    'bd-engine.db'
    'bd-engine.db-wal'
    'bd-engine.db-shm'
    'before_metrics.txt'
    'after_metrics.txt'
    'license.json'
)

$excludeDataDirs = @(
    'live-sheet-backups'
)

# ─── Clean up previous temp/zip ───
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host '  [..] Copying project files...'

# ─── Copy everything except excluded items ───
Get-ChildItem -Path $projectRoot -Force | Where-Object {
    $excludeTopLevel -notcontains $_.Name
} | ForEach-Object {
    $dest = Join-Path $tempDir $_.Name
    if ($_.PSIsContainer) {
        Copy-Item $_.FullName $dest -Recurse -Force
    } else {
        Copy-Item $_.FullName $dest -Force
    }
}

# ─── Remove excluded scripts ───
foreach ($f in $excludeScripts) {
    $p = Join-Path $tempDir "scripts\$f"
    if (Test-Path $p) { Remove-Item $p -Force }
}

# ─── Remove excluded data files ───
foreach ($f in $excludeDataFiles) {
    $p = Join-Path $tempDir "data\$f"
    if (Test-Path $p) { Remove-Item $p -Force }
}

# ─── Remove excluded data directories ───
foreach ($d in $excludeDataDirs) {
    $p = Join-Path $tempDir "data\$d"
    if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

# ─── Ensure clean data templates are in place ───
$dataDir = Join-Path $tempDir 'data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

# Empty seed config (header only)
$seedFile = Join-Path $dataDir 'seed-job-boards-config.json'
@'
[
  ["Company","ATS_Type","Board_ID","Domain","Careers_URL","Active","Notes","Source","","","","Last_Checked","Discovery_Status","Discovery_Method"]
]
'@ | Set-Content $seedFile -Encoding UTF8

# Empty resolver mappings
'{}' | Set-Content (Join-Path $dataDir 'resolver-known-mappings.json') -Encoding UTF8

# ─── Create zip ───
Write-Host '  [..] Compressing...'
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

# ─── Clean up temp ───
Remove-Item $tempDir -Recurse -Force

# ─── Report ───
$size = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$fileCount = $archive.Entries.Count
$archive.Dispose()
Write-Host ''
Write-Host "  [OK] Created $zipName ($size MB, $fileCount files)" -ForegroundColor Green
Write-Host "       Location: $zipPath"
Write-Host ''
Write-Host '  This is a COMMERCIAL build:'
Write-Host '  - No customer data included'
Write-Host '  - License activation required on first launch'
Write-Host '  - License generation script excluded'
Write-Host ''
