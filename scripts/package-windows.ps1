param(
    [string]$Version = '',
    [string]$InnoSetupPath = '',
    [switch]$SkipInstaller
)

$ErrorActionPreference = 'Stop'

$projectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Resolve-Path '.').Path }
$distRoot = Join-Path $projectRoot 'dist'
$windowsDistRoot = Join-Path $distRoot 'windows'
$stagingRoot = Join-Path $windowsDistRoot 'app'
$issPath = Join-Path $projectRoot 'packaging\windows\BD-Engine.iss'

if ([string]::IsNullOrWhiteSpace($Version)) {
    $versionPath = Join-Path $projectRoot 'VERSION'
    $Version = if (Test-Path -LiteralPath $versionPath) {
        (Get-Content -LiteralPath $versionPath -Raw).Trim()
    } else {
        '0.1.0'
    }
}

function Copy-RequiredDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $source = Join-Path $projectRoot $Name
    $destination = Join-Path $stagingRoot $Name
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Required directory was not found: $source"
    }

    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

function Copy-RequiredFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [string]$DestinationRelativePath = ''
    )

    $source = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Required file was not found: $source"
    }

    $destinationRelative = if ([string]::IsNullOrWhiteSpace($DestinationRelativePath)) { $RelativePath } else { $DestinationRelativePath }
    $destination = Join-Path $stagingRoot $destinationRelative
    $destinationDirectory = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $destinationDirectory)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }

    Copy-Item -LiteralPath $source -Destination $destination -Force
}

function Find-InnoSetupCompiler {
    if (-not [string]::IsNullOrWhiteSpace($InnoSetupPath)) {
        if (-not (Test-Path -LiteralPath $InnoSetupPath)) {
            throw "Inno Setup compiler was not found at $InnoSetupPath"
        }
        return $InnoSetupPath
    }

    $command = Get-Command iscc.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    return ''
}

function Assert-CustomerPackageIsClean {
    $forbiddenDirectories = @(
        'data',
        'BD-Engine',
        'data_backup_before_reseed',
        'gmail-oauth-helper',
        'google-apps-script',
        'compliant_outreach_app',
        'outreach_output',
        'outreach_output_test',
        'tools',
        '.git',
        '.claude'
    )

    foreach ($name in $forbiddenDirectories) {
        $path = Join-Path $stagingRoot $name
        if (Test-Path -LiteralPath $path) {
            throw "Customer package contains forbidden directory: $name"
        }
    }

    $forbiddenFilePatterns = @(
        '*.credentials.json',
        '*.service-account.json',
        'bd-engine.db',
        'bd-engine.db-wal',
        'bd-engine.db-shm',
        'Connections.csv',
        'workbook.xlsx'
    )

    foreach ($pattern in $forbiddenFilePatterns) {
        $matches = @(Get-ChildItem -Path $stagingRoot -Recurse -File -Force -Filter $pattern -ErrorAction SilentlyContinue)
        if ($matches.Count -gt 0) {
            $relative = @($matches | ForEach-Object { $_.FullName.Substring($stagingRoot.Length + 1) })
            throw "Customer package contains forbidden personal/runtime file(s): $($relative -join ', ')"
        }
    }
}

Write-Host "Preparing BD Engine Windows package $Version..."

if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

Copy-RequiredDirectory -Name 'app'
Copy-RequiredDirectory -Name 'server\Modules'
Copy-RequiredDirectory -Name 'server\vendor'
Copy-RequiredFile -RelativePath 'server\Server.ps1'
Copy-RequiredFile -RelativePath 'server\BackgroundJobWorker.ps1'
Copy-RequiredFile -RelativePath 'server\schema.sql'
$emptyDataSource = Join-Path $projectRoot 'packaging\empty-data'
$emptyDataDestination = Join-Path $stagingRoot 'data-template'
if (-not (Test-Path -LiteralPath $emptyDataSource)) {
    throw "Required empty data template was not found: $emptyDataSource"
}
Copy-Item -LiteralPath $emptyDataSource -Destination $emptyDataDestination -Recurse -Force

Copy-RequiredFile -RelativePath 'scripts\Sync-LiveJobBoardsConfig.ps1'
Copy-RequiredFile -RelativePath 'packaging\windows\BD-Engine-Launcher.ps1' -DestinationRelativePath 'BD-Engine-Launcher.ps1'
Copy-RequiredFile -RelativePath 'VERSION'

foreach ($doc in @('DIST_README.md', 'PACKAGING.md', 'README.md')) {
    if (Test-Path -LiteralPath (Join-Path $projectRoot $doc)) {
        Copy-RequiredFile -RelativePath $doc
    }
}

$manifest = [ordered]@{
    name = 'BD Engine'
    version = $Version
    builtAt = (Get-Date).ToString('o')
    dataMode = 'empty-template'
    userDataRoot = '%LOCALAPPDATA%\BD Engine\Data'
    installer = 'Inno Setup'
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $stagingRoot 'package-manifest.json') -Encoding UTF8

Assert-CustomerPackageIsClean

if ($SkipInstaller) {
    Write-Host "Staged customer package at $stagingRoot"
    Write-Host 'Skipped installer compilation because -SkipInstaller was supplied.'
    exit 0
}

$iscc = Find-InnoSetupCompiler
if ([string]::IsNullOrWhiteSpace($iscc)) {
    throw "Inno Setup 6 compiler (ISCC.exe) was not found. Install Inno Setup 6 or pass -InnoSetupPath. Staged files are ready at $stagingRoot."
}

if (-not (Test-Path -LiteralPath $issPath)) {
    throw "Inno Setup script was not found: $issPath"
}

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
& $iscc "/DAppVersion=$Version" "/DSourceDir=$stagingRoot" "/DOutputDir=$distRoot" $issPath
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup failed with exit code $LASTEXITCODE."
}

$installerPath = Join-Path $distRoot 'BD-Engine-Setup.exe'
if (-not (Test-Path -LiteralPath $installerPath)) {
    throw "Expected installer was not created: $installerPath"
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $installerPath).Length / 1MB, 1)
Write-Host "Created $installerPath ($sizeMb MB)"
