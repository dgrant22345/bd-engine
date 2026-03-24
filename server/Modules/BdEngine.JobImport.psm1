Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'BdEngine.State.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BdEngine.Domain.psm1') -DisableNameChecking

# --- Diagnostics logging ---
# Set $env:BD_ENGINE_DIAGNOSTICS = '1' to enable verbose pipeline tracing
$script:DiagnosticsEnabled = [bool]($env:BD_ENGINE_DIAGNOSTICS -eq '1')
$script:DiagnosticsLog = New-Object System.Collections.ArrayList

function Write-PipelineDiag {
    param(
        [string]$Stage,
        [string]$Company = '',
        [string]$Message,
        [hashtable]$Data = @{}
    )
    $entry = [ordered]@{
        timestamp = (Get-Date).ToString('o')
        stage     = $Stage
        company   = $Company
        message   = $Message
    }
    foreach ($key in $Data.Keys) { $entry[$key] = $Data[$key] }
    [void]$script:DiagnosticsLog.Add($entry)
    if ($script:DiagnosticsEnabled) {
        $dataStr = if ($Data.Count -gt 0) { " | $($Data | ConvertTo-Json -Compress -Depth 3)" } else { '' }
        Write-Host "[DIAG][$Stage] $Company - $Message$dataStr" -ForegroundColor DarkCyan
    }
}

function Get-PipelineDiagnostics {
    return @($script:DiagnosticsLog.ToArray())
}

function Clear-PipelineDiagnostics {
    $script:DiagnosticsLog.Clear()
}

$script:GtaCities = @(
    'toronto','mississauga','brampton','markham','vaughan',
    'richmond hill','oakville','burlington','pickering','ajax',
    'whitby','oshawa','scarborough','etobicoke','north york',
    'east york','york','newmarket','aurora','king city',
    'caledon','halton','milton','georgetown','stouffville',
    'thornhill','woodbridge','bolton','maple','concord',
    'unionville','gta','greater toronto'
)

$script:CanadaKeywords = @(
    'canada',
    'toronto','vancouver','montreal','calgary','ottawa',
    'edmonton','mississauga','markham','waterloo','kitchener',
    'burnaby','winnipeg','halifax','brampton','vaughan',
    'richmond hill','oakville','burlington','pickering','ajax',
    'whitby','oshawa','scarborough','etobicoke','north york',
    'newmarket','aurora','caledon','milton','stouffville',
    'thornhill','woodbridge','london, on','hamilton','guelph',
    'barrie','kingston','victoria','surrey','richmond, bc',
    'quebec city','saskatoon','regina','st. john',
    'ontario','british columbia','alberta','quebec',
    'manitoba','saskatchewan','nova scotia','new brunswick',
    'newfoundland','prince edward island',
    ', on',', bc',', ab',', qc',', mb',', sk',', ns',
    ', nb',', nl',', pe',', nt',', nu',', yt'
)

function Test-CanadaLocation {
    param([string]$Location)

    $value = ([string]$Location).ToLowerInvariant().Trim()
    if (-not $value) {
        return $false
    }

    foreach ($keyword in $script:CanadaKeywords) {
        if ($value.Contains($keyword)) {
            return $true
        }
    }

    return $false
}

function Test-GtaLocation {
    param([string]$Location)

    $value = ([string]$Location).ToLowerInvariant().Trim()
    if (-not $value) {
        return $false
    }

    foreach ($keyword in $script:GtaCities) {
        if ($value.Contains($keyword)) {
            return $true
        }
    }

    return $false
}

function Get-JsonFromUrl {
    param([string]$Url)

    return Invoke-RestMethod -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 45
}

function Get-NestedValue {
    param(
        $Object,
        [string[]]$Paths
    )

    foreach ($path in @($Paths)) {
        if (-not $path) {
            continue
        }

        $current = $Object
        $found = $true
        foreach ($segment in ($path -split '\.')) {
            if ($null -eq $current) {
                $found = $false
                break
            }

            if ($current -is [System.Collections.IDictionary]) {
                if (-not (Test-ObjectHasKey -Object $current -Name $segment)) {
                    $found = $false
                    break
                }

                $current = $current[$segment]
                continue
            }

            $property = $current.PSObject.Properties[$segment]
            if (-not $property) {
                $found = $false
                break
            }

            $current = $property.Value
        }

        if ($found -and $null -ne $current -and [string]$current -ne '') {
            return $current
        }
    }

    return $null
}

function Get-TopLevelCollection {
    param(
        $Payload,
        [string[]]$PropertyNames = @()
    )

    foreach ($propertyName in @($PropertyNames)) {
        if (-not $propertyName) {
            continue
        }

        $value = Get-ObjectValue -Object $Payload -Name $propertyName -Default $null
        if ($null -eq $value) {
            continue
        }

        $items = @($value)
        if ($items.Count -gt 0) {
            return $items
        }
    }

    if ($Payload -is [System.Collections.IEnumerable] -and $Payload -isnot [string]) {
        return @($Payload)
    }

    if ($null -eq $Payload) {
        return @()
    }

    return @($Payload)
}

function Get-ConfiguredApiUrl {
    param($Config)

    if ($Config.source -and ([string]$Config.source).StartsWith('http')) {
        return [string]$Config.source
    }

    return ''
}

function Get-AshbyBoardIdFromCareersPage {
    param([string]$CareersUrl)

    if (-not $CareersUrl) {
        return $null
    }

    $response = Invoke-WebRequest -Uri $CareersUrl -UseBasicParsing -TimeoutSec 45
    $match = [regex]::Match($response.Content, 'jobs\.ashbyhq\.com\/([^\/"''\?\s]+)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) {
        return $null
    }

    return $match.Groups[1].Value
}

function Get-DomainFromUrl {
    param([string]$Url)

    if (-not $Url) {
        return ''
    }

    $uri = $null
    if (-not [Uri]::TryCreate([string]$Url, [UriKind]::Absolute, [ref]$uri)) {
        $candidate = [string]$Url
        if (-not $candidate.StartsWith('http://') -and -not $candidate.StartsWith('https://')) {
            [void][Uri]::TryCreate("https://$candidate", [UriKind]::Absolute, [ref]$uri)
        }
    }

    if (-not $uri) {
        return ''
    }

    $host = $uri.Host.ToLowerInvariant()
    if ($host.StartsWith('www.')) {
        $host = $host.Substring(4)
    }

    return $host
}

function Get-CompanySlugCandidates {
    param([string]$CompanyName)

    $name = ([string]$CompanyName).Trim()
    if (-not $name) {
        return @()
    }

    $candidates = New-Object System.Collections.ArrayList
    $raw = $name.ToLowerInvariant()
    $raw = $raw -replace '&', ' and '
    $raw = $raw -replace '\(.*?\)', ' '
    $raw = $raw -replace '\b(the|incorporated|inc|corp|corporation|company|co|limited|ltd|llc|llp|plc|group|holdings|technologies|technology|solutions|systems|services|financial group)\b', ' '
    $raw = $raw -replace '[^a-z0-9]+', ' '
    $tokens = @($raw.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries))

    if ($tokens.Count -gt 0) {
        [void]$candidates.Add(($tokens -join ''))
        if ($tokens.Count -ge 2) {
            [void]$candidates.Add(($tokens[0..1] -join ''))
        }
        [void]$candidates.Add($tokens[0])
    }

    $normalized = Normalize-TextKey $name
    if ($normalized) {
        [void]$candidates.Add(($normalized -replace ' ', ''))
    }

    return @($candidates | Where-Object { $_ } | Select-Object -Unique)
}

function Get-ResolverCandidateMethodPriority {
    param([string]$Method)

    switch ([string]$Method) {
        'known_map'          { return 120 }
        'careers_url'        { return 110 }
        'domain_root'        { return 100 }
        'linkedin_slug'      { return 95 }
        'normalized_company' { return 80 }
        'dashed_company'     { return 74 }
        'alias'              { return 62 }
        'company_root'       { return 28 }
        default              { return 50 }
    }
}

function Get-ResolverSlugSignal {
    param(
        [string]$Slug,
        [string]$Method,
        [string]$Domain = '',
        [string]$CareersUrl = '',
        [string]$LinkedinCompanySlug = ''
    )

    $candidate = ([string]$Slug).Trim().ToLowerInvariant()
    if (-not $candidate) {
        return [ordered]@{
            score = 0
            band = 'weak'
            reject = $true
            reason = 'empty'
        }
    }

    $resolvedDomain = Get-DomainFromUrl -Url $Domain
    $resolvedCareersDomain = Get-DomainFromUrl -Url $CareersUrl
    $hasStrongIdentity = [bool]($resolvedDomain -or $resolvedCareersDomain -or ([string]$LinkedinCompanySlug).Trim())
    $alphaCount = [regex]::Matches($candidate, '[a-z]').Count
    $digitCount = [regex]::Matches($candidate, '\d').Count
    $genericTokens = @('job', 'jobs', 'career', 'careers', 'apply', 'team', 'global', 'company', 'group', 'tech', 'inc', 'co', 'corp', 'us', 'ca', 'uk', 'hq')

    if ($candidate -match '^\d+$') {
        return [ordered]@{
            score = 0
            band = 'weak'
            reject = $true
            reason = 'numeric_only'
        }
    }

    if ($candidate.Length -le 1 -or $alphaCount -lt 1) {
        return [ordered]@{
            score = 0
            band = 'weak'
            reject = $true
            reason = 'too_short'
        }
    }

    if ($candidate -in $genericTokens) {
        return [ordered]@{
            score = 0
            band = 'weak'
            reject = $true
            reason = 'generic_token'
        }
    }

    $score = 44
    $score += [Math]::Min(28, $candidate.Length * 4)
    $score += [Math]::Min(22, (Get-ResolverCandidateMethodPriority -Method $Method) / 4)

    if ($digitCount -gt 0) {
        $score -= [Math]::Min(18, $digitCount * 4)
    }
    if ($candidate.Length -le 2) {
        $score -= 28
    } elseif ($candidate.Length -eq 3) {
        $score -= 12
    }
    if ($Method -eq 'alias' -and $candidate.Length -lt 4) {
        $score -= 10
    }
    if ($Method -eq 'company_root' -and $candidate.Length -lt 5) {
        $score -= 16
    }
    if ($candidate -match '^\d' -and -not $hasStrongIdentity) {
        $score -= 10
    }

    if (-not $hasStrongIdentity -and $candidate.Length -lt 3) {
        return [ordered]@{
            score = 0
            band = 'weak'
            reject = $true
            reason = 'short_untrusted'
        }
    }

    if ($score -lt 0) {
        $score = 0
    }

    $band = if ($score -ge 86) {
        'strong'
    } elseif ($score -ge 66) {
        'medium'
    } else {
        'weak'
    }

    return [ordered]@{
        score = [int][Math]::Round($score)
        band = $band
        reject = $false
        reason = if ($band -eq 'strong') { 'high_signal' } elseif ($band -eq 'medium') { 'balanced_signal' } else { 'weak_signal' }
    }
}

function Test-ResolverConfigIdentityTrusted {
    param($Config)

    if (-not $Config) {
        return $false
    }

    $discoveryMethod = [string](Get-ObjectValue -Object $Config -Name 'discoveryMethod' -Default '')
    $discoveryStatus = [string](Get-ObjectValue -Object $Config -Name 'discoveryStatus' -Default '')
    $reviewStatus = [string](Get-ObjectValue -Object $Config -Name 'reviewStatus' -Default '')
    $confidenceBand = [string](Get-ObjectValue -Object $Config -Name 'confidenceBand' -Default '')
    $domain = [string](Get-ObjectValue -Object $Config -Name 'domain' -Default '')
    $careersUrl = [string](Get-ObjectValue -Object $Config -Name 'careersUrl' -Default '')
    $resolvedBoardUrl = [string](Get-ObjectValue -Object $Config -Name 'resolvedBoardUrl' -Default '')
    $usesHostedIdentity = [bool](
        (Test-HostedAtsDomain -Domain $domain) -or
        (Test-HostedAtsDomain -Domain $careersUrl) -or
        (Test-HostedAtsDomain -Domain $resolvedBoardUrl)
    )

    if ($reviewStatus -in @('approved', 'manual', 'promoted')) {
        return $true
    }
    if ($discoveryStatus -eq 'mapped') {
        return $true
    }
    if ($discoveryMethod -in @('known_map', 'repair_seed', 'manual_override', 'company_site', 'domain_root', 'careers_url', 'linkedin_slug')) {
        return $true
    }
    if ($confidenceBand -eq 'high' -and -not $usesHostedIdentity) {
        return $true
    }

    return $false
}

function Get-ResolverIdentityInputs {
    param(
        [Parameter(Mandatory = $true)]
        $Company,
        $Config
    )

    $companyDomain = [string]$(if (Get-ObjectValue -Object $Company -Name 'canonicalDomain') { Get-ObjectValue -Object $Company -Name 'canonicalDomain' } elseif (Get-ObjectValue -Object $Company -Name 'domain') { Get-ObjectValue -Object $Company -Name 'domain' } else { '' })
    $companyCareersUrl = [string](Get-ObjectValue -Object $Company -Name 'careersUrl' -Default '')
    $configTrusted = Test-ResolverConfigIdentityTrusted -Config $Config
    $configDomain = if ($configTrusted) { [string](Get-ObjectValue -Object $Config -Name 'domain' -Default '') } else { '' }
    $configCareersUrl = if ($configTrusted) { [string](Get-ObjectValue -Object $Config -Name 'careersUrl' -Default '') } else { '' }

    return [ordered]@{
        domain = if ($companyDomain) { $companyDomain } else { $configDomain }
        careersUrl = if ($companyCareersUrl) { $companyCareersUrl } else { $configCareersUrl }
        identitySource = if ($companyDomain -or $companyCareersUrl) { 'company' } elseif ($configTrusted -and ($configDomain -or $configCareersUrl)) { 'trusted_config' } else { 'none' }
        trustedConfig = [bool]$configTrusted
    }
}

