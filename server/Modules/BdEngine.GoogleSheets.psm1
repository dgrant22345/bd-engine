Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Web.Extensions

function Get-GoogleServiceAccountConfig {
    $jsonPath = $env:GOOGLE_SERVICE_ACCOUNT_JSON
    if (-not $jsonPath) {
        $jsonPath = $env:GOOGLE_APPLICATION_CREDENTIALS
    }

    if (-not $jsonPath) {
        throw 'Google service account credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS to the JSON key path.'
    }

    if (-not (Test-Path -LiteralPath $jsonPath)) {
        throw "Google service account JSON file not found: $jsonPath"
    }

    $config = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
    if (-not $config.client_email -or -not $config.private_key) {
        throw 'Invalid Google service account JSON. Expected client_email and private_key.'
    }

    return $config
}

function ConvertFrom-PemPrivateKey {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Pem
    )

    $base64 = $Pem.
        Replace('-----BEGIN PRIVATE KEY-----', '').
        Replace('-----END PRIVATE KEY-----', '').
        Replace("`r", '').
        Replace("`n", '').
        Trim()

    return [Convert]::FromBase64String($base64)
}

function ConvertTo-Base64Url {
    param(
        [Parameter(Mandatory = $true)]
        [byte[]]$Bytes
    )

    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-GoogleSignedJwt {
    param(
        [Parameter(Mandatory = $true)]
        $ServiceAccount,
        [Parameter(Mandatory = $true)]
        [string]$Scope
    )

    $issuedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $expiresAt = $issuedAt + 3600

    $headerJson = '{"alg":"RS256","typ":"JWT"}'
    $claimSetJson = (
        [ordered]@{
            iss = [string]$ServiceAccount.client_email
            scope = $Scope
            aud = if ($ServiceAccount.token_uri) { [string]$ServiceAccount.token_uri } else { 'https://oauth2.googleapis.com/token' }
            exp = $expiresAt
            iat = $issuedAt
        } | ConvertTo-Json -Compress
    )

    $header = ConvertTo-Base64Url -Bytes ([System.Text.Encoding]::UTF8.GetBytes($headerJson))
    $claims = ConvertTo-Base64Url -Bytes ([System.Text.Encoding]::UTF8.GetBytes($claimSetJson))
    $unsignedJwt = "$header.$claims"

    $keyBytes = ConvertFrom-PemPrivateKey -Pem ([string]$ServiceAccount.private_key)
    $dataBytes = [System.Text.Encoding]::UTF8.GetBytes($unsignedJwt)
    $signatureBytes = $null

    $rsa = [System.Security.Cryptography.RSA]::Create()
    try {
        if ($rsa.PSObject.Methods.Name -contains 'ImportPkcs8PrivateKey') {
            $bytesRead = 0
            $rsa.ImportPkcs8PrivateKey($keyBytes, [ref]$bytesRead)
            $signatureBytes = $rsa.SignData(
                $dataBytes,
                [System.Security.Cryptography.HashAlgorithmName]::SHA256,
                [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
            )
        }
    } finally {
        $rsa.Dispose()
    }

    if (-not $signatureBytes) {
        $cngKey = [System.Security.Cryptography.CngKey]::Import($keyBytes, [System.Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)
        $rsaCng = [System.Security.Cryptography.RSACng]::new($cngKey)
        try {
            $signatureBytes = $rsaCng.SignData(
                $dataBytes,
                [System.Security.Cryptography.HashAlgorithmName]::SHA256,
                [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
            )
        } finally {
            $rsaCng.Dispose()
            $cngKey.Dispose()
        }
    }

    $signature = ConvertTo-Base64Url -Bytes $signatureBytes
    return "$unsignedJwt.$signature"
}

function Get-GoogleSheetsAccessToken {
    param(
        [string]$Scope = 'https://www.googleapis.com/auth/spreadsheets'
    )

    $serviceAccount = Get-GoogleServiceAccountConfig
    $jwt = New-GoogleSignedJwt -ServiceAccount $serviceAccount -Scope $Scope
    $tokenUri = if ($serviceAccount.token_uri) { [string]$serviceAccount.token_uri } else { 'https://oauth2.googleapis.com/token' }

    $response = Invoke-RestMethod -Uri $tokenUri -Method Post -ContentType 'application/x-www-form-urlencoded' -Body @{
        grant_type = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
        assertion = $jwt
    }

    if (-not $response.access_token) {
        throw 'Google OAuth token request succeeded but no access_token was returned.'
    }

    return [string]$response.access_token
}

function Invoke-GoogleSheetsRequest {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('GET', 'POST', 'PUT')]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Url,
        $Body = $null
    )

    $accessToken = Get-GoogleSheetsAccessToken
    $headers = @{
        Authorization = "Bearer $accessToken"
    }

    $maxAttempts = 5
    $serializer = $null
    $jsonBody = $null
    if ($null -ne $Body) {
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $serializer.MaxJsonLength = 67108864
        $jsonBody = $serializer.Serialize($Body)
    }

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            if ($null -eq $Body) {
                return Invoke-RestMethod -Uri $Url -Method $Method -Headers $headers -ContentType 'application/json'
            }
            return Invoke-RestMethod -Uri $Url -Method $Method -Headers $headers -ContentType 'application/json' -Body $jsonBody
        } catch {
            $statusCode = 0
            $errorBody = ''
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                try {
                    $errorBody = $reader.ReadToEnd()
                } finally {
                    $reader.Dispose()
                }
            } else {
                $errorBody = [string]$_.Exception.Message
            }

            $isTransient = ($statusCode -eq 429 -or $statusCode -ge 500 -or $statusCode -eq 0)
            if ($isTransient -and $attempt -lt $maxAttempts) {
                $delaySeconds = [Math]::Min(30, [Math]::Pow(2, $attempt))
                Start-Sleep -Seconds $delaySeconds
                continue
            }

            throw "Google Sheets API request failed for $Method $Url : $errorBody"
        }
    }
}

