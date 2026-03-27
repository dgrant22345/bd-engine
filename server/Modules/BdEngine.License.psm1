Set-StrictMode -Version Latest

<#
.SYNOPSIS
    License key generation and validation for BD Engine commercial edition.

.DESCRIPTION
    License keys use HMAC-SHA256 signing with a secret. Keys are formatted as:
    BDENG-XXXXX-XXXXX-XXXXX-XXXXX

    The key encodes: licensee name, expiry date, and a signature.
    Validation checks the signature and expiry without needing a server.
#>

$script:LicenseFilePath = $null

function Initialize-LicensePath {
    param([string]$DataDir)
    $script:LicenseFilePath = Join-Path $DataDir 'license.json'
}

function New-LicenseKey {
    <#
    .SYNOPSIS
        Generates a new license key for a customer. Run this as the vendor.
    .PARAMETER LicenseeName
        The customer's name or company.
    .PARAMETER ExpiryDate
        When the license expires (default: 1 year from now).
    .PARAMETER Secret
        The HMAC signing secret. Keep this private.
    #>
    param(
        [Parameter(Mandatory)][string]$LicenseeName,
        [DateTime]$ExpiryDate = (Get-Date).AddYears(1),
        [Parameter(Mandatory)][string]$Secret
    )

    $payload = @{
        licensee = $LicenseeName
        expiry   = $ExpiryDate.ToString('yyyy-MM-dd')
        issued   = (Get-Date).ToString('yyyy-MM-dd')
    }

    $payloadJson = $payload | ConvertTo-Json -Compress
    $payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($payloadJson)
    $payloadB64 = [Convert]::ToBase64String($payloadBytes)

    # Sign with HMAC-SHA256
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($Secret)
    $sigBytes = $hmac.ComputeHash($payloadBytes)
    $sigHex = ($sigBytes | ForEach-Object { $_.ToString('x2') }) -join ''

    # Format: BDENG-{first 20 chars of sig in groups of 5}
    $sigPart = $sigHex.Substring(0, 20).ToUpper()
    $keyFormatted = "BDENG-$($sigPart.Substring(0,5))-$($sigPart.Substring(5,5))-$($sigPart.Substring(10,5))-$($sigPart.Substring(15,5))"

    return @{
        key      = $keyFormatted
        payload  = $payloadB64
        licensee = $LicenseeName
        expiry   = $ExpiryDate.ToString('yyyy-MM-dd')
    }
}

function Test-LicenseKey {
    <#
    .SYNOPSIS
        Validates a license key + payload pair.
    .PARAMETER Key
        The formatted license key (BDENG-XXXXX-XXXXX-XXXXX-XXXXX).
    .PARAMETER Payload
        The base64-encoded payload string.
    .PARAMETER Secret
        The HMAC signing secret.
    #>
    param(
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)][string]$Payload,
        [Parameter(Mandatory)][string]$Secret
    )

    try {
        $payloadBytes = [Convert]::FromBase64String($Payload)
        $payloadJson = [System.Text.Encoding]::UTF8.GetString($payloadBytes)
        $payloadObj = $payloadJson | ConvertFrom-Json

        # Recompute signature
        $hmac = New-Object System.Security.Cryptography.HMACSHA256
        $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($Secret)
        $sigBytes = $hmac.ComputeHash($payloadBytes)
        $sigHex = ($sigBytes | ForEach-Object { $_.ToString('x2') }) -join ''

        $expectedSigPart = $sigHex.Substring(0, 20).ToUpper()
        $expectedKey = "BDENG-$($expectedSigPart.Substring(0,5))-$($expectedSigPart.Substring(5,5))-$($expectedSigPart.Substring(10,5))-$($expectedSigPart.Substring(15,5))"

        if ($Key -ne $expectedKey) {
            return @{ valid = $false; reason = 'Invalid license key' }
        }

        # Check expiry
        $expiryDate = [DateTime]::ParseExact($payloadObj.expiry, 'yyyy-MM-dd', $null)
        if ($expiryDate -lt (Get-Date).Date) {
            return @{ valid = $false; reason = "License expired on $($payloadObj.expiry)" }
        }

        return @{
            valid    = $true
            licensee = $payloadObj.licensee
            expiry   = $payloadObj.expiry
            issued   = $payloadObj.issued
        }
    } catch {
        return @{ valid = $false; reason = "License validation error: $_" }
    }
}

function Get-InstalledLicense {
    <#
    .SYNOPSIS
        Reads the installed license from data/license.json.
    #>
    if (-not $script:LicenseFilePath -or -not (Test-Path $script:LicenseFilePath)) {
        return $null
    }

    try {
        $data = Get-Content $script:LicenseFilePath -Raw | ConvertFrom-Json
        return $data
    } catch {
        return $null
    }
}

function Install-License {
    <#
    .SYNOPSIS
        Saves a license key + payload to data/license.json.
    #>
    param(
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)][string]$Payload,
        [string]$LicenseeName = ''
    )

    if (-not $script:LicenseFilePath) {
        throw 'License path not initialized. Call Initialize-LicensePath first.'
    }

    $license = @{
        key       = $Key
        payload   = $Payload
        licensee  = $LicenseeName
        installed = (Get-Date).ToString('o')
    }

    $license | ConvertTo-Json | Set-Content $script:LicenseFilePath -Encoding UTF8
    return $license
}

Export-ModuleMember -Function @(
    'Initialize-LicensePath'
    'New-LicenseKey'
    'Test-LicenseKey'
    'Get-InstalledLicense'
    'Install-License'
)