function Get-BoardConfigTemplateMap {
    $existingMap = Get-Variable -Scope Script -Name BoardConfigTemplateMap -ErrorAction SilentlyContinue
    if ($existingMap -and $existingMap.Value) {
        return $existingMap.Value
    }

    $script:BoardConfigTemplateMap = @{
        'shopify' = @{ atsType = 'other'; boardId = ''; domain = 'shopify.com'; careersUrl = 'https://www.shopify.com/careers'; source = 'repair_seed'; notes = 'Seeded from repaired workbook: careers site appears custom and previous Greenhouse slug returned 404'; discoveryStatus = 'known_unsupported'; discoveryMethod = 'repair_seed'; active = $false }
        'stripe' = @{ atsType = 'greenhouse'; boardId = 'stripe'; domain = 'stripe.com'; careersUrl = 'https://stripe.com/jobs'; source = 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'datadog' = @{ atsType = 'greenhouse'; boardId = 'datadog'; domain = 'datadoghq.com'; careersUrl = 'https://careers.datadoghq.com'; source = 'https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'snowflake' = @{ atsType = 'other'; boardId = ''; domain = 'careers.snowflake.com'; careersUrl = 'https://careers.snowflake.com'; source = 'repair_seed'; notes = 'Seeded from repaired workbook: careers site appears custom and public Greenhouse board was not confirmed'; discoveryStatus = 'known_unsupported'; discoveryMethod = 'repair_seed'; active = $false }
        'coinbase' = @{ atsType = 'greenhouse'; boardId = 'coinbase'; domain = 'coinbase.com'; careersUrl = 'https://www.coinbase.com/careers'; source = 'https://boards-api.greenhouse.io/v1/boards/coinbase/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'openai' = @{ atsType = 'ashby'; boardId = 'openai'; domain = 'openai.com'; careersUrl = 'https://openai.com/careers'; source = 'https://api.ashbyhq.com/posting-api/job-board/openai'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'notion' = @{ atsType = 'ashby'; boardId = 'notion'; domain = 'notion.so'; careersUrl = 'https://www.notion.so/careers'; source = 'https://api.ashbyhq.com/posting-api/job-board/notion'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'discord' = @{ atsType = 'greenhouse'; boardId = 'discord'; domain = 'discord.com'; careersUrl = 'https://discord.com/jobs'; source = 'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true'; notes = 'Seeded from repaired workbook'; discoveryStatus = 'verified'; discoveryMethod = 'repair_seed'; active = $true }
        'airtable' = @{ atsType = 'greenhouse'; boardId = 'airtable'; domain = 'airtable.com'; careersUrl = 'https://www.airtable.com/careers'; source = 'https://boards-api.greenhouse.io/v1/boards/airtable/jobs?content=true'; notes = 'Seeded from repaired workbook'; discoveryStatus = 'verified'; discoveryMethod = 'repair_seed'; active = $true }
        'scaleai' = @{ atsType = 'greenhouse'; boardId = 'scaleai'; domain = 'scale.com'; careersUrl = 'https://scale.com/careers'; source = 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true'; notes = 'Seeded from repaired workbook'; discoveryStatus = 'verified'; discoveryMethod = 'repair_seed'; active = $true }
        'lightspeed' = @{ atsType = 'greenhouse'; boardId = 'lightspeedhq'; domain = 'careers.lightspeedhq.com'; careersUrl = 'https://careers.lightspeedhq.com'; source = 'https://boards-api.greenhouse.io/v1/boards/lightspeedhq/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'benchling' = @{ atsType = 'other'; boardId = ''; domain = 'benchling.com'; careersUrl = 'https://www.benchling.com/careers'; source = 'repair_seed'; notes = 'Seeded from repaired workbook: careers page found but no supported ATS board confirmed'; discoveryStatus = 'needs_review'; discoveryMethod = 'repair_seed'; active = $false }
        'plaid' = @{ atsType = 'lever'; boardId = 'plaid'; domain = 'plaid.com'; careersUrl = 'https://plaid.com/careers'; source = 'https://api.lever.co/v0/postings/plaid?mode=json'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'brex' = @{ atsType = 'greenhouse'; boardId = 'brex'; domain = 'brex.com'; careersUrl = 'https://www.brex.com/careers'; source = 'https://boards-api.greenhouse.io/v1/boards/brex/jobs?content=true'; notes = 'Seeded from repaired workbook'; discoveryStatus = 'verified'; discoveryMethod = 'repair_seed'; active = $true }
        'flexport' = @{ atsType = 'greenhouse'; boardId = 'flexport'; domain = 'flexport.com'; careersUrl = 'https://www.flexport.com/careers'; source = 'https://boards-api.greenhouse.io/v1/boards/flexport/jobs?content=true'; notes = 'Seeded from repaired workbook'; discoveryStatus = 'verified'; discoveryMethod = 'repair_seed'; active = $true }
        'figma' = @{ atsType = 'greenhouse'; boardId = 'figma'; domain = 'figma.com'; careersUrl = 'https://www.figma.com/careers'; source = 'https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=true'; notes = 'Seeded from repaired workbook'; discoveryStatus = 'verified'; discoveryMethod = 'repair_seed'; active = $true }
        'rippling' = @{ atsType = 'other'; boardId = ''; domain = 'rippling.com'; careersUrl = 'https://www.rippling.com/careers'; source = 'repair_seed'; notes = 'Seeded from repaired workbook: careers page found but a supported ATS board was not confirmed'; discoveryStatus = 'needs_review'; discoveryMethod = 'repair_seed'; active = $false }
        'asana' = @{ atsType = 'greenhouse'; boardId = 'asana'; domain = 'asana.com'; careersUrl = 'https://asana.com/jobs'; source = 'https://boards-api.greenhouse.io/v1/boards/asana/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'databricks' = @{ atsType = 'greenhouse'; boardId = 'databricks'; domain = 'databricks.com'; careersUrl = 'https://www.databricks.com/company/careers'; source = 'https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'robinhood' = @{ atsType = 'greenhouse'; boardId = 'robinhood'; domain = 'careers.robinhood.com'; careersUrl = 'https://careers.robinhood.com'; source = 'https://boards-api.greenhouse.io/v1/boards/robinhood/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'samsara' = @{ atsType = 'greenhouse'; boardId = 'samsara'; domain = 'samsara.com'; careersUrl = 'https://www.samsara.com/company/careers'; source = 'https://boards-api.greenhouse.io/v1/boards/samsara/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'doordash' = @{ atsType = 'greenhouse'; boardId = 'doordashusa'; domain = 'careersatdoordash.com'; careersUrl = 'https://careersatdoordash.com'; source = 'https://boards-api.greenhouse.io/v1/boards/doordashusa/jobs?content=true'; notes = 'Seeded from repaired workbook'; discoveryStatus = 'verified'; discoveryMethod = 'repair_seed'; active = $true }
        'instacart' = @{ atsType = 'greenhouse'; boardId = 'instacart'; domain = 'instacart.careers'; careersUrl = 'https://instacart.careers'; source = 'https://boards-api.greenhouse.io/v1/boards/instacart/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'canva' = @{ atsType = 'other'; boardId = ''; domain = 'canva.com'; careersUrl = 'https://www.canva.com/careers'; source = 'repair_seed'; notes = 'Seeded from repaired workbook: supported ATS board was not confirmed from public careers pages'; discoveryStatus = 'needs_review'; discoveryMethod = 'repair_seed'; active = $false }
        'atlassian' = @{ atsType = 'other'; boardId = ''; domain = 'atlassian.com'; careersUrl = 'https://www.atlassian.com/company/careers'; source = 'repair_seed'; notes = 'Seeded from repaired workbook: careers site appears custom'; discoveryStatus = 'known_unsupported'; discoveryMethod = 'repair_seed'; active = $false }
        'gusto' = @{ atsType = 'greenhouse'; boardId = 'gusto'; domain = 'gusto.com'; careersUrl = 'https://gusto.com/careers'; source = 'https://boards-api.greenhouse.io/v1/boards/gusto/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'segment' = @{ atsType = 'other'; boardId = ''; domain = 'segment.com'; careersUrl = 'https://segment.com/careers'; source = 'repair_seed'; notes = 'Seeded from repaired workbook: standalone supported ATS board was not confirmed'; discoveryStatus = 'needs_review'; discoveryMethod = 'repair_seed'; active = $false }
        'twilio' = @{ atsType = 'greenhouse'; boardId = 'twilio'; domain = 'twilio.com'; careersUrl = 'https://www.twilio.com/company/jobs'; source = 'https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
        'square' = @{ atsType = 'other'; boardId = ''; domain = 'block.xyz'; careersUrl = 'https://block.xyz/careers'; source = 'repair_seed'; notes = 'Seeded from repaired workbook: roles appear under Block careers and no standalone supported ATS board was confirmed'; discoveryStatus = 'known_unsupported'; discoveryMethod = 'repair_seed'; active = $false }
        'dropbox' = @{ atsType = 'greenhouse'; boardId = 'dropbox'; domain = 'dropbox.com'; careersUrl = 'https://jobs.dropbox.com'; source = 'https://boards-api.greenhouse.io/v1/boards/dropbox/jobs?content=true'; notes = 'Filled from known ATS map'; discoveryStatus = 'verified'; discoveryMethod = 'known_map'; active = $true }
    }

    $resolverOverrides = Get-ResolverKnownMappingOverrides
    foreach ($key in @($resolverOverrides.Keys)) {
        $script:BoardConfigTemplateMap[[string]$key] = $resolverOverrides[[string]$key]
    }

    return $script:BoardConfigTemplateMap
}

function Get-ResolverKnownMappingPath {
    return (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'data\resolver-known-mappings.json')
}

function Get-ResolverKnownMappingOverrides {
    $existing = Get-Variable -Scope Script -Name ResolverKnownMappingOverrides -ErrorAction SilentlyContinue
    if ($existing -and $existing.Value) {
        return $existing.Value
    }

    $path = Get-ResolverKnownMappingPath
    if (-not (Test-Path -LiteralPath $path)) {
        $script:ResolverKnownMappingOverrides = @{}
        return $script:ResolverKnownMappingOverrides
    }

    try {
        $raw = Get-Content -LiteralPath $path -Raw -ErrorAction Stop
        $parsed = if ([string]::IsNullOrWhiteSpace($raw)) { @{} } else { $raw | ConvertFrom-Json -Depth 20 }
        $overrides = @{}
        foreach ($property in @($parsed.PSObject.Properties)) {
            $pso = $property.Value
            $hash = [ordered]@{}
            foreach ($p in @($pso.PSObject.Properties)) {
                $hash[[string]$p.Name] = $p.Value
            }
            $overrides[[string]$property.Name] = $hash
        }
        $script:ResolverKnownMappingOverrides = $overrides
    } catch {
        $script:ResolverKnownMappingOverrides = @{}
    }

    return $script:ResolverKnownMappingOverrides
}

function Save-ResolverKnownMappingOverride {
    param(
        [Parameter(Mandatory = $true)]
        $Config
    )

    $companyKey = Get-CanonicalCompanyKey $(if ($Config.normalizedCompanyName) { $Config.normalizedCompanyName } else { $Config.companyName })
    if (-not $companyKey) {
        throw 'Cannot promote a config without a canonical company key.'
    }

    $path = Get-ResolverKnownMappingPath
    $directory = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }

    $overrides = Get-ResolverKnownMappingOverrides
    $overrides[$companyKey] = [ordered]@{
        atsType = [string]$Config.atsType
        boardId = [string]$Config.boardId
        domain = [string]$Config.domain
        careersUrl = [string]$Config.careersUrl
        resolvedBoardUrl = [string]$(if ($Config.resolvedBoardUrl) { $Config.resolvedBoardUrl } else { Get-ResolvedBoardUrl -AtsType ([string]$Config.atsType) -BoardId ([string]$Config.boardId) -FallbackUrl ([string]$Config.careersUrl) })
        source = [string]$(if ($Config.source) { $Config.source } else { 'known_override' })
        notes = [string]$(if ($Config.notes) { $Config.notes } else { 'Promoted from resolver review' })
        discoveryStatus = 'mapped'
        discoveryMethod = 'known_override'
        confidenceScore = 100
        confidenceBand = 'high'
        supportedImport = [bool](Test-ImportCapableAtsType -AtsType ([string]$Config.atsType))
        active = [bool]$(if ($Config.PSObject.Properties.Name -contains 'active' -and $Config.active -ne $null) { $Config.active } else { Test-ImportCapableAtsType -AtsType ([string]$Config.atsType) })
    }

    ($overrides | ConvertTo-Json -Depth 20) | Set-Content -LiteralPath $path
    $script:ResolverKnownMappingOverrides = $overrides
    $script:BoardConfigTemplateMap = $null
    return $overrides[$companyKey]
}

function Test-ImportCapableAtsType {
    param([string]$AtsType)

    return ([string]$AtsType).ToLowerInvariant() -in @(
        'greenhouse',
        'lever',
        'ashby',
        'smartrecruiters',
        'workday',
        'jobvite'
    )
}

function Get-ResolverConfidenceBand {
    param([double]$Score)

    if ($Score -ge 85) { return 'high' }
    if ($Score -ge 65) { return 'medium' }
    if ($Score -gt 0) { return 'low' }
    return 'unresolved'
}

function Get-ResolvedBoardUrl {
    param(
        [string]$AtsType,
        [string]$BoardId,
        [string]$FallbackUrl = ''
    )

    $ats = ([string]$AtsType).ToLowerInvariant()
    $board = ([string]$BoardId).Trim()

    switch ($ats) {
        'greenhouse' { if ($board) { return "https://job-boards.greenhouse.io/$board" } }
        'lever' { if ($board) { return "https://jobs.lever.co/$board" } }
        'ashby' { if ($board) { return "https://jobs.ashbyhq.com/$board" } }
        'smartrecruiters' { if ($board) { return "https://careers.smartrecruiters.com/$board" } }
        'workday' { if ($FallbackUrl) { return [string]$FallbackUrl } }
        'jobvite' { if ($board) { return "https://jobs.jobvite.com/$board" } }
        'bamboohr' { if ($board) { return "https://$board.bamboohr.com/careers" } }
        'icims' { if ($FallbackUrl) { return [string]$FallbackUrl } }
        'taleo' { if ($FallbackUrl) { return [string]$FallbackUrl } }
        'successfactors' { if ($FallbackUrl) { return [string]$FallbackUrl } }
    }

    return [string]$FallbackUrl
}

function Resolve-AtsFromUrlValue {
    param(
        [string]$Url,
        [string]$Method = 'url_pattern'
    )

    $rawUrl = ([string]$Url).Trim()
    if (-not $rawUrl) {
        return $null
    }

    $domain = Get-DomainFromUrl -Url $rawUrl
    $lower = $rawUrl.ToLowerInvariant()
    $candidate = [ordered]@{
        atsType = ''
        boardId = ''
        domain = $domain
        careersUrl = $rawUrl
        resolvedBoardUrl = ''
        source = ''
        discoveryStatus = 'discovered'
        discoveryMethod = $Method
        supportedImport = $false
        confidenceScore = 0
        confidenceBand = 'unresolved'
        evidenceSummary = ''
        matchedSignatures = @()
        redirectTarget = ''
    }

    if ($lower -match '(boards-api|job-boards)\.greenhouse\.io/(v1/boards/)?([a-z0-9-]+)' -or $lower -match 'greenhouse\.io/([a-z0-9-]+)(/jobs)?') {
        $candidate.atsType = 'greenhouse'
        $candidate.boardId = [string]$matches[$matches.Count - 1]
        $candidate.supportedImport = $true
        $candidate.source = if ($candidate.boardId) { "https://boards-api.greenhouse.io/v1/boards/$($candidate.boardId)/jobs?content=true" } else { '' }
        $candidate.confidenceScore = if ($candidate.boardId) { 92 } else { 74 }
        $candidate.matchedSignatures = @('greenhouse')
    } elseif ($lower -match '(jobs|careers)\.lever\.co/([a-z0-9-]+)' -or $lower -match 'api\.lever\.co/v0/postings/([a-z0-9-]+)') {
        $candidate.atsType = 'lever'
        $candidate.boardId = [string]$matches[$matches.Count - 1]
        $candidate.supportedImport = $true
        $candidate.source = if ($candidate.boardId) { "https://api.lever.co/v0/postings/$($candidate.boardId)?mode=json" } else { '' }
        $candidate.confidenceScore = if ($candidate.boardId) { 92 } else { 72 }
        $candidate.matchedSignatures = @('lever')
    } elseif ($lower -match 'jobs\.ashbyhq\.com/([a-z0-9-]+)' -or $lower -match 'posting-api/job-board/([a-z0-9-]+)') {
        $candidate.atsType = 'ashby'
        $candidate.boardId = [string]$matches[$matches.Count - 1]
        $candidate.supportedImport = $true
        $candidate.source = if ($candidate.boardId) { "https://api.ashbyhq.com/posting-api/job-board/$($candidate.boardId)" } else { '' }
        $candidate.confidenceScore = if ($candidate.boardId) { 92 } else { 72 }
        $candidate.matchedSignatures = @('ashby')
    } elseif ($lower -match 'careers\.smartrecruiters\.com/([a-z0-9-]+)' -or $lower -match 'api\.smartrecruiters\.com/v1/companies/([a-z0-9-]+)' -or $lower -match 'smartrecruiters\.com/.*/company/([a-z0-9-]+)') {
        $candidate.atsType = 'smartrecruiters'
        $candidate.boardId = [string]$matches[$matches.Count - 1]
        $candidate.supportedImport = $true
        $candidate.source = if ($candidate.boardId) { "https://api.smartrecruiters.com/v1/companies/$($candidate.boardId)/postings?limit=100" } else { '' }
        $candidate.confidenceScore = if ($candidate.boardId) { 88 } else { 70 }
        $candidate.matchedSignatures = @('smartrecruiters')
    } elseif ($lower -match 'https?://([a-z0-9-]+)\.bamboohr\.com/(careers|jobs)') {
        $candidate.atsType = 'bamboohr'
        $candidate.boardId = [string]$matches[1]
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 82
        $candidate.matchedSignatures = @('bamboohr')
    } elseif ($lower -match 'jobs\.jobvite\.com/([a-z0-9-]+)' -or $lower -match 'jobvite\.com/api/job-list\?company=([a-z0-9-]+)') {
        $candidate.atsType = 'jobvite'
        $candidate.boardId = [string]$matches[$matches.Count - 1]
        $candidate.supportedImport = $true
        $candidate.source = if ($lower -match 'jobvite\.com/api/job-list') { $rawUrl } elseif ($candidate.boardId) { "https://jobs.jobvite.com/api/job-list?company=$($candidate.boardId)" } else { '' }
        $candidate.confidenceScore = if ($candidate.boardId) { 86 } else { 68 }
        $candidate.matchedSignatures = @('jobvite')
    } elseif ($lower -match '([a-z0-9-]+)\.myworkdayjobs\.com' -or $lower -match '/wday/cxs/[^/]+/[^/?#]+') {
        $candidate.atsType = 'workday'
        if ($lower -match '/wday/cxs/([^/]+)/([^/?#]+)') {
            $candidate.boardId = ('{0}/{1}' -f $matches[1], $matches[2])
            $candidate.supportedImport = $true
            $candidate.source = if ($rawUrl -match '(https?://[^/]+/wday/cxs/[^/]+/[^/?#]+)') { "$($matches[1])/jobs" } else { '' }
            $candidate.confidenceScore = 88
        } elseif ($lower -match '([a-z0-9-]+)\.myworkdayjobs\.com') {
            $candidate.boardId = $matches[1]
            $candidate.confidenceScore = 82
        } else {
            $candidate.confidenceScore = 72
        }
        $candidate.matchedSignatures = @('workday')
    } elseif ($lower -match '([a-z0-9-]+)\.icims\.com' -or $lower -match 'icims\.jobs') {
        $candidate.atsType = 'icims'
        $candidate.boardId = if ($matches[1]) { $matches[1] } else { $domain }
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 76
        $candidate.matchedSignatures = @('icims')
    } elseif ($lower -match 'taleo\.net' -or $lower -match 'oraclecloud\.com/.+candidateexperience') {
        $candidate.atsType = 'taleo'
        $candidate.boardId = $domain
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 76
        $candidate.matchedSignatures = @('taleo')
    } elseif ($lower -match 'successfactors\.com' -or $lower -match 'jobs\.sap\.com|career[s]?\.?successfactors') {
        $candidate.atsType = 'successfactors'
        $candidate.boardId = $domain
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 74
        $candidate.matchedSignatures = @('successfactors')
    } elseif ($lower -match '([a-z0-9-]+)\.personio\.(de|com|es|fr|nl|at|ch|it)') {
        $candidate.atsType = 'personio'
        $candidate.boardId = [string]$matches[1]
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 82
        $candidate.matchedSignatures = @('personio')
    } elseif ($lower -match '([a-z0-9-]+)\.recruitee\.com') {
        $candidate.atsType = 'recruitee'
        $candidate.boardId = [string]$matches[1]
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 82
        $candidate.matchedSignatures = @('recruitee')
    } elseif ($lower -match '(career\.)?([a-z0-9-]+)\.teamtailor\.com') {
        $candidate.atsType = 'teamtailor'
        $candidate.boardId = [string]$matches[2]
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 82
        $candidate.matchedSignatures = @('teamtailor')
    } elseif ($lower -match 'comeet\.com/jobs/([a-z0-9-]+)' -or $lower -match 'comeet\.co/jobs/([a-z0-9-]+)') {
        $candidate.atsType = 'comeet'
        $candidate.boardId = [string]$matches[1]
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 80
        $candidate.matchedSignatures = @('comeet')
    } elseif ($lower -match '([a-z0-9-]+)\.jazzhr\.com' -or $lower -match 'app\.jazz\.co') {
        $candidate.atsType = 'jazzhr'
        $candidate.boardId = if ($matches[1]) { [string]$matches[1] } else { $domain }
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 80
        $candidate.matchedSignatures = @('jazzhr')
    } elseif ($lower -match 'adp\.com/.*(jobs|careers|recruiting)' -or $lower -match 'workforcenow\.adp\.com') {
        $candidate.atsType = 'adp'
        $candidate.boardId = $domain
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 74
        $candidate.matchedSignatures = @('adp')
    } elseif ($lower -match 'rippling\.com/.*careers' -or $lower -match 'app\.rippling\.com/.*careers') {
        $candidate.atsType = 'rippling'
        $candidate.boardId = $domain
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 74
        $candidate.matchedSignatures = @('rippling')
    } elseif ($lower -match '(careers|jobs|join|people)\.([a-z0-9-]+)\.([a-z]+)' -or $lower -match '/(careers|jobs|join-us|company-careers|openings)') {
        $candidate.atsType = 'custom_enterprise'
        $candidate.boardId = $domain
        $candidate.supportedImport = $false
        $candidate.confidenceScore = 62
        $candidate.matchedSignatures = @('custom_careers_url')
    }

    if (-not $candidate.atsType) {
        return $null
    }

    $candidate.resolvedBoardUrl = Get-ResolvedBoardUrl -AtsType $candidate.atsType -BoardId $candidate.boardId -FallbackUrl $rawUrl
    $candidate.confidenceBand = Get-ResolverConfidenceBand -Score ([double]$candidate.confidenceScore)
    $candidate.evidenceSummary = ('ATS signature matched from {0}' -f $Method)
    return $candidate
}

# NOTE: New-ResolverAttemptRecord, Invoke-ResolverProbeRequest, Get-CareersPageCandidateUrls,
# and Find-AtsDetectionsInContent are defined below (after Invoke-CompanyEnrichment) as the
# canonical versions with full ATS detection, HTML meta scanning, and diagnostics support.

function Get-AtsInferenceFromCareersUrl {
    param([string]$CareersUrl)

    $url = ([string]$CareersUrl).Trim()
    if (-not $url) {
        return $null
    }

    $inferred = Resolve-AtsFromUrlValue -Url $url -Method 'careers_url'
    if (-not $inferred) {
        return [ordered]@{
            atsType = ''
            boardId = ''
            domain = Get-DomainFromUrl -Url $url
            careersUrl = $url
            resolvedBoardUrl = ''
            source = ''
            notes = 'Copied careers URL from account data'
            active = $false
            supportedImport = $false
            discoveryStatus = 'no_match_supported_ats'
            discoveryMethod = 'careers_url'
            confidenceScore = 0
            confidenceBand = 'unresolved'
            evidenceSummary = ''
            reviewStatus = 'pending'
            failureReason = 'No ATS signature matched from careers URL'
            redirectTarget = ''
            matchedSignatures = @()
        }
    }

    $inferred.notes = 'ATS inferred from careers URL'
    $inferred.active = [bool]($inferred.supportedImport -and $inferred.confidenceBand -eq 'high')
    $inferred.reviewStatus = if ($inferred.confidenceBand -eq 'high') { 'auto' } else { 'pending' }
    return $inferred
}

function New-GeneratedBoardConfig {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        $Company
    )

    $companyNormalizedName = Get-ObjectValue -Object $Company -Name 'normalizedName'
    $companyDisplayName = [string](Get-ObjectValue -Object $Company -Name 'displayName')
    $companyDomain = [string]$(if (Get-ObjectValue -Object $Company -Name 'canonicalDomain') { Get-ObjectValue -Object $Company -Name 'canonicalDomain' } else { Get-ObjectValue -Object $Company -Name 'domain' })
    $companyCareersUrl = [string](Get-ObjectValue -Object $Company -Name 'careersUrl')
    $normalizedName = Get-CanonicalCompanyKey $(if ($companyNormalizedName) { $companyNormalizedName } else { $companyDisplayName })
    if (-not $normalizedName) {
        return $null
    }

    $templateMap = Get-BoardConfigTemplateMap
    $companyName = Get-CanonicalCompanyDisplayName $companyDisplayName
    $template = $null
    foreach ($candidate in (Get-CompanySlugCandidates -CompanyName $companyName)) {
        if ($templateMap.ContainsKey($candidate)) {
            $template = $templateMap[$candidate]
            break
        }
    }

    if (-not $template) {
        $template = Get-AtsInferenceFromCareersUrl -CareersUrl $companyCareersUrl
    }

    if (-not $template) {
        $template = [ordered]@{
            atsType = ''
            boardId = ''
            domain = ''
            careersUrl = ''
            resolvedBoardUrl = ''
            source = ''
            notes = 'No ATS inferred automatically yet'
            discoveryStatus = if ($companyDomain -or $companyCareersUrl) { 'no_match_supported_ats' } else { 'missing_inputs' }
            discoveryMethod = 'account_seed'
            active = $false
            supportedImport = $false
            confidenceScore = 0
            confidenceBand = 'unresolved'
            evidenceSummary = ''
            reviewStatus = 'pending'
            lastResolutionAttemptAt = $null
            nextResolutionAttemptAt = $null
            failureReason = if ($companyDomain -or $companyCareersUrl) { 'No ATS inferred from seed data' } else { 'Missing company domain and careers URL' }
            redirectTarget = ''
            matchedSignatures = @()
            attemptedUrls = @()
            httpSummary = @()
        }
    }

    if (-not (Get-ObjectValue -Object $template -Name 'domain')) {
        $template.domain = if ($companyDomain) { $companyDomain } else { Get-DomainFromUrl -Url ([string](Get-ObjectValue -Object $template -Name 'careersUrl')) }
    }
    if (-not (Get-ObjectValue -Object $template -Name 'careersUrl')) {
        $template.careersUrl = $companyCareersUrl
    }
    if (-not (Get-ObjectValue -Object $template -Name 'resolvedBoardUrl')) {
        $template.resolvedBoardUrl = Get-ResolvedBoardUrl -AtsType ([string](Get-ObjectValue -Object $template -Name 'atsType')) -BoardId ([string](Get-ObjectValue -Object $template -Name 'boardId')) -FallbackUrl ([string](Get-ObjectValue -Object $template -Name 'careersUrl'))
    }

    $templateDiscoveryMethod = [string](Get-ObjectValue -Object $template -Name 'discoveryMethod')
    $templateDiscoveryStatus = [string](Get-ObjectValue -Object $template -Name 'discoveryStatus')
    if ($templateDiscoveryMethod -in @('known_map', 'repair_seed')) {
        $template.discoveryStatus = 'mapped'
        $template.confidenceScore = if (Test-ObjectHasKey -Object $template -Name 'confidenceScore' | Where-Object { $_ }) { Get-ObjectValue -Object $template -Name 'confidenceScore' } else { 100 }
        $template.confidenceBand = 'high'
        $template.supportedImport = [bool](Test-ImportCapableAtsType -AtsType ([string]$template.atsType))
        $template.active = [bool]($template.supportedImport -and $template.active)
        $template.reviewStatus = if ($template.reviewStatus) { $template.reviewStatus } else { 'auto' }
    } elseif ($templateDiscoveryStatus -eq 'verified') {
        $template.discoveryStatus = 'discovered'
    } elseif ($templateDiscoveryStatus -eq 'unresolved') {
        $template.discoveryStatus = 'missing_inputs'
    }

    $id = New-DeterministicId -Prefix 'cfgauto' -Seed $normalizedName
    return [ordered]@{
        id = $id
        workspaceId = $State.workspace.id
        accountId = $Company.id
        companyName = $companyName
        normalizedCompanyName = $normalizedName
        atsType = [string]$template.atsType
        boardId = [string]$template.boardId
        domain = [string]$template.domain
        careersUrl = [string]$template.careersUrl
        resolvedBoardUrl = [string]$(if ($template.resolvedBoardUrl) { $template.resolvedBoardUrl } else { '' })
        source = [string]$template.source
        notes = [string]$template.notes
        active = if ($null -ne $template.active) { [bool]$template.active } else { $true }
        supportedImport = [bool]$(if (Test-ObjectHasKey -Object $template -Name 'supportedImport') { Get-ObjectValue -Object $template -Name 'supportedImport' } else { Test-ImportCapableAtsType -AtsType ([string]$template.atsType) })
        lastCheckedAt = if ($template.discoveryStatus -in @('mapped', 'discovered')) { (Get-Date).ToString('o') } else { $null }
        lastResolutionAttemptAt = $null
        nextResolutionAttemptAt = $null
        discoveryStatus = [string]$template.discoveryStatus
        discoveryMethod = [string]$template.discoveryMethod
        confidenceScore = [double]$(if (Test-ObjectHasKey -Object $template -Name 'confidenceScore') { Get-ObjectValue -Object $template -Name 'confidenceScore' } else { 0 })
        confidenceBand = [string]$(if (Get-ObjectValue -Object $template -Name 'confidenceBand') { Get-ObjectValue -Object $template -Name 'confidenceBand' } else { Get-ResolverConfidenceBand -Score ([double]$(if (Test-ObjectHasKey -Object $template -Name 'confidenceScore') { Get-ObjectValue -Object $template -Name 'confidenceScore' } else { 0 })) })
        evidenceSummary = [string]$(if (Get-ObjectValue -Object $template -Name 'evidenceSummary') { Get-ObjectValue -Object $template -Name 'evidenceSummary' } else { '' })
        reviewStatus = [string]$(if (Get-ObjectValue -Object $template -Name 'reviewStatus') { Get-ObjectValue -Object $template -Name 'reviewStatus' } else { 'pending' })
        failureReason = [string]$(if (Get-ObjectValue -Object $template -Name 'failureReason') { Get-ObjectValue -Object $template -Name 'failureReason' } else { '' })
        redirectTarget = [string]$(if (Get-ObjectValue -Object $template -Name 'redirectTarget') { Get-ObjectValue -Object $template -Name 'redirectTarget' } else { '' })
        matchedSignatures = @($(if ($null -ne (Get-ObjectValue -Object $template -Name 'matchedSignatures')) { Get-ObjectValue -Object $template -Name 'matchedSignatures' } else { @() }))
        attemptedUrls = @($(if ($null -ne (Get-ObjectValue -Object $template -Name 'attemptedUrls')) { Get-ObjectValue -Object $template -Name 'attemptedUrls' } else { @() }))
        httpSummary = @($(if ($null -ne (Get-ObjectValue -Object $template -Name 'httpSummary')) { Get-ObjectValue -Object $template -Name 'httpSummary' } else { @() }))
        lastImportAt = $null
        lastImportStatus = ''
    }
}

function Merge-BoardConfigRecord {
    param(
        [Parameter(Mandatory = $true)]
        $Existing,
        [Parameter(Mandatory = $true)]
        $Generated
    )

    $existingMethod = ([string](Get-ObjectValue -Object $Existing -Name 'discoveryMethod' -Default '')).ToLowerInvariant()
    $existingReview = ([string](Get-ObjectValue -Object $Existing -Name 'reviewStatus' -Default '')).ToLowerInvariant()
    $existingConfidence = ([string](Get-ObjectValue -Object $Existing -Name 'confidenceBand' -Default '')).ToLowerInvariant()
    $existingResolved = -not [string]::IsNullOrWhiteSpace([string](Get-ObjectValue -Object $Existing -Name 'boardId' -Default '')) -or -not [string]::IsNullOrWhiteSpace([string](Get-ObjectValue -Object $Existing -Name 'resolvedBoardUrl' -Default ''))
    $isProtected = ([string](Get-ObjectValue -Object $Existing -Name 'source' -Default '')).ToLowerInvariant() -eq 'manual' -or $existingMethod -in @('manual', 'known_map', 'known_override') -or $existingReview -in @('approved', 'promoted', 'rejected') -or ($existingResolved -and $existingConfidence -eq 'high')
    $merged = [ordered]@{}
    foreach ($property in $Existing.Keys) {
        $merged[$property] = $Existing[$property]
    }

    foreach ($field in 'workspaceId', 'accountId', 'companyName', 'normalizedCompanyName') {
        $merged[$field] = $Generated[$field]
    }

    if ($isProtected) {
        # FIX: Use $null check instead of falsy check — otherwise 0, $false, '' overwrite good data
        foreach ($field in 'domain', 'careersUrl', 'lastCheckedAt', 'discoveryStatus', 'discoveryMethod', 'resolvedBoardUrl', 'confidenceScore', 'confidenceBand', 'evidenceSummary', 'reviewStatus', 'failureReason', 'redirectTarget', 'matchedSignatures', 'attemptedUrls', 'httpSummary', 'supportedImport', 'nextResolutionAttemptAt', 'lastResolutionAttemptAt') {
            if ($null -eq $merged[$field] -or ($merged[$field] -is [string] -and [string]::IsNullOrWhiteSpace([string]$merged[$field]))) {
                $merged[$field] = $Generated[$field]
            }
        }
        return $merged
    }

    foreach ($field in 'atsType', 'boardId', 'domain', 'careersUrl', 'resolvedBoardUrl', 'source', 'notes', 'active', 'supportedImport', 'lastCheckedAt', 'lastResolutionAttemptAt', 'nextResolutionAttemptAt', 'discoveryStatus', 'discoveryMethod', 'confidenceScore', 'confidenceBand', 'evidenceSummary', 'reviewStatus', 'failureReason', 'redirectTarget', 'matchedSignatures', 'attemptedUrls', 'httpSummary') {
        $merged[$field] = $Generated[$field]
    }

    if (-not $merged.Contains('lastImportAt')) {
        $merged['lastImportAt'] = $null
    }
    if (-not $merged.Contains('lastImportStatus')) {
        $merged['lastImportStatus'] = ''
    }

    return $merged
}

function Get-DomainRootCandidateSlugs {
    param(
        [string]$Domain,
        [string]$CareersUrl
    )

    $resolvedDomain = if ($Domain) { Get-DomainFromUrl -Url $Domain } else { '' }
    if (-not $resolvedDomain -and $CareersUrl) {
        $resolvedDomain = Get-DomainFromUrl -Url $CareersUrl
    }
    if (-not $resolvedDomain) {
        return @()
    }

    $parts = @($resolvedDomain.Split('.') | Where-Object { $_ })
    if ($parts.Count -eq 0) {
        return @()
    }

    $root = $parts[0]
    if ($root -in @('www', 'jobs', 'careers', 'boards', 'apply')) {
        if ($parts.Count -ge 2) {
            $root = $parts[1]
        }
    }

    $variants = New-Object System.Collections.ArrayList
    foreach ($candidate in @(
            $root,
            ($root -replace '-', ''),
            ($root -replace '[^a-z0-9]', '')
        )) {
        if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
            [void]$variants.Add(([string]$candidate).ToLowerInvariant())
        }
    }

    return @($variants | Select-Object -Unique)
}

function Get-DiscoveryCandidateSlugs {
    param(
        [string]$CompanyName,
        [string]$Domain = '',
        [string]$CareersUrl = '',
        [string[]]$Aliases = @(),
        [string]$LinkedinCompanySlug = ''
    )

    $candidates = New-Object System.Collections.ArrayList
    $seen = @{}

    function Add-Candidate {
        param(
            [System.Collections.ArrayList]$List,
            [hashtable]$Seen,
            [string]$Slug,
            [string]$Method
        )

        $value = ([string]$Slug).Trim().ToLowerInvariant()
        if (-not $value) {
            return
        }
        if ($Seen.ContainsKey($value)) {
            return
        }
        $signal = Get-ResolverSlugSignal -Slug $value -Method $Method -Domain $Domain -CareersUrl $CareersUrl -LinkedinCompanySlug $LinkedinCompanySlug
        if ([bool](Get-ObjectValue -Object $signal -Name 'reject' -Default $false)) {
            return
        }
        $Seen[$value] = $true
        [void]$List.Add([ordered]@{
            slug = $value
            method = $Method
            signalScore = [int](Convert-ToNumber (Get-ObjectValue -Object $signal -Name 'score' -Default 0))
            signalBand = [string](Get-ObjectValue -Object $signal -Name 'band' -Default 'weak')
            signalReason = [string](Get-ObjectValue -Object $signal -Name 'reason' -Default '')
        })
    }

    foreach ($alias in @($Aliases | Where-Object { $_ })) {
        foreach ($candidate in @(Get-CompanySlugCandidates -CompanyName ([string]$alias))) {
            Add-Candidate -List $candidates -Seen $seen -Slug $candidate -Method 'alias'
        }
    }

    foreach ($candidate in @(Get-CompanySlugCandidates -CompanyName $CompanyName)) {
        Add-Candidate -List $candidates -Seen $seen -Slug $candidate -Method 'normalized_company'
    }

    $tokens = @((Normalize-TextKey $CompanyName) -split ' ' | Where-Object { $_ })
    if ($tokens.Count -gt 0) {
        Add-Candidate -List $candidates -Seen $seen -Slug ($tokens -join '-') -Method 'dashed_company'
        Add-Candidate -List $candidates -Seen $seen -Slug $tokens[0] -Method 'company_root'
        if ($tokens.Count -ge 2) {
            Add-Candidate -List $candidates -Seen $seen -Slug ($tokens[0..1] -join '-') -Method 'dashed_company'
        }
    }

    foreach ($candidate in @(Get-DomainRootCandidateSlugs -Domain $Domain -CareersUrl $CareersUrl)) {
        Add-Candidate -List $candidates -Seen $seen -Slug $candidate -Method 'domain_root'
        Add-Candidate -List $candidates -Seen $seen -Slug ($candidate -replace '-', '') -Method 'domain_root'
    }

    if ($LinkedinCompanySlug) {
        Add-Candidate -List $candidates -Seen $seen -Slug $LinkedinCompanySlug -Method 'linkedin_slug'
    }

    return @(
        $candidates.ToArray() |
            Sort-Object @(
                @{ Expression = { [int](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'signalScore' -Default 0)) }; Descending = $true },
                @{ Expression = { Get-ResolverCandidateMethodPriority -Method ([string](Get-ObjectValue -Object $_ -Name 'method' -Default '')) }; Descending = $true },
                @{ Expression = { ([string](Get-ObjectValue -Object $_ -Name 'slug' -Default '')).Length }; Descending = $true },
                @{ Expression = { [string](Get-ObjectValue -Object $_ -Name 'slug' -Default '') }; Descending = $false }
            )
    )
}

function ConvertFrom-ResolverJsonContent {
    param([string]$Content)

    if ([string]::IsNullOrWhiteSpace($Content)) {
        return $null
    }

    try {
        return ($Content | ConvertFrom-Json -Depth 30)
    } catch {
        return $null
    }
}

function Get-ResolverScoreAdjustment {
    param([string]$Method)

    switch ([string]$Method) {
        'normalized_company' { return 2 }
        'domain_root' { return 4 }
        'careers_page' { return 6 }
        'careers_url' { return 8 }
        default { return 0 }
    }
}

function Get-ResolverNextAttemptAt {
    param(
        [string]$DiscoveryStatus,
        [string]$ConfidenceBand
    )

    switch ([string]$ConfidenceBand) {
        'high' { return (Get-Date).AddDays(30).ToString('o') }
        'medium' { return (Get-Date).AddDays(7).ToString('o') }
        'low' { return (Get-Date).AddDays(5).ToString('o') }
        default {
            switch ([string]$DiscoveryStatus) {
                'missing_inputs' { return (Get-Date).AddDays(21).ToString('o') }
                'error' { return (Get-Date).AddHours(12).ToString('o') }
                default { return (Get-Date).AddDays(10).ToString('o') }
            }
        }
    }
}

function Get-EnrichmentNextAttemptAt {
    param(
        [string]$Status,
        [string]$ConfidenceBand
    )

    # Keep high/verified results cached for 30 days — no point re-checking known-good data
    # Aggressively retry everything else so the full 12k dataset processes in days, not months
    switch ([string]$ConfidenceBand) {
        'high'   { return (Get-Date).AddDays(30).ToString('o') }
        'medium' { return (Get-Date).AddDays(3).ToString('o') }
        'low'    { return (Get-Date).AddDays(2).ToString('o') }
        default {
            switch ([string]$Status) {
                'missing_inputs' { return (Get-Date).AddDays(3).ToString('o') }
                'error'          { return (Get-Date).AddHours(4).ToString('o') }
                'unresolved'     { return (Get-Date).AddDays(1).ToString('o') }
                default          { return (Get-Date).AddDays(1).ToString('o') }
            }
        }
    }
}

function Test-FreeEmailDomain {
    param([string]$Domain)

    $candidate = (Get-DomainFromUrl -Url ([string]$Domain))
    if (-not $candidate) {
        return $false
    }

    return $candidate -in @(
        'gmail.com',
        'googlemail.com',
        'outlook.com',
        'hotmail.com',
        'live.com',
        'icloud.com',
        'me.com',
        'yahoo.com',
        'protonmail.com'
    )
}

function Test-HostedAtsDomain {
    param([string]$Domain)

    $candidate = (Get-DomainFromUrl -Url ([string]$Domain))
    if (-not $candidate) {
        return $false
    }

    foreach ($suffix in @(
            'greenhouse.io',
            'lever.co',
            'ashbyhq.com',
            'smartrecruiters.com',
            'jobvite.com',
            'bamboohr.com',
            'workdayjobs.com',
            'myworkdayjobs.com',
            'icims.com',
            'icims.jobs',
            'taleo.net',
            'oraclecloud.com',
            'successfactors.com',
            'jobs.sap.com',
            'personio.de',
            'personio.com',
            'recruitee.com',
            'teamtailor.com',
            'comeet.com',
            'comeet.co',
            'jazzhr.com',
            'jazz.co'
        )) {
        if ($candidate -eq $suffix -or $candidate.EndsWith(".$suffix")) {
            return $true
        }
    }

    return $false
}

function Get-CompanyEnrichmentRelatedRecords {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        $Company
    )

    $normalizedName = [string]$(if (Get-ObjectValue -Object $Company -Name 'normalizedName') { Get-ObjectValue -Object $Company -Name 'normalizedName' } else { Get-CanonicalCompanyKey (Get-ObjectValue -Object $Company -Name 'displayName') })
    $accountId = [string](Get-ObjectValue -Object $Company -Name 'id')

    return [ordered]@{
        configs = @(
            $State.boardConfigs |
                Where-Object { $_.accountId -eq $accountId -or $_.normalizedCompanyName -eq $normalizedName }
        )
        jobs = @(
            $State.jobs |
                Where-Object { $_.accountId -eq $accountId -or $_.normalizedCompanyName -eq $normalizedName } |
                Select-Object -First 30
        )
        contacts = @(
            $State.contacts |
                Where-Object { $_.accountId -eq $accountId -or $_.normalizedCompanyName -eq $normalizedName } |
                Select-Object -First 40
        )
    }
}

function Resolve-CompanyReachableCareersEndpoint {
    param(
        [string]$Domain,
        [string]$CareersUrl,
        [int]$CandidateLimit = 6,
        [int]$TimeoutSec = 6
    )

    $attemptedUrls = New-Object System.Collections.ArrayList
    $httpSummary = New-Object System.Collections.ArrayList
    $bestUrl = ''
    $bestDomain = ''
    $bestEvidence = ''
    $verified = $false
    $candidateUrls = @((Get-CareersPageCandidateUrls -Domain $Domain -CareersUrl $CareersUrl) | Select-Object -First $CandidateLimit)
    foreach ($candidateUrl in @($candidateUrls)) {
        [void]$attemptedUrls.Add([string]$candidateUrl)
    }

    # FIX: Do NOT use StopOnFirstSuccess — the bare domain often returns 200 first but
    # is not the careers page. Probe all candidates and pick the best careers-specific URL.
    $probeBatch = Invoke-ResolverProbeRequestsParallel -Urls $candidateUrls -TimeoutSec $TimeoutSec
    foreach ($response in @($probeBatch.responses)) {
        $responseUrl = [string]$(if ($response.url) { $response.url } else { '' })
        [void]$httpSummary.Add((New-ResolverAttemptRecord -Stage 'enrichment_careers' -Url $responseUrl -Response $response))
    }

    # Score each successful response: prefer URLs with /careers, /jobs, join-us, or careers. subdomain
    $successResponse = $null
    $bestScore = -1
    foreach ($response in @($probeBatch.responses | Where-Object { $_.ok })) {
        $responseUrl = [string]$(if ($response.url) { $response.url } else { '' })
        $finalUrl = [string]$(if ($response.finalUrl) { $response.finalUrl } else { $responseUrl })
        $score = 1  # base score for any 200 response
        if ($finalUrl -match '/careers|/jobs|/join-us|/openings|/company/careers|/about/careers') { $score += 10 }
        if ($responseUrl -match '/careers|/jobs|/join-us|/openings|/company/careers|/about/careers') { $score += 8 }
        if ($finalUrl -match 'careers\.' -or $responseUrl -match 'careers\.') { $score += 6 }
        # Penalise bare domain — it's almost never the careers page
        if ($responseUrl -match '^https?://[^/]+/?$') { $score -= 5 }
        if ($score -gt $bestScore) {
            $bestScore = $score
            $successResponse = $response
        }
    }

    if ($successResponse) {
        $responseUrl = [string]$(if ($successResponse.url) { $successResponse.url } else { '' })
        $finalUrl = [string]$(if ($successResponse.finalUrl) { $successResponse.finalUrl } else { $responseUrl })
        $finalDomain = Get-DomainFromUrl -Url $finalUrl
        $bestUrl = $finalUrl
        $bestDomain = if ($Domain) { $Domain } else { $finalDomain }
        $bestEvidence = if ($successResponse.title) { "Reachable careers page: $($successResponse.title)" } else { 'Reachable careers page discovered' }
        $verified = $true

        if ($finalUrl -match '/careers|/jobs|join-us|careers\.') {
            $bestEvidence = if ($successResponse.title) { "Verified careers endpoint: $($successResponse.title)" } else { 'Verified careers endpoint' }
        }
    }

    return [ordered]@{
        careersUrl = $bestUrl
        domain = $bestDomain
        verified = $verified
        evidence = $bestEvidence
        attemptedUrls = @($attemptedUrls.ToArray())
        httpSummary = @($httpSummary.ToArray())
    }
}

function Test-EnrichmentAttemptDue {
    param([string]$NextAttemptAt)

    if ([string]::IsNullOrWhiteSpace([string]$NextAttemptAt)) {
        return $true
    }

    $parsed = [datetime]::MinValue
    if (-not [datetime]::TryParse([string]$NextAttemptAt, [ref]$parsed)) {
        return $true
    }

    return ($parsed.ToUniversalTime() -le (Get-Date).ToUniversalTime())
}

function Get-CompanyEnrichmentSearchPlan {
    param(
        [Parameter(Mandatory = $true)]
        $Company,
        [string]$CompanyName = '',
        [double]$BestKnownIdentityScore = 0,
        [switch]$ForceRefresh,
        [switch]$DeepVerify
    )

    $displayName = ([string]$CompanyName).Trim()
    if (-not $displayName) {
        $displayName = [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default '')
    }
    if (-not $displayName) {
        $displayName = [string](Get-ObjectValue -Object $Company -Name 'normalizedName' -Default '')
    }

    $targetScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'targetScore' -Default 0))
    if ($targetScore -le 0) {
        $targetScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'normalizedTargetScore' -Default 0))
    }
    $alertPriorityScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'alertPriorityScore' -Default 0))
    $relationshipStrengthScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'relationshipStrengthScore' -Default 0))
    $engagementScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'engagementScore' -Default 0))
    $hiringVelocity = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringVelocity' -Default 0))
    $openRoleCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'openRoleCount' -Default 0))
    if ($openRoleCount -lt 1) {
        $openRoleCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobCount' -Default 0))
    }
    $connectionCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'connectionCount' -Default 0))
    $priority = [string](Get-ObjectValue -Object $Company -Name 'priority' -Default 'medium')
    $priorityBonus = switch ($priority) {
        'critical' { 26 }
        'high' { 16 }
        'medium' { 6 }
        default { 0 }
    }

    $nameQualityScore = 100
    $alphaCount = [regex]::Matches($displayName, '[A-Za-z]').Count
    $digitCount = [regex]::Matches($displayName, '\d').Count
    $wordCount = [regex]::Matches($displayName.Trim(), '[A-Za-z0-9]+').Count
    if ($displayName -match '^[^A-Za-z]+') { $nameQualityScore -= 18 }
    if ($displayName -match '[\(\)\"]') { $nameQualityScore -= 8 }
    if ($displayName.Length -gt 42) { $nameQualityScore -= 8 }
    if ($displayName -match 'under contract to|self employed|freelance|contractor|brokerage') { $nameQualityScore -= 12 }
    if ($digitCount -gt 0) { $nameQualityScore -= [Math]::Min(18, $digitCount * 4) }
    if ($wordCount -gt 6) { $nameQualityScore -= 10 }
    if ($alphaCount -lt 4) { $nameQualityScore -= 18 }
    if ($nameQualityScore -lt 0) { $nameQualityScore = 0 }

    $opportunityScore = 0.0
    $opportunityScore += [Math]::Min($targetScore, 100) * 0.65
    $opportunityScore += [Math]::Min($alertPriorityScore, 100) * 0.45
    $opportunityScore += [Math]::Min($relationshipStrengthScore, 100) * 0.20
    $opportunityScore += [Math]::Min($engagementScore, 100) * 0.10
    $opportunityScore += [Math]::Min($connectionCount * 7, 35)
    $opportunityScore += [Math]::Min($openRoleCount * 4, 24)
    $opportunityScore += [Math]::Min($hiringVelocity * 0.35, 18)
    $opportunityScore += $priorityBonus
    $opportunityScore += [Math]::Min($BestKnownIdentityScore * 0.15, 12)

    $tier = 'low'
    if ($opportunityScore -ge 95 -or $openRoleCount -ge 4 -or $targetScore -ge 70 -or $alertPriorityScore -ge 60 -or $priority -in @('critical', 'high')) {
        $tier = 'high'
    } elseif ($opportunityScore -ge 35 -or $openRoleCount -gt 0 -or $connectionCount -ge 3 -or $relationshipStrengthScore -ge 55 -or $engagementScore -ge 30) {
        $tier = 'medium'
    }

    if ($nameQualityScore -lt 45 -and $tier -ne 'high') {
        $tier = 'low'
    }

    $plan = [ordered]@{
        tier = $tier
        signalScore = [int][Math]::Round($opportunityScore)
        nameQualityScore = [int][Math]::Round($nameQualityScore)
        maxSeeds = 1
        maxResults = 2
        queryTimeoutSec = 2
        allowOfficialSiteFallback = $false
        careersProbeLimit = 2
        careersProbeTimeoutSec = 3
        reason = 'low_signal_fast_bail'
    }

    switch ($tier) {
        'high' {
            $plan.maxSeeds = 2
            $plan.maxResults = 3
            $plan.queryTimeoutSec = 3
            $plan.allowOfficialSiteFallback = $true
            $plan.careersProbeLimit = 4
            $plan.careersProbeTimeoutSec = 5
            $plan.reason = 'high_opportunity'
        }
        'medium' {
            $plan.maxSeeds = 1
            $plan.maxResults = 3
            $plan.queryTimeoutSec = 3
            $plan.allowOfficialSiteFallback = ($nameQualityScore -ge 45)
            $plan.careersProbeLimit = 3
            $plan.careersProbeTimeoutSec = 4
            $plan.reason = 'balanced_probe'
        }
    }

    $manualPrioritySignal = [bool](
        $connectionCount -ge 8 -or
        $relationshipStrengthScore -ge 80 -or
        $alertPriorityScore -ge 40 -or
        $targetScore -ge 50 -or
        $openRoleCount -ge 1
    )
    if ($ForceRefresh -and $tier -eq 'low' -and $nameQualityScore -ge 55 -and $manualPrioritySignal) {
        $plan.allowOfficialSiteFallback = $true
        $plan.reason = 'manual_refresh_priority'
    }

    if ($DeepVerify) {
        switch ($tier) {
            'high' {
                $plan.maxSeeds = 3
                $plan.maxResults = 4
                $plan.queryTimeoutSec = 4
                $plan.allowOfficialSiteFallback = $true
                $plan.careersProbeLimit = 5
                $plan.careersProbeTimeoutSec = 6
            }
            'medium' {
                $plan.maxSeeds = 2
                $plan.maxResults = 4
                $plan.queryTimeoutSec = 4
                $plan.allowOfficialSiteFallback = $true
                $plan.careersProbeLimit = 4
                $plan.careersProbeTimeoutSec = 5
            }
            default {
                $plan.maxSeeds = 2
                $plan.maxResults = 3
                $plan.queryTimeoutSec = 3
                $plan.allowOfficialSiteFallback = ($nameQualityScore -ge 45)
                $plan.careersProbeLimit = 4
                $plan.careersProbeTimeoutSec = 4
            }
        }
        $plan.reason = 'deep_verify'
    }

    return $plan
}

