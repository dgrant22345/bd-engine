<#
.SYNOPSIS
    First-run setup wizard for BD Engine commercial edition.
    Handles license activation, workspace naming, and owner roster configuration.
#>
param(
    [switch]$SkipLicense
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$dataDir = Join-Path $projectRoot 'data'

# ─── Ensure data directory ───
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir | Out-Null
}

# ─── Import license module ───
$licenseModule = Join-Path $projectRoot 'server\Modules\BdEngine.License.psm1'
Import-Module $licenseModule -Force
Initialize-LicensePath -DataDir $dataDir

# The HMAC secret embedded in the commercial build (change this for your builds)
$LicenseSecret = 'bd-engine-commercial-2026'

function Show-Banner {
    Write-Host ''
    Write-Host '  ============================================' -ForegroundColor Cyan
    Write-Host '   BD Engine - First-Run Setup' -ForegroundColor Cyan
    Write-Host '  ============================================' -ForegroundColor Cyan
    Write-Host ''
}

function Step-License {
    $existing = Get-InstalledLicense
    if ($existing) {
        $check = Test-LicenseKey -Key $existing.key -Payload $existing.payload -Secret $LicenseSecret
        if ($check.valid) {
            Write-Host "  [OK] License active for: $($check.licensee) (expires $($check.expiry))" -ForegroundColor Green
            Write-Host ''
            return $true
        } else {
            Write-Host "  [!] Existing license invalid: $($check.reason)" -ForegroundColor Yellow
        }
    }

    Write-Host '  Enter your license information below.'
    Write-Host '  (You received a key and payload when you purchased BD Engine.)'
    Write-Host ''

    $key = Read-Host '  License Key (BDENG-XXXXX-XXXXX-XXXXX-XXXXX)'
    $key = $key.Trim()

    $payload = Read-Host '  License Payload'
    $payload = $payload.Trim()

    if (-not $key -or -not $payload) {
        Write-Host '  [ERROR] Both key and payload are required.' -ForegroundColor Red
        return $false
    }

    $check = Test-LicenseKey -Key $key -Payload $payload -Secret $LicenseSecret
    if (-not $check.valid) {
        Write-Host "  [ERROR] $($check.reason)" -ForegroundColor Red
        return $false
    }

    Install-License -Key $key -Payload $payload -LicenseeName $check.licensee
    Write-Host ''
    Write-Host "  [OK] License activated for: $($check.licensee)" -ForegroundColor Green
    Write-Host "       Expires: $($check.expiry)" -ForegroundColor Green
    Write-Host ''
    return $true
}

function Step-Workspace {
    $wsFile = Join-Path $dataDir 'workspace.json'
    $ws = @{ id = 'workspace-default'; name = 'My Workspace'; createdAt = (Get-Date).ToString('o') }

    if (Test-Path $wsFile) {
        try {
            $existing = Get-Content $wsFile -Raw | ConvertFrom-Json
            if ($existing.name -and $existing.name -ne 'My Workspace') {
                Write-Host "  Workspace: $($existing.name)" -ForegroundColor Green
                return
            }
        } catch {}
    }

    Write-Host '  What would you like to name your workspace?'
    $name = Read-Host '  Workspace name (default: My Workspace)'
    if ($name.Trim()) {
        $ws.name = $name.Trim()
    }

    $ws | ConvertTo-Json | Set-Content $wsFile -Encoding UTF8
    Write-Host "  [OK] Workspace created: $($ws.name)" -ForegroundColor Green
    Write-Host ''
}

function Step-Owners {
    $ownersFile = Join-Path $dataDir 'owners.json'

    if (Test-Path $ownersFile) {
        try {
            $existing = Get-Content $ownersFile -Raw | ConvertFrom-Json
            if ($existing.Count -gt 0 -and $existing[0].displayName -ne 'Team Member 1') {
                Write-Host "  Team members: $(($existing | ForEach-Object { $_.displayName }) -join ', ')" -ForegroundColor Green
                return
            }
        } catch {}
    }

    Write-Host '  Add your team members (the people who will use BD Engine).'
    Write-Host '  Enter names one at a time. Press Enter with no name when done.'
    Write-Host ''

    $owners = @()
    $i = 1
    while ($true) {
        $name = Read-Host "  Team member $i name (or press Enter to finish)"
        if (-not $name.Trim()) { break }

        $slug = ($name.Trim().ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
        $owners += @{ ownerId = $slug; displayName = $name.Trim() }
        $i++
    }

    if ($owners.Count -eq 0) {
        $owners += @{ ownerId = 'user-1'; displayName = 'Team Member 1' }
        Write-Host '  Using default team member. You can edit data\owners.json later.' -ForegroundColor Yellow
    }

    $owners | ConvertTo-Json -Depth 2 | Set-Content $ownersFile -Encoding UTF8
    Write-Host "  [OK] $($owners.Count) team member(s) configured." -ForegroundColor Green
    Write-Host ''
}

function Step-Settings {
    $settingsFile = Join-Path $dataDir 'settings.json'
    $settings = @{
        workspaceId              = 'workspace-default'
        minCompanyConnections    = 3
        minJobsPosted            = 2
        contactPriorityThreshold = 10
        maxCompaniesToReview     = 25
        geographyFocus           = ''
        gtaPriority              = $false
    }

    if (Test-Path $settingsFile) {
        try {
            $existing = Get-Content $settingsFile -Raw | ConvertFrom-Json
            if ($existing.geographyFocus) {
                Write-Host "  Settings already configured (geography: $($existing.geographyFocus))." -ForegroundColor Green
                return
            }
        } catch {}
    }

    Write-Host '  Optional: Set your geography focus (e.g., "United States", "Canada", "UK").'
    $geo = Read-Host '  Geography focus (or press Enter to skip)'
    if ($geo.Trim()) {
        $settings.geographyFocus = $geo.Trim()
    }

    $settings | ConvertTo-Json | Set-Content $settingsFile -Encoding UTF8
    Write-Host '  [OK] Settings saved.' -ForegroundColor Green
    Write-Host ''
}

# ─── Main ───
Show-Banner

if (-not $SkipLicense) {
    $licensed = Step-License
    if (-not $licensed) {
        Write-Host ''
        Write-Host '  Setup cannot continue without a valid license.' -ForegroundColor Red
        Write-Host '  Contact your vendor for license information.' -ForegroundColor Red
        Write-Host ''
        exit 1
    }
}

Step-Workspace
Step-Owners
Step-Settings

Write-Host ''
Write-Host '  ============================================' -ForegroundColor Green
Write-Host '   Setup complete!' -ForegroundColor Green
Write-Host '  ============================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Run Start-BDEngine.bat to launch the app.'
Write-Host ''
