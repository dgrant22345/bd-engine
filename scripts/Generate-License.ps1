<#
.SYNOPSIS
    Generate a license key for a BD Engine customer.
    THIS SCRIPT IS FOR THE VENDOR ONLY — do not distribute.

.EXAMPLE
    .\Generate-License.ps1 -LicenseeName "Acme Corp" -Secret "your-secret-here"
    .\Generate-License.ps1 -LicenseeName "Jane Smith" -ExpiryDate "2027-03-27" -Secret "your-secret-here"
#>
param(
    [Parameter(Mandatory)][string]$LicenseeName,
    [string]$ExpiryDate,
    [Parameter(Mandatory)][string]$Secret
)

$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot '..\server\Modules\BdEngine.License.psm1'
Import-Module $modulePath -Force

$params = @{
    LicenseeName = $LicenseeName
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
Write-Host "  Licensee:  $($result.licensee)"
Write-Host "  Expires:   $($result.expiry)"
Write-Host ''
Write-Host '  License Key:' -ForegroundColor Green
Write-Host "  $($result.key)" -ForegroundColor Yellow
Write-Host ''
Write-Host '  License Payload:' -ForegroundColor Green
Write-Host "  $($result.payload)" -ForegroundColor Yellow
Write-Host ''
Write-Host '  Send BOTH the key and payload to the customer.'
Write-Host '  They will enter these during first-run setup.'
Write-Host ''