function Get-DiscoverySearchPlan {
    param(
        [Parameter(Mandatory = $true)]
        $Company,
        [Parameter(Mandatory = $true)]
        $Config,
        [switch]$ForceRefresh,
        [switch]$DeepVerify
    )

    $companyName = [string]$(if (Get-ObjectValue -Object $Company -Name 'displayName') { Get-ObjectValue -Object $Company -Name 'displayName' } else { Get-ObjectValue -Object $Config -Name 'companyName' })
    $identityInputs = Get-ResolverIdentityInputs -Company $Company -Config $Config
    $domain = [string](Get-ObjectValue -Object $identityInputs -Name 'domain' -Default '')
    $careersUrl = [string](Get-ObjectValue -Object $identityInputs -Name 'careersUrl' -Default '')
    $configConfidenceScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Config -Name 'confidenceScore' -Default 0))
    $bestKnownIdentityScore = 0.0
    if ($domain) { $bestKnownIdentityScore += 38 }
    if ($careersUrl) { $bestKnownIdentityScore += 46 }
    if ([bool](Get-ObjectValue -Object $identityInputs -Name 'trustedConfig' -Default $false)) {
        $bestKnownIdentityScore += [Math]::Min($configConfidenceScore * 0.25, 18)
    }
    if ($bestKnownIdentityScore -gt 100) { $bestKnownIdentityScore = 100 }

    $plan = Get-CompanyEnrichmentSearchPlan -Company $Company -CompanyName $companyName -BestKnownIdentityScore $bestKnownIdentityScore -ForceRefresh:$ForceRefresh -DeepVerify:$DeepVerify
    switch ([string]$plan.tier) {
        'high' {
            $plan.slugCandidateLimit = 6
            $plan.atsProbeTypes = @('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'jobvite', 'bamboohr')
        }
        'medium' {
            $plan.slugCandidateLimit = 4
            $plan.atsProbeTypes = @('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'jobvite')
        }
        default {
            $plan.slugCandidateLimit = 3
            $plan.atsProbeTypes = @('greenhouse', 'lever', 'ashby', 'smartrecruiters')
        }
    }
    if ($DeepVerify -and [int]$plan.slugCandidateLimit -lt 5) {
        $plan.slugCandidateLimit = 5
        $plan.atsProbeTypes = @('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'jobvite', 'bamboohr')
    }
    $plan.discoveryCareersCandidateLimit = [Math]::Max(3, [int]$plan.careersProbeLimit)
    $plan.discoveryCareersTimeoutSec = [Math]::Max(4, [int]$plan.careersProbeTimeoutSec)
    if (-not $DeepVerify -and -not $plan.allowOfficialSiteFallback -and ($domain -or $careersUrl)) {
        $plan.reason = 'discovery_fast_bail'
    }
    return $plan
}

function New-CurrentCompanyEnrichmentResult {
    param(
        [Parameter(Mandatory = $true)]
        $Company,
        [string[]]$Aliases = @()
    )

    $canonicalDomain = [string]$(if (Get-ObjectValue -Object $Company -Name 'canonicalDomain') { Get-ObjectValue -Object $Company -Name 'canonicalDomain' } elseif (Get-ObjectValue -Object $Company -Name 'domain') { Get-ObjectValue -Object $Company -Name 'domain' } else { '' })
    $careersUrl = [string](Get-ObjectValue -Object $Company -Name 'careersUrl')
    $status = [string](Get-ObjectValue -Object $Company -Name 'enrichmentStatus')
    if (-not $status) {
        if ($canonicalDomain -or $careersUrl) {
            $status = 'enriched'
        } else {
            $status = 'missing_inputs'
        }
    }

    $confidenceBand = [string](Get-ObjectValue -Object $Company -Name 'enrichmentConfidence')
    if (-not $confidenceBand) {
        $confidenceBand = if ($status -eq 'manual' -or $status -eq 'verified') { 'high' } elseif ($canonicalDomain -or $careersUrl) { 'medium' } else { 'unresolved' }
    }

    $confidenceScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'enrichmentConfidenceScore' -Default 0))
    if ($confidenceScore -lt 1) {
        $confidenceScore = switch ($confidenceBand) {
            'high' { 92 }
            'medium' { 76 }
            'low' { 58 }
            default { 0 }
        }
    }

    $lastEnrichedAt = Get-ObjectValue -Object $Company -Name 'lastEnrichedAt' -Default $null
    $lastVerifiedAt = Get-ObjectValue -Object $Company -Name 'lastVerifiedAt' -Default $null
    $nextAttemptAt = [string](Get-ObjectValue -Object $Company -Name 'nextEnrichmentAttemptAt')
    if (-not $nextAttemptAt) {
        $nextAttemptAt = Get-EnrichmentNextAttemptAt -Status $status -ConfidenceBand $confidenceBand
    }

    return [ordered]@{
        canonicalDomain = $canonicalDomain
        careersUrl = $careersUrl
        linkedinCompanySlug = [string](Get-ObjectValue -Object $Company -Name 'linkedinCompanySlug')
        aliases = @($Aliases)
        cacheHit = $false
        enrichmentStatus = $status
        enrichmentSource = [string](Get-ObjectValue -Object $Company -Name 'enrichmentSource')
        enrichmentConfidence = $confidenceBand
        enrichmentConfidenceScore = $confidenceScore
        enrichmentNotes = [string](Get-ObjectValue -Object $Company -Name 'enrichmentNotes')
        enrichmentEvidence = [string](Get-ObjectValue -Object $Company -Name 'enrichmentEvidence')
        enrichmentFailureReason = [string](Get-ObjectValue -Object $Company -Name 'enrichmentFailureReason')
        enrichmentAttemptedUrls = @((Get-ObjectValue -Object $Company -Name 'enrichmentAttemptedUrls' -Default @()) | Where-Object { $_ } | Select-Object -Unique)
        enrichmentHttpSummary = @((Get-ObjectValue -Object $Company -Name 'enrichmentHttpSummary' -Default @()))
        nextEnrichmentAttemptAt = $nextAttemptAt
        lastEnrichedAt = if ($lastEnrichedAt) { $lastEnrichedAt } else { $null }
        lastVerifiedAt = if ($lastVerifiedAt) { $lastVerifiedAt } else { $null }
    }
}

function Get-CompanyEnrichmentResult {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        $Company,
        [switch]$ForceRefresh,
        [switch]$DeepVerify
    )

    $enrichmentStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $companyName = [string]$(if (Get-ObjectValue -Object $Company -Name 'displayName') { Get-ObjectValue -Object $Company -Name 'displayName' } else { Get-ObjectValue -Object $Company -Name 'normalizedName' })
    $baseDomain = [string]$(if (Get-ObjectValue -Object $Company -Name 'canonicalDomain') { Get-ObjectValue -Object $Company -Name 'canonicalDomain' } elseif (Get-ObjectValue -Object $Company -Name 'domain') { Get-ObjectValue -Object $Company -Name 'domain' } else { '' })
    $baseCareersUrl = [string](Get-ObjectValue -Object $Company -Name 'careersUrl')
    $aliases = @(Get-GeneratedCompanyAliases -CompanyName $companyName -Domain $baseDomain -ExistingAliases @(Get-ObjectValue -Object $Company -Name 'aliases' -Default @()))
    $existingResult = New-CurrentCompanyEnrichmentResult -Company $Company -Aliases $aliases
    $hasStoredResult = [bool]($existingResult.enrichmentStatus -or $existingResult.canonicalDomain -or $existingResult.careersUrl)
    $attemptDue = Test-EnrichmentAttemptDue -NextAttemptAt ([string](Get-ObjectValue -Object $existingResult -Name 'nextEnrichmentAttemptAt'))
    $recentStrongResult = $false
    foreach ($timestampValue in @(
            $(if ([string](Get-ObjectValue -Object $existingResult -Name 'lastVerifiedAt')) { [string](Get-ObjectValue -Object $existingResult -Name 'lastVerifiedAt') } else { '' }),
            $(if ([string](Get-ObjectValue -Object $existingResult -Name 'lastEnrichedAt')) { [string](Get-ObjectValue -Object $existingResult -Name 'lastEnrichedAt') } else { '' })
        )) {
        if (-not $timestampValue) {
            continue
        }
        $parsedTimestamp = [datetime]::MinValue
        if ([datetime]::TryParse($timestampValue, [ref]$parsedTimestamp)) {
            if ($parsedTimestamp.ToUniversalTime() -ge (Get-Date).ToUniversalTime().AddDays(-7)) {
                $recentStrongResult = $true
                break
            }
        }
    }
    $hasStrongStoredResult = [bool](($existingResult.enrichmentStatus -in @('manual', 'verified')) -or (([string](Get-ObjectValue -Object $existingResult -Name 'enrichmentConfidence')) -in @('high', 'medium') -and ((Get-ObjectValue -Object $existingResult -Name 'canonicalDomain') -or (Get-ObjectValue -Object $existingResult -Name 'careersUrl'))))
    if (-not $ForceRefresh -and $hasStoredResult -and ((-not $attemptDue) -or ($hasStrongStoredResult -and $recentStrongResult))) {
        [void](Set-ObjectValue -Object $existingResult -Name 'cacheHit' -Value $true)
        $enrichmentStopwatch.Stop()
        Write-PipelineDiag -Stage 'enrichment_result' -Company $companyName -Message 'Using cached enrichment result' -Data @{
            cacheHit = $true
            status = [string](Get-ObjectValue -Object $existingResult -Name 'enrichmentStatus')
            confidence = [string](Get-ObjectValue -Object $existingResult -Name 'enrichmentConfidence')
            cooldownActive = [bool](-not $attemptDue)
            elapsedMs = [int]$enrichmentStopwatch.ElapsedMilliseconds
        }
        return $existingResult
    }

    $related = Get-CompanyEnrichmentRelatedRecords -State $State -Company $Company
    $domainCandidates = @{}
    $careersCandidates = @{}
    $attemptedUrls = New-Object System.Collections.ArrayList
    $httpSummary = New-Object System.Collections.ArrayList
    $searchElapsedMs = 0
    $careersProbeElapsedMs = 0
    $usedSearchFallback = $false
    $usedCareersProbe = $false

    function Add-EnrichmentCandidate {
        param(
            [hashtable]$Store,
            [string]$Type,
            [string]$Value,
            [double]$Score,
            [string]$Source,
            [string]$Evidence
        )

        $candidateValue = [string]$Value
        if ($Type -eq 'domain') {
            $candidateValue = Get-DomainFromUrl -Url $candidateValue
        } elseif ($candidateValue -and $candidateValue -notmatch '^https?://') {
            $candidateValue = "https://$candidateValue"
        }

        $candidateValue = ([string]$candidateValue).Trim()
        if (-not $candidateValue) {
            return
        }

        $key = $candidateValue.ToLowerInvariant()
        if ($Store.ContainsKey($key) -and [double]$Store[$key].score -ge $Score) {
            return
        }

        $Store[$key] = [ordered]@{
            value = $candidateValue
            score = [double]$Score
            source = [string]$Source
            evidence = [string]$Evidence
        }
    }

    if ($baseDomain) {
        Add-EnrichmentCandidate -Store $domainCandidates -Type 'domain' -Value $baseDomain -Score 96 -Source 'company_record' -Evidence 'Existing company domain'
    }
    if ($baseCareersUrl) {
        Add-EnrichmentCandidate -Store $careersCandidates -Type 'careers' -Value $baseCareersUrl -Score 94 -Source 'company_record' -Evidence 'Existing company careers URL'
    }

    foreach ($config in @($related.configs)) {
        $configConfidence = [string]$(if (Get-ObjectValue -Object $config -Name 'confidenceBand') { Get-ObjectValue -Object $config -Name 'confidenceBand' } else { 'unresolved' })
        $baseScore = switch ($configConfidence) {
            'high' { 90 }
            'medium' { 74 }
            'low' { 62 }
            default { 56 }
        }

        $configDomain = [string](Get-ObjectValue -Object $config -Name 'domain')
        $configCareersUrl = [string](Get-ObjectValue -Object $config -Name 'careersUrl')
        $configResolvedBoardUrl = [string](Get-ObjectValue -Object $config -Name 'resolvedBoardUrl')
        if ($configDomain) {
            $domainScore = if (Test-HostedAtsDomain -Domain $configDomain) { $baseScore - 18 } else { $baseScore }
            Add-EnrichmentCandidate -Store $domainCandidates -Type 'domain' -Value $configDomain -Score $domainScore -Source 'board_config' -Evidence ("Config domain from {0}" -f [string](Get-ObjectValue -Object $config -Name 'discoveryStatus'))
        }
        if ($configCareersUrl) {
            Add-EnrichmentCandidate -Store $careersCandidates -Type 'careers' -Value $configCareersUrl -Score ($baseScore + 2) -Source 'board_config' -Evidence ("Config careers URL from {0}" -f [string](Get-ObjectValue -Object $config -Name 'discoveryMethod'))
        }
        if ($configResolvedBoardUrl) {
            Add-EnrichmentCandidate -Store $careersCandidates -Type 'careers' -Value $configResolvedBoardUrl -Score ($baseScore - 4) -Source 'board_config' -Evidence 'Resolved board URL from config'
        }
    }

    foreach ($contact in @($related.contacts)) {
        $email = [string]$contact.email
        if (-not $email -or $email -notmatch '@') {
            continue
        }

        $emailDomain = ([string]$email.Split('@')[-1]).Trim().ToLowerInvariant()
        if (-not $emailDomain -or (Test-FreeEmailDomain -Domain $emailDomain) -or (Test-HostedAtsDomain -Domain $emailDomain)) {
            continue
        }

        Add-EnrichmentCandidate -Store $domainCandidates -Type 'domain' -Value $emailDomain -Score 82 -Source 'contact_email' -Evidence 'Derived from contact email domain'
    }

    foreach ($job in @($related.jobs)) {
        foreach ($value in @([string]$job.url, [string]$job.jobUrl, [string]$job.sourceUrl)) {
            if (-not $value) {
                continue
            }

            $jobDomain = Get-DomainFromUrl -Url $value
            if ($jobDomain -and -not (Test-HostedAtsDomain -Domain $jobDomain)) {
                Add-EnrichmentCandidate -Store $domainCandidates -Type 'domain' -Value $jobDomain -Score 68 -Source 'job_url' -Evidence 'Derived from job posting URL'
            }
            if ($value -match '/careers|/jobs|join-us|company/careers') {
                Add-EnrichmentCandidate -Store $careersCandidates -Type 'careers' -Value $value -Score 70 -Source 'job_url' -Evidence 'Derived from job posting URL'
            }
        }
    }

    $bestDomainCandidate = $domainCandidates.Values | Sort-Object @{ Expression = { [double]$_.score }; Descending = $true }, @{ Expression = { [string]$_.value }; Descending = $false } | Select-Object -First 1
    $bestCareersCandidate = $careersCandidates.Values | Sort-Object @{ Expression = { [double]$_.score }; Descending = $true }, @{ Expression = { [string]$_.value }; Descending = $false } | Select-Object -First 1

    $bestDomain = [string]$(if ($bestDomainCandidate) { $bestDomainCandidate.value } else { '' })
    $bestCareersUrl = [string]$(if ($bestCareersCandidate) { $bestCareersCandidate.value } else { '' })
    $verifiedAt = $null
    $evidenceParts = New-Object System.Collections.ArrayList
    if ($bestDomainCandidate) { [void]$evidenceParts.Add([string]$bestDomainCandidate.evidence) }
    if ($bestCareersCandidate) { [void]$evidenceParts.Add([string]$bestCareersCandidate.evidence) }
    $bestKnownIdentityScore = [double][Math]::Max(
        [double]$(if ($bestDomainCandidate) { $bestDomainCandidate.score } else { 0 }),
        [double]$(if ($bestCareersCandidate) { $bestCareersCandidate.score } else { 0 })
    )
    $searchPlan = Get-CompanyEnrichmentSearchPlan -Company $Company -CompanyName $companyName -BestKnownIdentityScore $bestKnownIdentityScore -ForceRefresh:$ForceRefresh -DeepVerify:$DeepVerify

    if (-not $ForceRefresh -and $bestDomain -and $bestCareersUrl -and $bestKnownIdentityScore -ge 88) {
        $confidenceScore = [double][Math]::Min(100, $bestKnownIdentityScore + 4)
        $status = if ([string](Get-ObjectValue -Object $existingResult -Name 'enrichmentStatus') -in @('manual', 'verified')) { [string](Get-ObjectValue -Object $existingResult -Name 'enrichmentStatus') } elseif ($bestKnownIdentityScore -ge 92) { 'verified' } else { 'enriched' }
        $confidenceBand = if ($status -eq 'manual') { 'high' } else { Get-ResolverConfidenceBand -Score $confidenceScore }
        $evidenceSummary = [string]::Join('; ', @($evidenceParts | Where-Object { $_ } | Select-Object -Unique))
        $now = (Get-Date).ToString('o')
        $result = [ordered]@{
            canonicalDomain = $bestDomain
            careersUrl = $bestCareersUrl
            linkedinCompanySlug = [string](Get-ObjectValue -Object $Company -Name 'linkedinCompanySlug')
            aliases = @($aliases)
            cacheHit = $false
            enrichmentStatus = $status
            enrichmentSource = [string]$(if ($bestCareersCandidate) { $bestCareersCandidate.source } elseif ($bestDomainCandidate) { $bestDomainCandidate.source } else { '' })
            enrichmentConfidence = $confidenceBand
            enrichmentConfidenceScore = [int][Math]::Round($confidenceScore)
            enrichmentNotes = 'Company identity inputs refreshed from existing internal signals'
            enrichmentEvidence = $evidenceSummary
            enrichmentFailureReason = ''
            enrichmentAttemptedUrls = @()
            enrichmentHttpSummary = @()
            nextEnrichmentAttemptAt = Get-EnrichmentNextAttemptAt -Status $status -ConfidenceBand $confidenceBand
            lastEnrichedAt = $now
            lastVerifiedAt = if ($status -eq 'verified') { $(if ([string](Get-ObjectValue -Object $existingResult -Name 'lastVerifiedAt')) { [string](Get-ObjectValue -Object $existingResult -Name 'lastVerifiedAt') } else { $now }) } else { Get-ObjectValue -Object $Company -Name 'lastVerifiedAt' -Default $null }
        }
        $enrichmentStopwatch.Stop()
        Write-PipelineDiag -Stage 'enrichment_result' -Company $companyName -Message 'Resolved enrichment from internal signals only' -Data @{
            cacheHit = $false
            skippedExternalProbe = $true
            status = $status
            confidence = $confidenceBand
            score = [int][Math]::Round($confidenceScore)
            elapsedMs = [int]$enrichmentStopwatch.ElapsedMilliseconds
        }
        return $result
    }

    if ((-not $bestDomain -and -not $bestCareersUrl -or $ForceRefresh) -and $companyName) {
        $searchStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $searchFallback = Resolve-SearchResultCandidate -CompanyName $companyName -Domain $bestDomain -CareersUrl $bestCareersUrl -Aliases $aliases -MaxResults ([int]$searchPlan.maxResults) -MaxSeeds ([int]$searchPlan.maxSeeds) -QueryTimeoutSec ([int]$searchPlan.queryTimeoutSec) -AllowOfficialSiteFallback ([bool]$searchPlan.allowOfficialSiteFallback)
        $searchStopwatch.Stop()
        $searchElapsedMs = [int]$searchStopwatch.ElapsedMilliseconds
        $usedSearchFallback = $true
        foreach ($attempt in @((Get-ObjectValue -Object $searchFallback -Name 'httpSummary'))) { [void]$httpSummary.Add($attempt) }
        foreach ($attemptedUrl in @((Get-ObjectValue -Object $searchFallback -Name 'attemptedUrls'))) { [void]$attemptedUrls.Add([string]$attemptedUrl) }

        if (Get-ObjectValue -Object $searchFallback -Name 'domain') {
            Add-EnrichmentCandidate -Store $domainCandidates -Type 'domain' -Value ([string](Get-ObjectValue -Object $searchFallback -Name 'domain')) -Score 76 -Source 'web_search' -Evidence 'Official domain candidate from web search'
        }
        if (Get-ObjectValue -Object $searchFallback -Name 'careersUrl') {
            Add-EnrichmentCandidate -Store $careersCandidates -Type 'careers' -Value ([string](Get-ObjectValue -Object $searchFallback -Name 'careersUrl')) -Score 78 -Source 'web_search' -Evidence 'Careers URL candidate from web search'
        }

        $bestDomainCandidate = $domainCandidates.Values | Sort-Object @{ Expression = { [double]$_.score }; Descending = $true } | Select-Object -First 1
        $bestCareersCandidate = $careersCandidates.Values | Sort-Object @{ Expression = { [double]$_.score }; Descending = $true } | Select-Object -First 1
        $bestDomain = [string]$(if ($bestDomainCandidate) { $bestDomainCandidate.value } else { '' })
        $bestCareersUrl = [string]$(if ($bestCareersCandidate) { $bestCareersCandidate.value } else { '' })
    }

    if ($bestDomain -or $bestCareersUrl) {
        $careersProbeTimeoutSec = [int]$searchPlan.careersProbeTimeoutSec
        $careersProbeLimit = [int]$searchPlan.careersProbeLimit
        if ($bestCareersCandidate -and [double]$bestCareersCandidate.score -ge 90) {
            $careersProbeTimeoutSec = [Math]::Min($careersProbeTimeoutSec, 4)
            $careersProbeLimit = [Math]::Min($careersProbeLimit, 3)
        } elseif ($bestDomainCandidate -and [double]$bestDomainCandidate.score -ge 80) {
            $careersProbeTimeoutSec = [Math]::Min([Math]::Max($careersProbeTimeoutSec, 4), 5)
            $careersProbeLimit = [Math]::Min([Math]::Max($careersProbeLimit, 3), 4)
        }
        $careersProbeStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $careersProbe = Resolve-CompanyReachableCareersEndpoint -Domain $bestDomain -CareersUrl $bestCareersUrl -CandidateLimit $careersProbeLimit -TimeoutSec $careersProbeTimeoutSec
        $careersProbeStopwatch.Stop()
        $careersProbeElapsedMs = [int]$careersProbeStopwatch.ElapsedMilliseconds
        $usedCareersProbe = $true
        foreach ($attempt in @($careersProbe.httpSummary)) { [void]$httpSummary.Add($attempt) }
        foreach ($attemptedUrl in @($careersProbe.attemptedUrls)) { [void]$attemptedUrls.Add([string]$attemptedUrl) }

        if ($careersProbe.careersUrl) {
            Add-EnrichmentCandidate -Store $careersCandidates -Type 'careers' -Value ([string]$careersProbe.careersUrl) -Score 88 -Source 'careers_probe' -Evidence ([string]$careersProbe.evidence)
        }
        if ($careersProbe.domain) {
            Add-EnrichmentCandidate -Store $domainCandidates -Type 'domain' -Value ([string]$careersProbe.domain) -Score 86 -Source 'careers_probe' -Evidence 'Canonical domain verified via careers endpoint'
        }
        if ($careersProbe.verified) {
            $verifiedAt = (Get-Date).ToString('o')
        }

        $bestDomainCandidate = $domainCandidates.Values | Sort-Object @{ Expression = { [double]$_.score }; Descending = $true } | Select-Object -First 1
        $bestCareersCandidate = $careersCandidates.Values | Sort-Object @{ Expression = { [double]$_.score }; Descending = $true } | Select-Object -First 1
        $bestDomain = [string]$(if ($bestDomainCandidate) { $bestDomainCandidate.value } else { '' })
        $bestCareersUrl = [string]$(if ($bestCareersCandidate) { $bestCareersCandidate.value } else { '' })
    }

    $confidenceScore = [double][Math]::Max(
        [double]$(if ($bestDomainCandidate) { $bestDomainCandidate.score } else { 0 }),
        [double]$(if ($bestCareersCandidate) { $bestCareersCandidate.score } else { 0 })
    )
    if ($bestDomain -and $bestCareersUrl) {
        $confidenceScore = [Math]::Min(100, $confidenceScore + 6)
    }
    if ($verifiedAt) {
        $confidenceScore = [Math]::Min(100, $confidenceScore + 6)
    }

    $status = ''
    $failureReason = ''
    if ($bestDomain -or $bestCareersUrl) {
        $status = if ($verifiedAt) { 'verified' } else { 'enriched' }
    } elseif ($attemptedUrls.Count -gt 0) {
        $status = 'unresolved'
        $failureReason = 'Unable to verify an official domain or careers page from current signals'
    } else {
        $status = 'missing_inputs'
        $failureReason = 'Missing company identity inputs for enrichment'
    }

    if ($bestDomainCandidate) { [void]$evidenceParts.Add([string]$bestDomainCandidate.evidence) }
    if ($bestCareersCandidate) { [void]$evidenceParts.Add([string]$bestCareersCandidate.evidence) }
    $evidenceSummary = [string]::Join('; ', @($evidenceParts | Where-Object { $_ } | Select-Object -Unique))
    $confidenceBand = Get-ResolverConfidenceBand -Score ([double]$confidenceScore)
    $now = (Get-Date).ToString('o')
    $result = [ordered]@{
        canonicalDomain = $bestDomain
        careersUrl = $bestCareersUrl
        linkedinCompanySlug = [string](Get-ObjectValue -Object $Company -Name 'linkedinCompanySlug')
        aliases = @($aliases)
        cacheHit = $false
        enrichmentStatus = $status
        enrichmentSource = [string]$(if ($bestCareersCandidate) { $bestCareersCandidate.source } elseif ($bestDomainCandidate) { $bestDomainCandidate.source } else { '' })
        enrichmentConfidence = $confidenceBand
        enrichmentConfidenceScore = [int][Math]::Round($confidenceScore)
        enrichmentNotes = if ($status -in @('enriched', 'verified')) { 'Company identity inputs refreshed for ATS resolution' } else { $failureReason }
        enrichmentEvidence = $evidenceSummary
        enrichmentFailureReason = $failureReason
        enrichmentAttemptedUrls = @($attemptedUrls.ToArray() | Where-Object { $_ } | Select-Object -Unique)
        enrichmentHttpSummary = @($httpSummary.ToArray())
        nextEnrichmentAttemptAt = Get-EnrichmentNextAttemptAt -Status $status -ConfidenceBand $confidenceBand
        lastEnrichedAt = $now
        lastVerifiedAt = if ($verifiedAt) { $verifiedAt } else { Get-ObjectValue -Object $Company -Name 'lastVerifiedAt' -Default $null }
    }
    $enrichmentStopwatch.Stop()
    if ($usedSearchFallback -or $usedCareersProbe -or [int]$enrichmentStopwatch.ElapsedMilliseconds -ge 1000) {
        Write-PipelineDiag -Stage 'enrichment_result' -Company $companyName -Message 'Computed company enrichment result' -Data @{
            cacheHit = $false
            usedSearchFallback = [bool]$usedSearchFallback
            usedCareersProbe = [bool]$usedCareersProbe
            status = $status
            confidence = $confidenceBand
            score = [int][Math]::Round($confidenceScore)
            attemptedUrls = $attemptedUrls.Count
            searchTier = [string]$searchPlan.tier
            searchReason = [string]$searchPlan.reason
            searchSignalScore = [int]$searchPlan.signalScore
            searchNameQualityScore = [int]$searchPlan.nameQualityScore
            deepVerify = [bool]$DeepVerify
            searchMs = $searchElapsedMs
            careersProbeMs = $careersProbeElapsedMs
            elapsedMs = [int]$enrichmentStopwatch.ElapsedMilliseconds
        }
    }
    return $result
}

function Invoke-CompanyEnrichment {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [int]$Limit = 50,
        [string[]]$AccountIds = @(),
        [switch]$ForceRefresh,
        [switch]$DeepVerify,
        [scriptblock]$ProgressCallback,
        [int]$ProcessedOffset = 0,
        [int]$TotalOverride = 0
    )

    $startedAt = (Get-Date).ToString('o')
    $candidates = @($State.companies)
    if (@($AccountIds).Count -gt 0) {
        $accountSet = @{}
        foreach ($accountId in @($AccountIds)) {
            if ($accountId) {
                $accountSet[[string]$accountId] = $true
            }
        }
        $candidates = @($candidates | Where-Object { $accountSet.ContainsKey([string]$_.id) })
    }

    if ($Limit -gt 0 -and @($AccountIds).Count -eq 0) {
        $candidates = @($candidates | Select-Object -First $Limit)
    }

    $candidateCount = @($candidates).Count
    $total = if ($TotalOverride -gt 0) { [int]$TotalOverride } else { [int]$candidateCount }
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Running company enrichment' -Processed $ProcessedOffset -Total $total -StartedAt $startedAt -Message 'Refreshing company identity inputs'

    $stats = [ordered]@{
        checked = 0
        verified = 0
        enriched = 0
        unresolved = 0
        missingInputs = 0
    }

    $changedCompanies = New-Object System.Collections.ArrayList
    for ($index = 0; $index -lt $candidates.Count; $index++) {
        $company = $candidates[$index]
        if ($ProgressCallback) {
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Running company enrichment' -Processed ($ProcessedOffset + $index) -Total $total -StartedAt $startedAt -Message ("Enriching {0}" -f [string](Get-ObjectValue -Object $company -Name 'displayName'))
        }

        $result = Get-CompanyEnrichmentResult -State $State -Company $company -ForceRefresh:$ForceRefresh -DeepVerify:$DeepVerify
        $cacheHit = [bool](Get-ObjectValue -Object $result -Name 'cacheHit' -Default $false)
        if (-not $cacheHit -or $ForceRefresh) {
            foreach ($field in 'canonicalDomain', 'careersUrl', 'linkedinCompanySlug', 'aliases', 'enrichmentStatus', 'enrichmentSource', 'enrichmentConfidence', 'enrichmentConfidenceScore', 'enrichmentNotes', 'enrichmentEvidence', 'enrichmentFailureReason', 'enrichmentAttemptedUrls', 'enrichmentHttpSummary', 'nextEnrichmentAttemptAt', 'lastEnrichedAt', 'lastVerifiedAt') {
                [void](Set-ObjectValue -Object $company -Name $field -Value $result[$field])
            }
            if ($result.canonicalDomain) {
                [void](Set-ObjectValue -Object $company -Name 'domain' -Value ([string]$result.canonicalDomain))
            }
            if ($result.careersUrl) {
                [void](Set-ObjectValue -Object $company -Name 'careersUrl' -Value ([string]$result.careersUrl))
            }
            [void](Set-ObjectValue -Object $company -Name 'updatedAt' -Value ((Get-Date).ToString('o')))
            $company = Update-CompanyProjection -Company $company
            [void]$changedCompanies.Add($company)
        }

        $stats.checked += 1
        switch ([string]$result.enrichmentStatus) {
            'verified' { $stats.verified += 1 }
            'enriched' { $stats.enriched += 1 }
            'missing_inputs' { $stats.missingInputs += 1 }
            default { $stats.unresolved += 1 }
        }

        $processed = $ProcessedOffset + $index + 1
        if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $total -or ($processed % 5) -eq 0)) {
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Running company enrichment' -Processed $processed -Total $total -StartedAt $startedAt -Message 'Refreshing company identity inputs'
        }
    }

    return [ordered]@{
        state = $State
        stats = $stats
        changedCompanies = @($changedCompanies.ToArray())
    }
}

