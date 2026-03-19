$ErrorActionPreference = 'Stop'

$projectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Resolve-Path '.').Path }
$zipName = 'BD-Engine.zip'
$zipPath = Join-Path $projectRoot $zipName
$tempDir = Join-Path $env:TEMP 'BD-Engine-pkg'

# Items to exclude from the package
$excludeTopLevel = @(
    '.claude'
    '.git'
    'data_backup_before_reseed'
    'node_modules'
    'scratch.txt'
    'server-test.log'
    'Package-BDEngine.bat'
    'BD-Engine.zip'
)

$excludeDataFiles = @(
    'background-worker.pid'
    'diagnostic.txt'
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

# ─── Remove WAL/SHM files (SQLite will recreate them) ───
Get-ChildItem (Join-Path $tempDir 'data') -Filter 'bd-engine.db-*' -ErrorAction SilentlyContinue |
    Remove-Item -Force

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
Write-Host '  Send this file to your coworker.'
Write-Host '  They unzip it and double-click Start-BDEngine.bat'
