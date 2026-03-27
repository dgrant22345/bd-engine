<#
.SYNOPSIS
    Generate a license key for a BD Engine customer.
    THIS SCRIPT IS FOR THE VENDOR ONLY — do not distribute.

.DESCRIPTION
    The customer runs Setup-BDEngine.ps1 first, which displays their Machine ID.
    They send you the Machine ID, then you run this script to generate a
    license key that only works on their specific computer.

.EXAMPLE
    .\Generate-License.ps1 -LicenseeName "Acme Corp" -MachineId "MACH-A1B2-C3D4-E5F6-7890" -Secret "your-secret-here"
    .\Generate-License.ps1 -LicenseeName "Jane Smith" -MachineId "MACH-A1B2-C3D4-E5F6-7890" -ExpiryDate "2027-03-27" -Secret "your-secret-here"
#>
param(
    [Parameter(Mandatory)][string]$LicenseeName,
    [Parameter(Mandatory)][string]$MachineId,
    [string]$ExpiryDate,
    [Parameter(Mandatory)][string]$Secret
)

$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\server\Modules\BdEngine.License.psm1'
Import-Module $modulePath -Force

$params = @{
    LicenseeName = $LicenseeName
    MachineId    = $MachineId
    Secret       = $Secret
}

if ($ExpiryDate) {
    $params.ExpiryDate = [DateTime]::ParseExact($ExpiryDate, 'yyyy-MM-dd', $null)
}

$result = New-LicenseKey @params

Write-Host ''
Write-Host '  =========================================' -ForegroundColor Cyan
Write-Host '   BD Engine License Generated' -ForegroundColor Cyan
Write-Host '  =========================================' -ForegroundColor Cyan
Write-Host ''
Write-Host "  Licensee:    $($result.licensee)"
Write-Host "  Machine ID:  $($result.machineId)"
Write-Host "  Expires:     $($result.expiry)"
Write-Host ''
Write-Host '  License Key:' -ForegroundColor Green
Write-Host "  $($result.key)" -ForegroundColor Yellow
Write-Host ''
Write-Host '  License Payload:' -ForegroundColor Green
Write-Host "  $($result.payload)" -ForegroundColor Yellow
Write-Host ''
Write-Host '  Send BOTH the key and payload to the customer.'
Write-Host '  This license ONLY works on the machine with ID:' -ForegroundColor Red
Write-Host "  $($result.machineId)" -ForegroundColor Red
Write-Host ''