function New-ResolverAttemptRecord {
    param(
        [string]$Stage,
        [string]$Url,
        $Response
    )

    return [ordered]@{
        stage = [string]$Stage
        url = [string]$Url
        ok = [bool](Get-ObjectValue -Object $Response -Name 'ok' -Default $false)
        statusCode = [int](Convert-ToNumber (Get-ObjectValue -Object $Response -Name 'statusCode' -Default 0))
        finalUrl = [string](Get-ObjectValue -Object $Response -Name 'finalUrl')
        contentType = [string](Get-ObjectValue -Object $Response -Name 'contentType')
        title = [string](Get-ObjectValue -Object $Response -Name 'title')
        error = [string](Get-ObjectValue -Object $Response -Name 'error')
        cacheSource = [string](Get-ObjectValue -Object $Response -Name 'cacheSource')
        elapsedMs = [int](Convert-ToNumber (Get-ObjectValue -Object $Response -Name 'elapsedMs' -Default 0))
        cacheAgeSeconds = [int](Convert-ToNumber (Get-ObjectValue -Object $Response -Name 'cacheAgeSeconds' -Default 0))
    }
}

function Initialize-ResolverProbeCaches {
    $cache = Get-Variable -Scope Script -Name ResolverHttpProbeCache -ErrorAction SilentlyContinue
    if (-not $cache) {
        $script:ResolverHttpProbeCache = @{}
    }
}

function Convert-ToResolverProbeCanonicalResponse {
    param($Response)

    if ($null -eq $Response) {
        return $null
    }

    return [ordered]@{
        url = [string](Get-ObjectValue -Object $Response -Name 'url')
        ok = [bool](Get-ObjectValue -Object $Response -Name 'ok' -Default $false)
        statusCode = [int](Convert-ToNumber (Get-ObjectValue -Object $Response -Name 'statusCode' -Default 0))
        finalUrl = [string]$(if (Get-ObjectValue -Object $Response -Name 'finalUrl') { Get-ObjectValue -Object $Response -Name 'finalUrl' } else { Get-ObjectValue -Object $Response -Name 'url' })
        contentType = [string](Get-ObjectValue -Object $Response -Name 'contentType')
        content = [string](Get-ObjectValue -Object $Response -Name 'content')
        title = [string](Get-ObjectValue -Object $Response -Name 'title')
        error = [string](Get-ObjectValue -Object $Response -Name 'error')
    }
}

function New-ResolverProbeResponseResult {
    param(
        $Response,
        [string]$CacheSource = '',
        [int]$ElapsedMs = 0,
        [string]$FetchedAt = '',
        [string]$ExpiresAt = ''
    )

    $canonical = Convert-ToResolverProbeCanonicalResponse -Response $Response
    if (-not $canonical) {
        return $null
    }

    $cacheAgeSeconds = 0
    if ($FetchedAt) {
        try {
            $cacheAgeSeconds = [int][Math]::Max(0, [Math]::Round(((Get-Date) - ([datetime]$FetchedAt)).TotalSeconds))
        } catch {
            $cacheAgeSeconds = 0
        }
    }

    return [ordered]@{
        url = [string]$canonical.url
        ok = [bool]$canonical.ok
        statusCode = [int]$canonical.statusCode
        finalUrl = [string]$canonical.finalUrl
        contentType = [string]$canonical.contentType
        content = [string]$canonical.content
        title = [string]$canonical.title
        error = [string]$canonical.error
        cacheSource = [string]$CacheSource
        elapsedMs = [int]$ElapsedMs
        cacheFetchedAt = [string]$FetchedAt
        cacheExpiresAt = [string]$ExpiresAt
        cacheAgeSeconds = [int]$cacheAgeSeconds
    }
}

function Get-ResolverProbeMemoryEntry {
    param([string]$Url)

    Initialize-ResolverProbeCaches
    if (-not $script:ResolverHttpProbeCache.ContainsKey($Url)) {
        return $null
    }

    $cached = $script:ResolverHttpProbeCache[$Url]
    if ($null -eq $cached) {
        return $null
    }

    if (Test-ObjectHasKey -Object $cached -Name 'response') {
        return [ordered]@{
            response = Convert-ToResolverProbeCanonicalResponse -Response (Get-ObjectValue -Object $cached -Name 'response')
            fetchedAt = [string](Get-ObjectValue -Object $cached -Name 'fetchedAt')
            expiresAt = [string](Get-ObjectValue -Object $cached -Name 'expiresAt')
        }
    }

    return [ordered]@{
        response = Convert-ToResolverProbeCanonicalResponse -Response $cached
        fetchedAt = ''
        expiresAt = ''
    }
}

function Save-ResolverProbeMemoryEntry {
    param(
        [string]$Url,
        $Response,
        [string]$FetchedAt = '',
        [string]$ExpiresAt = ''
    )

    Initialize-ResolverProbeCaches
    $script:ResolverHttpProbeCache[[string]$Url] = [ordered]@{
        response = Convert-ToResolverProbeCanonicalResponse -Response $Response
        fetchedAt = [string]$FetchedAt
        expiresAt = [string]$ExpiresAt
    }
}

function Get-ResolverProbeCacheTtlSeconds {
    param($Response)

    $statusCode = [int](Convert-ToNumber (Get-ObjectValue -Object $Response -Name 'statusCode' -Default 0))
    $ok = [bool](Get-ObjectValue -Object $Response -Name 'ok' -Default $false)
    if ($ok) {
        return 21600
    }

    switch ($statusCode) {
        { $_ -in 404, 410 } { return 21600 }
        429 { return 900 }
        { $_ -ge 500 } { return 900 }
        default { return 1800 }
    }
}

function Invoke-ResolverProbeCacheMaintenance {
    if (-not (Test-AppStoreUsesSqlite)) {
        return
    }

    $lastRun = Get-Variable -Scope Script -Name ResolverProbeCacheCleanupAt -ErrorAction SilentlyContinue
    if ($lastRun) {
        try {
            if (((Get-Date) - ([datetime]$lastRun.Value)).TotalMinutes -lt 30) {
                return
            }
        } catch {
        }
    }

    try {
        [void](Clear-AppResolverProbeCacheExpired)
        [void](Clear-AppResolverSearchCacheExpired)
        [void](Clear-AppResolverSeedCooldownsExpired)
        $script:ResolverProbeCacheCleanupAt = (Get-Date)
    } catch {
    }
}

function Invoke-ResolverProbeNetworkRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$TimeoutSec = 6
    )

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $result = [ordered]@{
        url = [string]$Url
        ok = $false
        statusCode = 0
        finalUrl = [string]$Url
        contentType = ''
        content = ''
        title = ''
        error = ''
    }

    try {
        $probeHeaders = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -MaximumRedirection 5 -TimeoutSec $TimeoutSec -Headers $probeHeaders -ErrorAction Stop
        $result.ok = $true
        $result.statusCode = [int]$(if ($response.StatusCode) { $response.StatusCode } else { 200 })
        $result.finalUrl = [string]$(if ($response.BaseResponse -and $response.BaseResponse.ResponseUri) { $response.BaseResponse.ResponseUri.AbsoluteUri } else { $Url })
        $result.contentType = [string]$(if ($response.Headers['Content-Type']) { $response.Headers['Content-Type'] } elseif ($response.RawContentType) { $response.RawContentType } else { '' })
        $rawContent = [string]$(if ($response.Content) { $response.Content } else { '' })
        $looksJson = $false
        if ($result.contentType -match 'json') {
            $looksJson = $true
        } elseif ($rawContent) {
            $trimmed = $rawContent.TrimStart()
            $looksJson = ($trimmed.StartsWith('{') -or $trimmed.StartsWith('['))
        }

        if ($looksJson) {
            $result.content = $rawContent
        } elseif ($rawContent.Length -gt 120000) {
            $result.content = $rawContent.Substring(0, 120000)
        } else {
            $result.content = $rawContent
        }
    } catch {
        $exception = $_.Exception
        $result.error = [string]$exception.Message
        try {
            $webResponse = $exception.Response
            if ($webResponse) {
                $result.statusCode = [int]$webResponse.StatusCode
                $result.finalUrl = [string]$webResponse.ResponseUri.AbsoluteUri
                $result.contentType = [string]$webResponse.ContentType
            }
        } catch {
        }
    }

    if ($result.content -match '<title[^>]*>(.*?)</title>') {
        $result.title = ([string]$matches[1] -replace '\s+', ' ').Trim()
    }

    $stopwatch.Stop()
    return [ordered]@{
        response = (Convert-ToResolverProbeCanonicalResponse -Response $result)
        elapsedMs = [int]$stopwatch.ElapsedMilliseconds
    }
}

function Invoke-ResolverProbeRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$TimeoutSec = 6
    )

    $normalizedUrl = ([string]$Url).Trim()
    if (-not $normalizedUrl) {
        return $null
    }

    $memoryEntry = Get-ResolverProbeMemoryEntry -Url $normalizedUrl
    if ($memoryEntry) {
        return (New-ResolverProbeResponseResult -Response $memoryEntry.response -CacheSource 'memory' -ElapsedMs 0 -FetchedAt ([string]$memoryEntry.fetchedAt) -ExpiresAt ([string]$memoryEntry.expiresAt))
    }

    $cacheLookupElapsed = 0
    $cacheRecord = $null
    if (Test-AppStoreUsesSqlite) {
        $cacheStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $cacheRecord = @(Get-AppResolverProbeCacheRecords -Urls @($normalizedUrl) | Select-Object -First 1)
        } finally {
            $cacheStopwatch.Stop()
            $cacheLookupElapsed = [int]$cacheStopwatch.ElapsedMilliseconds
        }
    }

    if ($cacheRecord) {
        Save-ResolverProbeMemoryEntry -Url $normalizedUrl -Response $cacheRecord.response -FetchedAt ([string]$cacheRecord.fetchedAt) -ExpiresAt ([string]$cacheRecord.expiresAt)
        return (New-ResolverProbeResponseResult -Response $cacheRecord.response -CacheSource 'persistent' -ElapsedMs $cacheLookupElapsed -FetchedAt ([string]$cacheRecord.fetchedAt) -ExpiresAt ([string]$cacheRecord.expiresAt))
    }

    $networkResult = Invoke-ResolverProbeNetworkRequest -Url $normalizedUrl -TimeoutSec $TimeoutSec
    $fetchedAt = (Get-Date).ToString('o')
    $expiresAt = (Get-Date).AddSeconds((Get-ResolverProbeCacheTtlSeconds -Response $networkResult.response)).ToString('o')
    Save-ResolverProbeMemoryEntry -Url $normalizedUrl -Response $networkResult.response -FetchedAt $fetchedAt -ExpiresAt $expiresAt

    if (Test-AppStoreUsesSqlite) {
        try {
            [void](Save-AppResolverProbeCacheRecords -Records @([ordered]@{
                        url = $normalizedUrl
                        response = $networkResult.response
                        fetchedAt = $fetchedAt
                        expiresAt = $expiresAt
                    }))
            Invoke-ResolverProbeCacheMaintenance
        } catch {
        }
    }

    return (New-ResolverProbeResponseResult -Response $networkResult.response -CacheSource 'network' -ElapsedMs ([int]$networkResult.elapsedMs) -FetchedAt $fetchedAt -ExpiresAt $expiresAt)
}

function Invoke-ResolverProbeRequestsParallel {
    param(
        [string[]]$Urls,
        [int]$TimeoutSec = 6,
        [switch]$StopOnFirstSuccess,
        [switch]$DisableCache
    )

    $normalizedUrls = @($Urls | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ } | Select-Object -Unique)
    if ($normalizedUrls.Count -eq 0) {
        return [ordered]@{
            responses = @()
            firstSuccess = $null
        }
    }

    if (-not $DisableCache) {
        Initialize-ResolverProbeCaches
    }

    $responses = New-Object System.Collections.ArrayList
    $pendingUrls = New-Object System.Collections.ArrayList
    $firstSuccess = $null
    foreach ($url in @($normalizedUrls)) {
        if (-not $DisableCache) {
            $memoryEntry = Get-ResolverProbeMemoryEntry -Url $url
            if ($memoryEntry) {
                $cachedResponse = New-ResolverProbeResponseResult -Response $memoryEntry.response -CacheSource 'memory' -ElapsedMs 0 -FetchedAt ([string]$memoryEntry.fetchedAt) -ExpiresAt ([string]$memoryEntry.expiresAt)
                [void]$responses.Add($cachedResponse)
                if ($StopOnFirstSuccess -and $cachedResponse.ok -and -not $firstSuccess) {
                    $firstSuccess = $cachedResponse
                    break
                }
                continue
            }
        }

        [void]$pendingUrls.Add($url)
    }

    if ($firstSuccess -or $pendingUrls.Count -eq 0) {
        return [ordered]@{
            responses = @($responses.ToArray())
            firstSuccess = $firstSuccess
        }
    }

    $persistentRecords = @()
    $persistentLookupElapsed = 0
    if ((-not $DisableCache) -and (Test-AppStoreUsesSqlite)) {
        $cacheStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $persistentRecords = @(Get-AppResolverProbeCacheRecords -Urls @($pendingUrls.ToArray()))
        } finally {
            $cacheStopwatch.Stop()
            $persistentLookupElapsed = [int]$cacheStopwatch.ElapsedMilliseconds
        }
    }

    if (@($persistentRecords).Count -gt 0) {
        $persistedMap = @{}
        foreach ($record in @($persistentRecords)) {
            $persistedMap[[string]$record.url] = $record
        }

        $remainingUrls = New-Object System.Collections.ArrayList
        $perRecordElapsed = if ($persistentRecords.Count -gt 0) { [int][Math]::Max([Math]::Round($persistentLookupElapsed / $persistentRecords.Count), 1) } else { 0 }
        foreach ($url in @($pendingUrls.ToArray())) {
            if ($persistedMap.ContainsKey([string]$url)) {
                $cacheRecord = $persistedMap[[string]$url]
                Save-ResolverProbeMemoryEntry -Url ([string]$url) -Response $cacheRecord.response -FetchedAt ([string]$cacheRecord.fetchedAt) -ExpiresAt ([string]$cacheRecord.expiresAt)
                $cachedResponse = New-ResolverProbeResponseResult -Response $cacheRecord.response -CacheSource 'persistent' -ElapsedMs $perRecordElapsed -FetchedAt ([string]$cacheRecord.fetchedAt) -ExpiresAt ([string]$cacheRecord.expiresAt)
                [void]$responses.Add($cachedResponse)
                if ($StopOnFirstSuccess -and $cachedResponse.ok -and -not $firstSuccess) {
                    $firstSuccess = $cachedResponse
                    break
                }
                continue
            }

            [void]$remainingUrls.Add([string]$url)
        }
        $pendingUrls = $remainingUrls
    }

    if ($firstSuccess -or $pendingUrls.Count -eq 0) {
        return [ordered]@{
            responses = @($responses.ToArray())
            firstSuccess = $firstSuccess
        }
    }

    $probeScript = {
        param(
            [string]$Url,
            [int]$TimeoutSec
        )

        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $result = [ordered]@{
            url = $Url
            ok = $false
            statusCode = 0
            finalUrl = $Url
            contentType = ''
            content = ''
            title = ''
            error = ''
        }

        try {
            $probeHeaders = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -MaximumRedirection 5 -TimeoutSec $TimeoutSec -Headers $probeHeaders -ErrorAction Stop
            $result.ok = $true
            $result.statusCode = [int]$(if ($response.StatusCode) { $response.StatusCode } else { 200 })
            $result.finalUrl = [string]$(if ($response.BaseResponse -and $response.BaseResponse.ResponseUri) { $response.BaseResponse.ResponseUri.AbsoluteUri } else { $Url })
            $result.contentType = [string]$(if ($response.Headers['Content-Type']) { $response.Headers['Content-Type'] } elseif ($response.RawContentType) { $response.RawContentType } else { '' })
            $rawContent = [string]$(if ($response.Content) { $response.Content } else { '' })
            $looksJson = $false
            if ($result.contentType -match 'json') {
                $looksJson = $true
            } elseif ($rawContent) {
                $trimmed = $rawContent.TrimStart()
                $looksJson = ($trimmed.StartsWith('{') -or $trimmed.StartsWith('['))
            }

            if ($looksJson) {
                $result.content = $rawContent
            } elseif ($rawContent.Length -gt 120000) {
                $result.content = $rawContent.Substring(0, 120000)
            } else {
                $result.content = $rawContent
            }
        } catch {
            $exception = $_.Exception
            $result.error = [string]$exception.Message
            try {
                $webResponse = $exception.Response
                if ($webResponse) {
                    $result.statusCode = [int]$webResponse.StatusCode
                    $result.finalUrl = [string]$webResponse.ResponseUri.AbsoluteUri
                    $result.contentType = [string]$webResponse.ContentType
                }
            } catch {
            }
        }

        if ($result.content -match '<title[^>]*>(.*?)</title>') {
            $result.title = ([string]$matches[1] -replace '\s+', ' ').Trim()
        }

        $stopwatch.Stop()
        $result.elapsedMs = [int]$stopwatch.ElapsedMilliseconds
        return [pscustomobject]$result
    }

    $pool = $null
    $pending = New-Object System.Collections.ArrayList
    $recordsToPersist = New-Object System.Collections.ArrayList
    try {
        $maxThreads = [Math]::Min([Math]::Max($pendingUrls.Count, 1), 6)
        $pool = [RunspaceFactory]::CreateRunspacePool(1, $maxThreads)
        $pool.Open()

        foreach ($url in @($pendingUrls.ToArray())) {
            $powershell = [PowerShell]::Create()
            $powershell.RunspacePool = $pool
            [void]$powershell.AddScript($probeScript).AddParameter('Url', [string]$url).AddParameter('TimeoutSec', $TimeoutSec)
            $async = $powershell.BeginInvoke()
            [void]$pending.Add([ordered]@{
                url = [string]$url
                ps = $powershell
                async = $async
            })
        }

        while ($pending.Count -gt 0) {
            $handles = @($pending | ForEach-Object { $_.async.AsyncWaitHandle })
            $signaledIndex = [System.Threading.WaitHandle]::WaitAny($handles, [Math]::Max(($TimeoutSec + 1) * 1000, 1000))
            if ($signaledIndex -lt 0 -or $signaledIndex -ge $pending.Count) {
                continue
            }

            $workItem = $pending[$signaledIndex]
            $pending.RemoveAt($signaledIndex)

            try {
                $output = $workItem.ps.EndInvoke($workItem.async)
                $response = @($output | Select-Object -First 1)
                if (-not $response) {
                    $response = [ordered]@{
                        url = [string]$workItem.url
                        ok = $false
                        statusCode = 0
                        finalUrl = [string]$workItem.url
                        contentType = ''
                        content = ''
                        title = ''
                        error = 'Probe returned no response'
                        elapsedMs = 0
                    }
                }
            } catch {
                $response = [ordered]@{
                    url = [string]$workItem.url
                    ok = $false
                    statusCode = 0
                    finalUrl = [string]$workItem.url
                    contentType = ''
                    content = ''
                    title = ''
                    error = [string]$_.Exception.Message
                    elapsedMs = 0
                }
            } finally {
                try {
                    if ($workItem.async -and $workItem.async.AsyncWaitHandle) {
                        $workItem.async.AsyncWaitHandle.Close()
                    }
                } catch {
                }
                try { $workItem.ps.Dispose() } catch {
                }
            }

            $canonicalResponse = Convert-ToResolverProbeCanonicalResponse -Response $response
            $fetchedAt = (Get-Date).ToString('o')
            $expiresAt = (Get-Date).AddSeconds((Get-ResolverProbeCacheTtlSeconds -Response $canonicalResponse)).ToString('o')
            if (-not $DisableCache) {
                Save-ResolverProbeMemoryEntry -Url ([string]$workItem.url) -Response $canonicalResponse -FetchedAt $fetchedAt -ExpiresAt $expiresAt
            }
            if ((-not $DisableCache) -and (Test-AppStoreUsesSqlite)) {
                [void]$recordsToPersist.Add([ordered]@{
                        url = [string]$workItem.url
                        response = $canonicalResponse
                        fetchedAt = $fetchedAt
                        expiresAt = $expiresAt
                    })
            }

            $resultResponse = New-ResolverProbeResponseResult -Response $canonicalResponse -CacheSource 'network' -ElapsedMs ([int](Convert-ToNumber (Get-ObjectValue -Object $response -Name 'elapsedMs' -Default 0))) -FetchedAt $fetchedAt -ExpiresAt $expiresAt
            [void]$responses.Add($resultResponse)

            if ($StopOnFirstSuccess -and $resultResponse.ok -and -not $firstSuccess) {
                $firstSuccess = $resultResponse
                break
            }
        }
    } finally {
        foreach ($remaining in @($pending.ToArray())) {
            try { $remaining.ps.Stop() } catch {
            }
            try {
                if ($remaining.async -and $remaining.async.AsyncWaitHandle) {
                    $remaining.async.AsyncWaitHandle.Close()
                }
            } catch {
            }
            try { $remaining.ps.Dispose() } catch {
            }
        }

        if ($pool) {
            try { $pool.Close() } catch {
            }
            try { $pool.Dispose() } catch {
            }
        }
    }

    if ((-not $DisableCache) -and (Test-AppStoreUsesSqlite) -and $recordsToPersist.Count -gt 0) {
        try {
            [void](Save-AppResolverProbeCacheRecords -Records @($recordsToPersist.ToArray()))
            Invoke-ResolverProbeCacheMaintenance
        } catch {
        }
    }

    return [ordered]@{
        responses = @($responses.ToArray())
        firstSuccess = $firstSuccess
    }
}

function Get-CareersPageCandidateUrls {
    param(
        [string]$Domain,
        [string]$CareersUrl
    )

    $urls = New-Object System.Collections.ArrayList
    $seen = @{}

    function Add-CareersUrl {
        param([string]$Value)

        $candidate = ([string]$Value).Trim()
        if (-not $candidate) {
            return
        }
        if ($candidate -notmatch '^https?://') {
            $candidate = "https://$candidate"
        }
        if ($seen.ContainsKey($candidate)) {
            return
        }
        $seen[$candidate] = $true
        [void]$urls.Add($candidate)
    }

    Add-CareersUrl -Value $CareersUrl
    if ($Domain) {
        foreach ($path in '/careers', '/jobs', '/company/careers', '/join-us', '/about/careers', '/careers/jobs') {
            Add-CareersUrl -Value ("https://{0}{1}" -f $Domain.Trim('/'), $path)
        }
        Add-CareersUrl -Value ("https://careers.{0}" -f $Domain.Trim('/'))
        Add-CareersUrl -Value $Domain
    }

    return @($urls.ToArray())
}