function Get-GoogleSpreadsheetMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId
    )

    $url = "https://sheets.googleapis.com/v4/spreadsheets/$([uri]::EscapeDataString($SpreadsheetId))?fields=spreadsheetId,properties.title,sheets.properties"
    return Invoke-GoogleSheetsRequest -Method GET -Url $url
}

function Invoke-GoogleSheetsBatchUpdate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId,
        [Parameter(Mandatory = $true)]
        [object[]]$Requests
    )

    $url = "https://sheets.googleapis.com/v4/spreadsheets/$([uri]::EscapeDataString($SpreadsheetId)):batchUpdate"
    return Invoke-GoogleSheetsRequest -Method POST -Url $url -Body @{ requests = @($Requests) }
}

function Ensure-GoogleSheetExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId,
        [Parameter(Mandatory = $true)]
        [string]$SheetName
    )

    $metadata = Get-GoogleSpreadsheetMetadata -SpreadsheetId $SpreadsheetId
    $existing = @($metadata.sheets | Where-Object { $_.properties.title -eq $SheetName } | Select-Object -First 1)
    if ($existing) {
        return $existing.properties
    }

    $result = Invoke-GoogleSheetsBatchUpdate -SpreadsheetId $SpreadsheetId -Requests @(
        @{
            addSheet = @{
                properties = @{
                    title = $SheetName
                }
            }
        }
    )

    return $result.replies[0].addSheet.properties
}

function Get-GoogleSheetValues {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId,
        [Parameter(Mandatory = $true)]
        [string]$Range
    )

    $escapedRange = [uri]::EscapeDataString($Range)
    $url = "https://sheets.googleapis.com/v4/spreadsheets/$([uri]::EscapeDataString($SpreadsheetId))/values/$escapedRange"
    $response = Invoke-GoogleSheetsRequest -Method GET -Url $url
    if ($null -eq $response -or -not ($response.PSObject.Properties.Name -contains 'values')) {
        return @()
    }
    return @($response.values)
}

function Clear-GoogleSheetValues {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId,
        [Parameter(Mandatory = $true)]
        [string]$Range
    )

    $escapedRange = [uri]::EscapeDataString($Range)
    $url = "https://sheets.googleapis.com/v4/spreadsheets/$([uri]::EscapeDataString($SpreadsheetId))/values/$escapedRange`:clear"
    return Invoke-GoogleSheetsRequest -Method POST -Url $url -Body @{}
}

function Set-GoogleSheetValues {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId,
        [Parameter(Mandatory = $true)]
        [string]$Range,
        [Parameter(Mandatory = $true)]
        [object[]]$Values
    )

    $escapedRange = [uri]::EscapeDataString($Range)
    $url = "https://sheets.googleapis.com/v4/spreadsheets/$([uri]::EscapeDataString($SpreadsheetId))/values/${escapedRange}?valueInputOption=USER_ENTERED"
    $body = @{
        range = $Range
        majorDimension = 'ROWS'
        values = @($Values)
    }
    return Invoke-GoogleSheetsRequest -Method PUT -Url $url -Body $body
}

function Test-GoogleSheetsAccess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId
    )

    $metadata = Get-GoogleSpreadsheetMetadata -SpreadsheetId $SpreadsheetId
    return [ordered]@{
        ok = $true
        spreadsheetId = [string]$metadata.spreadsheetId
        title = [string]$metadata.properties.title
        sheetNames = @($metadata.sheets | ForEach-Object { [string]$_.properties.title })
        serviceAccountEmail = [string](Get-GoogleServiceAccountConfig).client_email
    }
}

Export-ModuleMember -Function *-*