function Find-AtsDetectionsInContent {
    param(
        [string]$Content,
        [string]$FinalUrl = '',
        [string]$Method = 'careers_page'
    )

    $detections = New-Object System.Collections.ArrayList
    $seen = @{}

    function Add-Detection {
        param($Detection)
        if (-not $Detection) { return }
        $atsType = [string](Get-ObjectValue -Object $Detection -Name 'atsType')
        $boardId = [string](Get-ObjectValue -Object $Detection -Name 'boardId')
        if (-not $atsType -and -not $boardId) {
            return
        }
        $key = ('{0}|{1}' -f $atsType, $boardId)
        if (-not $seen.ContainsKey($key)) {
            $seen[$key] = $true
            [void]$detections.Add($Detection)
        }
    }

    foreach ($candidateUrl in @($FinalUrl)) {
        Add-Detection -Detection (Resolve-AtsFromUrlValue -Url $candidateUrl -Method $Method)
    }

    $lowerContent = ([string]$Content).ToLowerInvariant()

    # Meta tags / application-level signatures
    if ($lowerContent -match '<meta\s+name=["'']?applicationname["'']?\s+content=["'']?workday') {
        Add-Detection -Detection [ordered]@{ atsType = 'workday'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'html_meta'; supportedImport = $true; confidenceScore = 90; confidenceBand = 'high'; evidenceSummary = 'Workday application meta tag found in HTML'; matchedSignatures = @('html_meta'); redirectTarget = '' }
    }
    
    if ($lowerContent -match '<meta\s+property=["'']?og:site_name["'']?\s+content=["'']?icims') {
        Add-Detection -Detection [ordered]@{ atsType = 'icims'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'html_meta'; supportedImport = $false; confidenceScore = 86; confidenceBand = 'high'; evidenceSummary = 'iCIMS og:site_name meta tag found in HTML'; matchedSignatures = @('html_meta'); redirectTarget = '' }
    }

    if ($lowerContent -match 'oraclecloud\.com/.+candidateexperience') {
         Add-Detection -Detection [ordered]@{ atsType = 'taleo'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'html_body'; supportedImport = $false; confidenceScore = 82; confidenceBand = 'high'; evidenceSummary = 'Oracle/Taleo candidate experience reference found in HTML'; matchedSignatures = @('html_body'); redirectTarget = '' }
    }

    if ($lowerContent -match 'jobs\.sap\.com|successfactors') {
        Add-Detection -Detection [ordered]@{ atsType = 'successfactors'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'html_body'; supportedImport = $false; confidenceScore = 82; confidenceBand = 'high'; evidenceSummary = 'SuccessFactors / SAP reference found in HTML'; matchedSignatures = @('html_body'); redirectTarget = '' }
    }

    # Script src patterns for ATS providers
    if ($lowerContent -match 'src=[^>]*personio\.(de|com)') {
        Add-Detection -Detection [ordered]@{ atsType = 'personio'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'script_src'; supportedImport = $false; confidenceScore = 84; confidenceBand = 'medium'; evidenceSummary = 'Personio script reference found in HTML'; matchedSignatures = @('script_src'); redirectTarget = '' }
    }
    if ($lowerContent -match 'src=[^>]*recruitee\.com') {
        Add-Detection -Detection [ordered]@{ atsType = 'recruitee'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'script_src'; supportedImport = $false; confidenceScore = 84; confidenceBand = 'medium'; evidenceSummary = 'Recruitee script reference found in HTML'; matchedSignatures = @('script_src'); redirectTarget = '' }
    }
    if ($lowerContent -match 'src=[^>]*teamtailor\.com') {
        Add-Detection -Detection [ordered]@{ atsType = 'teamtailor'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'script_src'; supportedImport = $false; confidenceScore = 84; confidenceBand = 'medium'; evidenceSummary = 'Teamtailor script reference found in HTML'; matchedSignatures = @('script_src'); redirectTarget = '' }
    }
    if ($lowerContent -match 'src=[^>]*comeet\.(com|co)') {
        Add-Detection -Detection [ordered]@{ atsType = 'comeet'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'script_src'; supportedImport = $false; confidenceScore = 84; confidenceBand = 'medium'; evidenceSummary = 'Comeet script reference found in HTML'; matchedSignatures = @('script_src'); redirectTarget = '' }
    }

    # Iframe embeds — common for embedded ATS boards
    if ($lowerContent -match '<iframe[^>]+src=[^>]*greenhouse\.io') {
        Add-Detection -Detection [ordered]@{ atsType = 'greenhouse'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'iframe_embed'; supportedImport = $true; confidenceScore = 86; confidenceBand = 'high'; evidenceSummary = 'Greenhouse iframe embed found in HTML'; matchedSignatures = @('iframe_embed'); redirectTarget = '' }
    }
    if ($lowerContent -match '<iframe[^>]+src=[^>]*lever\.co') {
        Add-Detection -Detection [ordered]@{ atsType = 'lever'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'iframe_embed'; supportedImport = $true; confidenceScore = 86; confidenceBand = 'high'; evidenceSummary = 'Lever iframe embed found in HTML'; matchedSignatures = @('iframe_embed'); redirectTarget = '' }
    }

    # JSON-LD / schema.org JobPosting detection
    if ($lowerContent -match '"@type"\s*:\s*"jobposting"' -or $lowerContent -match '"@type"\s*:\s*\[\s*"jobposting"') {
        # If we haven't already found a specific ATS, the page has structured job data
        if ($detections.Count -eq 0) {
            Add-Detection -Detection [ordered]@{ atsType = 'custom_enterprise'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'json_ld'; supportedImport = $false; confidenceScore = 72; confidenceBand = 'medium'; evidenceSummary = 'JSON-LD JobPosting schema found in HTML — jobs are present but ATS provider unknown'; matchedSignatures = @('json_ld', 'schema_org'); redirectTarget = '' }
        }
    }

    if ($detections.Count -eq 0 -and $lowerContent -match 'apply now|view jobs|open positions|career opportunities|current openings') {
        Add-Detection -Detection [ordered]@{ atsType = 'custom_enterprise'; boardId = ''; domain = ''; careersUrl = $FinalUrl; resolvedBoardUrl = ''; source = $FinalUrl; discoveryStatus = 'discovered'; discoveryMethod = 'html_body'; supportedImport = $false; confidenceScore = 62; confidenceBand = 'low'; evidenceSummary = 'Generic careers keywords found in HTML'; matchedSignatures = @('html_body'); redirectTarget = '' }
    }

    foreach ($match in [regex]::Matches([string]$Content, 'https?://[^"''<>\s)]+', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        $candidateUrl = [string]$match.Value
        
        $detection = Resolve-AtsFromUrlValue -Url $candidateUrl -Method $Method
        if ($detection) {
             Add-Detection -Detection $detection
        }
        
        if ($detections.Count -ge 10) {
            break
        }
    }

    return @($detections.ToArray())
}

function Test-SupportedBoardCandidate {
    param(
        [string]$AtsType,
        [string]$Slug,
        [string]$Method = 'candidate_probe'
    )

    $candidateSlug = ([string]$Slug).Trim().ToLowerInvariant()
    if (-not $candidateSlug) {
        return $null
    }

    $url = ''
    $supportsImport = $false
    switch ([string]$AtsType) {
        'greenhouse' {
            $url = "https://boards-api.greenhouse.io/v1/boards/$([uri]::EscapeDataString($candidateSlug))/jobs?content=true"
            $supportsImport = $true
        }
        'lever' {
            $url = "https://api.lever.co/v0/postings/$([uri]::EscapeDataString($candidateSlug))?mode=json"
            $supportsImport = $true
        }
        'ashby' {
            $url = "https://api.ashbyhq.com/posting-api/job-board/$([uri]::EscapeDataString($candidateSlug))"
            $supportsImport = $true
        }
        'smartrecruiters' {
            $url = "https://api.smartrecruiters.com/v1/companies/$([uri]::EscapeDataString($candidateSlug))/postings?limit=20"
            $supportsImport = $true
        }
        'jobvite' {
            $url = "https://jobs.jobvite.com/api/job-list?company=$([uri]::EscapeDataString($candidateSlug))"
            $supportsImport = $true
        }
        'bamboohr' {
            $url = "https://$candidateSlug.bamboohr.com/careers/list"
            $supportsImport = $true
        }
        default {
            return $null
        }
    }

    $response = Invoke-ResolverProbeRequest -Url $url
    $jsonPayload = ConvertFrom-ResolverJsonContent -Content ([string]$response.content)
    $contentText = [string]$response.content
    $matched = $false
    switch ([string]$AtsType) {
        'greenhouse' {
            $matched = [bool](
                $response.ok -and (
                    ($jsonPayload -and $jsonPayload.PSObject.Properties.Name -contains 'jobs') -or
                    ($contentText -match '"jobs"\s*:')
                )
            )
        }
        'lever' {
            $trimmedContent = $contentText.TrimStart()
            $matched = [bool](
                $response.ok -and (
                    ($trimmedContent.StartsWith('[') -and $trimmedContent.Length -gt 2) -or
                    $jsonPayload -is [System.Collections.IEnumerable]
                )
            )
        }
        'ashby' {
            $matched = [bool](
                $response.ok -and (
                    ($jsonPayload -and ($jsonPayload.PSObject.Properties.Name -contains 'jobs' -or $jsonPayload.PSObject.Properties.Name -contains 'organizationName')) -or
                    ($contentText -match '"jobs"\s*:\s*\[' -and $contentText -match 'jobs\.ashbyhq\.com/[A-Za-z0-9\-]+/')
                )
            )
        }
        'smartrecruiters' {
            $totalFound = 0
            try { $totalFound = [int]$jsonPayload.totalFound } catch {}
            if ($totalFound -le 0 -and $contentText -match '"totalFound"\s*:\s*([0-9]+)') {
                $totalFound = [int]$matches[1]
            }
            $hasContentMarker = [bool](
                ($jsonPayload -and $jsonPayload.PSObject.Properties.Name -contains 'content') -or
                ($contentText -match '"content"\s*:\s*\[')
            )
            $matched = [bool]($response.ok -and $hasContentMarker -and $totalFound -gt 0)
        }
        'jobvite' {
            $matched = [bool](
                $response.ok -and (
                    ($jsonPayload -and ($jsonPayload.PSObject.Properties.Name -contains 'jobs' -or $jsonPayload.PSObject.Properties.Name -contains 'requisitions')) -or
                    ($contentText -match '"(jobs|requisitions)"\s*:')
                )
            )
        }
        'bamboohr' {
            $expectedHost = ('{0}.bamboohr.com' -f $candidateSlug)
            $matched = [bool](
                $response.ok -and
                $response.finalUrl -match ([regex]::Escape($expectedHost)) -and
                $response.finalUrl -match '/careers' -and
                ($contentText -match 'class="RtesseractJobBoard"' -or $contentText -match 'data-job-id' -or $contentText -match '"result"' -or $contentText -match '"id"\s*:\s*\d+')
            )
        }
    }

    if (-not $matched) {
        return [ordered]@{
            attemptedUrl = $url
            attemptedUrls = @($url)
            httpSummary = @(New-ResolverAttemptRecord -Stage $AtsType -Url $url -Response $response)
        }
    }

    $score = if ($supportsImport) { 90 } else { 80 }
    $score += (Get-ResolverScoreAdjustment -Method $Method)
    $resolvedBoardUrl = Get-ResolvedBoardUrl -AtsType $AtsType -BoardId $candidateSlug -FallbackUrl $(if ($response.finalUrl) { $response.finalUrl } else { $url })

    return [ordered]@{
        atsType = [string]$AtsType
        boardId = $candidateSlug
        source = $url
        domain = Get-DomainFromUrl -Url $resolvedBoardUrl
        careersUrl = if ($supportsImport) { $resolvedBoardUrl } else { $response.finalUrl }
        resolvedBoardUrl = $resolvedBoardUrl
        supportedImport = $supportsImport
        discoveryMethod = [string]$Method
        confidenceScore = [int][Math]::Min(100, $score)
        confidenceBand = Get-ResolverConfidenceBand -Score ([double][Math]::Min(100, $score))
        evidenceSummary = ("{0} probe responded for slug '{1}'" -f (Get-Culture).TextInfo.ToTitleCase($AtsType), $candidateSlug)
        matchedSignatures = @($AtsType, 'hosted_probe')
        attemptedUrls = @($url)
        httpSummary = @(New-ResolverAttemptRecord -Stage $AtsType -Url $url -Response $response)
    }
}

function Resolve-CareersPageCandidate {
    param(
        [string]$Domain,
        [string]$CareersUrl,
        [int]$CandidateLimit = 5,
        [int]$TimeoutSec = 6
    )

    $attemptedUrls = New-Object System.Collections.ArrayList
    $httpSummary = New-Object System.Collections.ArrayList
    $best = $null

    $candidateUrls = @((Get-CareersPageCandidateUrls -Domain $Domain -CareersUrl $CareersUrl) | Select-Object -First $CandidateLimit)
    foreach ($candidateUrl in @($candidateUrls)) {
        [void]$attemptedUrls.Add([string]$candidateUrl)
    }

    $probeBatch = Invoke-ResolverProbeRequestsParallel -Urls $candidateUrls -TimeoutSec $TimeoutSec
    foreach ($response in @($probeBatch.responses)) {
        $candidateUrl = [string]$(if ($response.url) { $response.url } else { '' })
        [void]$httpSummary.Add((New-ResolverAttemptRecord -Stage 'careers_page' -Url $candidateUrl -Response $response))
        if (-not $response.ok) {
            continue
        }

        $detections = @(Find-AtsDetectionsInContent -Content ([string]$response.content) -FinalUrl ([string]$response.finalUrl) -Method 'careers_page')
        foreach ($detection in @($detections)) {
            $score = [double]$detection.confidenceScore + 6
            if ($response.finalUrl -and $response.finalUrl -ne $candidateUrl) {
                $score += 4
                $detection.redirectTarget = [string]$response.finalUrl
            }

            $candidate = [ordered]@{
                atsType = [string]$detection.atsType
                boardId = [string]$detection.boardId
                source = [string]$(if ($detection.source) { $detection.source } else { $detection.resolvedBoardUrl })
                domain = if ($Domain) { $Domain } else { Get-DomainFromUrl -Url $response.finalUrl }
                careersUrl = [string]$(if ($CareersUrl) { $CareersUrl } else { $candidateUrl })
                resolvedBoardUrl = [string]$(if ($detection.resolvedBoardUrl) { $detection.resolvedBoardUrl } else { $response.finalUrl })
                supportedImport = [bool]$detection.supportedImport
                discoveryMethod = 'careers_page'
                confidenceScore = [int][Math]::Min(100, $score)
                confidenceBand = Get-ResolverConfidenceBand -Score ([double][Math]::Min(100, $score))
                evidenceSummary = ("ATS link discovered on careers page{0}" -f $(if ($response.title) { ": $($response.title)" } else { '' }))
                matchedSignatures = @($detection.matchedSignatures + @('careers_page'))
                attemptedUrls = @($attemptedUrls.ToArray())
                httpSummary = @($httpSummary.ToArray())
                redirectTarget = [string]$response.finalUrl
            }

            if (-not $best -or [double]$candidate.confidenceScore -gt [double]$best.confidenceScore) {
                $best = $candidate
            }
        }

        if ($best -and $best.confidenceBand -eq 'high') {
            break
        }
    }

    if ($best) {
        return $best
    }

    return [ordered]@{
        attemptedUrls = @($attemptedUrls.ToArray())
        httpSummary = @($httpSummary.ToArray())
    }
}

function Test-ResolverSearchCandidateUrlAllowed {
    param([string]$Url)

    $candidateUrl = ([string]$Url).Trim()
    if (-not $candidateUrl) {
        return $false
    }

    $domain = Get-DomainFromUrl -Url $candidateUrl
    if (-not $domain) {
        return $false
    }

    foreach ($blockedDomain in 'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'monster.com', 'simplyhired.com', 'builtin.com', 'wellfound.com', 'careerbliss.com', 'jobbank.gc.ca', 'talent.com', 'learn4good.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'youtube.com', 'wikipedia.org') {
        if ($domain -eq $blockedDomain -or $domain.EndsWith(".$blockedDomain")) {
            return $false
        }
    }

    return $true
}

function Get-ResolverSearchSeedCooldownKey {
    param(
        [string]$CompanyName,
        [string]$Seed
    )

    $companyKey = Get-CanonicalCompanyKey ([string]$CompanyName)
    $seedKey = Get-CanonicalCompanyKey ([string]$Seed)
    if (-not $seedKey) {
        $seedKey = ([string]$Seed).Trim().ToLowerInvariant()
    }
    return ('company={0}|seed={1}' -f $companyKey, $seedKey)
}

function Get-ResolverSearchCandidateUrls {
    param(
        [string]$CompanyName,
        [string[]]$Aliases = @(),
        [int]$MaxResults = 6,
        [int]$MaxSeeds = 4,
        [int]$QueryTimeoutSec = 4,
        [bool]$AllowOfficialSiteFallback = $true
    )

    $searchStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $normalizedCompanyName = ([string]$CompanyName).Trim()
    $searchSeeds = New-Object System.Collections.ArrayList
    foreach ($seed in @($normalizedCompanyName) + @($Aliases | Where-Object { $_ })) {
        $candidate = ([string]$seed).Trim()
        if (-not $candidate -or @($searchSeeds) -contains $candidate) {
            continue
        }
        [void]$searchSeeds.Add($candidate)
    }

    if ($searchSeeds.Count -eq 0) {
        $searchStopwatch.Stop()
        return @()
    }

    $cache = Get-Variable -Scope Script -Name ResolverSearchCandidateCache -ErrorAction SilentlyContinue
    if (-not $cache) {
        $script:ResolverSearchCandidateCache = @{}
        $cache = Get-Variable -Scope Script -Name ResolverSearchCandidateCache -ErrorAction SilentlyContinue
    }

    $searchStrategyVersion = 'v2_parallel_batches'
    $cacheKey = ('strategy={0}|fallback={1}|{2}|results={3}|seeds={4}|timeout={5}' -f $searchStrategyVersion, [int][bool]$AllowOfficialSiteFallback, [string]::Join('|', @($searchSeeds.ToArray())), $MaxResults, $MaxSeeds, $QueryTimeoutSec)
    if ($cache.Value.ContainsKey($cacheKey)) {
        $searchStopwatch.Stop()
        Write-PipelineDiag -Stage 'search_candidates' -Company $normalizedCompanyName -Message 'Loaded cached search candidate URLs' -Data @{
            cacheSource = 'memory'
            urlCount = @($cache.Value[$cacheKey]).Count
            elapsedMs = [int]$searchStopwatch.ElapsedMilliseconds
        }
        return @($cache.Value[$cacheKey])
    }

    if (Test-AppStoreUsesSqlite) {
        $persistentRecord = $null
        try {
            $persistentRecord = Get-AppResolverSearchCacheRecord -CacheKey $cacheKey
        } catch {
            $persistentRecord = $null
        }

        if ($persistentRecord) {
            $cache.Value[$cacheKey] = @($persistentRecord.urls)
            $searchStopwatch.Stop()
            Write-PipelineDiag -Stage 'search_candidates' -Company $normalizedCompanyName -Message 'Loaded cached search candidate URLs' -Data @{
                cacheSource = 'persistent'
                urlCount = @($persistentRecord.urls).Count
                elapsedMs = [int]$searchStopwatch.ElapsedMilliseconds
                cacheAgeSeconds = [int]$(if ($persistentRecord.fetchedAt) { [Math]::Max(0, [Math]::Round(((Get-Date) - ([datetime]$persistentRecord.fetchedAt)).TotalSeconds)) } else { 0 })
            }
            return @($persistentRecord.urls)
        }
    }

    $results = New-Object System.Collections.ArrayList
    $seen = @{}
    $selectedSeeds = @($searchSeeds.ToArray() | Select-Object -First $MaxSeeds)
    $seedCooldownKeys = @()
    $seedCooldownCount = 0
    if (Test-AppStoreUsesSqlite -and -not $AllowOfficialSiteFallback) {
        $seedCooldownKeys = @($selectedSeeds | ForEach-Object { Get-ResolverSearchSeedCooldownKey -CompanyName $normalizedCompanyName -Seed ([string]$_) })
        $seedCooldownRecords = @(Get-AppResolverSeedCooldownRecords -SeedKeys $seedCooldownKeys)
        if ($seedCooldownRecords.Count -gt 0) {
            $cooldownMap = @{}
            foreach ($record in @($seedCooldownRecords)) {
                $cooldownMap[[string]$record.seedKey] = $record
            }
            $eligibleSeeds = New-Object System.Collections.ArrayList
            foreach ($seed in @($selectedSeeds)) {
                $seedKey = Get-ResolverSearchSeedCooldownKey -CompanyName $normalizedCompanyName -Seed ([string]$seed)
                if (-not $cooldownMap.ContainsKey($seedKey)) {
                    [void]$eligibleSeeds.Add([string]$seed)
                }
            }
            $seedCooldownCount = $seedCooldownRecords.Count
            $selectedSeeds = @($eligibleSeeds.ToArray())
            if ($selectedSeeds.Count -eq 0) {
                $cache.Value[$cacheKey] = @()
                $searchStopwatch.Stop()
                Write-PipelineDiag -Stage 'search_candidates' -Company $normalizedCompanyName -Message 'Skipped search candidate fetch because all seeds are on cooldown' -Data @{
                    cacheSource = 'seed_cooldown'
                    cooldownCount = [int]$seedCooldownCount
                    urlCount = 0
                    elapsedMs = [int]$searchStopwatch.ElapsedMilliseconds
                }
                return @()
            }
        }
    }
    $primaryQueries = New-Object System.Collections.ArrayList
    $fallbackQueries = New-Object System.Collections.ArrayList
    foreach ($seed in @($selectedSeeds)) {
        [void]$primaryQueries.Add("$seed careers")
        [void]$primaryQueries.Add("$seed jobs")
        [void]$fallbackQueries.Add("$seed official site")
    }

    function Add-SearchResultsFromBatch {
        param(
            [object[]]$Responses,
            [System.Collections.ArrayList]$ResultStore,
            [hashtable]$SeenMap,
            [int]$ResultLimit
        )

        foreach ($response in @($Responses)) {
            if (-not $response -or -not $response.ok) {
                continue
            }

            foreach ($match in [regex]::Matches([string]$response.content, 'uddg=([^&"]+)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
                $candidateUrl = ''
                try {
                    $candidateUrl = [uri]::UnescapeDataString([string]$match.Groups[1].Value)
                } catch {
                    $candidateUrl = [string]$match.Groups[1].Value
                }

                if (-not $candidateUrl -or $SeenMap.ContainsKey($candidateUrl)) {
                    continue
                }
                if (-not (Test-ResolverSearchCandidateUrlAllowed -Url $candidateUrl)) {
                    continue
                }

                $SeenMap[$candidateUrl] = $true
                [void]$ResultStore.Add($candidateUrl)
                if ($ResultStore.Count -ge $ResultLimit) {
                    return
                }
            }
        }
    }

    $primaryBatchMs = 0
    $fallbackBatchMs = 0
    if ($primaryQueries.Count -gt 0) {
        $primaryBatchStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $primarySearchUrls = @($primaryQueries.ToArray() | ForEach-Object { 'https://duckduckgo.com/html/?q=' + [uri]::EscapeDataString([string]$_) })
        $primaryBatch = Invoke-ResolverProbeRequestsParallel -Urls $primarySearchUrls -TimeoutSec $QueryTimeoutSec -DisableCache
        $primaryBatchStopwatch.Stop()
        $primaryBatchMs = [int]$primaryBatchStopwatch.ElapsedMilliseconds
        Add-SearchResultsFromBatch -Responses @($primaryBatch.responses) -ResultStore $results -SeenMap $seen -ResultLimit $MaxResults
    }

    if ($AllowOfficialSiteFallback -and $results.Count -lt [Math]::Min($MaxResults, 2) -and $fallbackQueries.Count -gt 0) {
        $fallbackBatchStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $fallbackSearchUrls = @($fallbackQueries.ToArray() | ForEach-Object { 'https://duckduckgo.com/html/?q=' + [uri]::EscapeDataString([string]$_) })
        $fallbackBatch = Invoke-ResolverProbeRequestsParallel -Urls $fallbackSearchUrls -TimeoutSec $QueryTimeoutSec -DisableCache
        $fallbackBatchStopwatch.Stop()
        $fallbackBatchMs = [int]$fallbackBatchStopwatch.ElapsedMilliseconds
        Add-SearchResultsFromBatch -Responses @($fallbackBatch.responses) -ResultStore $results -SeenMap $seen -ResultLimit $MaxResults
    }

    $cache.Value[$cacheKey] = @($results.ToArray())
    if (Test-AppStoreUsesSqlite) {
        $fetchedAt = (Get-Date).ToString('o')
        $expiresAt = (Get-Date).AddHours($(if ($results.Count -gt 0) { 6 } else { 3 })).ToString('o')
        try {
            [void](Save-AppResolverSearchCacheRecord -CacheKey $cacheKey -Urls @($results.ToArray()) -FetchedAt $fetchedAt -ExpiresAt $expiresAt)
            if ($results.Count -eq 0 -and -not $AllowOfficialSiteFallback -and $selectedSeeds.Count -gt 0) {
                $cooldownHours = if ($MaxSeeds -le 1 -and $MaxResults -le 2 -and $QueryTimeoutSec -le 2) { 24 } else { 12 }
                [void](Save-AppResolverSeedCooldownRecords -Records @($selectedSeeds | ForEach-Object {
                            [ordered]@{
                                seedKey = Get-ResolverSearchSeedCooldownKey -CompanyName $normalizedCompanyName -Seed ([string]$_)
                                reason = 'no_result'
                                fetchedAt = $fetchedAt
                                expiresAt = (Get-Date).AddHours($cooldownHours).ToString('o')
                            }
                        }))
            } elseif ($results.Count -gt 0 -and $selectedSeeds.Count -gt 0) {
                [void](Remove-AppResolverSeedCooldownRecords -SeedKeys @($selectedSeeds | ForEach-Object { Get-ResolverSearchSeedCooldownKey -CompanyName $normalizedCompanyName -Seed ([string]$_) }))
            }
            Invoke-ResolverProbeCacheMaintenance
        } catch {
        }
    }
    $searchStopwatch.Stop()
    Write-PipelineDiag -Stage 'search_candidates' -Company $normalizedCompanyName -Message 'Resolved search candidate URLs' -Data @{
        cacheSource = 'network'
        urlCount = @($results.ToArray()).Count
        strategy = $searchStrategyVersion
        cooldownCount = [int]$seedCooldownCount
        queryCount = [int]($primaryQueries.Count + $(if ($fallbackBatchMs -gt 0) { $fallbackQueries.Count } else { 0 }))
        officialSiteFallback = [bool]$AllowOfficialSiteFallback
        primaryBatchMs = [int]$primaryBatchMs
        fallbackBatchMs = [int]$fallbackBatchMs
        elapsedMs = [int]$searchStopwatch.ElapsedMilliseconds
    }
    return @($results.ToArray())
}

function Resolve-SearchResultCandidate {
    param(
        [string]$CompanyName,
        [string]$Domain,
        [string]$CareersUrl,
        [string[]]$Aliases = @(),
        [int]$MaxResults = 3,
        [int]$MaxSeeds = 2,
        [int]$QueryTimeoutSec = 3,
        [bool]$AllowOfficialSiteFallback = $true
    )

    function Get-ResolverFollowUpCandidateScore {
        param(
            [string]$CandidateUrl,
            [string]$FinalUrl,
            [string]$FinalDomain,
            [string]$KnownDomain,
            [string]$PageTitle
        )

        $score = 0
        $candidateValue = [string]$CandidateUrl
        $finalValue = [string]$FinalUrl
        $domainValue = [string]$FinalDomain
        $knownDomainValue = [string]$KnownDomain
        $titleValue = ([string]$PageTitle).ToLowerInvariant()

        if ($candidateValue -match '/careers|/jobs|/join-us|/openings|/company/careers|/about/careers') { $score += 12 }
        if ($finalValue -match '/careers|/jobs|/join-us|/openings|/company/careers|/about/careers') { $score += 14 }
        if ($candidateValue -match 'careers\.' -or $finalValue -match 'careers\.') { $score += 8 }
        if ($titleValue -match 'career|job|join us|opportunit') { $score += 8 }
        if ($knownDomainValue -and $domainValue) {
            if ($domainValue -eq $knownDomainValue) {
                $score += 6
            } elseif ($domainValue.EndsWith(".$knownDomainValue") -or $knownDomainValue.EndsWith(".$domainValue")) {
                $score += 4
            }
        }
        if ($candidateValue -match '^https?://[^/]+/?$') { $score -= 5 }
        if ($finalValue -match '^https?://[^/]+/?$') { $score -= 4 }
        return $score
    }

    $resolveStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $attemptedUrls = New-Object System.Collections.ArrayList
    $httpSummary = New-Object System.Collections.ArrayList
    $best = $null
    $bestDomain = [string]$Domain
    $bestCareersUrl = [string]$CareersUrl
    $directPhaseMs = 0
    $contentProbeMs = 0
    $careersFollowUpMs = 0
    $careersFollowUpCount = 0
    $contentProbeCount = 0

    $candidateUrls = @((Get-ResolverSearchCandidateUrls -CompanyName $CompanyName -Aliases $Aliases -MaxResults $MaxResults -MaxSeeds $MaxSeeds -QueryTimeoutSec $QueryTimeoutSec -AllowOfficialSiteFallback:$AllowOfficialSiteFallback) | Select-Object -First $MaxResults)
    if ($candidateUrls.Count -eq 0) {
        $resolveStopwatch.Stop()
        Write-PipelineDiag -Stage 'search_result_resolve' -Company $CompanyName -Message 'No search-result candidates available' -Data @{
            candidateCount = 0
            directPhaseMs = 0
            contentProbeMs = 0
            careersFollowUpMs = 0
            elapsedMs = [int]$resolveStopwatch.ElapsedMilliseconds
        }
        return [ordered]@{
            candidate = $null
            domain = $bestDomain
            careersUrl = $bestCareersUrl
            attemptedUrls = @()
            httpSummary = @()
        }
    }

    $directPhaseStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    foreach ($candidateUrl in @($candidateUrls)) {
        [void]$attemptedUrls.Add([string]$candidateUrl)

        $directDetection = Resolve-AtsFromUrlValue -Url ([string]$candidateUrl) -Method 'search_result'
        $directAtsType = [string]$(if ($directDetection) { Get-ObjectValue -Object $directDetection -Name 'atsType' } else { '' })
        $directBoardId = [string]$(if ($directDetection) { Get-ObjectValue -Object $directDetection -Name 'boardId' } else { '' })
        if ($directAtsType) {
            $directCandidate = $directDetection
            if ($directBoardId -and $directAtsType -in @('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'jobvite')) {
                $verifiedCandidate = Test-SupportedBoardCandidate -AtsType $directAtsType -Slug $directBoardId -Method 'search_result'
                if ([string](Get-ObjectValue -Object $verifiedCandidate -Name 'atsType')) {
                    $directCandidate = $verifiedCandidate
                }
                foreach ($attempt in @((Get-ObjectValue -Object $verifiedCandidate -Name 'httpSummary'))) { [void]$httpSummary.Add($attempt) }
                foreach ($attemptedUrl in @((Get-ObjectValue -Object $verifiedCandidate -Name 'attemptedUrls'))) { [void]$attemptedUrls.Add([string]$attemptedUrl) }
            }

            $candidateScore = [double](Convert-ToNumber (Get-ObjectValue -Object $directCandidate -Name 'confidenceScore'))
            if ($candidateScore -lt 1) { $candidateScore = 76 }
            $candidateScore = [double][Math]::Min(100, $candidateScore + 6)
            $resolvedUrl = [string]$(if (Get-ObjectValue -Object $directCandidate -Name 'resolvedBoardUrl') { Get-ObjectValue -Object $directCandidate -Name 'resolvedBoardUrl' } else { Get-ResolvedBoardUrl -AtsType $directAtsType -BoardId $directBoardId -FallbackUrl ([string]$candidateUrl) })
            $candidate = [ordered]@{
                atsType = $directAtsType
                boardId = $directBoardId
                source = [string]$candidateUrl
                domain = [string]$(if ($Domain) { $Domain } else { Get-DomainFromUrl -Url $resolvedUrl })
                careersUrl = [string]$(if ($CareersUrl) { $CareersUrl } else { $candidateUrl })
                resolvedBoardUrl = $resolvedUrl
                supportedImport = [bool]$(if (Test-ObjectHasKey -Object $directCandidate -Name 'supportedImport') { Get-ObjectValue -Object $directCandidate -Name 'supportedImport' } else { Test-ImportCapableAtsType -AtsType $directAtsType })
                discoveryMethod = 'search_result'
                confidenceScore = [int][Math]::Round($candidateScore)
                confidenceBand = Get-ResolverConfidenceBand -Score $candidateScore
                evidenceSummary = 'Hosted ATS board found in company-site search results'
                matchedSignatures = @((Get-ObjectValue -Object $directCandidate -Name 'matchedSignatures') + @('search_result') | Where-Object { $_ } | Select-Object -Unique)
                attemptedUrls = @($attemptedUrls.ToArray())
                httpSummary = @($httpSummary.ToArray())
            }

            if (-not $best -or [double](Convert-ToNumber (Get-ObjectValue -Object $candidate -Name 'confidenceScore')) -gt [double](Convert-ToNumber (Get-ObjectValue -Object $best -Name 'confidenceScore'))) {
                $best = $candidate
            }
            if ($best -and ([string](Get-ObjectValue -Object $best -Name 'confidenceBand')) -eq 'high') {
                break
            }
        }
    }
    $directPhaseStopwatch.Stop()
    $directPhaseMs = [int]$directPhaseStopwatch.ElapsedMilliseconds

    if (-not ($best -and ([string](Get-ObjectValue -Object $best -Name 'confidenceBand')) -eq 'high')) {
        $contentProbeStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $probeBatch = Invoke-ResolverProbeRequestsParallel -Urls $candidateUrls -TimeoutSec 4
        $contentProbeStopwatch.Stop()
        $contentProbeMs = [int]$contentProbeStopwatch.ElapsedMilliseconds
        $contentProbeCount = [int]@($candidateUrls).Count
        $bestFollowUpTarget = $null
        $bestFollowUpScore = [int]::MinValue

        foreach ($response in @($probeBatch.responses)) {
            $candidateUrl = [string]$(if ($response.url) { $response.url } else { '' })
            [void]$httpSummary.Add((New-ResolverAttemptRecord -Stage 'search_result' -Url $candidateUrl -Response $response))
            if (-not $response.ok) {
                continue
            }

            $finalUrl = [string]$(if ($response.finalUrl) { $response.finalUrl } else { $candidateUrl })
            $finalDomain = Get-DomainFromUrl -Url $finalUrl
            if (-not $bestDomain -and $finalDomain) {
                $bestDomain = $finalDomain
            }
            if (-not $bestCareersUrl -and (($finalUrl -match '/careers|/jobs|join-us') -or ($candidateUrl -match '/careers|/jobs|join-us'))) {
                $bestCareersUrl = if ($finalUrl) { $finalUrl } else { [string]$candidateUrl }
            }

            $detections = @(Find-AtsDetectionsInContent -Content ([string]$response.content) -FinalUrl $finalUrl -Method 'search_result')
            foreach ($detection in @($detections)) {
                $candidateScore = [double](Convert-ToNumber (Get-ObjectValue -Object $detection -Name 'confidenceScore'))
                $candidateScore = [double][Math]::Min(100, $candidateScore + 8)
                $candidate = [ordered]@{
                    atsType = [string](Get-ObjectValue -Object $detection -Name 'atsType')
                    boardId = [string](Get-ObjectValue -Object $detection -Name 'boardId')
                    source = [string]$(if (Get-ObjectValue -Object $detection -Name 'source') { Get-ObjectValue -Object $detection -Name 'source' } else { $finalUrl })
                    domain = [string]$(if ($bestDomain) { $bestDomain } else { $finalDomain })
                    careersUrl = [string]$(if ($bestCareersUrl) { $bestCareersUrl } else { $finalUrl })
                    resolvedBoardUrl = [string]$(if (Get-ObjectValue -Object $detection -Name 'resolvedBoardUrl') { Get-ObjectValue -Object $detection -Name 'resolvedBoardUrl' } else { $finalUrl })
                    supportedImport = [bool]$(if (Test-ObjectHasKey -Object $detection -Name 'supportedImport') { Get-ObjectValue -Object $detection -Name 'supportedImport' } else { Test-ImportCapableAtsType -AtsType ([string](Get-ObjectValue -Object $detection -Name 'atsType')) })
                    discoveryMethod = 'search_result'
                    confidenceScore = [int][Math]::Round($candidateScore)
                    confidenceBand = Get-ResolverConfidenceBand -Score $candidateScore
                    evidenceSummary = 'ATS signature discovered from company-site search result'
                    matchedSignatures = @((Get-ObjectValue -Object $detection -Name 'matchedSignatures') + @('search_result') | Where-Object { $_ } | Select-Object -Unique)
                    attemptedUrls = @($attemptedUrls.ToArray())
                    httpSummary = @($httpSummary.ToArray())
                    redirectTarget = $finalUrl
                }

                if (-not $best -or [double](Convert-ToNumber (Get-ObjectValue -Object $candidate -Name 'confidenceScore')) -gt [double](Convert-ToNumber (Get-ObjectValue -Object $best -Name 'confidenceScore'))) {
                    $best = $candidate
                }
            }

            if (-not $best -or ([string](Get-ObjectValue -Object $best -Name 'confidenceBand')) -ne 'high') {
                $followUpScore = Get-ResolverFollowUpCandidateScore -CandidateUrl $candidateUrl -FinalUrl $finalUrl -FinalDomain $finalDomain -KnownDomain $bestDomain -PageTitle ([string](Get-ObjectValue -Object $response -Name 'title' -Default ''))
                if ($followUpScore -gt $bestFollowUpScore) {
                    $bestFollowUpScore = $followUpScore
                    $bestFollowUpTarget = [ordered]@{
                        domain = [string]$(if ($bestDomain) { $bestDomain } else { $finalDomain })
                        careersUrl = [string]$(if ($bestCareersUrl) { $bestCareersUrl } elseif ($finalUrl) { $finalUrl } else { $candidateUrl })
                    }
                }
            }

            if ($best -and ([string](Get-ObjectValue -Object $best -Name 'confidenceBand')) -eq 'high') {
                break
            }
        }

        if ($bestFollowUpTarget -and (-not $best -or ([string](Get-ObjectValue -Object $best -Name 'confidenceBand')) -ne 'high')) {
            $careersFollowUpStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            $careersCandidate = Resolve-CareersPageCandidate -Domain ([string](Get-ObjectValue -Object $bestFollowUpTarget -Name 'domain' -Default $bestDomain)) -CareersUrl ([string](Get-ObjectValue -Object $bestFollowUpTarget -Name 'careersUrl' -Default $bestCareersUrl)) -CandidateLimit 4 -TimeoutSec 4
            $careersFollowUpStopwatch.Stop()
            $careersFollowUpMs = [int]$careersFollowUpStopwatch.ElapsedMilliseconds
            $careersFollowUpCount = 1
            foreach ($attempt in @((Get-ObjectValue -Object $careersCandidate -Name 'httpSummary'))) { [void]$httpSummary.Add($attempt) }
            foreach ($attemptedUrl in @((Get-ObjectValue -Object $careersCandidate -Name 'attemptedUrls'))) { [void]$attemptedUrls.Add([string]$attemptedUrl) }
            if ([string](Get-ObjectValue -Object $careersCandidate -Name 'atsType')) {
                $careersCandidate.discoveryMethod = 'search_result'
                $careersCandidate.evidenceSummary = 'Careers page discovered from company-site search results'
                $careersCandidate.attemptedUrls = @($attemptedUrls.ToArray())
                $careersCandidate.httpSummary = @($httpSummary.ToArray())
                if (-not $best -or [double](Convert-ToNumber (Get-ObjectValue -Object $careersCandidate -Name 'confidenceScore')) -gt [double](Convert-ToNumber (Get-ObjectValue -Object $best -Name 'confidenceScore'))) {
                    $best = $careersCandidate
                }
            }
        }
    }

    $resolveStopwatch.Stop()
    Write-PipelineDiag -Stage 'search_result_resolve' -Company $CompanyName -Message 'Resolved ATS candidate from company-site search results' -Data @{
        candidateCount = [int]$candidateUrls.Count
        contentProbeCount = [int]$contentProbeCount
        careersFollowUpCount = [int]$careersFollowUpCount
        directPhaseMs = [int]$directPhaseMs
        contentProbeMs = [int]$contentProbeMs
        careersFollowUpMs = [int]$careersFollowUpMs
        elapsedMs = [int]$resolveStopwatch.ElapsedMilliseconds
        confidence = [string]$(if ($best) { Get-ObjectValue -Object $best -Name 'confidenceBand' -Default '' } else { '' })
        atsType = [string]$(if ($best) { Get-ObjectValue -Object $best -Name 'atsType' -Default '' } else { '' })
    }

    return [ordered]@{
        candidate = $best
        domain = $bestDomain
        careersUrl = $bestCareersUrl
        attemptedUrls = @($attemptedUrls.ToArray() | Where-Object { $_ } | Select-Object -Unique)
        httpSummary = @($httpSummary.ToArray())
    }
}

function Get-DiscoveryResultForConfig {
    param(
        [Parameter(Mandatory = $true)]
        $Company,
        [Parameter(Mandatory = $true)]
        $Config,
        [switch]$ForceRefresh,
        [switch]$DeepVerify
    )

    $discoveryStartTime = Get-Date
    $companyName = [string]$(if (Get-ObjectValue -Object $Company -Name 'displayName') { Get-ObjectValue -Object $Company -Name 'displayName' } else { Get-ObjectValue -Object $Config -Name 'companyName' })
    $identityInputs = Get-ResolverIdentityInputs -Company $Company -Config $Config
    $domain = [string](Get-ObjectValue -Object $identityInputs -Name 'domain' -Default '')
    $careersUrl = [string](Get-ObjectValue -Object $identityInputs -Name 'careersUrl' -Default '')
    $identitySource = [string](Get-ObjectValue -Object $identityInputs -Name 'identitySource' -Default 'none')
    $aliases = @(Get-GeneratedCompanyAliases -CompanyName $companyName -Domain $domain -ExistingAliases @(Get-ObjectValue -Object $Company -Name 'aliases' -Default @()))
    $linkedinCompanySlug = [string](Get-ObjectValue -Object $Company -Name 'linkedinCompanySlug')
    $resolvedDomain = $domain
    $resolvedCareersUrl = $careersUrl
    $attemptedUrls = New-Object System.Collections.ArrayList
    $httpSummary = New-Object System.Collections.ArrayList
    $discoveryPlan = Get-DiscoverySearchPlan -Company $Company -Config $Config -ForceRefresh:$ForceRefresh -DeepVerify:$DeepVerify
    $slugProbeCount = 0
    $searchMs = 0
    $careersPageMs = 0
    $candidateCount = 0

    Write-PipelineDiag -Stage 'discovery_start' -Company $companyName -Message 'Beginning ATS discovery' -Data @{
        domain = $domain
        careersUrl = $careersUrl
        aliasCount = $aliases.Count
        deepVerify = [bool]$DeepVerify
        searchTier = [string]$discoveryPlan.tier
        searchReason = [string]$discoveryPlan.reason
        slugCandidateLimit = [int]$discoveryPlan.slugCandidateLimit
        identitySource = $identitySource
    }

    try {
        if (-not $companyName -and -not $resolvedDomain -and -not $resolvedCareersUrl) {
            Write-PipelineDiag -Stage 'discovery_skip' -Company $companyName -Message 'Missing all inputs — skipping'
            return [ordered]@{
                atsType = ''
                boardId = ''
                domain = ''
                careersUrl = ''
                resolvedBoardUrl = ''
                source = ''
                notes = 'Missing company, domain, and careers URL inputs'
                active = $false
                supportedImport = $false
                discoveryStatus = 'missing_inputs'
                discoveryMethod = 'missing_inputs'
                confidenceScore = 0
                confidenceBand = 'unresolved'
                evidenceSummary = ''
                reviewStatus = 'pending'
                failureReason = 'Missing company domain and careers URL'
                redirectTarget = ''
                matchedSignatures = @()
                attemptedUrls = @()
                httpSummary = @()
            }
        }

        $knownTemplate = $null
        foreach ($candidate in @(Get-DiscoveryCandidateSlugs -CompanyName $companyName -Domain $domain -CareersUrl $careersUrl -Aliases $aliases -LinkedinCompanySlug $linkedinCompanySlug)) {
            $templateMap = Get-BoardConfigTemplateMap
            if ($templateMap.ContainsKey([string]$candidate.slug)) {
                $knownTemplate = $templateMap[[string]$candidate.slug]
                break
            }
        }
        if ($knownTemplate) {
            Write-PipelineDiag -Stage 'discovery_known_map' -Company $companyName -Message 'Matched known template map' -Data @{ atsType = [string]$knownTemplate.atsType; boardId = [string]$knownTemplate.boardId }
            $knownAtsType = [string]$knownTemplate.atsType
            $knownBoardId = [string]$knownTemplate.boardId
            $supportedImport = [bool]$(if (Test-ObjectHasKey -Object $knownTemplate -Name 'supportedImport') { Get-ObjectValue -Object $knownTemplate -Name 'supportedImport' } else { Test-ImportCapableAtsType -AtsType $knownAtsType })
            $resolvedBoardUrl = [string]$(if (Get-ObjectValue -Object $knownTemplate -Name 'resolvedBoardUrl') { Get-ObjectValue -Object $knownTemplate -Name 'resolvedBoardUrl' } else { Get-ResolvedBoardUrl -AtsType $knownAtsType -BoardId $knownBoardId -FallbackUrl ([string]$(if ($knownTemplate.careersUrl) { $knownTemplate.careersUrl } else { $careersUrl })) })
            return [ordered]@{
                atsType = $knownAtsType
                boardId = $knownBoardId
                domain = [string]$(if ($knownTemplate.domain) { $knownTemplate.domain } else { $resolvedDomain })
                careersUrl = [string]$(if ($knownTemplate.careersUrl) { $knownTemplate.careersUrl } else { $resolvedCareersUrl })
                resolvedBoardUrl = $resolvedBoardUrl
                source = [string]$knownTemplate.source
                notes = 'Matched from known mapping'
                active = [bool]($supportedImport -and $(if (Test-ObjectHasKey -Object $knownTemplate -Name 'active') { $knownTemplate.active } else { $true }))
                supportedImport = $supportedImport
                discoveryStatus = 'mapped'
                discoveryMethod = [string]$(if ($knownTemplate.discoveryMethod) { $knownTemplate.discoveryMethod } else { 'known_map' })
                confidenceScore = 100
                confidenceBand = 'high'
                evidenceSummary = 'Explicit known mapping'
                reviewStatus = 'auto'
                failureReason = ''
                redirectTarget = ''
                matchedSignatures = @('known_mapping')
                attemptedUrls = @()
                httpSummary = @()
            }
        }

        $bestCandidate = $null
        $inferred = Get-AtsInferenceFromCareersUrl -CareersUrl $careersUrl
        $inferredAtsType = [string]$(if ($inferred) { Get-ObjectValue -Object $inferred -Name 'atsType' } else { '' })
        $inferredBoardId = [string]$(if ($inferred) { Get-ObjectValue -Object $inferred -Name 'boardId' } else { '' })
        if ($inferred -and $inferredAtsType) {
            if ($inferredBoardId -and $inferredAtsType -in @('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'jobvite')) {
                $verified = Test-SupportedBoardCandidate -AtsType $inferredAtsType -Slug $inferredBoardId -Method 'careers_url'
                $verifiedAtsType = [string]$(if ($verified) { Get-ObjectValue -Object $verified -Name 'atsType' } else { '' })
                if ($verified -and $verifiedAtsType) {
                    $bestCandidate = $verified
                    $bestCandidate.domain = if ($resolvedDomain) { $resolvedDomain } else { $verified.domain }
                    $bestCandidate.careersUrl = if ($resolvedCareersUrl) { $resolvedCareersUrl } else { $verified.careersUrl }
                    $bestCandidate.evidenceSummary = 'Careers URL matched a hosted ATS board and the public endpoint responded'
                } elseif ($verified -and (Test-ObjectHasKey -Object $verified -Name 'httpSummary')) {
                    foreach ($attempt in @((Get-ObjectValue -Object $verified -Name 'httpSummary'))) { [void]$httpSummary.Add($attempt) }
                    foreach ($attemptedUrl in @((Get-ObjectValue -Object $verified -Name 'attemptedUrls'))) { [void]$attemptedUrls.Add([string]$attemptedUrl) }
                }
            }
            if (-not $bestCandidate) {
                $bestCandidate = $inferred
            }
        }

        $slugCandidates = @((Get-DiscoveryCandidateSlugs -CompanyName $companyName -Domain $domain -CareersUrl $careersUrl -Aliases $aliases -LinkedinCompanySlug $linkedinCompanySlug) | Select-Object -First ([int]$discoveryPlan.slugCandidateLimit))
        $candidateCount = $slugCandidates.Count
        foreach ($candidate in @($slugCandidates)) {
            foreach ($atsType in @($discoveryPlan.atsProbeTypes)) {
                $slugProbeCount += 1
                $probe = Test-SupportedBoardCandidate -AtsType $atsType -Slug ([string]$candidate.slug) -Method ([string]$candidate.method)
                if (-not $probe) {
                    continue
                }

                foreach ($attempt in @((Get-ObjectValue -Object $probe -Name 'httpSummary'))) { [void]$httpSummary.Add($attempt) }
                foreach ($attemptedUrl in @((Get-ObjectValue -Object $probe -Name 'attemptedUrls'))) { [void]$attemptedUrls.Add([string]$attemptedUrl) }

                $probeAtsType = [string](Get-ObjectValue -Object $probe -Name 'atsType')
                if (-not $probeAtsType) {
                    continue
                }

                $candidateSignalScore = [int](Convert-ToNumber (Get-ObjectValue -Object $candidate -Name 'signalScore' -Default 0))
                $candidateSignalBand = [string](Get-ObjectValue -Object $candidate -Name 'signalBand' -Default 'weak')
                $probeConfidenceScore = [int](Convert-ToNumber (Get-ObjectValue -Object $probe -Name 'confidenceScore' -Default 0))
                if (-not $resolvedDomain -and -not $resolvedCareersUrl -and $candidateSignalScore -lt 70) {
                    $probeConfidenceScore = [Math]::Min($probeConfidenceScore, 78)
                }
                if ($candidateSignalBand -eq 'weak') {
                    $probeConfidenceScore = [Math]::Min($probeConfidenceScore, 64)
                }
                $probe.confidenceScore = $probeConfidenceScore
                $probe.confidenceBand = Get-ResolverConfidenceBand -Score ([double]$probeConfidenceScore)

                $probe.domain = if ($resolvedDomain) { $resolvedDomain } else { $probe.domain }
                $probe.careersUrl = if ($resolvedCareersUrl) { $resolvedCareersUrl } else { $probe.careersUrl }
                $probe.evidenceSummary = ("Resolved using {0} slug '{1}' ({2})" -f [string]$candidate.method, [string]$candidate.slug, $candidateSignalBand)
                if (-not $bestCandidate -or [double](Convert-ToNumber (Get-ObjectValue -Object $probe -Name 'confidenceScore')) -gt [double](Convert-ToNumber (Get-ObjectValue -Object $bestCandidate -Name 'confidenceScore'))) {
                    $bestCandidate = $probe
                }
            }

            if ($bestCandidate -and ([string](Get-ObjectValue -Object $bestCandidate -Name 'confidenceBand')) -eq 'high') {
                break
            }
        }

        if (-not ($bestCandidate -and ([string](Get-ObjectValue -Object $bestCandidate -Name 'confidenceBand')) -eq 'high')) {
            $searchStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            $searchFallback = Resolve-SearchResultCandidate -CompanyName $companyName -Domain $resolvedDomain -CareersUrl $resolvedCareersUrl -Aliases $aliases -MaxResults ([int]$discoveryPlan.maxResults) -MaxSeeds ([int]$discoveryPlan.maxSeeds) -QueryTimeoutSec ([int]$discoveryPlan.queryTimeoutSec) -AllowOfficialSiteFallback ([bool]$discoveryPlan.allowOfficialSiteFallback)
            $searchStopwatch.Stop()
            $searchMs = [int]$searchStopwatch.ElapsedMilliseconds
            foreach ($attempt in @((Get-ObjectValue -Object $searchFallback -Name 'httpSummary'))) { [void]$httpSummary.Add($attempt) }
            foreach ($attemptedUrl in @((Get-ObjectValue -Object $searchFallback -Name 'attemptedUrls'))) { [void]$attemptedUrls.Add([string]$attemptedUrl) }
            if (Get-ObjectValue -Object $searchFallback -Name 'domain') {
                $resolvedDomain = [string](Get-ObjectValue -Object $searchFallback -Name 'domain')
            }
            if (Get-ObjectValue -Object $searchFallback -Name 'careersUrl') {
                $resolvedCareersUrl = [string](Get-ObjectValue -Object $searchFallback -Name 'careersUrl')
            }

            $searchCandidate = Get-ObjectValue -Object $searchFallback -Name 'candidate'
            if ($searchCandidate -and (-not $bestCandidate -or [double](Convert-ToNumber (Get-ObjectValue -Object $searchCandidate -Name 'confidenceScore')) -gt [double](Convert-ToNumber (Get-ObjectValue -Object $bestCandidate -Name 'confidenceScore')))) {
                $bestCandidate = $searchCandidate
            }
        }

        if (-not ($bestCandidate -and ([string](Get-ObjectValue -Object $bestCandidate -Name 'confidenceBand')) -eq 'high')) {
            $careersPageStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            $careersPageCandidate = Resolve-CareersPageCandidate -Domain $resolvedDomain -CareersUrl $resolvedCareersUrl -CandidateLimit ([int]$discoveryPlan.discoveryCareersCandidateLimit) -TimeoutSec ([int]$discoveryPlan.discoveryCareersTimeoutSec)
            $careersPageStopwatch.Stop()
            $careersPageMs = [int]$careersPageStopwatch.ElapsedMilliseconds
            foreach ($attempt in @((Get-ObjectValue -Object $careersPageCandidate -Name 'httpSummary'))) { [void]$httpSummary.Add($attempt) }
            foreach ($attemptedUrl in @((Get-ObjectValue -Object $careersPageCandidate -Name 'attemptedUrls'))) { [void]$attemptedUrls.Add([string]$attemptedUrl) }
            $careersPageAtsType = [string](Get-ObjectValue -Object $careersPageCandidate -Name 'atsType')
            if ($careersPageAtsType -and (-not $bestCandidate -or [double](Convert-ToNumber (Get-ObjectValue -Object $careersPageCandidate -Name 'confidenceScore')) -gt [double](Convert-ToNumber (Get-ObjectValue -Object $bestCandidate -Name 'confidenceScore')))) {
                $bestCandidate = $careersPageCandidate
            }
        }

        if ($bestCandidate) {
            $bestCandidateAtsType = [string](Get-ObjectValue -Object $bestCandidate -Name 'atsType')
            $bestCandidateBoardId = [string](Get-ObjectValue -Object $bestCandidate -Name 'boardId')
            $bestCandidateResolvedBoardUrl = [string](Get-ObjectValue -Object $bestCandidate -Name 'resolvedBoardUrl')
            $bestCandidateConfidenceScore = [double](Convert-ToNumber (Get-ObjectValue -Object $bestCandidate -Name 'confidenceScore'))
            $confidenceBand = Get-ResolverConfidenceBand -Score $bestCandidateConfidenceScore
            $supportedImport = [bool]$(if (Test-ObjectHasKey -Object $bestCandidate -Name 'supportedImport') { Get-ObjectValue -Object $bestCandidate -Name 'supportedImport' } else { Test-ImportCapableAtsType -AtsType $bestCandidateAtsType })
            $discoveryElapsed = ((Get-Date) - $discoveryStartTime).TotalMilliseconds
            Write-PipelineDiag -Stage 'discovery_resolved' -Company $companyName -Message 'ATS resolved' -Data @{
                atsType = $bestCandidateAtsType; boardId = $bestCandidateBoardId; confidence = $bestCandidateConfidenceScore
                band = $confidenceBand; method = [string](Get-ObjectValue -Object $bestCandidate -Name 'discoveryMethod')
                urlsAttempted = $attemptedUrls.Count; elapsedMs = [int]$discoveryElapsed
                candidateCount = [int]$candidateCount
                slugProbeCount = [int]$slugProbeCount
                searchMs = [int]$searchMs
                careersPageMs = [int]$careersPageMs
                deepVerify = [bool]$DeepVerify
                searchReason = [string]$discoveryPlan.reason
                identitySource = $identitySource
            }
            return [ordered]@{
                atsType = $bestCandidateAtsType
                boardId = $bestCandidateBoardId
                domain = [string]$(if (Get-ObjectValue -Object $bestCandidate -Name 'domain') { Get-ObjectValue -Object $bestCandidate -Name 'domain' } else { $resolvedDomain })
                careersUrl = [string]$(if (Get-ObjectValue -Object $bestCandidate -Name 'careersUrl') { Get-ObjectValue -Object $bestCandidate -Name 'careersUrl' } else { $resolvedCareersUrl })
                resolvedBoardUrl = [string]$(if ($bestCandidateResolvedBoardUrl) { $bestCandidateResolvedBoardUrl } else { Get-ResolvedBoardUrl -AtsType $bestCandidateAtsType -BoardId $bestCandidateBoardId -FallbackUrl ([string]$resolvedCareersUrl) })
                source = [string](Get-ObjectValue -Object $bestCandidate -Name 'source')
                notes = [string](Get-ObjectValue -Object $bestCandidate -Name 'evidenceSummary')
                active = [bool]($supportedImport -and $confidenceBand -eq 'high')
                supportedImport = $supportedImport
                discoveryStatus = 'discovered'
                discoveryMethod = [string]$(if (Get-ObjectValue -Object $bestCandidate -Name 'discoveryMethod') { Get-ObjectValue -Object $bestCandidate -Name 'discoveryMethod' } else { 'candidate_probe' })
                confidenceScore = $bestCandidateConfidenceScore
                confidenceBand = $confidenceBand
                evidenceSummary = [string](Get-ObjectValue -Object $bestCandidate -Name 'evidenceSummary')
                reviewStatus = if ($confidenceBand -eq 'high') { 'auto' } else { 'pending' }
                failureReason = ''
                redirectTarget = [string](Get-ObjectValue -Object $bestCandidate -Name 'redirectTarget')
                matchedSignatures = @((Get-ObjectValue -Object $bestCandidate -Name 'matchedSignatures') | Where-Object { $_ } | Select-Object -Unique)
                attemptedUrls = @($attemptedUrls.ToArray() | Where-Object { $_ } | Select-Object -Unique)
                httpSummary = @($httpSummary.ToArray())
            }
        }

        $failReason = if (-not $resolvedDomain -and -not $resolvedCareersUrl) { 'No domain' } elseif (-not $resolvedCareersUrl) { 'No careers page' } elseif ($resolvedCareersUrl -and -not $bestCandidate) { 'Custom careers site' } else { 'No ATS signature matched from probe attempts' }
        $discoveryElapsed = ((Get-Date) - $discoveryStartTime).TotalMilliseconds
        Write-PipelineDiag -Stage 'discovery_unresolved' -Company $companyName -Message "Unresolved: $failReason" -Data @{
            domain = $resolvedDomain; careersUrl = $resolvedCareersUrl; urlsAttempted = $attemptedUrls.Count
            elapsedMs = [int]$discoveryElapsed
            candidateCount = [int]$candidateCount
            slugProbeCount = [int]$slugProbeCount
            searchMs = [int]$searchMs
            careersPageMs = [int]$careersPageMs
            deepVerify = [bool]$DeepVerify
            searchReason = [string]$discoveryPlan.reason
            identitySource = $identitySource
        }
        return [ordered]@{
            atsType = ''
            boardId = ''
            domain = $resolvedDomain
            careersUrl = $resolvedCareersUrl
            resolvedBoardUrl = ''
            source = ''
            notes = if ($resolvedDomain -or $resolvedCareersUrl) { 'No ATS or hosted board signature found from enriched company identity inputs and candidate probes' } else { 'Missing domain or careers URL to probe' }
            active = $false
            supportedImport = $false
            discoveryStatus = if ($resolvedDomain -or $resolvedCareersUrl) { 'no_match_supported_ats' } else { 'missing_inputs' }
            discoveryMethod = 'candidate_probe'
            confidenceScore = 0
            confidenceBand = 'unresolved'
            evidenceSummary = ''
            reviewStatus = 'pending'
            failureReason = $failReason
            redirectTarget = ''
            matchedSignatures = @()
            attemptedUrls = @($attemptedUrls.ToArray() | Where-Object { $_ } | Select-Object -Unique)
            httpSummary = @($httpSummary.ToArray())
        }
    } catch {
        $discoveryErrorMsg = [string]$_.Exception.Message
        Write-PipelineDiag -Stage 'discovery_error' -Company $companyName -Message ('Exception: ' + $discoveryErrorMsg)
        return [ordered]@{
            atsType = ''
            boardId = ''
            domain = $resolvedDomain
            careersUrl = $resolvedCareersUrl
            resolvedBoardUrl = ''
            source = ''
            notes = [string]$_.Exception.Message
            active = $false
            supportedImport = $false
            discoveryStatus = 'error'
            discoveryMethod = 'candidate_probe'
            confidenceScore = 0
            confidenceBand = 'unresolved'
            evidenceSummary = ''
            reviewStatus = 'pending'
            failureReason = [string]$_.Exception.Message
            redirectTarget = ''
            matchedSignatures = @()
            attemptedUrls = @($attemptedUrls.ToArray() | Where-Object { $_ } | Select-Object -Unique)
            httpSummary = @($httpSummary.ToArray())
        }
    }
}

function Invoke-AtsDiscovery {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [int]$Limit = 75,
        [switch]$OnlyMissing,
        [switch]$SkipSync,
        [string]$ConfigId = '',
        [string[]]$ConfigIds = @(),
        [switch]$ForceRefresh,
        [switch]$DeepVerify,
        [switch]$SkipDerivedData,
        [scriptblock]$ProgressCallback
    )

    $startedAt = (Get-Date).ToString('o')
    if (-not $SkipSync) {
        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Preparing ATS discovery' -StartedAt $startedAt -Message 'Refreshing config candidates from companies'
        $State = Sync-BoardConfigsFromCompanies -State $State -ProgressCallback $ProgressCallback
    }

    $companyByKey = @{}
    foreach ($company in @($State.companies)) {
        $key = Get-CanonicalCompanyKey $(if ($company.normalizedName) { $company.normalizedName } else { $company.displayName })
        if ($key) {
            $companyByKey[$key] = $company
        }
    }

    $candidates = @(
        $State.boardConfigs |
            Sort-Object @(
                @{ Expression = { [double]$(if ($companyByKey.ContainsKey($_.normalizedCompanyName)) { $companyByKey[$_.normalizedCompanyName].dailyScore } else { 0 }) }; Descending = $true },
                @{ Expression = { [double]$(if ($companyByKey.ContainsKey($_.normalizedCompanyName)) { $companyByKey[$_.normalizedCompanyName].targetScore } else { 0 }) }; Descending = $true }
            )
    )

    if (@($ConfigIds).Count -gt 0) {
        $configIdSet = @{}
        foreach ($candidateConfigId in @($ConfigIds)) {
            if ($candidateConfigId) {
                $configIdSet[[string]$candidateConfigId] = $true
            }
        }
        $candidates = @($candidates | Where-Object { $configIdSet.ContainsKey([string]$_.id) })
    } elseif ($ConfigId) {
        $candidates = @($candidates | Where-Object { $_.id -eq $ConfigId })
    } elseif ($OnlyMissing) {
        $candidates = @($candidates | Where-Object {
                ([string](Get-ObjectValue -Object $_ -Name 'discoveryStatus' -Default '')) -notin @('mapped', 'discovered') -or
                ([string](Get-ObjectValue -Object $_ -Name 'confidenceBand' -Default '')).ToLowerInvariant() -in @('medium', 'low', 'unresolved')
            })
    }

    if (-not $ForceRefresh) {
        $now = Get-Date
        $candidates = @($candidates | Where-Object {
                $nextAttempt = [string](Get-ObjectValue -Object $_ -Name 'nextResolutionAttemptAt' -Default '')
                if (-not $nextAttempt) {
                    return $true
                }
                $parsed = [datetime]::MinValue
                if (-not [datetime]::TryParse($nextAttempt, [ref]$parsed)) {
                    return $true
                }
                return $parsed -le $now
            })
    }

    if ($Limit -gt 0 -and -not $ConfigId) {
        $candidates = @($candidates | Select-Object -First $Limit)
    }

    $totalCandidates = @($candidates).Count
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Running ATS discovery' -Processed 0 -Total $totalCandidates -StartedAt $startedAt -Message 'Resolving ATS and careers endpoints'

    $stats = [ordered]@{
        checked = 0
        mapped = 0
        discovered = 0
        noMatch = 0
        missingInputs = 0
        errors = 0
        highConfidence = 0
        mediumConfidence = 0
        lowConfidence = 0
        unresolved = 0
    }

    for ($index = 0; $index -lt $candidates.Count; $index++) {
        $config = $candidates[$index]
        if (([string](Get-ObjectValue -Object $config -Name 'discoveryMethod' -Default '')).ToLowerInvariant() -eq 'manual' -and -not $ForceRefresh) {
            continue
        }

        $configCompanyName = [string](Get-ObjectValue -Object $config -Name 'companyName' -Default '')
        $configNormalizedName = [string](Get-ObjectValue -Object $config -Name 'normalizedCompanyName' -Default '')
        if ($ProgressCallback) {
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Running ATS discovery' -Processed $index -Total $totalCandidates -StartedAt $startedAt -Message ("Resolving {0}" -f $configCompanyName)
        }

        $company = if ($configNormalizedName -and $companyByKey.ContainsKey($configNormalizedName)) { $companyByKey[$configNormalizedName] } else { [ordered]@{ displayName = $configCompanyName; domain = ''; careersUrl = '' } }
        $result = Get-DiscoveryResultForConfig -Company $company -Config $config -ForceRefresh:$ForceRefresh -DeepVerify:$DeepVerify
        $stats.checked += 1

        foreach ($field in 'atsType', 'boardId', 'domain', 'careersUrl', 'resolvedBoardUrl', 'source', 'notes', 'active', 'supportedImport', 'discoveryStatus', 'discoveryMethod', 'confidenceScore', 'confidenceBand', 'evidenceSummary', 'reviewStatus', 'failureReason', 'redirectTarget', 'matchedSignatures', 'attemptedUrls', 'httpSummary') {
            [void](Set-ObjectValue -Object $config -Name $field -Value $result[$field])
        }
        [void](Set-ObjectValue -Object $config -Name 'lastCheckedAt' -Value ((Get-Date).ToString('o')))
        [void](Set-ObjectValue -Object $config -Name 'lastResolutionAttemptAt' -Value (Get-ObjectValue -Object $config -Name 'lastCheckedAt'))
        [void](Set-ObjectValue -Object $config -Name 'nextResolutionAttemptAt' -Value (Get-ResolverNextAttemptAt -DiscoveryStatus ([string]$result.discoveryStatus) -ConfidenceBand ([string]$result.confidenceBand)))

        switch ([string]$result.discoveryStatus) {
            'mapped' { $stats.mapped += 1 }
            'discovered' { $stats.discovered += 1 }
            'missing_inputs' { $stats.missingInputs += 1 }
            'error' { $stats.errors += 1 }
            default { $stats.noMatch += 1 }
        }

        switch ([string]$result.confidenceBand) {
            'high' { $stats.highConfidence += 1 }
            'medium' { $stats.mediumConfidence += 1 }
            'low' { $stats.lowConfidence += 1 }
            default { $stats.unresolved += 1 }
        }

        $processed = $index + 1
        if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $totalCandidates -or ($processed % 5) -eq 0)) {
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Running ATS discovery' -Processed $processed -Total $totalCandidates -StartedAt $startedAt -Message 'Resolving ATS and careers endpoints'
        }
    }

    if (-not $SkipDerivedData) {
        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Finalizing ATS discovery' -Processed $stats.checked -Total $totalCandidates -StartedAt $startedAt -Message 'Refreshing derived account scores'
        $State = Update-DerivedData -State $State -ProgressCallback $ProgressCallback
    } elseif ($ProgressCallback) {
        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Finalizing ATS discovery' -Processed $stats.checked -Total $totalCandidates -StartedAt $startedAt -Message 'Persisting ATS discovery results'
    }
    return [ordered]@{
        state = $State
        stats = $stats
        changedConfigs = @($candidates)
    }
}

function Sync-BoardConfigsFromCompanies {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [scriptblock]$ProgressCallback,
        [int]$ProgressInterval = 150
    )

    $startedAt = (Get-Date).ToString('o')
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Preparing config sync' -StartedAt $startedAt -Message 'Indexing existing configs and company keys'

    $existingByCompany = @{}
    $companyKeySet = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($company in @($State.companies)) {
        $companyKey = Get-CanonicalCompanyKey $(if ($company.normalizedName) { $company.normalizedName } else { $company.displayName })
        if ($companyKey) {
            [void]$companyKeySet.Add($companyKey)
        }
    }

    foreach ($config in @($State.boardConfigs)) {
        $key = Get-CanonicalCompanyKey $(if ($config.normalizedCompanyName) { $config.normalizedCompanyName } else { $config.companyName })
        if (-not $key) {
            continue
        }
        [void](Set-ObjectValue -Object $config -Name 'normalizedCompanyName' -Value $key)
        if (-not $existingByCompany.ContainsKey($key)) {
            $existingByCompany[$key] = New-Object System.Collections.ArrayList
        }
        [void]$existingByCompany[$key].Add($config)
    }

    $mergedConfigs = New-Object System.Collections.ArrayList
    $companies = @($State.companies)
    $totalCompanies = @($companies).Count
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Syncing board configs' -Processed 0 -Total $totalCompanies -StartedAt $startedAt -Message 'Generating config records from target companies'
    for ($index = 0; $index -lt $companies.Count; $index++) {
        $company = $companies[$index]
        $generated = New-GeneratedBoardConfig -State $State -Company $company
        if (-not $generated) {
            continue
        }

        $key = $generated.normalizedCompanyName
        $existingItems = if ($existingByCompany.ContainsKey($key)) { @($existingByCompany[$key].ToArray()) } else { @() }
        $manualItems = @($existingItems | Where-Object { ([string](Get-ObjectValue -Object $_ -Name 'source' -Default '')).ToLowerInvariant() -eq 'manual' -or ([string](Get-ObjectValue -Object $_ -Name 'discoveryMethod' -Default '')).ToLowerInvariant() -eq 'manual' })

        if ($manualItems.Count -gt 0) {
            foreach ($item in $existingItems) {
                [void](Set-ObjectValue -Object $item -Name 'accountId' -Value $company.id)
                [void](Set-ObjectValue -Object $item -Name 'companyName' -Value $company.displayName)
                [void](Set-ObjectValue -Object $item -Name 'normalizedCompanyName' -Value $key)
                $itemDomain = [string](Get-ObjectValue -Object $item -Name 'domain')
                $itemLastCheckedAt = [string](Get-ObjectValue -Object $item -Name 'lastCheckedAt')
                $itemDiscoveryStatus = [string](Get-ObjectValue -Object $item -Name 'discoveryStatus')
                $itemDiscoveryMethod = [string](Get-ObjectValue -Object $item -Name 'discoveryMethod')

                if (-not $itemDomain) { [void](Set-ObjectValue -Object $item -Name 'domain' -Value (Get-ObjectValue -Object $generated -Name 'domain')) }
                if (-not $itemLastCheckedAt) { [void](Set-ObjectValue -Object $item -Name 'lastCheckedAt' -Value (Get-ObjectValue -Object $generated -Name 'lastCheckedAt')) }
                if (-not $itemDiscoveryStatus) { [void](Set-ObjectValue -Object $item -Name 'discoveryStatus' -Value 'manual') }
                if (-not $itemDiscoveryMethod) { [void](Set-ObjectValue -Object $item -Name 'discoveryMethod' -Value 'manual') }
                if (-not (Get-ObjectValue -Object $item -Name 'resolvedBoardUrl')) { [void](Set-ObjectValue -Object $item -Name 'resolvedBoardUrl' -Value (Get-ObjectValue -Object $generated -Name 'resolvedBoardUrl')) }
                if ($null -eq (Get-ObjectValue -Object $item -Name 'supportedImport' -Default $null)) { [void](Set-ObjectValue -Object $item -Name 'supportedImport' -Value (Test-ImportCapableAtsType -AtsType ([string](Get-ObjectValue -Object $item -Name 'atsType')))) }
                if (-not (Get-ObjectValue -Object $item -Name 'confidenceScore' -Default $null)) { [void](Set-ObjectValue -Object $item -Name 'confidenceScore' -Value 100) }
                if (-not (Get-ObjectValue -Object $item -Name 'confidenceBand')) { [void](Set-ObjectValue -Object $item -Name 'confidenceBand' -Value 'high') }
                if (-not (Get-ObjectValue -Object $item -Name 'evidenceSummary')) { [void](Set-ObjectValue -Object $item -Name 'evidenceSummary' -Value 'Manual ATS config preserved during sync') }
                if (-not (Get-ObjectValue -Object $item -Name 'reviewStatus')) { [void](Set-ObjectValue -Object $item -Name 'reviewStatus' -Value 'approved') }
                if ($null -eq (Get-ObjectValue -Object $item -Name 'matchedSignatures' -Default $null)) { [void](Set-ObjectValue -Object $item -Name 'matchedSignatures' -Value @('manual')) }
                if ($null -eq (Get-ObjectValue -Object $item -Name 'attemptedUrls' -Default $null)) { [void](Set-ObjectValue -Object $item -Name 'attemptedUrls' -Value @()) }
                if ($null -eq (Get-ObjectValue -Object $item -Name 'httpSummary' -Default $null)) { [void](Set-ObjectValue -Object $item -Name 'httpSummary' -Value @()) }
                [void]$mergedConfigs.Add($item)
            }
            continue
        }

        $primary = $existingItems | Select-Object -First 1
        if ($primary) {
            [void]$mergedConfigs.Add((Merge-BoardConfigRecord -Existing $primary -Generated $generated))
        } else {
            [void]$mergedConfigs.Add($generated)
        }

        foreach ($extra in @($existingItems | Select-Object -Skip 1)) {
            [void]$mergedConfigs.Add($extra)
        }

        $processed = $index + 1
        if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $totalCompanies -or ($ProgressInterval -gt 0 -and ($processed % $ProgressInterval) -eq 0))) {
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Syncing board configs' -Processed $processed -Total $totalCompanies -StartedAt $startedAt -Message 'Generating config records from target companies'
        }
    }

    foreach ($config in @($State.boardConfigs)) {
        $key = Get-CanonicalCompanyKey $(if ($config.normalizedCompanyName) { $config.normalizedCompanyName } else { $config.companyName })
        if ($key -and $companyKeySet.Contains($key)) {
            continue
        }
        [void]$mergedConfigs.Add($config)
    }

    $State.boardConfigs = @(
        $mergedConfigs |
            Sort-Object @(
                @{ Expression = { [string]$_.companyName }; Descending = $false },
                @{ Expression = { [string]$(if ($_.PSObject.Properties.Name -contains 'atsType') { $_.atsType } else { '' }) }; Descending = $false },
                @{ Expression = { [string]$(if ($_.PSObject.Properties.Name -contains 'boardId') { $_.boardId } else { '' }) }; Descending = $false }
            )
    )
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Syncing board configs' -Processed $totalCompanies -Total $totalCompanies -StartedAt $startedAt -Message 'Finished config sync'
    return $State
}

function Get-GreenhouseJobs {
    param($Config)

    $url = "https://boards-api.greenhouse.io/v1/boards/$([uri]::EscapeDataString([string]$Config.boardId))/jobs?content=true"
    $payload = Get-JsonFromUrl -Url $url
    $jobs = @(Get-TopLevelCollection -Payload $payload -PropertyNames @('jobs'))
    return @(
        foreach ($job in @($jobs)) {
            [ordered]@{
                jobId = [string]$job.id
                title = if ($job.title) { $job.title } else { '' }
                location = if ($job.location -and $job.location.name) { $job.location.name } else { '' }
                department = if ($job.departments) { (@($job.departments) | ForEach-Object { $_.name }) -join ', ' } else { '' }
                employmentType = [string](Get-NestedValue -Object $job -Paths @('metadata.workplace'))
                url = if ($job.absolute_url) { $job.absolute_url } else { '' }
                postedAt = if ($job.updated_at) { Convert-ToDateString $job.updated_at } else { (Get-Date).ToString('o') }
                sourceUrl = $url
                rawPayload = $job
            }
        }
    )
}

function Get-LeverJobs {
    param($Config)

    $url = "https://api.lever.co/v0/postings/$([uri]::EscapeDataString([string]$Config.boardId))?mode=json"
    $payload = Get-JsonFromUrl -Url $url
    return @(
        foreach ($job in @($payload)) {
            $location = [string](Get-NestedValue -Object $job -Paths @('categories.location', 'location'))
            $department = [string](Get-NestedValue -Object $job -Paths @('categories.team', 'team'))
            $employmentType = [string](Get-NestedValue -Object $job -Paths @('categories.commitment', 'categories.workplaceType', 'commitment'))
            [ordered]@{
                jobId = [string]$(Get-NestedValue -Object $job -Paths @('id', 'requisitionCode'))
                title = [string](Get-NestedValue -Object $job -Paths @('text', 'title'))
                location = $location
                department = $department
                employmentType = $employmentType
                url = [string](Get-NestedValue -Object $job -Paths @('hostedUrl', 'applyUrl', 'url'))
                postedAt = if (Get-NestedValue -Object $job -Paths @('createdAt')) { Convert-ToDateString ([datetimeoffset]::FromUnixTimeMilliseconds([int64](Get-NestedValue -Object $job -Paths @('createdAt'))).DateTime) } else { (Get-Date).ToString('o') }
                sourceUrl = $url
                rawPayload = $job
            }
        }
    )
}

function Get-AshbyJobs {
    param($Config)

    $boardId = $Config.boardId
    if (-not $boardId) {
        $boardId = Get-AshbyBoardIdFromCareersPage -CareersUrl $Config.careersUrl
    }
    if (-not $boardId) {
        return @()
    }

    $url = "https://api.ashbyhq.com/posting-api/job-board/$([uri]::EscapeDataString([string]$boardId))"
    $payload = Get-JsonFromUrl -Url $url
    $jobs = @(
        (Get-ObjectValue -Object $payload -Name 'jobs' -Default $null),
        $(if ($payload -is [System.Collections.IEnumerable] -and $payload -isnot [string]) { $payload } else { $null })
    )
    $jobItems = @()
    foreach ($candidateJobs in $jobs) {
        if ($null -eq $candidateJobs) {
            continue
        }

        $jobItems = @($candidateJobs)
        if ($jobItems.Count -gt 0) {
            break
        }
    }
    return @(
        foreach ($job in @($jobItems)) {
            [ordered]@{
                jobId = [string](Get-NestedValue -Object $job -Paths @('id', 'jobPostId'))
                title = [string](Get-NestedValue -Object $job -Paths @('title'))
                location = [string](Get-NestedValue -Object $job -Paths @('location'))
                department = [string](Get-NestedValue -Object $job -Paths @('departmentName', 'department'))
                employmentType = [string](Get-NestedValue -Object $job -Paths @('employmentType'))
                url = [string](Get-NestedValue -Object $job -Paths @('jobUrl'))
                postedAt = if (Get-NestedValue -Object $job -Paths @('publishedAt')) { Convert-ToDateString (Get-NestedValue -Object $job -Paths @('publishedAt')) } else { (Get-Date).ToString('o') }
                sourceUrl = $url
                rawPayload = $job
            }
        }
    )
}

function Get-SmartRecruitersJobs {
    param($Config)

    if (-not $Config.boardId) {
        return @()
    }

    $url = "https://api.smartrecruiters.com/v1/companies/$([uri]::EscapeDataString([string]$Config.boardId))/postings?limit=100"
    $payload = Get-JsonFromUrl -Url $url
    $jobs = @(
        (Get-ObjectValue -Object $payload -Name 'content' -Default $null),
        (Get-ObjectValue -Object $payload -Name 'postings' -Default $null),
        $(if ($payload -is [System.Collections.IEnumerable] -and $payload -isnot [string]) { $payload } else { $null })
    )
    $jobItems = @()
    foreach ($candidateJobs in $jobs) {
        if ($null -eq $candidateJobs) {
            continue
        }

        $jobItems = @($candidateJobs)
        if ($jobItems.Count -gt 0) {
            break
        }
    }
    return @(
        foreach ($job in @($jobItems)) {
            $locationParts = @(
                [string](Get-NestedValue -Object $job -Paths @('location.city'))
                [string](Get-NestedValue -Object $job -Paths @('location.region'))
                [string](Get-NestedValue -Object $job -Paths @('location.country'))
            ) | Where-Object { $_ }
            [ordered]@{
                jobId = [string](Get-NestedValue -Object $job -Paths @('id', 'ref'))
                title = [string](Get-NestedValue -Object $job -Paths @('name', 'title'))
                location = ($locationParts -join ', ')
                department = [string](Get-NestedValue -Object $job -Paths @('department.label', 'department.name', 'department'))
                employmentType = [string](Get-NestedValue -Object $job -Paths @('typeOfEmployment.label', 'typeOfEmployment.name', 'typeOfEmployment'))
                url = [string](Get-NestedValue -Object $job -Paths @('ref', 'applyUrl', 'jobAd.publicUrl'))
                postedAt = if (Get-NestedValue -Object $job -Paths @('releasedDate', 'createdOn')) { Convert-ToDateString (Get-NestedValue -Object $job -Paths @('releasedDate', 'createdOn')) } else { (Get-Date).ToString('o') }
                sourceUrl = $url
                rawPayload = $job
            }
        }
    )
}

function Convert-ToWorkdaySlug {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }

    return (($Value.ToLowerInvariant() -replace '[^a-z0-9]+', '').Trim())
}

function Get-WorkdaySiteSegmentFromUri {
    param([uri]$Uri)

    if ($null -eq $Uri) {
        return ''
    }

    $segments = @($Uri.AbsolutePath.Trim('/') -split '/' | Where-Object { $_ })
    if ($segments.Count -eq 0) {
        return ''
    }

    if ($segments.Count -ge 4 -and [string]$segments[0] -eq 'wday' -and [string]$segments[1] -eq 'cxs') {
        return [string]$segments[3]
    }

    if ($segments.Count -ge 2 -and [string]$segments[0] -match '^[a-z]{2}(?:-[A-Z]{2})?$') {
        return [string]$segments[1]
    }

    return [string]$segments[0]
}

function Get-WorkdayHostDescriptors {
    param($Config)

    $descriptors = New-Object System.Collections.ArrayList
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($candidateUrl in @(
            [string](Get-ConfiguredApiUrl -Config $Config),
            [string](Get-ObjectValue -Object $Config -Name 'resolvedBoardUrl' -Default ''),
            [string](Get-ObjectValue -Object $Config -Name 'careersUrl' -Default ''),
            [string](Get-ObjectValue -Object $Config -Name 'source' -Default '')
        )) {
        $normalizedCandidate = ([string]$candidateUrl).Trim()
        if (-not $normalizedCandidate) {
            continue
        }

        try {
            $uri = [uri]$normalizedCandidate
            if ($uri.Host -notmatch '^([^.]+)\.wd\d+\.myworkdayjobs\.com$') {
                continue
            }

            $tenant = [string]$matches[1]
            $descriptorKey = ('{0}://{1}|{2}' -f $uri.Scheme, $uri.Host, $tenant).ToLowerInvariant()
            if (-not $seen.Add($descriptorKey)) {
                continue
            }

            [void]$descriptors.Add([ordered]@{
                    baseUrl = ('{0}://{1}' -f $uri.Scheme, $uri.Host)
                    host = [string]$uri.Host
                    scheme = [string]$uri.Scheme
                    tenant = $tenant
                })
        } catch {
        }
    }

    return @($descriptors)
}

function Get-WorkdayDirectApiCandidateUrls {
    param($Config)

    $candidates = New-Object System.Collections.ArrayList
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'

    function Add-WorkdayApiCandidate {
        param([string]$Value)

        $normalized = ([string]$Value).Trim()
        if (-not $normalized) {
            return
        }

        $candidateKey = $normalized.ToLowerInvariant()
        if ($seen.Add($candidateKey)) {
            [void]$candidates.Add($normalized)
        }
    }

    foreach ($candidateUrl in @(
            [string](Get-ConfiguredApiUrl -Config $Config),
            [string](Get-ObjectValue -Object $Config -Name 'resolvedBoardUrl' -Default ''),
            [string](Get-ObjectValue -Object $Config -Name 'careersUrl' -Default ''),
            [string](Get-ObjectValue -Object $Config -Name 'source' -Default '')
        )) {
        $normalizedCandidate = ([string]$candidateUrl).Trim()
        if (-not $normalizedCandidate) {
            continue
        }

        if ($normalizedCandidate -match '(https?://[^/]+/wday/cxs/[^/]+/[^/?#]+)(?:/jobs)?') {
            Add-WorkdayApiCandidate -Value "$($matches[1])/jobs"
        }

        try {
            $uri = [uri]$normalizedCandidate
            if ($uri.Host -notmatch '^([^.]+)\.wd\d+\.myworkdayjobs\.com$') {
                continue
            }

            $tenant = [string]$matches[1]
            $siteSegment = Get-WorkdaySiteSegmentFromUri -Uri $uri
            if ($siteSegment) {
                Add-WorkdayApiCandidate -Value ('{0}://{1}/wday/cxs/{2}/{3}/jobs' -f $uri.Scheme, $uri.Host, [uri]::EscapeDataString($tenant), [uri]::EscapeDataString($siteSegment))
            }
        } catch {
        }
    }

    $slugInputs = @(
        [string](Get-ObjectValue -Object $Config -Name 'boardId' -Default ''),
        [string](Get-ObjectValue -Object $Config -Name 'normalizedCompanyName' -Default ''),
        [string](Get-ObjectValue -Object $Config -Name 'companyName' -Default '')
    )
    foreach ($hostDescriptor in @(Get-WorkdayHostDescriptors -Config $Config)) {
        foreach ($slugInput in $slugInputs) {
            $slug = Convert-ToWorkdaySlug -Value $slugInput
            if (-not $slug) {
                continue
            }

            foreach ($siteSegment in @(
                    $slug,
                    ('{0}careers' -f $slug),
                    ('{0}_careers' -f $slug),
                    ('{0}-careers' -f $slug)
                )) {
                Add-WorkdayApiCandidate -Value ('{0}/wday/cxs/{1}/{2}/jobs' -f $hostDescriptor.baseUrl, [uri]::EscapeDataString([string]$hostDescriptor.tenant), [uri]::EscapeDataString([string]$siteSegment))
            }
        }
    }

    return @($candidates)
}

function Resolve-WorkdayApiCandidateUrlsFromPages {
    param($Config)

    $candidateUrls = New-Object System.Collections.ArrayList
    $seenApi = New-Object 'System.Collections.Generic.HashSet[string]'
    $pageCandidates = New-Object System.Collections.ArrayList
    $seenPages = New-Object 'System.Collections.Generic.HashSet[string]'
    $resolutionStart = [System.Diagnostics.Stopwatch]::StartNew()

    function Add-WorkdayResolvedApiCandidate {
        param([string]$Value)

        $normalized = ([string]$Value).Trim()
        if (-not $normalized) {
            return
        }

        if ($seenApi.Add($normalized.ToLowerInvariant())) {
            [void]$candidateUrls.Add($normalized)
        }
    }

    function Add-WorkdayPageCandidate {
        param([string]$Value)

        $normalized = ([string]$Value).Trim()
        if (-not $normalized) {
            return
        }

        try {
            $normalized = ([uri]$normalized).GetLeftPart([System.UriPartial]::Path)
        } catch {
            return
        }

        if ($seenPages.Add($normalized.ToLowerInvariant())) {
            [void]$pageCandidates.Add($normalized)
        }
    }

    foreach ($candidateUrl in @(
            [string](Get-ConfiguredApiUrl -Config $Config),
            [string](Get-ObjectValue -Object $Config -Name 'resolvedBoardUrl' -Default ''),
            [string](Get-ObjectValue -Object $Config -Name 'careersUrl' -Default ''),
            [string](Get-ObjectValue -Object $Config -Name 'source' -Default '')
        )) {
        $normalizedCandidate = ([string]$candidateUrl).Trim()
        if (-not $normalizedCandidate) {
            continue
        }

        try {
            $uri = [uri]$normalizedCandidate
            if ($uri.Host -notmatch '^([^.]+)\.wd\d+\.myworkdayjobs\.com$') {
                continue
            }

            Add-WorkdayPageCandidate -Value $normalizedCandidate
            $siteSegment = Get-WorkdaySiteSegmentFromUri -Uri $uri
            if ($siteSegment) {
                Add-WorkdayPageCandidate -Value ('{0}://{1}/{2}' -f $uri.Scheme, $uri.Host, [uri]::EscapeDataString($siteSegment))
                Add-WorkdayPageCandidate -Value ('{0}://{1}/en-US/{2}' -f $uri.Scheme, $uri.Host, [uri]::EscapeDataString($siteSegment))
            }
        } catch {
        }
    }

    $slugInputs = @(
        [string](Get-ObjectValue -Object $Config -Name 'boardId' -Default ''),
        [string](Get-ObjectValue -Object $Config -Name 'normalizedCompanyName' -Default ''),
        [string](Get-ObjectValue -Object $Config -Name 'companyName' -Default '')
    )
    foreach ($hostDescriptor in @(Get-WorkdayHostDescriptors -Config $Config)) {
        foreach ($slugInput in $slugInputs) {
            $slug = Convert-ToWorkdaySlug -Value $slugInput
            if (-not $slug) {
                continue
            }

            foreach ($siteSegment in @(
                    $slug,
                    ('{0}careers' -f $slug),
                    ('{0}_careers' -f $slug),
                    ('{0}-careers' -f $slug)
                )) {
                Add-WorkdayPageCandidate -Value ('{0}/{1}' -f $hostDescriptor.baseUrl, $siteSegment)
                Add-WorkdayPageCandidate -Value ('{0}/en-US/{1}' -f $hostDescriptor.baseUrl, $siteSegment)
            }
        }
    }

    foreach ($pageUrl in @($pageCandidates)) {
        $response = Invoke-ResolverProbeRequest -Url $pageUrl
        if (-not (Get-ObjectValue -Object $response -Name 'ok' -Default $false)) {
            continue
        }

        $content = [string](Get-ObjectValue -Object $response -Name 'content' -Default '')
        if (-not $content) {
            continue
        }

        try {
            $pageUri = [uri]$pageUrl
            if ($content -match '/wday/drs/outage\?t=([^&"''<>\s]+)&s=([^&"''<>\s]+)') {
                $tenant = [uri]::UnescapeDataString([string]$matches[1])
                $siteSegment = [uri]::UnescapeDataString([string]$matches[2])
                Add-WorkdayResolvedApiCandidate -Value ('{0}://{1}/wday/cxs/{2}/{3}/jobs' -f $pageUri.Scheme, $pageUri.Host, [uri]::EscapeDataString($tenant), [uri]::EscapeDataString($siteSegment))
                continue
            }

            if ($content -match '/wday/cxs/([^/\"''<>\s]+)/([^/\"''<>\s]+)/jobs') {
                $tenant = [uri]::UnescapeDataString([string]$matches[1])
                $siteSegment = [uri]::UnescapeDataString([string]$matches[2])
                Add-WorkdayResolvedApiCandidate -Value ('{0}://{1}/wday/cxs/{2}/{3}/jobs' -f $pageUri.Scheme, $pageUri.Host, [uri]::EscapeDataString($tenant), [uri]::EscapeDataString($siteSegment))
            }
        } catch {
        }
    }

    $resolutionStart.Stop()
    Write-PipelineDiag -Stage 'workday_page_resolve' -Company ([string](Get-ObjectValue -Object $Config -Name 'companyName' -Default '')) -Message 'Resolved Workday API candidates from board pages' -Data @{
        pageCandidateCount = @($pageCandidates).Count
        apiCandidateCount = @($candidateUrls).Count
        elapsedMs = [int]$resolutionStart.Elapsed.TotalMilliseconds
    }
    return @($candidateUrls)
}

function Get-WorkdayApiCandidateUrls {
    param(
        $Config,
        [switch]$IncludePageResolution
    )

    $resolutionStart = [System.Diagnostics.Stopwatch]::StartNew()
    $candidateUrls = New-Object System.Collections.ArrayList
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'

    foreach ($candidateUrl in @(Get-WorkdayDirectApiCandidateUrls -Config $Config)) {
        $normalized = ([string]$candidateUrl).Trim()
        if ($normalized -and $seen.Add($normalized.ToLowerInvariant())) {
            [void]$candidateUrls.Add($normalized)
        }
    }

    if ($IncludePageResolution) {
        foreach ($candidateUrl in @(Resolve-WorkdayApiCandidateUrlsFromPages -Config $Config)) {
            $normalized = ([string]$candidateUrl).Trim()
            if ($normalized -and $seen.Add($normalized.ToLowerInvariant())) {
                [void]$candidateUrls.Add($normalized)
            }
        }
    }

    $resolutionStart.Stop()
    Write-PipelineDiag -Stage 'workday_candidates' -Company ([string](Get-ObjectValue -Object $Config -Name 'companyName' -Default '')) -Message 'Resolved Workday API candidate list' -Data @{
        directCandidateCount = @((Get-WorkdayDirectApiCandidateUrls -Config $Config)).Count
        includePageResolution = [bool]$IncludePageResolution
        totalCandidateCount = @($candidateUrls).Count
        elapsedMs = [int]$resolutionStart.Elapsed.TotalMilliseconds
    }
    return @($candidateUrls)
}

function Get-WorkdayApiUrl {
    param($Config)

    foreach ($candidateUrl in @(Get-WorkdayApiCandidateUrls -Config $Config -IncludePageResolution)) {
        return [string]$candidateUrl
    }

    return ''
}

function Get-WorkdayJobCollection {
    param($Payload)

    foreach ($candidateJobs in @(
            (Get-NestedValue -Object $Payload -Paths @('jobPostings')),
            (Get-NestedValue -Object $Payload -Paths @('jobPostingInfo')),
            (Get-NestedValue -Object $Payload -Paths @('listItems')),
            (Get-NestedValue -Object $Payload -Paths @('jobs')),
            $(if ($Payload -is [System.Collections.IEnumerable] -and $Payload -isnot [string]) { $Payload } else { $null })
        )) {
        if ($null -eq $candidateJobs) {
            continue
        }

        $jobs = @($candidateJobs)
        if ($jobs.Count -gt 0) {
            return $jobs
        }
    }

    return @()
}

function Invoke-WorkdayPageRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$Offset = 0,
        [int]$PageLimit = 20,
        [int]$TimeoutSec = 45
    )

    $headers = @{
        'Content-Type' = 'application/json'
        'Accept' = 'application/json'
    }
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $result = [ordered]@{
        ok = $false
        offset = $Offset
        jobs = @()
        reportedTotal = 0
        elapsedMs = 0
        error = ''
    }

    try {
        $body = @{
            appliedFacets = @{}
            limit = $PageLimit
            offset = $Offset
            searchText = ''
        } | ConvertTo-Json -Depth 6 -Compress
        $payload = Invoke-RestMethod -Uri $Url -Method Post -Headers $headers -Body $body -TimeoutSec $TimeoutSec
        $pageJobs = @(Get-WorkdayJobCollection -Payload $payload)
        $totalValue = Get-ObjectValue -Object $payload -Name 'total' -Default $null
        $parsedTotal = 0
        if ($null -ne $totalValue) {
            [void][int]::TryParse([string]$totalValue, [ref]$parsedTotal)
        }

        $result.ok = $true
        $result.jobs = @($pageJobs)
        $result.reportedTotal = $parsedTotal
    } catch {
        $result.error = [string]$_.Exception.Message
    } finally {
        $stopwatch.Stop()
        $result.elapsedMs = [int]$stopwatch.Elapsed.TotalMilliseconds
    }

    return [pscustomobject]$result
}

function Invoke-WorkdayPageRequestsParallel {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int[]]$Offsets,
        [int]$PageLimit = 20,
        [int]$TimeoutSec = 45
    )

    $normalizedOffsets = @($Offsets | Where-Object { $_ -ge 0 } | Sort-Object -Unique)
    if ($normalizedOffsets.Count -eq 0) {
        return @()
    }

    $pageScript = {
        param(
            [string]$Url,
            [int]$Offset,
            [int]$PageLimit,
            [int]$TimeoutSec
        )

        $headers = @{
            'Content-Type' = 'application/json'
            'Accept' = 'application/json'
        }
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $result = [ordered]@{
            ok = $false
            offset = $Offset
            jobs = @()
            reportedTotal = 0
            elapsedMs = 0
            error = ''
        }

        try {
            $body = @{
                appliedFacets = @{}
                limit = $PageLimit
                offset = $Offset
                searchText = ''
            } | ConvertTo-Json -Depth 6 -Compress
            $payload = Invoke-RestMethod -Uri $Url -Method Post -Headers $headers -Body $body -TimeoutSec $TimeoutSec
            $pageJobs = @()
            foreach ($candidateJobs in @(
                    $(if ($payload.PSObject.Properties.Name -contains 'jobPostings') { $payload.jobPostings } else { $null }),
                    $(if ($payload.PSObject.Properties.Name -contains 'jobPostingInfo') { $payload.jobPostingInfo } else { $null }),
                    $(if ($payload.PSObject.Properties.Name -contains 'listItems') { $payload.listItems } else { $null }),
                    $(if ($payload.PSObject.Properties.Name -contains 'jobs') { $payload.jobs } else { $null }),
                    $(if ($payload -is [System.Collections.IEnumerable] -and $payload -isnot [string]) { $payload } else { $null })
                )) {
                if ($null -eq $candidateJobs) {
                    continue
                }

                $pageJobs = @($candidateJobs)
                if ($pageJobs.Count -gt 0) {
                    break
                }
            }

            $parsedTotal = 0
            if ($payload.PSObject.Properties.Name -contains 'total') {
                [void][int]::TryParse([string]$payload.total, [ref]$parsedTotal)
            }

            $result.ok = $true
            $result.jobs = @($pageJobs)
            $result.reportedTotal = $parsedTotal
        } catch {
            $result.error = [string]$_.Exception.Message
        } finally {
            $stopwatch.Stop()
            $result.elapsedMs = [int]$stopwatch.Elapsed.TotalMilliseconds
        }

        return [pscustomobject]$result
    }

    $results = New-Object System.Collections.ArrayList
    $batchSize = 60
    for ($batchStart = 0; $batchStart -lt $normalizedOffsets.Count; $batchStart += $batchSize) {
        $offsetBatch = @($normalizedOffsets | Select-Object -Skip $batchStart -First $batchSize)
        $pool = $null
        $pending = New-Object System.Collections.ArrayList
        try {
            $maxThreads = [Math]::Min([Math]::Max($offsetBatch.Count, 1), 6)
            $pool = [RunspaceFactory]::CreateRunspacePool(1, $maxThreads)
            $pool.Open()

            foreach ($offset in @($offsetBatch)) {
                $powershell = [PowerShell]::Create()
                $powershell.RunspacePool = $pool
                [void]$powershell.AddScript($pageScript).AddParameter('Url', $Url).AddParameter('Offset', [int]$offset).AddParameter('PageLimit', $PageLimit).AddParameter('TimeoutSec', $TimeoutSec)
                $async = $powershell.BeginInvoke()
                [void]$pending.Add([ordered]@{
                        offset = [int]$offset
                        ps = $powershell
                        async = $async
                    })
            }

            while ($pending.Count -gt 0) {
                $handles = @($pending | ForEach-Object { $_.async.AsyncWaitHandle })
                $signaledIndex = [System.Threading.WaitHandle]::WaitAny($handles, [Math]::Max(($TimeoutSec + 1) * 1000, 1000))
                if ($signaledIndex -lt 0 -or $signaledIndex -ge $pending.Count) {
                    continue
                }

                $workItem = $pending[$signaledIndex]
                $pending.RemoveAt($signaledIndex)

                try {
                    $output = $workItem.ps.EndInvoke($workItem.async)
                    $pageResult = @($output | Select-Object -First 1)
                    if (-not $pageResult) {
                        $pageResult = [pscustomobject]@{
                            ok = $false
                            offset = [int]$workItem.offset
                            jobs = @()
                            reportedTotal = 0
                            elapsedMs = 0
                            error = 'Workday page fetch returned no response'
                        }
                    }

                    [void]$results.Add($pageResult)
                } finally {
                    $workItem.ps.Dispose()
                }
            }
        } finally {
            foreach ($workItem in @($pending.ToArray())) {
                try { $workItem.ps.Dispose() } catch { }
            }
            if ($pool) {
                $pool.Close()
                $pool.Dispose()
            }
        }
    }

    return @($results.ToArray())
}

function Invoke-WorkdayJobsRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$CandidateUrls,
        [Parameter(Mandatory = $true)]
        $Config
    )

    $triedCandidateKeys = New-Object 'System.Collections.Generic.HashSet[string]'
    $lastException = $null

    foreach ($candidateUrl in @($CandidateUrls)) {
        $normalizedCandidate = ([string]$candidateUrl).Trim()
        if (-not $normalizedCandidate) {
            continue
        }

        if (-not $triedCandidateKeys.Add($normalizedCandidate.ToLowerInvariant())) {
            continue
        }

        $requestStart = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $jobs = New-Object System.Collections.ArrayList
            $seenJobKeys = New-Object 'System.Collections.Generic.HashSet[string]'
            $pageLimit = 20
            $pageCount = 0
            $reportedTotal = 0
            $parallelPageCount = 0
            $firstPageResult = Invoke-WorkdayPageRequest -Url $normalizedCandidate -Offset 0 -PageLimit $pageLimit -TimeoutSec 45
            if (-not $firstPageResult.ok) {
                throw $firstPageResult.error
            }

            foreach ($job in @($firstPageResult.jobs)) {
                $jobKey = [string](Get-NestedValue -Object $job -Paths @('externalPath', 'id', 'jobPostingId', 'title'))
                if (-not $jobKey) {
                    $jobKey = ('offset:{0}|row:{1}' -f 0, $jobs.Count)
                }

                if ($seenJobKeys.Add($jobKey)) {
                    [void]$jobs.Add($job)
                }
            }

            $pageCount = 1
            if ([int]$firstPageResult.reportedTotal -gt 0) {
                $reportedTotal = [int]$firstPageResult.reportedTotal
            }

            if ($firstPageResult.jobs.Count -gt 0 -and $firstPageResult.jobs.Count -eq $pageLimit -and $reportedTotal -gt $pageLimit) {
                $remainingOffsets = @()
                for ($offset = $pageLimit; $offset -lt $reportedTotal; $offset += $pageLimit) {
                    $remainingOffsets += $offset
                }

                $pageResults = @(Invoke-WorkdayPageRequestsParallel -Url $normalizedCandidate -Offsets $remainingOffsets -PageLimit $pageLimit -TimeoutSec 45)
                $parallelPageCount = $pageResults.Count
                $pageCount += $parallelPageCount
                $failedPageOffsets = @($pageResults | Where-Object { -not $_.ok } | Select-Object -ExpandProperty offset)
                if ($failedPageOffsets.Count -gt 0) {
                    $retryResults = New-Object System.Collections.ArrayList
                    foreach ($failedOffset in @($failedPageOffsets)) {
                        $retryPageResult = Invoke-WorkdayPageRequest -Url $normalizedCandidate -Offset ([int]$failedOffset) -PageLimit $pageLimit -TimeoutSec 45
                        if (-not $retryPageResult.ok) {
                            throw $retryPageResult.error
                        }

                        [void]$retryResults.Add($retryPageResult)
                    }

                    $successfulParallelResults = @($pageResults | Where-Object { $_.ok })
                    $pageResults = @($successfulParallelResults + @($retryResults.ToArray()))
                }

                foreach ($pageResult in @($pageResults | Sort-Object offset)) {
                    if ([int]$pageResult.reportedTotal -gt 0) {
                        $reportedTotal = [Math]::Max($reportedTotal, [int]$pageResult.reportedTotal)
                    }

                    foreach ($job in @($pageResult.jobs)) {
                        $jobKey = [string](Get-NestedValue -Object $job -Paths @('externalPath', 'id', 'jobPostingId', 'title'))
                        if (-not $jobKey) {
                            $jobKey = ('offset:{0}|row:{1}' -f [int]$pageResult.offset, $jobs.Count)
                        }

                        if ($seenJobKeys.Add($jobKey)) {
                            [void]$jobs.Add($job)
                        }
                    }
                }
            } elseif ($firstPageResult.jobs.Count -eq $pageLimit) {
                $offset = $pageLimit
                while ($pageCount -lt 250) {
                    $pageResult = Invoke-WorkdayPageRequest -Url $normalizedCandidate -Offset $offset -PageLimit $pageLimit -TimeoutSec 45
                    if (-not $pageResult.ok) {
                        throw $pageResult.error
                    }

                    $pageCount += 1
                    if ([int]$pageResult.reportedTotal -gt 0) {
                        $reportedTotal = [Math]::Max($reportedTotal, [int]$pageResult.reportedTotal)
                    }

                    foreach ($job in @($pageResult.jobs)) {
                        $jobKey = [string](Get-NestedValue -Object $job -Paths @('externalPath', 'id', 'jobPostingId', 'title'))
                        if (-not $jobKey) {
                            $jobKey = ('offset:{0}|row:{1}' -f $offset, $jobs.Count)
                        }

                        if ($seenJobKeys.Add($jobKey)) {
                            [void]$jobs.Add($job)
                        }
                    }

                    if ($pageResult.jobs.Count -eq 0 -or $pageResult.jobs.Count -lt $pageLimit) {
                        break
                    }

                    if ($reportedTotal -gt 0 -and ($offset + $pageResult.jobs.Count) -ge $reportedTotal) {
                        break
                    }

                    $offset += $pageResult.jobs.Count
                }
            }

            $requestStart.Stop()
            Write-PipelineDiag -Stage 'workday_fetch' -Company ([string](Get-ObjectValue -Object $Config -Name 'companyName' -Default '')) -Message 'Fetched Workday jobs from API candidate' -Data @{
                apiUrl = $normalizedCandidate
                pageCount = $pageCount
                parallelPageCount = $parallelPageCount
                jobCount = @($jobs).Count
                reportedTotal = $reportedTotal
                elapsedMs = [int]$requestStart.Elapsed.TotalMilliseconds
            }
            return [ordered]@{
                apiUrl = $normalizedCandidate
                jobs = @($jobs)
                pageCount = $pageCount
                reportedTotal = $reportedTotal
                elapsedMs = [int]$requestStart.Elapsed.TotalMilliseconds
            }
        } catch {
            $requestStart.Stop()
            $lastException = $_.Exception
            Write-PipelineDiag -Stage 'workday_fetch_candidate_error' -Company ([string](Get-ObjectValue -Object $Config -Name 'companyName' -Default '')) -Message ('Workday API candidate failed: ' + [string]$lastException.Message) -Data @{
                apiUrl = $normalizedCandidate
                elapsedMs = [int]$requestStart.Elapsed.TotalMilliseconds
            }
        }
    }

    if ($lastException) {
        throw $lastException
    }

    return [ordered]@{
        apiUrl = ''
        jobs = @()
        pageCount = 0
        reportedTotal = 0
        elapsedMs = 0
    }
}

function Get-WorkdayJobs {
    param($Config)

    $candidateResolutionStart = [System.Diagnostics.Stopwatch]::StartNew()
    $directCandidates = @(Get-WorkdayApiCandidateUrls -Config $Config)
    $candidateResolutionStart.Stop()
    if ($directCandidates.Count -eq 0) {
        return @()
    }

    Write-PipelineDiag -Stage 'workday_resolve' -Company ([string](Get-ObjectValue -Object $Config -Name 'companyName' -Default '')) -Message 'Resolved direct Workday API candidates' -Data @{
        candidateCount = $directCandidates.Count
        elapsedMs = [int]$candidateResolutionStart.Elapsed.TotalMilliseconds
    }

    try {
        $requestResult = Invoke-WorkdayJobsRequest -CandidateUrls $directCandidates -Config $Config
    } catch {
        $fallbackResolutionStart = [System.Diagnostics.Stopwatch]::StartNew()
        $resolvedCandidates = @(Get-WorkdayApiCandidateUrls -Config $Config -IncludePageResolution)
        $fallbackResolutionStart.Stop()
        Write-PipelineDiag -Stage 'workday_resolve' -Company ([string](Get-ObjectValue -Object $Config -Name 'companyName' -Default '')) -Message 'Resolved fallback Workday API candidates' -Data @{
            candidateCount = $resolvedCandidates.Count
            elapsedMs = [int]$fallbackResolutionStart.Elapsed.TotalMilliseconds
        }
        $requestResult = Invoke-WorkdayJobsRequest -CandidateUrls $resolvedCandidates -Config $Config
    }

    $url = [string](Get-ObjectValue -Object $requestResult -Name 'apiUrl' -Default '')
    $jobs = @((Get-ObjectValue -Object $requestResult -Name 'jobs' -Default @()))

    return @(
        foreach ($job in @($jobs)) {
            $externalPath = [string](Get-NestedValue -Object $job -Paths @('externalPath'))
            $jobUrl = if ($externalPath -and $url -match '^(https?://[^/]+)') { "$($matches[1])$externalPath" } else { $externalPath }
            [ordered]@{
                jobId = [string](Get-NestedValue -Object $job -Paths @('externalPath', 'id', 'jobPostingId'))
                title = [string](Get-NestedValue -Object $job -Paths @('title'))
                location = [string](Get-NestedValue -Object $job -Paths @('locationsText', 'location', 'locationText'))
                department = [string](Get-NestedValue -Object $job -Paths @('jobFamily', 'department', 'bulletFields.jobFamily'))
                employmentType = [string](Get-NestedValue -Object $job -Paths @('timeType', 'workerSubType', 'employmentType'))
                url = if ($jobUrl) { $jobUrl } else { [string](Get-NestedValue -Object $job -Paths @('externalUrl', 'url')) }
                postedAt = Convert-ToDateString (Get-NestedValue -Object $job -Paths @('postedOn', 'postedOnDate', 'startDate'))
                sourceUrl = $url
                rawPayload = $job
            }
        }
    )
}

function Get-JobviteJobs {
    param($Config)

    $url = Get-ConfiguredApiUrl -Config $Config
    if (-not $url -and $Config.boardId) {
        $url = "https://jobs.jobvite.com/api/job-list?company=$([uri]::EscapeDataString([string]$Config.boardId))"
    }
    if (-not $url) {
        return @()
    }

    $payload = Get-JsonFromUrl -Url $url
    $jobs = @(Get-TopLevelCollection -Payload $payload -PropertyNames @('jobs', 'requisitions'))
    return @(
        foreach ($job in $jobs) {
            [ordered]@{
                jobId = [string](Get-NestedValue -Object $job -Paths @('id', 'jobId', 'requisitionId'))
                title = [string](Get-NestedValue -Object $job -Paths @('title', 'name'))
                location = [string](Get-NestedValue -Object $job -Paths @('location', 'location.city'))
                department = [string](Get-NestedValue -Object $job -Paths @('department', 'category'))
                employmentType = [string](Get-NestedValue -Object $job -Paths @('jobType', 'employmentType'))
                url = [string](Get-NestedValue -Object $job -Paths @('jobUrl', 'url', 'applyUrl'))
                postedAt = Convert-ToDateString (Get-NestedValue -Object $job -Paths @('postedDate', 'postedAt', 'createdDate'))
                sourceUrl = $url
                rawPayload = $job
            }
        }
    )
}

function Get-IcimsJobs {
    param($Config)

    $url = Get-ConfiguredApiUrl -Config $Config
    if (-not $url) {
        return @()
    }

    $payload = Get-JsonFromUrl -Url $url
    $jobs = @(Get-TopLevelCollection -Payload $payload -PropertyNames @('searchResults', 'jobs'))
    return @(
        foreach ($job in $jobs) {
            [ordered]@{
                jobId = [string](Get-NestedValue -Object $job -Paths @('id', 'jobId'))
                title = [string](Get-NestedValue -Object $job -Paths @('title', 'jobTitle'))
                location = [string](Get-NestedValue -Object $job -Paths @('location', 'jobLocation'))
                department = [string](Get-NestedValue -Object $job -Paths @('department', 'category'))
                employmentType = [string](Get-NestedValue -Object $job -Paths @('employmentType', 'fullOrPartTime'))
                url = [string](Get-NestedValue -Object $job -Paths @('url', 'applyUrl', 'jobUrl'))
                postedAt = Convert-ToDateString (Get-NestedValue -Object $job -Paths @('postedDate', 'updatedDate', 'datePosted'))
                sourceUrl = $url
                rawPayload = $job
            }
        }
    )
}

function Get-TaleoJobs {
    param($Config)

    $url = Get-ConfiguredApiUrl -Config $Config
    if (-not $url) {
        return @()
    }

    $payload = Get-JsonFromUrl -Url $url
    $jobs = @(Get-TopLevelCollection -Payload $payload -PropertyNames @('items', 'requisitions'))
    return @(
        foreach ($job in $jobs) {
            [ordered]@{
                jobId = [string](Get-NestedValue -Object $job -Paths @('id', 'jobId', 'requisitionId'))
                title = [string](Get-NestedValue -Object $job -Paths @('title', 'JobTitle'))
                location = [string](Get-NestedValue -Object $job -Paths @('location', 'PrimaryLocation'))
                department = [string](Get-NestedValue -Object $job -Paths @('department', 'OrganizationName'))
                employmentType = [string](Get-NestedValue -Object $job -Paths @('employmentType', 'RegularTemporary'))
                url = [string](Get-NestedValue -Object $job -Paths @('url', 'jobUrl', 'applyUrl'))
                postedAt = Convert-ToDateString (Get-NestedValue -Object $job -Paths @('postedDate', 'SubmissionDate', 'datePosted'))
                sourceUrl = $url
                rawPayload = $job
            }
        }
    )
}

function Get-BamboohrJobs {
    param($Config)

    $boardId = [string]$Config.boardId
    if (-not $boardId) {
        return @()
    }

    $url = "https://$([uri]::EscapeDataString($boardId)).bamboohr.com/careers/list"
    $response = Invoke-ResolverProbeRequest -Url $url
    if (-not $response.ok) {
        return @()
    }

    $content = [string]$response.content
    $jobs = @()

    # BambooHR embeds job data as JSON in the page - try to extract it
    # Look for the embedded JSON data structure with job listings
    if ($content -match '"result"\s*:\s*(\[[\s\S]*?\])\s*[,}]') {
        try {
            $jobArray = $matches[1] | ConvertFrom-Json
            foreach ($job in @($jobArray)) {
                $location = @(
                    if ($job.PSObject.Properties.Name -contains 'location' -and $job.location) {
                        if ($job.location.PSObject.Properties.Name -contains 'city' -and $job.location.city) { [string]$job.location.city }
                        if ($job.location.PSObject.Properties.Name -contains 'state' -and $job.location.state) { [string]$job.location.state }
                        if ($job.location.PSObject.Properties.Name -contains 'country' -and $job.location.country) { [string]$job.location.country }
                    }
                ) | Where-Object { $_ }

                $jobs += [ordered]@{
                    jobId = [string](Get-NestedValue -Object $job -Paths @('id'))
                    title = [string](Get-NestedValue -Object $job -Paths @('jobOpeningName', 'title', 'name'))
                    location = ($location -join ', ')
                    department = [string](Get-NestedValue -Object $job -Paths @('departmentLabel', 'department'))
                    employmentType = [string](Get-NestedValue -Object $job -Paths @('employmentStatusLabel', 'employmentType'))
                    url = ('https://{0}.bamboohr.com/careers/{1}' -f $boardId, (Get-NestedValue -Object $job -Paths @('id')))
                    postedAt = (Get-Date).ToString('o')
                    sourceUrl = $url
                    rawPayload = $job
                }
            }
        }
        catch {
            # JSON parse failed, fall through to HTML parsing
        }
    }

    # Fallback: try parsing HTML for job links
    if ($jobs.Count -eq 0) {
        $htmlMatches = [regex]::Matches($content, '<a[^>]+href="(/careers/(\d+))"[^>]*>([^<]+)</a>')
        foreach ($m in $htmlMatches) {
            $jobId = $m.Groups[2].Value
            $title = $m.Groups[3].Value.Trim()
            if ($jobId -and $title) {
                $jobs += [ordered]@{
                    jobId = $jobId
                    title = $title
                    location = ''
                    department = ''
                    employmentType = ''
                    url = ('https://{0}.bamboohr.com{1}' -f $boardId, $m.Groups[1].Value)
                    postedAt = (Get-Date).ToString('o')
                    sourceUrl = $url
                    rawPayload = @{ id = $jobId; title = $title }
                }
            }
        }
    }

    return @($jobs)
}

function Get-JobsForConfig {
    param($Config)

    switch ([string]$Config.atsType) {
        'greenhouse' { return Get-GreenhouseJobs -Config $Config }
        'lever' { return Get-LeverJobs -Config $Config }
        'ashby' { return Get-AshbyJobs -Config $Config }
        'smartrecruiters' { return Get-SmartRecruitersJobs -Config $Config }
        'workday' { return Get-WorkdayJobs -Config $Config }
        'jobvite' { return Get-JobviteJobs -Config $Config }
        'icims' { return Get-IcimsJobs -Config $Config }
        'taleo' { return Get-TaleoJobs -Config $Config }
        'bamboohr' { return Get-BamboohrJobs -Config $Config }
        default { return @() }
    }
}

function Sync-ImportedCompanyData {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [string[]]$CompanyKeys = @()
    )

    $companyDefaults = Get-CompanyRecordDefaults
    $contactDefaults = Get-ContactRecordDefaults
    $jobDefaults = Get-JobRecordDefaults
    $boardConfigDefaults = Get-BoardConfigDefaults
    $activityDefaults = Get-ActivityRecordDefaults
    $companies = New-Object System.Collections.ArrayList
    $companyMap = @{}
    foreach ($company in @($State.companies)) {
        Ensure-RecordDefaults -Record $company -Defaults $companyDefaults | Out-Null
        [void]$companies.Add($company)
        $key = Get-CanonicalCompanyKey $(if ($company.normalizedName) { $company.normalizedName } else { $company.displayName })
        if ($key) {
            $companyMap[$key] = $company
        }
    }

    $contactsByCompany = @{}
    foreach ($contact in @($State.contacts)) {
        Ensure-RecordDefaults -Record $contact -Defaults $contactDefaults | Out-Null
        $key = Get-CanonicalCompanyKey $(if ($contact.normalizedCompanyName) { $contact.normalizedCompanyName } else { $contact.companyName })
        if (-not $key) { continue }
        [void](Set-ObjectValue -Object $contact -Name 'normalizedCompanyName' -Value $key)
        if (-not $contactsByCompany.ContainsKey($key)) {
            $contactsByCompany[$key] = New-Object System.Collections.ArrayList
        }
        [void]$contactsByCompany[$key].Add($contact)
    }

    $jobsByCompany = @{}
    foreach ($job in @($State.jobs)) {
        Ensure-RecordDefaults -Record $job -Defaults $jobDefaults | Out-Null
        $key = Get-CanonicalCompanyKey $(if ($job.normalizedCompanyName) { $job.normalizedCompanyName } else { $job.companyName })
        if (-not $key) { continue }
        [void](Set-ObjectValue -Object $job -Name 'normalizedCompanyName' -Value $key)
        if (-not $jobsByCompany.ContainsKey($key)) {
            $jobsByCompany[$key] = New-Object System.Collections.ArrayList
        }
        [void]$jobsByCompany[$key].Add($job)
    }

    $configsByCompany = @{}
    foreach ($config in @($State.boardConfigs)) {
        Ensure-RecordDefaults -Record $config -Defaults $boardConfigDefaults | Out-Null
        $key = Get-CanonicalCompanyKey $(if ($config.normalizedCompanyName) { $config.normalizedCompanyName } else { $config.companyName })
        if (-not $key) { continue }
        [void](Set-ObjectValue -Object $config -Name 'normalizedCompanyName' -Value $key)
        if (-not $configsByCompany.ContainsKey($key)) {
            $configsByCompany[$key] = New-Object System.Collections.ArrayList
        }
        [void]$configsByCompany[$key].Add($config)
    }

    $activitiesByCompany = @{}
    foreach ($activity in @($State.activities)) {
        Ensure-RecordDefaults -Record $activity -Defaults $activityDefaults | Out-Null
        $key = Get-CanonicalCompanyKey (Get-ObjectValue -Object $activity -Name 'normalizedCompanyName' -Default '')
        if (-not $key) { continue }
        [void](Set-ObjectValue -Object $activity -Name 'normalizedCompanyName' -Value $key)
        if (-not $activitiesByCompany.ContainsKey($key)) {
            $activitiesByCompany[$key] = New-Object System.Collections.ArrayList
        }
        [void]$activitiesByCompany[$key].Add($activity)
    }

    $keysToRefresh = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($key in @($CompanyKeys)) {
        $normalized = Normalize-TextKey $key
        if ($normalized) { [void]$keysToRefresh.Add($normalized) }
    }

    if (@($CompanyKeys).Count -eq 0) {
        foreach ($key in $jobsByCompany.Keys) {
            if ($configsByCompany.ContainsKey($key)) {
                [void]$keysToRefresh.Add($key)
            }
        }
    }

    foreach ($key in ($keysToRefresh | Sort-Object)) {
        $company = $companyMap[$key]
        $contactItems = if ($contactsByCompany.ContainsKey($key)) { @($contactsByCompany[$key].ToArray()) } else { @() }
        $configItems = if ($configsByCompany.ContainsKey($key)) { @($configsByCompany[$key].ToArray()) } else { @() }
        $jobItems = if ($jobsByCompany.ContainsKey($key)) { @($jobsByCompany[$key].ToArray()) } else { @() }
        $activityItems = if ($activitiesByCompany.ContainsKey($key)) { @($activitiesByCompany[$key].ToArray()) } else { @() }

        if (-not $company) {
            $displayName = ''
            if (@($contactItems).Count -gt 0 -and $contactItems[0].companyName) {
                $displayName = [string]$contactItems[0].companyName
            } elseif (@($configItems).Count -gt 0 -and $configItems[0].companyName) {
                $displayName = [string]$configItems[0].companyName
            } elseif (@($jobItems).Count -gt 0 -and $jobItems[0].companyName) {
                $displayName = [string]$jobItems[0].companyName
            }
            $company = New-CompanyProjection -WorkspaceId $State.workspace.id -NormalizedName $key -DisplayName $displayName
            [void]$companies.Add($company)
            $companyMap[$key] = $company
        }

        $company = Update-CompanyProjection -Company $company -Contacts $contactItems -Jobs $jobItems -Configs $configItems -Activities $activityItems
        foreach ($contact in @($contactItems)) {
            if ($null -eq $contact) { continue }
            [void](Set-ObjectValue -Object $contact -Name 'accountId' -Value $company.id)
        }
        foreach ($config in @($configItems)) {
            if ($null -eq $config) { continue }
            [void](Set-ObjectValue -Object $config -Name 'accountId' -Value $company.id)
        }
        foreach ($job in @($jobItems)) {
            if ($null -eq $job) { continue }
            [void](Set-ObjectValue -Object $job -Name 'accountId' -Value $company.id)
            if (-not $job.companyName) { [void](Set-ObjectValue -Object $job -Name 'companyName' -Value $company.displayName) }
        }
        foreach ($activity in @($activityItems)) {
            if ($null -eq $activity) { continue }
            [void](Set-ObjectValue -Object $activity -Name 'accountId' -Value $company.id)
        }
    }

    $State.companies = Sort-Companies -Companies @($companies.ToArray())
    return $State
}

function Invoke-LiveJobImport {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [switch]$SkipPersistence,
        [scriptblock]$ProgressCallback,
        [int]$ProgressInterval = 10
    )

    $startedAt = (Get-Date).ToString('o')
    $errors = New-Object System.Collections.ArrayList
    $stats = [ordered]@{
        configs = 0
        fetched = 0
        imported = 0
        newJobs = 0
        canadaKept = 0
        gtaKept = 0
        filteredOutNonCanada = 0
        errors = 0
    }

    $jobMap = @{}
    $existingByNaturalKey = @{}
    $changedJobs = New-Object System.Collections.ArrayList
    $changedJobIds = New-Object 'System.Collections.Generic.HashSet[string]'
    $changedConfigs = New-Object System.Collections.ArrayList
    $changedConfigIds = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($job in @($State.jobs)) {
        if (-not $job.retrievedAt -and $job.importedAt) {
            [void](Set-ObjectValue -Object $job -Name 'retrievedAt' -Value $job.importedAt)
        }
        if (-not $job.firstSeenAt -and $job.importedAt) {
            [void](Set-ObjectValue -Object $job -Name 'firstSeenAt' -Value $job.importedAt)
        }
        if (-not $job.url -and $job.jobUrl) {
            [void](Set-ObjectValue -Object $job -Name 'url' -Value $job.jobUrl)
        }
        if (-not $job.jobId) {
            [void](Set-ObjectValue -Object $job -Name 'jobId' -Value '')
        }
        if (-not $job.naturalKey) {
            [void](Set-ObjectValue -Object $job -Name 'naturalKey' -Value $(if ($job.dedupeKey) { [string]$job.dedupeKey } else { '{0}|{1}|{2}' -f $job.normalizedCompanyName, $job.atsType, ($job.url) }))
        }
        $jobMap[$job.id] = $job
        if ($job.naturalKey) {
            $existingByNaturalKey[[string]$job.naturalKey] = $job
        }
    }

    $companyKeys = New-Object 'System.Collections.Generic.HashSet[string]'
    $retrievedAt = (Get-Date).ToString('o')
    $activeConfigs = @(
        $State.boardConfigs |
            Where-Object {
                if ((Get-ObjectValue -Object $_ -Name 'active' -Default $true) -eq $false) {
                    return $false
                }

                $supportedImport = Get-ObjectValue -Object $_ -Name 'supportedImport' -Default $null
                if ($null -ne $supportedImport) {
                    return (Test-Truthy $supportedImport)
                }

                return (Test-ImportCapableAtsType -AtsType ([string](Get-ObjectValue -Object $_ -Name 'atsType')))
            }
    )
    $totalConfigs = @($activeConfigs).Count
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing live jobs' -Processed 0 -Total $totalConfigs -StartedAt $startedAt -Message 'Fetching active ATS job feeds'
    for ($configIndex = 0; $configIndex -lt $activeConfigs.Count; $configIndex++) {
        $config = $activeConfigs[$configIndex]
        $configId = [string](Get-ObjectValue -Object $config -Name 'id')
        if ($ProgressCallback) {
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing live jobs' -Processed $configIndex -Total $totalConfigs -StartedAt $startedAt -Message ("Fetching {0}" -f [string]$config.companyName)
        }
        [void](Set-ObjectValue -Object $config -Name 'companyName' -Value ([string]$config.companyName))
        [void](Set-ObjectValue -Object $config -Name 'companyName' -Value (Get-CanonicalCompanyDisplayName ([string]$config.companyName)))
        [void](Set-ObjectValue -Object $config -Name 'normalizedCompanyName' -Value (Get-CanonicalCompanyKey $(if ($config.normalizedCompanyName) { $config.normalizedCompanyName } else { $config.companyName })))
        if ($config.normalizedCompanyName) {
            [void]$companyKeys.Add($config.normalizedCompanyName)
        }

        $configKey = if ($config.id) { [string]$config.id } else { '{0}|{1}|{2}' -f $config.normalizedCompanyName, $config.atsType, $config.boardId }
        $seenNaturalKeys = New-Object 'System.Collections.Generic.HashSet[string]'
        $stats.configs += 1
        try {
            $fetchStartTime = Get-Date
            $jobs = Get-JobsForConfig -Config $config
            $fetchElapsed = ((Get-Date) - $fetchStartTime).TotalMilliseconds
            $fetchedCount = @($jobs).Count
            $stats.fetched += $fetchedCount
            $configFilteredOut = 0

            Write-PipelineDiag -Stage 'job_fetch' -Company $config.companyName -Message "Fetched $fetchedCount jobs" -Data @{
                atsType = [string]$config.atsType; boardId = [string]$config.boardId; jobCount = $fetchedCount; elapsedMs = [int]$fetchElapsed
            }

            foreach ($job in @($jobs)) {
                if (-not (Test-CanadaLocation -Location $job.location)) {
                    $configFilteredOut += 1
                    $stats.filteredOutNonCanada += 1
                    continue
                }

                $stats.canadaKept += 1
                if (Test-GtaLocation -Location $job.location) {
                    $stats.gtaKept += 1
                }

                $externalJobId = [string]$(if ($job.jobId) { $job.jobId } elseif ($job.url) { $job.url } else { '{0}|{1}' -f (Normalize-TextKey $job.title), (Normalize-TextKey $job.location) })
                $naturalKey = '{0}|{1}|{2}' -f $config.normalizedCompanyName, $config.atsType, $externalJobId
                [void]$seenNaturalKeys.Add($naturalKey)
                $existingJob = if ($existingByNaturalKey.ContainsKey($naturalKey)) { $existingByNaturalKey[$naturalKey] } else { $null }
                $jobId = if ($existingJob) { [string]$existingJob.id } else { New-DeterministicId -Prefix 'job' -Seed $naturalKey }

                $jobRecord = if ($existingJob) { $existingJob } else { [ordered]@{} }
                [void](Set-ObjectValue -Object $jobRecord -Name 'id' -Value $jobId)
                [void](Set-ObjectValue -Object $jobRecord -Name 'workspaceId' -Value $State.workspace.id)
                [void](Set-ObjectValue -Object $jobRecord -Name 'accountId' -Value $config.accountId)
                [void](Set-ObjectValue -Object $jobRecord -Name 'companyName' -Value $config.companyName)
                [void](Set-ObjectValue -Object $jobRecord -Name 'normalizedCompanyName' -Value $config.normalizedCompanyName)
                [void](Set-ObjectValue -Object $jobRecord -Name 'title' -Value $job.title)
                [void](Set-ObjectValue -Object $jobRecord -Name 'normalizedTitle' -Value (Normalize-TextKey $job.title))
                [void](Set-ObjectValue -Object $jobRecord -Name 'location' -Value $job.location)
                [void](Set-ObjectValue -Object $jobRecord -Name 'department' -Value $job.department)
                [void](Set-ObjectValue -Object $jobRecord -Name 'employmentType' -Value $job.employmentType)
                [void](Set-ObjectValue -Object $jobRecord -Name 'jobId' -Value $externalJobId)
                [void](Set-ObjectValue -Object $jobRecord -Name 'url' -Value $job.url)
                [void](Set-ObjectValue -Object $jobRecord -Name 'jobUrl' -Value $job.url)
                [void](Set-ObjectValue -Object $jobRecord -Name 'sourceUrl' -Value $job.sourceUrl)
                [void](Set-ObjectValue -Object $jobRecord -Name 'atsType' -Value $config.atsType)
                [void](Set-ObjectValue -Object $jobRecord -Name 'configKey' -Value $configKey)
                [void](Set-ObjectValue -Object $jobRecord -Name 'postedAt' -Value $job.postedAt)
                [void](Set-ObjectValue -Object $jobRecord -Name 'retrievedAt' -Value $retrievedAt)
                [void](Set-ObjectValue -Object $jobRecord -Name 'lastSeenAt' -Value $retrievedAt)
                if (-not (Get-ObjectValue -Object $jobRecord -Name 'firstSeenAt')) {
                    [void](Set-ObjectValue -Object $jobRecord -Name 'firstSeenAt' -Value $retrievedAt)
                }
                if (-not (Get-ObjectValue -Object $jobRecord -Name 'importedAt')) {
                    [void](Set-ObjectValue -Object $jobRecord -Name 'importedAt' -Value $retrievedAt)
                }
                [void](Set-ObjectValue -Object $jobRecord -Name 'naturalKey' -Value $naturalKey)
                [void](Set-ObjectValue -Object $jobRecord -Name 'dedupeKey' -Value $naturalKey)
                [void](Set-ObjectValue -Object $jobRecord -Name 'rawPayload' -Value $job.rawPayload)
                [void](Set-ObjectValue -Object $jobRecord -Name 'active' -Value $true)
                [void](Set-ObjectValue -Object $jobRecord -Name 'isGta' -Value (Test-GtaLocation -Location $job.location))
                [void](Set-ObjectValue -Object $jobRecord -Name 'isNew' -Value ([bool](-not $existingJob)))

                if (-not $existingJob) {
                    $stats.newJobs += 1
                }

                $jobMap[$jobId] = $jobRecord
                $existingByNaturalKey[$naturalKey] = $jobRecord
                if ($changedJobIds.Add($jobId)) {
                    [void]$changedJobs.Add($jobRecord)
                }
            }

            foreach ($existingJob in @($jobMap.Values | Where-Object {
                        $_.configKey -eq $configKey -and
                        $_.active -ne $false
                    })) {
                if (-not $seenNaturalKeys.Contains([string]$existingJob.naturalKey)) {
                    [void](Set-ObjectValue -Object $existingJob -Name 'active' -Value $false)
                    [void](Set-ObjectValue -Object $existingJob -Name 'isNew' -Value $false)
                    [void](Set-ObjectValue -Object $existingJob -Name 'retrievedAt' -Value $retrievedAt)
                    $existingJobId = [string](Get-ObjectValue -Object $existingJob -Name 'id')
                    if ($existingJobId -and $changedJobIds.Add($existingJobId)) {
                        [void]$changedJobs.Add($existingJob)
                    }
                }
            }

            # Log when the location filter drops a significant number of jobs
            if ($configFilteredOut -gt 0) {
                Write-PipelineDiag -Stage 'job_filter' -Company $config.companyName -Message ('Location filter: ' + $configFilteredOut + ' of ' + $fetchedCount + ' jobs dropped (non-Canada)') -Data @{
                    fetched = $fetchedCount; filteredOut = $configFilteredOut; kept = ($fetchedCount - $configFilteredOut)
                    reason = 'Non-Canada location'; atsType = [string]$config.atsType
                }
            }
            if ($fetchedCount -gt 0 -and $configFilteredOut -eq $fetchedCount) {
                Write-PipelineDiag -Stage 'job_filter_zero' -Company $config.companyName -Message ('ALL ' + $fetchedCount + ' jobs filtered out by Canada location filter - zero imported') -Data @{
                    atsType = [string]$config.atsType; boardId = [string]$config.boardId
                }
            }

            [void](Set-ObjectValue -Object $config -Name 'lastImportAt' -Value $retrievedAt)
            [void](Set-ObjectValue -Object $config -Name 'lastImportStatus' -Value 'success')
        } catch {
            $stats.errors += 1
            [void](Set-ObjectValue -Object $config -Name 'lastImportAt' -Value $retrievedAt)
            [void](Set-ObjectValue -Object $config -Name 'lastImportStatus' -Value 'error')
            $fetchErrorMsg = [string]$_.Exception.Message
            Write-PipelineDiag -Stage 'job_fetch_error' -Company $config.companyName -Message ('Job fetch failed: ' + $fetchErrorMsg) -Data @{
                atsType = [string]$config.atsType; boardId = [string]$config.boardId; statusCode = ''
            }
            [void]$errors.Add([ordered]@{
                company = $config.companyName
                atsType = $config.atsType
                message = $fetchErrorMsg
            })
        }

        if ($configId -and $changedConfigIds.Add($configId)) {
            [void]$changedConfigs.Add($config)
        }

        $processed = $configIndex + 1
        if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $totalConfigs -or ($ProgressInterval -gt 0 -and ($processed % $ProgressInterval) -eq 0))) {
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing live jobs' -Processed $processed -Total $totalConfigs -StartedAt $startedAt -Message 'Fetching active ATS job feeds'
        }
    }

    $State.jobs = @(
        $jobMap.Values | Sort-Object @(
            @{ Expression = { Get-DateSortValue $(if ($_.postedAt) { $_.postedAt } else { $_.importedAt }) }; Descending = $true },
            @{ Expression = { [string]$_.companyName }; Descending = $false },
            @{ Expression = { [string]$_.title }; Descending = $false }
        )
    )
    $stats.imported = @(@($State.jobs) | Where-Object { $_.active -ne $false }).Count

    $run = [ordered]@{
        id = New-RandomId -Prefix 'run'
        workspaceId = $State.workspace.id
        type = 'live-job-import'
        status = if ($stats.errors -gt 0) { 'completed_with_errors' } else { 'completed' }
        startedAt = $startedAt
        finishedAt = $retrievedAt
        summary = 'Fetched jobs from active ATS configs'
        stats = $stats
        errors = @($errors)
    }

    $State.importRuns = @(@($State.importRuns) + @($run))
    if (-not $SkipPersistence) {
        Sync-AppStateSegments -State $State -Segments @('Jobs', 'BoardConfigs', 'ImportRuns')
    }

    Write-PipelineDiag -Stage 'import_complete' -Company '' -Message 'Job import finished' -Data @{
        configs = $stats.configs; fetched = $stats.fetched; imported = $stats.imported
        newJobs = $stats.newJobs; canadaKept = $stats.canadaKept; filteredOutNonCanada = $stats.filteredOutNonCanada
        errors = $stats.errors
    }

    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing live jobs' -Processed $totalConfigs -Total $totalConfigs -StartedAt $startedAt -Message 'Finished ATS job import'

    return [ordered]@{
        state = $State
        importRun = $run
        changedJobs = @($changedJobs.ToArray())
        changedConfigs = @($changedConfigs.ToArray())
        companyKeys = @($companyKeys | Sort-Object)
    }
}

Export-ModuleMember -Function *-*
