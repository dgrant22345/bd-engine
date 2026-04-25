Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'BdEngine.State.psm1') -DisableNameChecking

$script:DashboardCache = $null
$script:DashboardCacheSignature = ''
$script:FilterOptionsCache = $null
$script:FilterOptionsCacheSignature = ''
$script:RoleSeniorityScoreCache = @{}
$script:DecisionMakerFitScoreCache = @{}

# Legacy fallback owner roster for existing development workspaces.
$script:OwnerRoster = @(
    [ordered]@{ ownerId = 'derek-grant';  displayName = 'Derek Grant' }
    [ordered]@{ ownerId = 'alex-chong';   displayName = 'Alex Chong' }
    [ordered]@{ ownerId = 'danny-chung';  displayName = 'Danny Chung' }
)

function Get-ConfiguredOwnerRoster {
    try {
        $settings = Get-AppSegment -Segment 'Settings'
        $configured = @(Get-ObjectValue -Object $settings -Name 'ownerRoster' -Default @())
        $owners = New-Object System.Collections.ArrayList
        foreach ($owner in @($configured)) {
            $displayName = [string](Get-ObjectValue -Object $owner -Name 'displayName' -Default '')
            $ownerId = [string](Get-ObjectValue -Object $owner -Name 'ownerId' -Default '')
            if (-not [string]::IsNullOrWhiteSpace($displayName) -and -not [string]::IsNullOrWhiteSpace($ownerId)) {
                [void]$owners.Add([ordered]@{
                    ownerId = $ownerId
                    displayName = $displayName
                    email = [string](Get-ObjectValue -Object $owner -Name 'email' -Default '')
                })
            }
        }
        if ($owners.Count -gt 0) {
            return @($owners)
        }
    } catch {
        return @()
    }

    return @()
}

function Get-OwnerRoster {
    $configured = @(Get-ConfiguredOwnerRoster)
    if ($configured.Count -gt 0) {
        return @($configured)
    }

    return @($script:OwnerRoster)
}

function Resolve-OwnerDisplayName {
    param([string]$OwnerIdOrName)
    if (-not $OwnerIdOrName) { return '' }
    $match = Get-OwnerRoster | Where-Object {
        $_.ownerId -eq $OwnerIdOrName -or $_.displayName -eq $OwnerIdOrName
    } | Select-Object -First 1
    if ($match) { return [string]$match.displayName }
    return $OwnerIdOrName
}

function Resolve-OwnerId {
    param([string]$OwnerIdOrName)
    if (-not $OwnerIdOrName) { return '' }
    $match = Get-OwnerRoster | Where-Object {
        $_.ownerId -eq $OwnerIdOrName -or $_.displayName -eq $OwnerIdOrName
    } | Select-Object -First 1
    if ($match) { return [string]$match.ownerId }
    return ''
}

function Normalize-TextKey {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }

    $normalized = $Value.ToLowerInvariant()
    $normalized = $normalized -replace '&', ' and '
    $normalized = $normalized -replace '[^a-z0-9]+', ' '
    return $normalized.Trim()
}

$script:CanadaLocationHints = @(
    'canada', 'toronto', 'ontario', 'vancouver', 'british columbia', 'montreal', 'quebec', 'quebec city',
    'calgary', 'alberta', 'edmonton', 'ottawa', 'mississauga', 'markham', 'halifax', 'nova scotia', 'gatineau',
    'kitchener', 'waterloo', 'longueuil', 'manitoba', 'saskatchewan', 'new brunswick', 'newfoundland', 'labrador',
    'prince edward island', 'pei', 'yukon', 'nunavut', 'northwest territories'
)

$script:UsLocationHints = @(
    'united states', 'usa', 'new york', 'california', 'san francisco', 'los angeles', 'chicago', 'denver',
    'bethesda', 'philadelphia', 'connecticut', 'new jersey', 'dallas', 'texas', 'pennsylvania', 'washington',
    'seattle', 'massachusetts', 'boston', 'atlanta', 'georgia', 'colorado', 'virginia', 'north carolina',
    'florida', 'illinois', 'remote usa', 'remote united states'
)

function Get-LocationMarketFlags {
    param([string]$Location)

    $text = ([string]$Location).Trim().ToLowerInvariant()
    if (-not $text) {
        return [ordered]@{
            hasCanada = $false
            hasUs = $false
        }
    }

    $hasCanada = $false
    foreach ($hint in @($script:CanadaLocationHints)) {
        if ($text.Contains([string]$hint)) {
            $hasCanada = $true
            break
        }
    }

    $hasUs = $false
    foreach ($hint in @($script:UsLocationHints)) {
        if ($text.Contains([string]$hint)) {
            $hasUs = $true
            break
        }
    }

    return [ordered]@{
        hasCanada = $hasCanada
        hasUs = $hasUs
    }
}

function Test-LocationMatchesGeography {
    param(
        [string]$Location,
        [string]$Geography
    )

    $scope = ([string]$Geography).Trim().ToLowerInvariant()
    if (-not $scope) {
        return $true
    }

    $flags = Get-LocationMarketFlags -Location $Location
    switch ($scope) {
        'canada' {
            return ([bool]$flags.hasCanada -and -not [bool]$flags.hasUs)
        }
        'canada_us' {
            return ([bool]$flags.hasCanada -or [bool]$flags.hasUs)
        }
        'us' {
            return ([bool]$flags.hasUs -and -not [bool]$flags.hasCanada)
        }
        default {
            return $true
        }
    }
}

function Publish-EngineProgress {
    param(
        [scriptblock]$ProgressCallback,
        [string]$Phase,
        [int]$Processed = 0,
        [int]$Total = 0,
        [string]$StartedAt = '',
        [string]$Message = ''
    )

    if (-not $ProgressCallback) {
        return
    }

    & $ProgressCallback ([ordered]@{
            phase = $Phase
            processed = $Processed
            total = $Total
            startedAt = $StartedAt
            message = $Message
        })
}

function Get-CompanyAliasCatalog {
    return @(
        @{ key = 'rbc'; displayName = 'RBC'; aliases = @('rbc', 'royal bank of canada', 'royal bank', 'rbc insurance', 'rbc capital markets', 'royal bank of canada capital markets') }
        @{ key = 'bmo'; displayName = 'BMO'; aliases = @('bmo', 'bmo financial group', 'bank of montreal', 'bmo capital markets') }
        @{ key = 'cibc'; displayName = 'CIBC'; aliases = @('cibc', 'canadian imperial bank of commerce', 'cibc capital markets') }
        @{ key = 'td'; displayName = 'TD'; aliases = @('td', 'td bank', 'td bank group', 'toronto dominion bank', 'td securities') }
        @{ key = 'scotiabank'; displayName = 'Scotiabank'; aliases = @('scotiabank', 'bank of nova scotia', 'scotia bank', 'scotia capital') }
        @{ key = 'rogers communications'; displayName = 'Rogers Communications'; aliases = @('rogers', 'rogers communications', 'rogers communications inc') }
        @{ key = 'microsoft'; displayName = 'Microsoft'; aliases = @('microsoft', 'microsoft corporation', 'microsoft canada') }
        @{ key = 'google'; displayName = 'Google'; aliases = @('google', 'google llc', 'alphabet', 'alphabet inc') }
        @{ key = 'amazon'; displayName = 'Amazon'; aliases = @('amazon', 'amazon web services', 'aws', 'amazon.com') }
        @{ key = 'akkodis'; displayName = 'Akkodis'; aliases = @('akkodis', 'akkodis canada', 'modis', 'modis canada', 'modis formerly ajilon', 'ajilon') }
    )
}

function Resolve-CompanyIdentity {
    param([string]$CompanyName)

    $raw = [string]$CompanyName
    $normalized = Normalize-TextKey $raw
    if (-not $normalized) {
        return [ordered]@{
            key = ''
            displayName = ''
            matched = $false
        }
    }

    foreach ($entry in @(Get-CompanyAliasCatalog)) {
        foreach ($alias in @($entry.aliases)) {
            $aliasKey = Normalize-TextKey $alias
            if (-not $aliasKey) {
                continue
            }

            if ($normalized -eq $aliasKey -or $normalized.StartsWith("$aliasKey ")) {
                return [ordered]@{
                    key = [string]$entry.key
                    displayName = [string]$entry.displayName
                    matched = $true
                }
            }
        }
    }

    return [ordered]@{
        key = $normalized
        displayName = $raw.Trim()
        matched = $false
    }
}

function Get-CanonicalCompanyKey {
    param([string]$CompanyName)

    return [string](Resolve-CompanyIdentity -CompanyName $CompanyName).key
}

function Get-CanonicalCompanyDisplayName {
    param([string]$CompanyName)

    $resolved = Resolve-CompanyIdentity -CompanyName $CompanyName
    if ($resolved.displayName) {
        return [string]$resolved.displayName
    }
    return ([string]$CompanyName).Trim()
}

function Test-Truthy {
    param($Value)

    if ($Value -is [bool]) {
        return $Value
    }

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $false
    }

    return @('1', 'true', 'yes', 'y', 'active') -contains $text.Trim().ToLowerInvariant()
}

function Convert-ToNumber {
    param($Value)

    if ($null -eq $Value -or $Value -eq '') {
        return 0
    }

    $parsed = 0.0
    if ([double]::TryParse([string]$Value, [ref]$parsed)) {
        return $parsed
    }

    return 0
}

function Convert-ToDateString {
    param($Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return $null
    }

    if ($Value -is [DateTime]) {
        return $Value.ToString('o')
    }

    $text = [string]$Value
    $parsed = [DateTime]::MinValue
    if ([DateTime]::TryParse($text, [ref]$parsed)) {
        return $parsed.ToString('o')
    }

    $serial = 0.0
    if ([double]::TryParse($text, [ref]$serial)) {
        return ([DateTime]::FromOADate($serial)).ToString('o')
    }

    return $null
}

function Get-DomainName {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }

    $candidate = [string]$Value
    if ($candidate -notmatch '^[a-z]+://') {
        $candidate = "https://$candidate"
    }

    try {
        return ([uri]$candidate).Host.ToLowerInvariant()
    } catch {
        return ''
    }
}

function Test-HostedCompanyIdentityDomain {
    param([string]$Value)

    $domain = Get-DomainName $Value
    if (-not $domain) {
        return $false
    }

    foreach ($suffix in @(
            'greenhouse.io',
            'lever.co',
            'ashbyhq.com',
            'smartrecruiters.com',
            'myworkdayjobs.com',
            'workdayjobs.com',
            'bamboohr.com',
            'jobvite.com',
            'icims.com',
            'taleo.net',
            'successfactors.com',
            'recruitee.com',
            'eightfold.ai',
            'phenompeople.com'
        )) {
        if ($domain -eq $suffix -or $domain.EndsWith(".$suffix")) {
            return $true
        }
    }

    return $false
}

function Get-CompanyAcronym {
    param([string]$CompanyName)

    $tokens = @((Normalize-TextKey $CompanyName) -split ' ' | Where-Object { $_ -and $_.Length -gt 1 })
    if ($tokens.Count -lt 2) {
        return ''
    }

    $letters = New-Object System.Collections.ArrayList
    foreach ($token in @($tokens | Select-Object -First 5)) {
        [void]$letters.Add($token.Substring(0, 1))
    }

    return ([string]::Join('', @($letters))).ToLowerInvariant()
}

function Get-GeneratedCompanyAliases {
    param(
        [string]$CompanyName,
        [string]$Domain = '',
        [object[]]$ExistingAliases = @()
    )

    $results = New-Object System.Collections.ArrayList
    $seen = @{}

    function Add-AliasValue {
        param(
            [System.Collections.ArrayList]$List,
            [hashtable]$Seen,
            [string]$Value
        )

        $candidate = ([string]$Value).Trim()
        if (-not $candidate) {
            return
        }

        $normalized = Normalize-TextKey $candidate
        if (-not $normalized -or $Seen.ContainsKey($normalized)) {
            return
        }

        $Seen[$normalized] = $true
        [void]$List.Add($candidate)
    }

    foreach ($alias in @($ExistingAliases)) {
        Add-AliasValue -List $results -Seen $seen -Value ([string]$alias)
    }

    $name = ([string]$CompanyName).Trim()
    if ($name) {
        Add-AliasValue -List $results -Seen $seen -Value $name

        $suffixTrimmed = ($name -replace '(?i)\b(inc|incorporated|corp|corporation|llc|ltd|limited|group|holdings|company|co|technologies|technology)\b\.?', '')
        $suffixTrimmed = ($suffixTrimmed -replace '\s+', ' ').Trim(' ', ',', '.', '-')
        Add-AliasValue -List $results -Seen $seen -Value $suffixTrimmed

        $normalizedName = Normalize-TextKey $name
        Add-AliasValue -List $results -Seen $seen -Value $normalizedName
        Add-AliasValue -List $results -Seen $seen -Value (($normalizedName -replace ' ', '-'))
        Add-AliasValue -List $results -Seen $seen -Value (($normalizedName -replace ' ', ''))

        $acronym = Get-CompanyAcronym -CompanyName $name
        Add-AliasValue -List $results -Seen $seen -Value $acronym

        $resolved = Resolve-CompanyIdentity -CompanyName $name
        foreach ($entry in @(Get-CompanyAliasCatalog)) {
            if ([string]$entry.key -ne [string]$resolved.key) {
                continue
            }
            foreach ($alias in @($entry.aliases)) {
                Add-AliasValue -List $results -Seen $seen -Value ([string]$alias)
            }
        }
    }

    $resolvedDomain = Get-DomainName $Domain
    if ($resolvedDomain) {
        Add-AliasValue -List $results -Seen $seen -Value $resolvedDomain

        $parts = @($resolvedDomain.Split('.') | Where-Object { $_ })
        if ($parts.Count -gt 0) {
            $root = $parts[0]
            if ($root -in @('www', 'jobs', 'careers', 'boards', 'apply') -and $parts.Count -gt 1) {
                $root = $parts[1]
            }
            Add-AliasValue -List $results -Seen $seen -Value $root
            Add-AliasValue -List $results -Seen $seen -Value ($root -replace '-', '')
        }
    }

    return @($results.ToArray())
}

function Get-ObjectValue {
    param(
        $Object,
        [string]$Name,
        $Default = ''
    )

    if ($null -eq $Object -or [string]::IsNullOrWhiteSpace($Name)) {
        return $Default
    }

    if ($Object -is [System.Collections.IDictionary]) {
        if (Test-ObjectHasKey -Object $Object -Name $Name) {
            return $Object[$Name]
        }
        return $Default
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }

    return $Default
}

function Set-ObjectValue {
    param(
        [Parameter(Mandatory = $true)]
        $Object,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        $Value
    )

    if ($Object -is [System.Collections.IDictionary]) {
        $Object[$Name] = $Value
        return $Object[$Name]
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($property) {
        $property.Value = $Value
        return $property.Value
    }

    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
    return $Value
}

function Test-ObjectHasKey {
    param(
        $Object,
        [string]$Name
    )

    if ($null -eq $Object -or [string]::IsNullOrWhiteSpace($Name)) {
        return $false
    }

    if ($Object -is [System.Collections.Generic.Dictionary[string, object]]) {
        return $Object.ContainsKey($Name)
    }

    if ($Object -is [System.Collections.IDictionary]) {
        return $Object.Contains($Name)
    }

    return [bool]$Object.PSObject.Properties[$Name]
}

function Get-TitleFlags {
    param([string]$Title)

    $lower = ([string]$Title).ToLowerInvariant()

    $senior = $lower -match '\b(vp|vice president|director|head of|head|chief|cto|cfo|coo|ceo|cio|svp|evp|partner|principal|managing director|general manager|gm|founder|owner)\b'
    $talent = $lower -match '\b(recruit|talent|people|human resources|hr|staffing|acquisition|hiring)\b'
    $buyer = $lower -match '\b(director|vp|vice president|head|manager|lead).*(talent|recruit|people|hr|human|staffing|hiring)\b|\b(talent|recruit|people|hr|human|staffing|hiring).*(director|vp|vice president|head|manager|lead)\b'
    $tech = $lower -match '\b(engineer|engineering|developer|software|data|analytics|technology|it|product|architect|security|cloud|devops|ai|machine learning)\b'
    $finance = $lower -match '\b(finance|financial|accounting|fp&a|controller|treasury|audit|risk|compliance|analyst|investment|capital markets)\b'

    return [ordered]@{
        buyer = [bool]$buyer
        senior = [bool]$senior
        talent = [bool]$talent
        tech = [bool]$tech
        finance = [bool]$finance
    }
}

function Get-CompanyOverlapBonus {
    param([double]$CompanyContacts)

    if ($CompanyContacts -ge 50) { return 20 }
    if ($CompanyContacts -ge 20) { return 15 }
    if ($CompanyContacts -ge 10) { return 10 }
    if ($CompanyContacts -ge 5) { return 5 }
    return 0
}

function Get-ContactPriorityScore {
    param(
        [Parameter(Mandatory = $true)]
        $Contact,
        [double]$CompanyContacts
    )

    return (
        (([int](Test-Truthy $Contact.buyerFlag)) * 20) +
        (([int](Test-Truthy $Contact.seniorFlag)) * 20) +
        (([int](Test-Truthy $Contact.talentFlag)) * 25) +
        (([int](Test-Truthy $Contact.techFlag)) * 10) +
        (([int](Test-Truthy $Contact.financeFlag)) * 6) +
        (Get-CompanyOverlapBonus -CompanyContacts $CompanyContacts)
    )
}

function Get-NetworkStrength {
    param(
        [double]$Connections,
        [double]$SeniorContacts
    )

    if ($Connections -ge 50 -or $SeniorContacts -ge 5) { return 'Hot' }
    if ($Connections -ge 10 -or $SeniorContacts -ge 1) { return 'Warm' }
    return 'Cold'
}

function Get-HiringStatus {
    param(
        [double]$JobCount,
        [string]$LastJobPostedAt
    )

    if ($JobCount -le 0) {
        return 'No active jobs'
    }

    if (-not $LastJobPostedAt) {
        return 'Hiring'
    }

    $parsed = [DateTime]::MinValue
    if (-not [DateTime]::TryParse($LastJobPostedAt, [ref]$parsed)) {
        return 'Hiring'
    }

    $ageDays = ((Get-Date) - $parsed).TotalDays
    if ($ageDays -le 7) { return 'Hiring now' }
    if ($ageDays -le 30) { return 'Hiring' }
    return 'Cooling'
}

function Get-PriorityTierFromScore {
    param([double]$TargetScore)

    if ($TargetScore -ge 80) { return 'Tier 1' }
    if ($TargetScore -ge 55) { return 'Tier 2' }
    return 'Tier 3'
}

function Get-PriorityTierBonus {
    param([string]$PriorityTier)

    switch ($PriorityTier) {
        'Tier 1' { return 15 }
        'Tier 2' { return 8 }
        default { return 0 }
    }
}

function Get-ManualPriorityBonus {
    param([string]$Priority)

    switch (([string]$Priority).ToLowerInvariant()) {
        'strategic' { return 18 }
        'high' { return 12 }
        'medium' { return 6 }
        default { return 0 }
    }
}

function Normalize-AccountStatus {
    param([string]$Status)

    switch (([string]$Status).Trim().ToLowerInvariant()) {
        'new' { return 'new' }
        'researching' { return 'researching' }
        'contacted' { return 'contacted' }
        'in_conversation' { return 'in_conversation' }
        'in conversation' { return 'in_conversation' }
        'client' { return 'client' }
        'paused' { return 'paused' }
        'watching' { return 'researching' }
        'active' { return 'new' }
        default { return 'new' }
    }
}

function Normalize-AccountPriority {
    param([string]$Priority)

    switch (([string]$Priority).Trim().ToLowerInvariant()) {
        'strategic' { return 'strategic' }
        'high' { return 'high' }
        'low' { return 'low' }
        default { return 'medium' }
    }
}

function Test-SuppressedCompanyName {
    param([string]$CompanyName)

    $value = Normalize-TextKey $CompanyName
    if (-not $value) {
        return $true
    }

    if ($value -in @(
            'self employed',
            'self-employed',
            'freelance',
            'independent consultant',
            'open to work',
            'seeking opportunities',
            'currently seeking new opportunities',
            'retired',
            'confidential',
            'stealth startup',
            'stealth'
        )) {
        return $true
    }

    return ($value -match 'self[- ]employed|freelance|open to work|seeking .*opportunit|independent consultant')
}

function Get-DepartmentInsights {
    param($Jobs)

    $counts = @{}
    $topDepartment = ''
    $topDepartmentCount = 0
    foreach ($job in @($Jobs)) {
        $department = ([string](Get-ObjectValue -Object $job -Name 'department' -Default 'General')).Trim()
        if (-not $department) {
            $department = 'General'
        }
        if (-not $counts.ContainsKey($department)) {
            $counts[$department] = 0
        }
        $counts[$department] += 1
        if ([int]$counts[$department] -gt $topDepartmentCount) {
            $topDepartment = [string]$department
            $topDepartmentCount = [int]$counts[$department]
        }
    }

    if ($counts.Count -eq 0) {
        return [ordered]@{
            topDepartment = ''
            topDepartmentCount = 0
            concentration = 0
        }
    }

    $total = @($Jobs).Count
    return [ordered]@{
        topDepartment = [string]$topDepartment
        topDepartmentCount = [int]$topDepartmentCount
        concentration = if ($total -gt 0) { [math]::Round(([double]$topDepartmentCount / [double]$total), 2) } else { 0 }
    }
}

function Add-RankedSignalJobEntry {
    param(
        [System.Collections.ArrayList]$RankedJobs,
        $Job,
        [datetime]$Timestamp,
        [int]$Limit = 12
    )

    if ($null -eq $RankedJobs -or $null -eq $Job -or $Limit -lt 1) {
        return
    }

    $entry = [ordered]@{
        job = $Job
        timestamp = $Timestamp
    }

    $insertIndex = -1
    for ($index = 0; $index -lt $RankedJobs.Count; $index++) {
        $existingTimestamp = [DateTime](Get-ObjectValue -Object $RankedJobs[$index] -Name 'timestamp' -Default ([DateTime]::MinValue))
        if ($Timestamp -gt $existingTimestamp) {
            $insertIndex = $index
            break
        }
    }

    if ($insertIndex -ge 0) {
        $RankedJobs.Insert($insertIndex, $entry)
    } elseif ($RankedJobs.Count -lt $Limit) {
        [void]$RankedJobs.Add($entry)
    }

    if ($RankedJobs.Count -gt $Limit) {
        $RankedJobs.RemoveAt($RankedJobs.Count - 1)
    }
}

function Get-FollowUpBonus {
    param(
        [string]$Status,
        [string]$NextActionAt,
        [string]$LastContactedAt
    )

    $normalizedStatus = Normalize-AccountStatus $Status
    if ($normalizedStatus -in @('client', 'paused')) {
        return 0
    }

    $now = Get-Date
    $nextAction = [DateTime]::MinValue
    if ($NextActionAt -and [DateTime]::TryParse([string]$NextActionAt, [ref]$nextAction)) {
        if ($nextAction -le $now) { return 16 }
        if ($nextAction -le $now.AddDays(2)) { return 8 }
    }

    $lastContact = [DateTime]::MinValue
    if ($LastContactedAt -and [DateTime]::TryParse([string]$LastContactedAt, [ref]$lastContact)) {
        $ageDays = ($now - $lastContact).TotalDays
        if ($ageDays -ge 14) { return 12 }
        if ($ageDays -ge 7) { return 5 }
    }

    if ($normalizedStatus -eq 'researching') { return 3 }
    if ($normalizedStatus -eq 'contacted') { return 5 }
    if ($normalizedStatus -eq 'in_conversation') { return 2 }
    return 0
}

function Get-RecencyBonus {
    param([string]$LastJobPostedAt)

    if (-not $LastJobPostedAt) {
        return 0
    }

    $parsed = [DateTime]::MinValue
    if (-not [DateTime]::TryParse($LastJobPostedAt, [ref]$parsed)) {
        return 0
    }

    $ageDays = ((Get-Date) - $parsed).TotalDays
    if ($ageDays -le 3) { return 20 }
    if ($ageDays -le 7) { return 14 }
    if ($ageDays -le 14) { return 8 }
    if ($ageDays -le 30) { return 3 }
    return 0
}

function Get-OutreachDraft {
    param($Company)

    $draft = Build-SmartOutreachDraft -Account $Company -Jobs @() -Contacts @()
    return [string](Get-ObjectValue -Object $draft -Name 'message_body' -Default '')
}

function Get-CompanyRecommendationSignature {
    param($Company)

    $topAlert = @(
        @($(if (Get-ObjectValue -Object $Company -Name 'triggerAlerts' -Default $null) { Get-ObjectValue -Object $Company -Name 'triggerAlerts' -Default @() } else { @() })) |
            Sort-Object @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'priorityScore' -Default 0)) }; Descending = $true } |
            Select-Object -First 1
    )
    $sequenceState = Get-ObjectValue -Object $Company -Name 'sequenceState' -Default $null
    $connectionGraph = Get-ObjectValue -Object $Company -Name 'connectionGraph' -Default $null
    $warmIntroCandidates = @($(if ($connectionGraph) { Get-ObjectValue -Object $connectionGraph -Name 'warmIntroCandidates' -Default @() } else { @() }))
    $shortestPath = if ($connectionGraph) { Get-ObjectValue -Object $connectionGraph -Name 'shortestPathToDecisionMaker' -Default $null } else { $null }
    $topWarmName = if ($warmIntroCandidates.Count -gt 0) { [string](Get-ObjectValue -Object $warmIntroCandidates[0] -Name 'fullName' -Default '') } else { '' }
    $topAlertType = if ($topAlert.Count -gt 0) { [string](Get-ObjectValue -Object $topAlert[0] -Name 'type' -Default '') } else { '' }
    $topAlertPriority = if ($topAlert.Count -gt 0) { [int](Convert-ToNumber (Get-ObjectValue -Object $topAlert[0] -Name 'priorityScore' -Default 0)) } else { 0 }
    $pathLength = if ($shortestPath) { [int](Convert-ToNumber (Get-ObjectValue -Object $shortestPath -Name 'pathLength' -Default 0)) } else { 0 }

    return [string]::Join('|', @(
            [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'nextAction' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'staleFlag' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'outreachStatus' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'networkStrength' -Default ''),
            [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobCount' -Default 0)),
            [string](Get-ObjectValue -Object $sequenceState -Name 'stopReason' -Default ''),
            $topAlertType,
            $topAlertPriority,
            $pathLength,
            $topWarmName
        ))
}

function Get-CompanyOutreachDraftSignature {
    param($Company)

    $sequenceState = Get-ObjectValue -Object $Company -Name 'sequenceState' -Default $null
    $connectionGraph = Get-ObjectValue -Object $Company -Name 'connectionGraph' -Default $null
    $warmIntroCandidates = @($(if ($connectionGraph) { Get-ObjectValue -Object $connectionGraph -Name 'warmIntroCandidates' -Default @() } else { @() }))
    $topWarm = if ($warmIntroCandidates.Count -gt 0) { $warmIntroCandidates[0] } else { $null }

    return [string]::Join('|', @(
            [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'industry' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'departmentFocus' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'networkStrength' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'recommendedAction' -Default ''),
            [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'openRoleCount' -Default 0)),
            [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast30Days' -Default 0)),
            [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast90Days' -Default 0)),
            [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'newRoleCount7d' -Default 0)),
            [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'staleRoleCount30d' -Default 0)),
            [string]([Math]::Round((Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringSpikeRatio' -Default 0)), 2)),
            [string](Get-ObjectValue -Object $Company -Name 'outreachStatus' -Default ''),
            [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'daysSinceContact' -Default 0)),
            [string](Get-ObjectValue -Object $Company -Name 'lastContactedAt' -Default ''),
            [string](Get-ObjectValue -Object $sequenceState -Name 'status' -Default ''),
            [string](Get-ObjectValue -Object $sequenceState -Name 'nextStepLabel' -Default ''),
            [string](Get-ObjectValue -Object $sequenceState -Name 'nextStepAt' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'topContactName' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'topContactTitle' -Default ''),
            [string](Get-ObjectValue -Object $topWarm -Name 'fullName' -Default ''),
            [string](Get-ObjectValue -Object $topWarm -Name 'title' -Default '')
        ))
}

function Get-ConnectionGraphSignatureData {
    param(
        $Company,
        $Contacts = $null,
        $Activities = $null
    )

    $pastPlacementCount = Get-CompanyPastPlacementCount -Company $Company -Activities $Activities
    $parts = New-Object System.Collections.ArrayList
    [void]$parts.Add([string](Get-ObjectValue -Object $Company -Name 'displayName' -Default ''))
    [void]$parts.Add([string]$pastPlacementCount)
    [void]$parts.Add([string]@($Contacts).Count)

    foreach ($contact in @($Contacts)) {
        if ($null -eq $contact) {
            continue
        }
        [void]$parts.Add(([string]::Join('|', @(
                        [string](Get-ObjectValue -Object $contact -Name 'id' -Default ''),
                        [string](Get-ObjectValue -Object $contact -Name 'fullName' -Default ''),
                        [string](Get-ObjectValue -Object $contact -Name 'title' -Default ''),
                        [string](Convert-ToNumber (Get-ObjectValue -Object $contact -Name 'yearsConnected' -Default 0)),
                        [string](Convert-ToNumber (Get-ObjectValue -Object $contact -Name 'priorityScore' -Default 0)),
                        [string](Convert-ToNumber (Get-ObjectValue -Object $contact -Name 'companyOverlapCount' -Default 0)),
                        [string](Test-Truthy (Get-ObjectValue -Object $contact -Name 'seniorFlag' -Default $false)),
                        [string](Test-Truthy (Get-ObjectValue -Object $contact -Name 'buyerFlag' -Default $false)),
                        [string](Test-Truthy (Get-ObjectValue -Object $contact -Name 'talentFlag' -Default $false)),
                        [string](Get-ObjectValue -Object $contact -Name 'connectedOn' -Default ''),
                        [string](Get-ObjectValue -Object $contact -Name 'linkedinUrl' -Default ''),
                        [string](Get-ObjectValue -Object $contact -Name 'email' -Default '')
                    ))))
    }

    return [ordered]@{
        signature = [string]::Join('||', @($parts.ToArray()))
        pastPlacementCount = [int]$pastPlacementCount
    }
}

function Join-NaturalLanguageList {
    param([string[]]$Values)

    $items = @($Values | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
    switch ($items.Count) {
        0 { return '' }
        1 { return [string]$items[0] }
        2 { return ('{0} and {1}' -f $items[0], $items[1]) }
        default {
            $leading = @($items | Select-Object -First ($items.Count - 1))
            return ('{0}, and {1}' -f ([string]::Join(', ', $leading)), $items[-1])
        }
    }
}

function Limit-TextWords {
    param(
        [string]$Text,
        [int]$MaxWords = 75
    )

    $value = [string]$Text
    if ([string]::IsNullOrWhiteSpace($value) -or $MaxWords -le 0) {
        return $value.Trim()
    }

    $words = @([regex]::Matches($value.Trim(), '\S+') | ForEach-Object { $_.Value })
    if ($words.Count -le $MaxWords) {
        return $value.Trim()
    }

    return ([string]::Join(' ', @($words | Select-Object -First $MaxWords))).Trim()
}

function Get-OutreachRoleTitleInsights {
    param(
        $Jobs,
        [int]$Limit = 3
    )

    $titleCounts = @{}
    foreach ($job in @($Jobs)) {
        $title = [string](Get-ObjectValue -Object $job -Name 'title' -Default '')
        if ([string]::IsNullOrWhiteSpace($title)) { continue }
        $cleanTitle = $title.Trim()
        if (-not $titleCounts.ContainsKey($cleanTitle)) {
            $titleCounts[$cleanTitle] = 0
        }
        $titleCounts[$cleanTitle] += 1
    }

    $titles = @(
        $titleCounts.GetEnumerator() |
            Sort-Object @{ Expression = { [int]$_.Value }; Descending = $true }, @{ Expression = { [string]$_.Key }; Descending = $false } |
            Select-Object -First $Limit |
            ForEach-Object { [string]$_.Key }
    )

    return [ordered]@{
        items = $titles
        summary = Join-NaturalLanguageList -Values $titles
    }
}

function Get-OutreachPatternInsights {
    param(
        $Jobs,
        [hashtable]$PatternMap,
        [hashtable]$JobSignalTextCache = $null,
        [int]$Limit = 3
    )

    $scores = @{}
    foreach ($label in @($PatternMap.Keys)) {
        $scores[[string]$label] = 0
    }

    foreach ($job in @($Jobs)) {
        $jobText = Get-CachedJobSignalText -Job $job -Cache $JobSignalTextCache -MaxLength 2200
        if ([string]::IsNullOrWhiteSpace($jobText)) { continue }
        foreach ($label in @($PatternMap.Keys)) {
            $pattern = [string]$PatternMap[$label]
            if ($jobText -match $pattern) {
                $scores[[string]$label] += 1
            }
        }
    }

    $items = @(
        $scores.GetEnumerator() |
            Where-Object { [int]$_.Value -gt 0 } |
            Sort-Object @{ Expression = { [int]$_.Value }; Descending = $true }, @{ Expression = { [string]$_.Key }; Descending = $false } |
            Select-Object -First $Limit |
            ForEach-Object { [string]$_.Key }
    )

    return [ordered]@{
        items = $items
        summary = Join-NaturalLanguageList -Values $items
    }
}

function Get-OutreachKeywordInsights {
    param(
        $Jobs,
        [hashtable]$JobSignalTextCache = $null,
        [int]$Limit = 3
    )

    $patternMap = [ordered]@{
        'platform engineering' = '\b(platform|backend|distributed systems?|api|microservices?)\b'
        'data engineering' = '\b(data engineering|data platform|etl|analytics engineering|warehouse|bi|snowflake|databricks|spark)\b'
        'cloud infrastructure' = '\b(cloud|infrastructure|sre|site reliability|devops|terraform|kubernetes|observability)\b'
        'security' = '\b(security|iam|identity|compliance|risk|soc 2|iso 27001|privacy)\b'
        'machine learning' = '\b(machine learning|ml|ai|artificial intelligence|llm|model)\b'
        'product and design' = '\b(product manager|product management|ux|ui|design|research)\b'
        'go-to-market' = '\b(account executive|sales|revenue operations|revops|marketing|growth|demand generation|customer success)\b'
        'finance systems' = '\b(finance|accounting|controller|fp&a|netsuite|sap|erp|billing)\b'
        'talent acquisition' = '\b(recruiter|talent acquisition|sourcer|people operations|hris)\b'
    }

    return (Get-OutreachPatternInsights -Jobs $Jobs -PatternMap $patternMap -JobSignalTextCache $JobSignalTextCache -Limit $Limit)
}

function Get-OutreachTechStackInsights {
    param(
        $Jobs,
        [hashtable]$JobSignalTextCache = $null,
        [int]$Limit = 3
    )

    $patternMap = [ordered]@{
        'TypeScript' = '\btypescript\b'
        'JavaScript' = '\bjavascript\b'
        'React' = '\breact\b'
        'Node' = '\bnode(\.js)?\b'
        '.NET' = '\b\.net\b|\bdotnet\b'
        'C#' = '\bc#\b'
        'Java' = '\bjava\b'
        'Python' = '\bpython\b'
        'Go' = '\bgo(lang)?\b'
        'AWS' = '\baws\b|amazon web services'
        'Azure' = '\bazure\b'
        'GCP' = '\bgcp\b|google cloud'
        'Kubernetes' = '\bkubernetes\b|\bk8s\b'
        'Terraform' = '\bterraform\b'
        'Snowflake' = '\bsnowflake\b'
        'Databricks' = '\bdatabricks\b'
        'Salesforce' = '\bsalesforce\b'
        'NetSuite' = '\bnetsuite\b'
        'Workday' = '\bworkday\b'
        'ServiceNow' = '\bservicenow\b'
        'Kafka' = '\bkafka\b'
        'PostgreSQL' = '\bpostgres(ql)?\b'
        'MongoDB' = '\bmongodb\b'
        'Docker' = '\bdocker\b'
    }

    return (Get-OutreachPatternInsights -Jobs $Jobs -PatternMap $patternMap -JobSignalTextCache $JobSignalTextCache -Limit $Limit)
}

function Get-OutreachRoleFamilyInsights {
    param(
        $Jobs,
        [hashtable]$JobSignalTextCache = $null,
        [int]$Limit = 3
    )

    $patternMap = [ordered]@{
        'machine learning' = '\b(machine learning|ml|ai|artificial intelligence|llm|research scientist|applied scientist|model)\b'
        'data' = '\b(data engineer|analytics engineering|data platform|etl|warehouse|bi|databricks|snowflake|spark)\b'
        'platform / infrastructure' = '\b(platform|infrastructure|devops|sre|site reliability|cloud|distributed systems?|backend|api)\b'
        'security' = '\b(security|iam|identity|compliance|risk|privacy)\b'
        'product and design' = '\b(product manager|product management|ux|ui|design|research)\b'
        'go-to-market' = '\b(account executive|sales|marketing|customer success|growth|revops|revenue operations)\b'
        'finance / operations' = '\b(finance|accounting|controller|fp&a|operations|manufacturing|supply chain|quality|logistics|bring-up)\b'
        'talent' = '\b(recruiter|talent acquisition|sourcer|people operations|hris|people systems)\b'
    }

    return (Get-OutreachPatternInsights -Jobs $Jobs -PatternMap $patternMap -JobSignalTextCache $JobSignalTextCache -Limit $Limit)
}

function Get-OutreachPossessiveLabel {
    param([string]$Value)

    $label = ([string]$Value).Trim()
    if (-not $label) { return '' }
    if ($label -match '[sS]$') {
        return ('{0}''' -f $label)
    }
    return ('{0}''s' -f $label)
}

function Get-OutreachContactContext {
    param(
        $Contacts,
        [string]$OverrideContactName = '',
        [string]$OverrideContactTitle = ''
    )

    $selected = $null
    $overrideName = ([string]$OverrideContactName).Trim()
    $overrideTitle = ([string]$OverrideContactTitle).Trim()

    if ($overrideName) {
        $selected = @(
            $Contacts |
                Where-Object {
                    [string](Get-ObjectValue -Object $_ -Name 'fullName' -Default '') -eq $overrideName -and
                    [string](Get-ObjectValue -Object $_ -Name 'title' -Default '') -eq $overrideTitle
                } |
                Select-Object -First 1
        )
        if (-not $selected) {
            $selected = @(
                $Contacts |
                    Where-Object { [string](Get-ObjectValue -Object $_ -Name 'fullName' -Default '') -eq $overrideName } |
                    Select-Object -First 1
            )
        }
    }

    if (-not $selected) {
        $selected = @($Contacts | Select-Object -First 1)
    }

    $resolved = if ($selected) { $selected[0] } else { $null }
    $name = if ($overrideName) { $overrideName } elseif ($resolved) { [string](Get-ObjectValue -Object $resolved -Name 'fullName' -Default '') } else { '' }
    $title = if ($overrideTitle) { $overrideTitle } elseif ($resolved) { [string](Get-ObjectValue -Object $resolved -Name 'title' -Default '') } else { '' }
    $talentFlag = if ($resolved) { [bool](Test-Truthy (Get-ObjectValue -Object $resolved -Name 'talentFlag' -Default $false)) } else { $false }
    $seniorFlag = if ($resolved) { [bool](Test-Truthy (Get-ObjectValue -Object $resolved -Name 'seniorFlag' -Default $false)) } else { $false }
    $buyerFlag = if ($resolved) { [bool](Test-Truthy (Get-ObjectValue -Object $resolved -Name 'buyerFlag' -Default $false)) } else { $false }
    $techFlag = if ($resolved) { [bool](Test-Truthy (Get-ObjectValue -Object $resolved -Name 'techFlag' -Default $false)) } else { $false }
    $financeFlag = if ($resolved) { [bool](Test-Truthy (Get-ObjectValue -Object $resolved -Name 'financeFlag' -Default $false)) } else { $false }
    $linkedinUrl = if ($resolved) { [string](Get-ObjectValue -Object $resolved -Name 'linkedinUrl' -Default '') } else { '' }

    return [ordered]@{
        name = $name
        title = $title
        known = [bool]$resolved
        talentFlag = $talentFlag
        seniorFlag = $seniorFlag
        buyerFlag = $buyerFlag
        techFlag = $techFlag
        financeFlag = $financeFlag
        linkedinUrl = $linkedinUrl
    }
}

function Get-OutreachTemplateProfile {
    param([string]$Template = 'cold')

    $templateKey = if ([string]::IsNullOrWhiteSpace([string]$Template)) { 'cold' } else { ([string]$Template).Trim().ToLowerInvariant() }
    switch ($templateKey) {
        'talent_partner' { return [ordered]@{ key = 'talent_partner'; label = 'Talent / recruiter note'; personaHint = 'talent'; buttonLabel = 'Generate recruiter note' } }
        'hiring_manager' { return [ordered]@{ key = 'hiring_manager'; label = 'Hiring manager note'; personaHint = 'leader'; buttonLabel = 'Generate hiring-manager note' } }
        'executive' { return [ordered]@{ key = 'executive'; label = 'Executive note'; personaHint = 'executive'; buttonLabel = 'Generate executive note' } }
        'follow_up' { return [ordered]@{ key = 'follow_up'; label = 'Follow-up note'; personaHint = ''; buttonLabel = 'Generate follow-up' } }
        're_engage' { return [ordered]@{ key = 're_engage'; label = 'Re-engagement note'; personaHint = ''; buttonLabel = 'Generate re-engagement note' } }
        'warm_intro' { return [ordered]@{ key = 'warm_intro'; label = 'Warm intro note'; personaHint = ''; buttonLabel = 'Generate warm intro' } }
        default { return [ordered]@{ key = 'cold'; label = 'Hiring signal note'; personaHint = ''; buttonLabel = 'Generate tailored note' } }
    }
}

function Get-OutreachPersonaProfile {
    param(
        $Account,
        $ContactContext,
        $TemplateProfile
    )

    $title = ([string](Get-ObjectValue -Object $ContactContext -Name 'title' -Default '')).Trim()
    $titleKey = Normalize-TextKey $title
    $personaKey = [string](Get-ObjectValue -Object $TemplateProfile -Name 'personaHint' -Default '')
    $talentContactCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'talentContactCount' -Default 0))

    if (-not $personaKey) {
        if ((Get-ObjectValue -Object $ContactContext -Name 'talentFlag' -Default $false) -or $titleKey -match 'recruit|talent|people|staffing|sourc|human resources|hrbp|people ops') {
            $personaKey = 'talent'
        } elseif ($titleKey -match 'founder|chief|ceo|coo|cto|cfo|cio|president|svp|evp|vp|general manager|gm') {
            $personaKey = 'executive'
        } elseif ((Get-ObjectValue -Object $ContactContext -Name 'techFlag' -Default $false) -or $titleKey -match 'engineer|product|data|security|platform|infrastructure|head|director|manager|lead|principal|architect') {
            $personaKey = 'leader'
        } elseif ((Get-ObjectValue -Object $ContactContext -Name 'seniorFlag' -Default $false)) {
            $personaKey = 'leader'
        } elseif ($talentContactCount -gt 0) {
            $personaKey = 'talent'
        } else {
            $personaKey = 'general'
        }
    }

    switch ($personaKey) {
        'talent' {
            return [ordered]@{
                key = 'talent'
                label = 'Talent / recruiting angle'
                pressureLine = 'When that mix ramps, recruiting teams usually feel it first in search prioritization, niche pipeline coverage, and hiring-manager bandwidth.'
                capabilityLine = 'Talencity helps internal TA teams close hard-to-fill searches without adding more coordination load.'
                contactLead = 'Lead with recruiter bandwidth and the specialist searches most likely to drag.'
                callPrompt = 'Where is the recruiting load or specialist search coverage starting to pinch most right now?'
            }
        }
        'leader' {
            return [ordered]@{
                key = 'leader'
                label = 'Hiring leader angle'
                pressureLine = 'When that hiring mix ramps, the pain usually shows up in specialist coverage, interview drag, and team bandwidth.'
                capabilityLine = 'Talencity helps leaders land hard-to-find builders without pulling core interviewers deeper into the search.'
                contactLead = 'Lead with delivery risk, interview load, and the hardest roles to close.'
                callPrompt = 'Which roles in the current mix are pulling the most time from the team?'
            }
        }
        'executive' {
            return [ordered]@{
                key = 'executive'
                label = 'Executive angle'
                pressureLine = 'That kind of hiring burst usually shows up as execution pressure before it shows up cleanly in the headcount plan.'
                capabilityLine = 'Talencity helps teams add critical talent quickly without building permanent recruiting overhead.'
                contactLead = 'Lead with headcount pace, delivery risk, and where external support speeds hiring.'
                callPrompt = 'Which part of the hiring plan feels most exposed if the team has to keep this pace for another quarter?'
            }
        }
        default {
            return [ordered]@{
                key = 'general'
                label = 'Hiring signal angle'
                pressureLine = 'That usually signals real capacity pressure, not just a routine backfill cycle.'
                capabilityLine = 'Talencity helps teams close hard-to-fill searches when internal hiring bandwidth gets thin.'
                contactLead = 'Lead with the current hiring pressure while the signal is still fresh.'
                callPrompt = 'Where is the current hiring mix starting to bottleneck?'
            }
        }
    }
}

function Build-SmartOutreachDraft {
    param(
        [Parameter(Mandatory = $true)]$Account,
        [Parameter(Mandatory = $true)]$Jobs,
        [Parameter(Mandatory = $true)]$Contacts,
        [string]$BookingLink = 'https://tinyurl.com/ysdep7cn',
        [string]$CompanySnippet = '',
        [string]$OverrideContactName = '',
        [string]$OverrideContactTitle = '',
        [string]$Template = 'cold'
    )

    $companyName = [string]$Account.displayName
    $possessiveCompanyName = Get-OutreachPossessiveLabel -Value $companyName
    $industry = [string](Get-ObjectValue -Object $Account -Name 'industry' -Default '')
    $departmentFocus = [string](Get-ObjectValue -Object $Account -Name 'departmentFocus' -Default '')
    $networkStrength = [string](Get-ObjectValue -Object $Account -Name 'networkStrength' -Default '')
    $recommendedAction = [string](Get-ObjectValue -Object $Account -Name 'recommendedAction' -Default '')
    $jobSignalTextCache = @{}
    $activeJobs = @($Jobs | Where-Object { $null -ne $_ -and (Get-ObjectValue -Object $_ -Name 'active' -Default $true) -ne $false })
    $openRoles = if ($activeJobs.Count -gt 0) { $activeJobs.Count } else { [int](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'openRoleCount' -Default 0)) }
    $jobsLast30Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'jobsLast30Days' -Default 0))
    $jobsLast90Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'jobsLast90Days' -Default 0))
    $newRoleCount7d = [int](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'newRoleCount7d' -Default 0))
    $staleRoleCount30d = [int](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'staleRoleCount30d' -Default 0))
    $hiringSpikeRatio = [double](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'hiringSpikeRatio' -Default 0))
    $outreachStatus = [string](Get-ObjectValue -Object $Account -Name 'outreachStatus' -Default 'not_started')
    $daysSinceContact = [int](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'daysSinceContact' -Default 0))
    $lastContactedAt = Get-ObjectValue -Object $Account -Name 'lastContactedAt' -Default $null
    $sequenceStatus = [string](Get-ObjectValue -Object (Get-ObjectValue -Object $Account -Name 'sequenceState' -Default $null) -Name 'status' -Default '')
    $sequenceNextStep = [string](Get-ObjectValue -Object (Get-ObjectValue -Object $Account -Name 'sequenceState' -Default $null) -Name 'nextStepLabel' -Default '')
    $sequenceNextStepAt = Get-ObjectValue -Object (Get-ObjectValue -Object $Account -Name 'sequenceState' -Default $null) -Name 'nextStepAt' -Default $null
    $contactContext = Get-OutreachContactContext -Contacts $Contacts -OverrideContactName $OverrideContactName -OverrideContactTitle $OverrideContactTitle
    $templateProfile = Get-OutreachTemplateProfile -Template $Template
    $personaProfile = Get-OutreachPersonaProfile -Account $Account -ContactContext $contactContext -TemplateProfile $templateProfile
    $roleTitleInsights = Get-OutreachRoleTitleInsights -Jobs $activeJobs
    $roleFamilyInsights = Get-OutreachRoleFamilyInsights -Jobs $activeJobs -JobSignalTextCache $jobSignalTextCache
    $roleKeywordInsights = Get-OutreachKeywordInsights -Jobs $activeJobs -JobSignalTextCache $jobSignalTextCache
    $techStackInsights = Get-OutreachTechStackInsights -Jobs $activeJobs -JobSignalTextCache $jobSignalTextCache

    $focusItems = @()
    if ($roleFamilyInsights.items.Count -gt 0) {
        $focusItems = @($roleFamilyInsights.items | Select-Object -First 2)
    } elseif ($roleKeywordInsights.items.Count -gt 0) {
        $focusItems = @($roleKeywordInsights.items | Select-Object -First 2)
    } elseif ($techStackInsights.items.Count -gt 0) {
        $focusItems = @($techStackInsights.items | Select-Object -First 2)
    } elseif ($departmentFocus) {
        $focusItems = @([string]$departmentFocus)
    } elseif ($roleTitleInsights.items.Count -gt 0) {
        $focusItems = @($roleTitleInsights.items | Select-Object -First 1)
    }

    $focusSummary = if ($focusItems.Count -gt 0) {
        Join-NaturalLanguageList -Values @($focusItems)
    } elseif ($departmentFocus) {
        [string]$departmentFocus
    } else {
        ''
    }
    $focusLabel = if ($focusItems.Count -gt 0) {
        [string]::Join(' + ', @($focusItems))
    } elseif ($openRoles -gt 0) {
        ('{0} open role{1}' -f $openRoles, $(if ($openRoles -eq 1) { '' } else { 's' }))
    } else {
        'current hiring pressure'
    }

    $whyNow = if ($jobsLast30Days -gt 0 -and $focusSummary -and $hiringSpikeRatio -ge 1.3) {
        '{0} roles opened in the last 30 days, a {1}x spike versus baseline, concentrated around {2}.' -f $jobsLast30Days, ([Math]::Round($hiringSpikeRatio, 2)), $focusSummary
    } elseif ($jobsLast30Days -gt 0 -and $focusSummary) {
        '{0} roles opened in the last 30 days, with hiring concentrated around {1}.' -f $jobsLast30Days, $focusSummary
    } elseif ($openRoles -gt 0 -and $focusSummary) {
        '{0} open roles live now across {1}.' -f $openRoles, $focusSummary
    } elseif ($jobsLast90Days -gt 0 -and $focusSummary) {
        '{0} roles over the last 90 days, with the current mix centered on {1}.' -f $jobsLast90Days, $focusSummary
    } elseif ($CompanySnippet) {
        [string]$CompanySnippet
    } elseif ($openRoles -gt 0) {
        '{0} open roles live right now.' -f $openRoles
    } else {
        'Live hiring motion is still visible.'
    }

    $leadSentence = switch ($templateProfile.key) {
        'warm_intro' { 'Since we are already connected, I will keep this direct.'; break }
        'follow_up' {
            if ($daysSinceContact -gt 0) {
                'Circling back because the hiring signal still looks active, and it has been {0} day{1} since the last touch.' -f $daysSinceContact, $(if ($daysSinceContact -eq 1) { '' } else { 's' })
            } else {
                'Circling back because the hiring signal still looks active.'
            }
            break
        }
        're_engage' {
            if ($daysSinceContact -gt 0) {
                'Reaching back out because the hiring picture looks materially more active now than it did {0} day{1} ago.' -f $daysSinceContact, $(if ($daysSinceContact -eq 1) { '' } else { 's' })
            } else {
                'Reaching back out because the hiring picture looks materially more active now.'
            }
            break
        }
        default { '' }
    }

    if ($jobsLast30Days -gt 0 -and $focusSummary -and $hiringSpikeRatio -ge 1.3) {
        $firstSentence = 'Saw {0} has opened {1} roles in the last 30 days, with hiring spiking across {2}.' -f $companyName, $jobsLast30Days, $focusSummary
    } elseif ($jobsLast30Days -gt 0 -and $focusSummary) {
        $firstSentence = 'Saw {0} has opened {1} roles in the last 30 days, especially across {2}.' -f $companyName, $jobsLast30Days, $focusSummary
    } elseif ($openRoles -gt 0 -and $focusSummary) {
        $firstSentence = 'Saw {0} is carrying {1} open roles across {2}.' -f $companyName, $openRoles, $focusSummary
    } elseif ($jobsLast90Days -gt 0 -and $focusSummary) {
        $firstSentence = 'Saw {0} has kept hiring active across {1}, with {2} roles in the last 90 days.' -f $companyName, $focusSummary, $jobsLast90Days
    } elseif ($openRoles -gt 0) {
        $firstSentence = 'Saw {0} is carrying {1} open roles right now.' -f $companyName, $openRoles
    } elseif ($CompanySnippet) {
        $firstSentence = '{0} looks to be in an active build phase: {1}' -f $companyName, $CompanySnippet
    } else {
        $firstSentence = 'Saw live hiring motion at {0}.' -f $companyName
    }

    $contextSentence = if ($industry -and $techStackInsights.summary -and $personaProfile.key -eq 'executive') {
        'In {0}, that usually means the operating plan is moving faster than the internal team can comfortably absorb.' -f $industry
    } elseif ($industry -and $techStackInsights.summary) {
        'In {0}, that usually means the team is adding capability around {1}, not just backfilling.' -f $industry, $techStackInsights.summary
    } elseif ($techStackInsights.summary -and $roleKeywordInsights.summary) {
        'The mix of {0} work and repeated mentions of {1} usually signals a real build push, not routine backfill.' -f $roleKeywordInsights.summary, $techStackInsights.summary
    } else {
        [string]$personaProfile.pressureLine
    }

    $capabilityFocus = if ($focusSummary) { $focusSummary } elseif ($departmentFocus) { $departmentFocus } else { 'specialist' }
    $capabilitySentence = switch ($personaProfile.key) {
        'talent' { 'Talencity helps internal TA teams close hard-to-fill {0} searches without adding more coordination load.' -f $capabilityFocus; break }
        'leader' { 'Talencity helps teams land hard-to-find {0} talent without pulling hiring leaders deeper into the search.' -f $capabilityFocus; break }
        'executive' { 'Talencity helps companies add critical {0} talent quickly without building permanent recruiting overhead.' -f $capabilityFocus; break }
        default { 'Talencity helps teams close hard-to-fill {0} searches when internal bandwidth gets thin.' -f $capabilityFocus }
    }

    $closeSentence = switch ($templateProfile.key) {
        'follow_up' { 'If this is still live, I can send a sharper take on which searches in that cluster are most likely to bottleneck first.'; break }
        're_engage' { 'If the plan is active again, I can send a fresh point of view on which searches are most likely to stall.'; break }
        'warm_intro' { 'If helpful, I can send a concise take on which searches in the cluster look hardest to close.'; break }
        'talent_partner' { 'If useful, I can send a quick prioritization view on where outside support would help fastest.'; break }
        'hiring_manager' { 'If helpful, I can share where I would expect interview drag or specialist coverage risk to show up first.'; break }
        'executive' { 'If useful, I can send a short view on where I would focus first to keep the hiring plan moving.'; break }
        default { 'If helpful, I can send a quick read on which searches in this cluster are most likely to bottleneck first.' }
    }
    if (($templateProfile.key -eq 'cold' -or $templateProfile.key -eq 'talent_partner' -or $templateProfile.key -eq 'hiring_manager') -and ($outreachStatus -eq 'contacted' -or $outreachStatus -eq 'researching') -and $daysSinceContact -ge 10) {
        $closeSentence = 'Since there was already a touch on this account, I can keep the follow-up tight and focused on the searches most likely to drag.'
    }

    $messageParts = @($leadSentence, $firstSentence, $contextSentence, $capabilitySentence, $closeSentence) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
    $messageBody = Limit-TextWords -Text ([string]::Join(' ', $messageParts)) -MaxWords 90

    $subjectOptions = @()
    switch ($templateProfile.key) {
        'follow_up' {
            $subjectOptions += ('Following up on {0} current hiring mix' -f $possessiveCompanyName)
            $subjectOptions += ('Still relevant for {0} hiring plan?' -f $possessiveCompanyName)
        }
        're_engage' {
            $subjectOptions += ('Worth revisiting {0} hiring plan?' -f $possessiveCompanyName)
            $subjectOptions += ('{0}: fresh hiring signal' -f $companyName)
        }
        'warm_intro' {
            $subjectOptions += ('Quick thought on {0} hiring' -f $companyName)
            $subjectOptions += ('A hiring angle for {0}' -f $companyName)
        }
        'talent_partner' {
            $subjectOptions += ('{0}: support for the current hiring load' -f $companyName)
            $subjectOptions += ('Where {0} search load may tighten' -f $possessiveCompanyName)
        }
        'hiring_manager' {
            $subjectOptions += ('{0}: scaling {1}' -f $companyName, $focusLabel)
            $subjectOptions += ('Where {0} hiring mix may bottleneck' -f $possessiveCompanyName)
        }
        'executive' {
            $subjectOptions += ('{0}: current headcount pressure' -f $companyName)
            $subjectOptions += ('Keeping {0} hiring plan moving' -f $possessiveCompanyName)
        }
        default {
            $subjectOptions += ('{0}: {1}' -f $companyName, $focusLabel)
            $subjectOptions += ('Where {0} current hiring mix may bottleneck' -f $possessiveCompanyName)
        }
    }
    $subjectOptions += ('Quick POV on {0} hiring pressure' -f $possessiveCompanyName)
    $subjectOptions = @($subjectOptions | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
    $subjectLine = if ($subjectOptions.Count -gt 0) { [string]$subjectOptions[0] } else { '{0}: hiring signal' -f $companyName }

    $contactName = [string](Get-ObjectValue -Object $contactContext -Name 'name' -Default '')
    $contactTitle = [string](Get-ObjectValue -Object $contactContext -Name 'title' -Default '')
    $greetingName = if ($contactName) { $contactName } else { 'there' }
    $linkedinOpen = if ($contactName) { 'Hi {0} -' -f $contactName } else { 'Hi -' }
    $linkedinParts = @(
        $linkedinOpen,
        ('saw {0} has {1} active around {2}.' -f $companyName, $(if ($jobsLast30Days -gt 0) { "$jobsLast30Days new roles in the last 30 days" } elseif ($openRoles -gt 0) { "$openRoles open roles right now" } else { 'live hiring motion' }), $(if ($focusSummary) { $focusSummary } else { 'core hiring' })),
        $(if ($personaProfile.key -eq 'talent') { 'That usually gets painful around prioritization and specialist pipeline coverage.' } elseif ($personaProfile.key -eq 'executive') { 'That kind of pace usually shows up as delivery pressure pretty quickly.' } else { 'That usually gets painful around specialist coverage and interview bandwidth.' }),
        'If useful, happy to send a quick take on which searches look hardest to close first.'
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
    $linkedinMessage = Limit-TextWords -Text ([string]::Join(' ', $linkedinParts)) -MaxWords 65

    $followUpParts = @(
        $(if ($contactName) { 'Hi {0},' -f $contactName } else { 'Hi,' }),
        ('circling back because {0} hiring signal still looks active, especially around {1}.' -f $possessiveCompanyName, $(if ($focusSummary) { $focusSummary } else { 'the current search mix' })),
        'If it would help, I can send a concise read on the roles I would expect to drag first and where external help is most useful.'
    )
    $followUpMessage = Limit-TextWords -Text ([string]::Join(' ', $followUpParts)) -MaxWords 65

    $callOpener = Limit-TextWords -Text ([string]::Join(' ', @(
                ('Saw {0} has {1} active around {2}.' -f $companyName, $(if ($jobsLast30Days -gt 0) { "$jobsLast30Days recent roles" } elseif ($openRoles -gt 0) { "$openRoles open roles" } else { 'live hiring motion' }), $(if ($focusSummary) { $focusSummary } else { 'the current search mix' })),
                [string]$personaProfile.capabilityLine,
                [string]$personaProfile.callPrompt
            ))) -MaxWords 55

    $contactRoute = if ($contactName -and $contactTitle) {
        '{0} ({1})' -f $contactName, $contactTitle
    } elseif ($contactName) {
        $contactName
    } else {
        ''
    }
    $contactHook = if ($contactRoute) {
        'Best route: {0}. {1}' -f $contactRoute, ([string]$personaProfile.contactLead)
    } elseif ($recommendedAction) {
        $recommendedAction
    } elseif ($networkStrength -eq 'Hot' -or $networkStrength -eq 'Warm') {
        'Lead with the live hiring signal and keep the ask tight while the network path is still warm.'
    } else {
        'Lead with the current hiring pressure and a concrete point of view on which searches will be hardest to close.'
    }
    if (($outreachStatus -eq 'contacted' -or $outreachStatus -eq 'researching') -and $daysSinceContact -gt 0) {
        $contactHook = '{0} Last touch was {1} day{2} ago, so the angle should sound like a focused continuation rather than a fresh cold note.' -f $contactHook, $daysSinceContact, $(if ($daysSinceContact -eq 1) { '' } else { 's' })
    }

    $angleSummary = switch ($templateProfile.key) {
        'follow_up' { 'Follow-up on a still-active hiring signal'; break }
        're_engage' { 'Re-open the thread with fresher hiring evidence'; break }
        'warm_intro' { 'Use the warm path and keep the message concise'; break }
        default { '{0} with live hiring evidence' -f [string]$personaProfile.label }
    }
    $sequenceGuidance = if ($sequenceStatus -eq 'active' -and $sequenceNextStep) {
        '{0}{1}' -f $sequenceNextStep, $(if ($sequenceNextStepAt) { ' due ' + ([string]$sequenceNextStepAt) } else { '' })
    } elseif ($daysSinceContact -gt 0) {
        'Last contact was {0} day{1} ago.' -f $daysSinceContact, $(if ($daysSinceContact -eq 1) { '' } else { 's' })
    } else {
        ''
    }

    return [ordered]@{
        template_key = [string](Get-ObjectValue -Object $templateProfile -Name 'key' -Default 'cold')
        subject_line = $subjectLine.Trim()
        subject_options = @($subjectOptions)
        message_body = $messageBody.Trim()
        outreach = $messageBody.Trim()
        linkedin_message = $linkedinMessage.Trim()
        follow_up_message = $followUpMessage.Trim()
        call_opener = $callOpener.Trim()
        why_now = [string]$whyNow
        contact_hook = [string]$contactHook
        angle_summary = [string]$angleSummary
        template_label = [string](Get-ObjectValue -Object $templateProfile -Name 'label' -Default 'Hiring signal note')
        template_button_label = [string](Get-ObjectValue -Object $templateProfile -Name 'buttonLabel' -Default 'Generate tailored note')
        persona = [string](Get-ObjectValue -Object $personaProfile -Name 'key' -Default 'general')
        persona_label = [string](Get-ObjectValue -Object $personaProfile -Name 'label' -Default 'Hiring signal angle')
        contact_name = $contactName
        contact_title = $contactTitle
        company_snippet = [string]$CompanySnippet
        booking_link = [string]$BookingLink
        outreach_status = [string]$outreachStatus
        sequence_status = [string]$sequenceStatus
        sequence_guidance = [string]$sequenceGuidance
        signal_focus = [string]$focusSummary
        suggested_next_step = [string]$recommendedAction
        signal_metrics = [ordered]@{
            open_roles = [int]$openRoles
            jobs_last_30_days = [int]$jobsLast30Days
            jobs_last_90_days = [int]$jobsLast90Days
            new_roles_7d = [int]$newRoleCount7d
            stale_roles_30d = [int]$staleRoleCount30d
            hiring_spike_ratio = [double]$hiringSpikeRatio
        }
    }
}

function Get-PlaybookAccounts {
    param($State)
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $accounts = @($State.companies |
        Where-Object {
            $status = [string](Get-ObjectValue -Object $_ -Name 'status' -Default '')
            $status -ne 'paused' -and $status -ne 'client' -and $status -ne 'archived'
        } |
        Sort-Object @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'targetScore' -Default 0)) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'hiringVelocity' -Default 0)) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'engagementScore' -Default 0)) }; Descending = $true } |
        Select-Object -First 5)
    return @($accounts | ForEach-Object {
        $nextActionAt = Get-ObjectValue -Object $_ -Name 'nextActionAt' -Default $null
        $isOverdue = ($nextActionAt -and [string]$nextActionAt -ne '' -and [string]$nextActionAt -lt $today)
        [ordered]@{
            id = [string](Get-ObjectValue -Object $_ -Name 'id' -Default '')
            displayName = [string](Get-ObjectValue -Object $_ -Name 'displayName' -Default '')
            dailyScore = [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'dailyScore' -Default 0))
            targetScore = [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'targetScore' -Default 0))
            hiringVelocity = [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'hiringVelocity' -Default 0))
            engagementScore = [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'engagementScore' -Default 0))
            openRoleCount = [int](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'openRoleCount' -Default 0))
            topContactName = [string](Get-ObjectValue -Object $_ -Name 'topContactName' -Default '')
            recommendedAction = [string](Get-ObjectValue -Object $_ -Name 'recommendedAction' -Default '')
            outreachStatus = [string](Get-ObjectValue -Object $_ -Name 'outreachStatus' -Default '')
            nextAction = [string](Get-ObjectValue -Object $_ -Name 'nextAction' -Default '')
            nextActionAt = $nextActionAt
            isOverdue = $isOverdue
            staleFlag = [string](Get-ObjectValue -Object $_ -Name 'staleFlag' -Default '')
            networkStrength = [string](Get-ObjectValue -Object $_ -Name 'networkStrength' -Default '')
            owner = [string](Get-ObjectValue -Object $_ -Name 'owner' -Default '')
        }
    })
}

function Get-OverdueFollowUps {
    param($State)
    $today = (Get-Date).ToString('yyyy-MM-dd')
    return @($State.companies |
        Where-Object {
            $nextActionAt = Get-ObjectValue -Object $_ -Name 'nextActionAt' -Default $null
            $status = [string](Get-ObjectValue -Object $_ -Name 'status' -Default '')
            $nextActionAt -and [string]$nextActionAt -ne '' -and [string]$nextActionAt -lt $today -and $status -ne 'paused' -and $status -ne 'archived'
        } |
        Sort-Object @{ Expression = { [string](Get-ObjectValue -Object $_ -Name 'nextActionAt' -Default '') } } |
        Select-Object -First 10 |
        ForEach-Object {
            [ordered]@{
                id = [string](Get-ObjectValue -Object $_ -Name 'id' -Default '')
                displayName = [string](Get-ObjectValue -Object $_ -Name 'displayName' -Default '')
                nextAction = [string](Get-ObjectValue -Object $_ -Name 'nextAction' -Default '')
                nextActionAt = Get-ObjectValue -Object $_ -Name 'nextActionAt' -Default $null
                outreachStatus = [string](Get-ObjectValue -Object $_ -Name 'outreachStatus' -Default '')
                owner = [string](Get-ObjectValue -Object $_ -Name 'owner' -Default '')
            }
        })
}

function Get-StaleAccounts {
    param($State)
    return @($State.companies |
        Where-Object {
            [string](Get-ObjectValue -Object $_ -Name 'staleFlag' -Default '') -eq 'STALE' -and
            [string](Get-ObjectValue -Object $_ -Name 'status' -Default '') -ne 'paused' -and
            [string](Get-ObjectValue -Object $_ -Name 'status' -Default '') -ne 'archived'
        } |
        Sort-Object @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'targetScore' -Default 0)) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'hiringVelocity' -Default 0)) }; Descending = $true } |
        Select-Object -First 10 |
        ForEach-Object {
            [ordered]@{
                id = [string](Get-ObjectValue -Object $_ -Name 'id' -Default '')
                displayName = [string](Get-ObjectValue -Object $_ -Name 'displayName' -Default '')
                dailyScore = [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'dailyScore' -Default 0))
                targetScore = [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'targetScore' -Default 0))
                lastContactedAt = Get-ObjectValue -Object $_ -Name 'lastContactedAt' -Default $null
                openRoleCount = [int](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'openRoleCount' -Default 0))
                owner = [string](Get-ObjectValue -Object $_ -Name 'owner' -Default '')
            }
        })
}

function Get-TopCompanyTriggerAlert {
    param($Company)

    $triggerAlerts = @($(if (Get-ObjectValue -Object $Company -Name 'triggerAlerts' -Default $null) { Get-ObjectValue -Object $Company -Name 'triggerAlerts' -Default @() } else { @() }))
    return @(
        $triggerAlerts |
            Where-Object { $null -ne $_ } |
            Sort-Object @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'priorityScore' -Default 0)) }; Descending = $true }, @{ Expression = { [string](Get-ObjectValue -Object $_ -Name 'title' -Default '') }; Descending = $false } |
            Select-Object -First 1
    )
}

function Get-CommandCenterAlertQueue {
    param(
        $State,
        [int]$Limit = 8
    )

    return @(
        @($State.companies | Where-Object {
                $status = [string](Get-ObjectValue -Object $_ -Name 'status' -Default '')
                $status -notin @('paused', 'client', 'archived')
            }) |
            ForEach-Object {
                $summary = Select-AccountSummary -Company $_
                $topAlert = @(Get-TopCompanyTriggerAlert -Company $_ | Select-Object -First 1)
                if ($topAlert) {
                    [ordered]@{
                        accountId = [string](Get-ObjectValue -Object $summary -Name 'id' -Default '')
                        displayName = [string](Get-ObjectValue -Object $summary -Name 'displayName' -Default '')
                        targetScore = [int](Convert-ToNumber (Get-ObjectValue -Object $summary -Name 'targetScore' -Default 0))
                        hiringVelocity = [double](Convert-ToNumber (Get-ObjectValue -Object $summary -Name 'hiringVelocity' -Default 0))
                        engagementScore = [double](Convert-ToNumber (Get-ObjectValue -Object $summary -Name 'engagementScore' -Default 0))
                        alertPriorityScore = [int](Convert-ToNumber (Get-ObjectValue -Object $summary -Name 'alertPriorityScore' -Default (Get-ObjectValue -Object $topAlert -Name 'priorityScore' -Default 0)))
                        outreachStatus = [string](Get-ObjectValue -Object $summary -Name 'outreachStatus' -Default '')
                        owner = [string](Get-ObjectValue -Object $summary -Name 'owner' -Default '')
                        type = [string](Get-ObjectValue -Object $topAlert -Name 'type' -Default '')
                        title = [string](Get-ObjectValue -Object $topAlert -Name 'title' -Default '')
                        summary = [string](Get-ObjectValue -Object $topAlert -Name 'summary' -Default '')
                        recommendedAction = [string](Get-ObjectValue -Object $topAlert -Name 'recommendedAction' -Default '')
                    }
                }
            } |
            Where-Object { $null -ne $_ } |
            Sort-Object @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'alertPriorityScore' -Default 0)) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'targetScore' -Default 0)) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'hiringVelocity' -Default 0)) }; Descending = $true } |
            Select-Object -First $Limit
    )
}

function Get-CommandCenterSequenceQueue {
    param(
        $State,
        [int]$Limit = 8
    )

    return @(
        @($State.companies | Where-Object {
                $status = [string](Get-ObjectValue -Object $_ -Name 'status' -Default '')
                $status -notin @('paused', 'client', 'archived')
            }) |
            ForEach-Object {
                $summary = Select-AccountSummary -Company $_
                $sequenceState = Get-ObjectValue -Object $_ -Name 'sequenceState' -Default $null
                if ($sequenceState) {
                    $status = [string](Get-ObjectValue -Object $sequenceState -Name 'status' -Default (Get-ObjectValue -Object $summary -Name 'sequenceStatus' -Default ''))
                    $nextStepAt = Get-ObjectValue -Object $sequenceState -Name 'nextStepAt' -Default (Get-ObjectValue -Object $summary -Name 'sequenceNextStepAt' -Default $null)
                    if ($status -eq 'active' -and $nextStepAt) {
                        [ordered]@{
                            accountId = [string](Get-ObjectValue -Object $summary -Name 'id' -Default '')
                            displayName = [string](Get-ObjectValue -Object $summary -Name 'displayName' -Default '')
                            targetScore = [int](Convert-ToNumber (Get-ObjectValue -Object $summary -Name 'targetScore' -Default 0))
                            engagementScore = [double](Convert-ToNumber (Get-ObjectValue -Object $summary -Name 'engagementScore' -Default 0))
                            relationshipStrengthScore = [int](Convert-ToNumber (Get-ObjectValue -Object $summary -Name 'relationshipStrengthScore' -Default 0))
                            owner = [string](Get-ObjectValue -Object $summary -Name 'owner' -Default '')
                            outreachStatus = [string](Get-ObjectValue -Object $summary -Name 'outreachStatus' -Default '')
                            status = $status
                            nextStep = [string](Get-ObjectValue -Object $sequenceState -Name 'nextStep' -Default (Get-ObjectValue -Object $summary -Name 'sequenceNextStep' -Default ''))
                            nextStepLabel = [string](Get-ObjectValue -Object $sequenceState -Name 'nextStepLabel' -Default '')
                            nextStepAt = $nextStepAt
                            adaptiveTimingReason = [string](Get-ObjectValue -Object $sequenceState -Name 'adaptiveTimingReason' -Default '')
                            isOverdue = ((Get-DateSortValue ([string]$nextStepAt)) -le (Get-Date))
                        }
                    }
                }
            } |
            Where-Object { $null -ne $_ } |
            Sort-Object @{ Expression = { Get-DateSortValue ([string](Get-ObjectValue -Object $_ -Name 'nextStepAt' -Default '')) } }, @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'targetScore' -Default 0)) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'relationshipStrengthScore' -Default 0)) }; Descending = $true } |
            Select-Object -First $Limit
    )
}

function Get-CommandCenterIntroQueue {
    param(
        $State,
        [int]$Limit = 8
    )

    return @(
        @($State.companies | Where-Object {
                $status = [string](Get-ObjectValue -Object $_ -Name 'status' -Default '')
                $status -notin @('paused', 'client', 'archived')
            }) |
            ForEach-Object {
                $summary = Select-AccountSummary -Company $_
                $connectionGraph = Get-ObjectValue -Object $_ -Name 'connectionGraph' -Default $null
                if ($connectionGraph) {
                    $warmIntroCandidates = @($(Get-ObjectValue -Object $connectionGraph -Name 'warmIntroCandidates' -Default @()))
                    if (@($warmIntroCandidates).Count -gt 0) {
                        $shortestPath = Get-ObjectValue -Object $connectionGraph -Name 'shortestPathToDecisionMaker' -Default $null
                        $candidate = @($warmIntroCandidates | Select-Object -First 1)
                        [ordered]@{
                            accountId = [string](Get-ObjectValue -Object $summary -Name 'id' -Default '')
                            displayName = [string](Get-ObjectValue -Object $summary -Name 'displayName' -Default '')
                            targetScore = [int](Convert-ToNumber (Get-ObjectValue -Object $summary -Name 'targetScore' -Default 0))
                            alertPriorityScore = [int](Convert-ToNumber (Get-ObjectValue -Object $summary -Name 'alertPriorityScore' -Default 0))
                            relationshipStrengthScore = [int](Convert-ToNumber (Get-ObjectValue -Object $summary -Name 'relationshipStrengthScore' -Default 0))
                            owner = [string](Get-ObjectValue -Object $summary -Name 'owner' -Default '')
                            contactName = [string](Get-ObjectValue -Object $candidate -Name 'fullName' -Default '')
                            contactTitle = [string](Get-ObjectValue -Object $candidate -Name 'title' -Default '')
                            contactWhy = [string](Get-ObjectValue -Object $candidate -Name 'why' -Default '')
                            pathLength = [int](Convert-ToNumber (Get-ObjectValue -Object $candidate -Name 'pathLength' -Default (Get-ObjectValue -Object $shortestPath -Name 'pathLength' -Default 0)))
                            confidence = [string](Get-ObjectValue -Object $shortestPath -Name 'confidence' -Default '')
                            introSummary = [string](Get-ObjectValue -Object $shortestPath -Name 'summary' -Default '')
                        }
                    }
                }
            } |
            Where-Object { $null -ne $_ } |
            Sort-Object @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'relationshipStrengthScore' -Default 0)) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'targetScore' -Default 0)) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'alertPriorityScore' -Default 0)) }; Descending = $true } |
            Select-Object -First $Limit
    )
}

function Get-GlobalActivityFeed {
    param($State, [int]$Limit = 15)
    $companyLookup = @{}
    foreach ($c in @($State.companies)) { $companyLookup[[string]$c.id] = [string]$c.displayName }
    return @($State.activities |
        Sort-Object @{ Expression = { Get-DateSortValue $_.occurredAt }; Descending = $true } |
        Select-Object -First $Limit |
        ForEach-Object {
            $summary = Select-ActivitySummary -Activity $_
            $summary.companyName = if ($companyLookup[[string]$_.accountId]) { $companyLookup[[string]$_.accountId] } else { [string]$_.normalizedCompanyName }
            $summary
        })
}

function Get-HiringVelocity {
    param($Jobs)
    $now = Get-Date
    $weekBuckets = [ordered]@{}
    for ($i = 0; $i -lt 4; $i++) {
        $weekStart = $now.AddDays(-($i * 7 + 7)).ToString('yyyy-MM-dd')
        $weekEnd = $now.AddDays(-($i * 7)).ToString('yyyy-MM-dd')
        $label = if ($i -eq 0) { 'This week' } elseif ($i -eq 1) { 'Last week' } else { "$($i+1) weeks ago" }
        $count = @($Jobs | Where-Object { $_.postedAt -and [string]$_.postedAt -ge $weekStart -and [string]$_.postedAt -lt $weekEnd }).Count
        $weekBuckets[$label] = $count
    }
    $thisWeek = $weekBuckets['This week']
    $lastWeek = $weekBuckets['Last week']
    $trend = if ($thisWeek -gt $lastWeek) { 'accelerating' } elseif ($thisWeek -lt $lastWeek) { 'slowing' } else { 'steady' }
    $signalMetrics = Get-CompanyHiringSignalMetrics -Jobs $Jobs -ReferenceNow $now
    return [ordered]@{
        weeks = $weekBuckets
        trend = $trend
        thisWeek = $thisWeek
        lastWeek = $lastWeek
        score = [int](Convert-ToNumber $signalMetrics.hiringVelocity)
        jobsLast30Days = [int](Convert-ToNumber $signalMetrics.jobsLast30Days)
        jobsLast90Days = [int](Convert-ToNumber $signalMetrics.jobsLast90Days)
        hiringSpikeRatio = [double](Convert-ToNumber $signalMetrics.hiringSpikeRatio)
    }
}

function Get-JobSignalTimestamp {
    param($Job)

    foreach ($field in 'postedAt', 'retrievedAt', 'importedAt', 'lastSeenAt') {
        $value = [string](Get-ObjectValue -Object $Job -Name $field -Default '')
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $parsed = Get-DateSortValue $value
            if ($parsed -gt [DateTime]::MinValue) {
                return $parsed
            }
        }
    }

    return [DateTime]::MinValue
}

function Get-JobSignalCacheKey {
    param($Job)

    foreach ($field in 'id', 'dedupeKey', 'jobId', 'url', 'jobUrl', 'sourceUrl') {
        $value = [string](Get-ObjectValue -Object $Job -Name $field -Default '')
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value
        }
    }

    return [string]::Join('|', @(
            [string](Get-ObjectValue -Object $Job -Name 'companyName' -Default ''),
            [string](Get-ObjectValue -Object $Job -Name 'title' -Default ''),
            [string](Get-ObjectValue -Object $Job -Name 'postedAt' -Default ''),
            [string](Get-ObjectValue -Object $Job -Name 'importedAt' -Default '')
        ))
}

function Get-PatternHitCount {
    param(
        [string]$Text,
        [object[]]$Patterns
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return 0
    }

    $count = 0
    foreach ($pattern in @($Patterns)) {
        $isMatch = $false
        if ($pattern -is [regex]) {
            $isMatch = $pattern.IsMatch($Text)
        } elseif ($Text -match [string]$pattern) {
            $isMatch = $true
        }

        if ($isMatch) {
            $count += 1
        }
    }

    return $count
}

$script:HiringSignalUrgencyPatterns = @(
    [regex]::new('\burgent\b'),
    [regex]::new('\bimmediately\b'),
    [regex]::new('\basap\b'),
    [regex]::new('\bhigh volume\b'),
    [regex]::new('\bmultiple openings\b'),
    [regex]::new('\bscale quickly\b'),
    [regex]::new('\bhypergrowth\b'),
    [regex]::new('\bbuild(ing)? out\b')
)
$script:HiringSignalHardRolePatterns = @(
    [regex]::new('\bprincipal\b'),
    [regex]::new('\bstaff\b'),
    [regex]::new('\barchitect\b'),
    [regex]::new('\bsecurity\b'),
    [regex]::new('\bmachine learning\b'),
    [regex]::new('\bai\b'),
    [regex]::new('\bdata platform\b'),
    [regex]::new('\bsite reliability\b'),
    [regex]::new('\bembedded\b'),
    [regex]::new('\bbilingual\b'),
    [regex]::new('\blicensed\b'),
    [regex]::new('\bclearance\b')
)
$script:HiringSignalPartnerFriendlyPatterns = @(
    [regex]::new('\bcontract\b'),
    [regex]::new('\bconsultant\b'),
    [regex]::new('\bproject based\b'),
    [regex]::new('\bsearch\b'),
    [regex]::new('\bpartner\b'),
    [regex]::new('\boutside support\b')
)
$script:HiringSignalNegativePatterns = @(
    [regex]::new('\bno agencies\b'),
    [regex]::new('\bno recruiters\b'),
    [regex]::new('\bunsolicited resumes\b'),
    [regex]::new('\bthird[- ]party\b'),
    [regex]::new('\bagency resumes\b')
)
$script:HiringSignalRemotePatterns = @(
    [regex]::new('\bremote\b'),
    [regex]::new('\bhybrid\b'),
    [regex]::new('\bmultiple locations\b'),
    [regex]::new('\bcanada\b'),
    [regex]::new('\bunited states\b')
)
$script:HiringSignalRecruiterTitlePattern = [regex]::new('recruiter|talent acquisition|sourcer')
$script:HiringSignalSeniorTitlePattern = [regex]::new('director|vp|vice president|head|chief|lead|principal|staff|architect')
$script:GrowthSignalFundingPatterns = @(
    [regex]::new('\bseries [a-z]+\b'),
    [regex]::new('\bseed\b'),
    [regex]::new('\bfunding\b'),
    [regex]::new('\braised\b'),
    [regex]::new('\bventure backed\b'),
    [regex]::new('\bbacked by\b'),
    [regex]::new('\bprivate equity\b'),
    [regex]::new('\bacquisition\b')
)
$script:GrowthSignalExpansionPatterns = @(
    [regex]::new('\bhypergrowth\b'),
    [regex]::new('\brapid(ly)? growing\b'),
    [regex]::new('\bscal(e|ing)\b'),
    [regex]::new('\bexpan(d|sion)\b'),
    [regex]::new('\bnew office\b'),
    [regex]::new('\bnew market\b'),
    [regex]::new('\bhiring surge\b'),
    [regex]::new('\bbuild(ing)? out\b'),
    [regex]::new('\bgrowth stage\b')
)

function Get-RoleSeniorityScore {
    param([string]$Title)

    $needle = Normalize-TextKey $Title
    if (-not $needle) { return 0 }

    if ($script:RoleSeniorityScoreCache.ContainsKey($needle)) {
        return [int]$script:RoleSeniorityScoreCache[$needle]
    }

    $score = 45
    if ($needle -match '\b(chief|ceo|coo|cto|cfo|cio|cro|cmo|chief [a-z]+ officer|president|founder|cofounder|general counsel)\b') {
        $score = 96
    } elseif ($needle -match '\b(svp|evp|vp|vice president|head of|general manager|gm)\b') {
        $score = 88
    } elseif ($needle -match '\bdirector|managing director\b') {
        $score = 76
    } elseif ($needle -match '\b(principal|staff|lead|manager|architect|supervisor)\b') {
        $score = 66
    } elseif ($needle -match '\b(senior|sr\.?)\b') {
        $score = 56
    } elseif ($needle -match '\b(intern|junior|jr\.?|entry level|apprentice)\b') {
        $score = 18
    } elseif ($needle -match '\b(associate|specialist|analyst|coordinator|administrator|recruiter|sourcer)\b') {
        $score = 34
    }

    $script:RoleSeniorityScoreCache[$needle] = [int]$score
    return [int]$score
}

function Get-SignalTextSnippet {
    param(
        [string]$Value,
        [int]$MaxLength = 0
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }

    $text = [string]$Value
    if ($MaxLength -gt 0 -and $text.Length -gt $MaxLength) {
        return $text.Substring(0, $MaxLength)
    }

    return $text
}

function Get-JobSignalText {
    param(
        $Job,
        [int]$MaxLength = 4000
    )

    $parts = New-Object System.Collections.ArrayList
    foreach ($field in 'title', 'department', 'location', 'employmentType') {
        $value = Get-SignalTextSnippet -Value ([string](Get-ObjectValue -Object $Job -Name $field -Default '')) -MaxLength 200
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            [void]$parts.Add($value)
        }
    }

    $rawPayload = Get-ObjectValue -Object $Job -Name 'rawPayload' -Default $null
    if ($rawPayload -is [string]) {
        $rawText = Get-SignalTextSnippet -Value $rawPayload -MaxLength $MaxLength
        if (-not [string]::IsNullOrWhiteSpace($rawText)) {
            [void]$parts.Add($rawText)
        }
    } elseif ($rawPayload) {
        foreach ($field in 'description', 'descriptionHtml', 'content', 'text', 'jobDescription', 'shortDescription', 'details', 'requirements', 'responsibilities') {
            $value = Get-SignalTextSnippet -Value ([string](Get-ObjectValue -Object $rawPayload -Name $field -Default '')) -MaxLength ([Math]::Max(300, [Math]::Floor($MaxLength / 3)))
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                [void]$parts.Add($value)
            }
        }
    }

    return Normalize-TextKey ([string]::Join(' ', @($parts.ToArray())))
}

function Get-CachedJobSignalTimestamp {
    param(
        $Job,
        [hashtable]$Cache = $null
    )

    $cacheKey = Get-JobSignalCacheKey -Job $Job
    if ($Cache -and $cacheKey -and $Cache.ContainsKey($cacheKey)) {
        return [DateTime]$Cache[$cacheKey]
    }

    $jobTimestamp = Get-JobSignalTimestamp -Job $Job
    if ($Cache -and $cacheKey) {
        $Cache[$cacheKey] = $jobTimestamp
    }

    return $jobTimestamp
}

function Get-CachedJobSignalText {
    param(
        $Job,
        [hashtable]$Cache = $null,
        [int]$MaxLength = 4000
    )

    $cacheKey = Get-JobSignalCacheKey -Job $Job
    $cacheLookupKey = if ($cacheKey) { '{0}|{1}' -f $cacheKey, $MaxLength } else { '' }
    if ($Cache -and $cacheLookupKey -and $Cache.ContainsKey($cacheLookupKey)) {
        return [string]$Cache[$cacheLookupKey]
    }

    $jobText = Get-JobSignalText -Job $Job -MaxLength $MaxLength
    if ($Cache -and $cacheLookupKey) {
        $Cache[$cacheLookupKey] = $jobText
    }

    return $jobText
}

function Get-CachedJobHiringSignalAnalysis {
    param(
        $Job,
        [hashtable]$Cache = $null,
        [hashtable]$JobSignalTextCache = $null,
        [int]$MaxLength = 2400
    )

    $jobCacheKey = Get-JobSignalCacheKey -Job $Job
    $title = [string](Get-ObjectValue -Object $Job -Name 'title' -Default '')
    $titleKey = Normalize-TextKey $title
    $cacheLookupKey = if ($jobCacheKey) { 'hiring-signal-v1|{0}|{1}|{2}' -f $jobCacheKey, $MaxLength, $titleKey } else { '' }
    if ($Cache -and $cacheLookupKey -and $Cache.ContainsKey($cacheLookupKey)) {
        return $Cache[$cacheLookupKey]
    }

    $jobText = Get-CachedJobSignalText -Job $Job -Cache $JobSignalTextCache -MaxLength $MaxLength
    $analysis = [ordered]@{
        roleSeniorityScore = if ($title) { (Get-RoleSeniorityScore -Title $title) } else { 0 }
        recruiterTitleHit = [bool]($titleKey -and $script:HiringSignalRecruiterTitlePattern.IsMatch($titleKey))
        seniorTitleHit = [bool]($titleKey -and $script:HiringSignalSeniorTitlePattern.IsMatch($titleKey))
        urgencyHits = 0
        hardRoleHits = 0
        partnerFriendlyHits = 0
        negativeHits = 0
        remoteHits = 0
        hasText = (-not [string]::IsNullOrWhiteSpace($jobText))
    }

    if ($analysis.hasText) {
        $analysis.urgencyHits = Get-PatternHitCount -Text $jobText -Patterns $script:HiringSignalUrgencyPatterns
        $analysis.hardRoleHits = Get-PatternHitCount -Text $jobText -Patterns $script:HiringSignalHardRolePatterns
        $analysis.partnerFriendlyHits = Get-PatternHitCount -Text $jobText -Patterns $script:HiringSignalPartnerFriendlyPatterns
        $analysis.negativeHits = Get-PatternHitCount -Text $jobText -Patterns $script:HiringSignalNegativePatterns
        $analysis.remoteHits = Get-PatternHitCount -Text $jobText -Patterns $script:HiringSignalRemotePatterns
    }

    if ($Cache -and $cacheLookupKey) {
        $Cache[$cacheLookupKey] = $analysis
    }

    return $analysis
}

function Get-CompanyHiringMetricsSignature {
    param(
        $ActiveJobs = $null,
        [datetime]$ReferenceNow = (Get-Date),
        [hashtable]$JobSignalTimestampCache = $null
    )

    $signatureEntries = New-Object System.Collections.ArrayList
    [void]$signatureEntries.Add($ReferenceNow.ToString('yyyy-MM-dd'))

    foreach ($job in @($ActiveJobs)) {
        if ($null -eq $job) {
            continue
        }

        $jobCacheKey = Get-JobSignalCacheKey -Job $job
        $jobTimestamp = Get-CachedJobSignalTimestamp -Job $job -Cache $JobSignalTimestampCache
        $title = [string](Get-ObjectValue -Object $job -Name 'title' -Default '')
        [void]$signatureEntries.Add(([string]::Join('|', @(
                    [string]$jobCacheKey,
                    [string]$jobTimestamp.Ticks,
                    $title
                ))))
    }

    return (New-DeterministicId -Prefix 'hsig' -Seed ([string]::Join('||', @($signatureEntries | Sort-Object))))
}

function Select-MostRecentJobsForSignalAnalysis {
    param(
        $Jobs = $null,
        [int]$Limit = 12,
        [hashtable]$JobSignalTimestampCache = $null
    )

    if ($Limit -lt 1) {
        return @()
    }

    $rankedJobs = New-Object System.Collections.ArrayList
    foreach ($job in @($Jobs)) {
        if ($null -eq $job) {
            continue
        }

        $timestamp = Get-CachedJobSignalTimestamp -Job $job -Cache $JobSignalTimestampCache
        Add-RankedSignalJobEntry -RankedJobs $rankedJobs -Job $job -Timestamp $timestamp -Limit $Limit
    }

    return @($rankedJobs | ForEach-Object { Get-ObjectValue -Object $_ -Name 'job' -Default $null } | Where-Object { $null -ne $_ })
}

function Get-ActiveJobsForSignalAnalysis {
    param($Jobs = $null)

    $activeJobs = New-Object System.Collections.ArrayList
    foreach ($job in @($Jobs)) {
        if ($null -eq $job) {
            continue
        }
        if ((Get-ObjectValue -Object $job -Name 'active' -Default $true) -eq $false) {
            continue
        }
        [void]$activeJobs.Add($job)
    }

    return @($activeJobs.ToArray())
}

function Get-ActivityMetadataNumber {
    param(
        $Metadata,
        [string[]]$Names
    )

    if (-not $Metadata) {
        return 0
    }

    foreach ($name in @($Names)) {
        $value = Get-ObjectValue -Object $Metadata -Name $name -Default $null
        if ($null -ne $value -and $value -ne '') {
            return [double](Convert-ToNumber $value)
        }
    }

    return 0
}

function Get-CompanyHiringSignalMetrics {
    param(
        $Company,
        $Jobs = $null,
        $ActiveJobs = $null,
        $JobsForTextAnalysis = $null,
        [datetime]$ReferenceNow = (Get-Date),
        [hashtable]$JobSignalTextCache = $null,
        [hashtable]$JobSignalTimestampCache = $null,
        [hashtable]$JobHiringSignalAnalysisCache = $null,
        [System.Collections.IDictionary]$TimingBag = $null
    )

    if ($null -eq $Jobs) {
        return [ordered]@{
            jobsLast30Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast30Days' -Default 0))
            jobsLast90Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast90Days' -Default 0))
            avgRoleSeniorityScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'avgRoleSeniorityScore' -Default 0))
            hiringSpikeRatio = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringSpikeRatio' -Default 0))
            externalRecruiterLikelihoodScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'externalRecruiterLikelihoodScore' -Default 0))
            hiringVelocity = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringVelocity' -Default 0))
        }
    }

    $activeJobs = if ($PSBoundParameters.ContainsKey('ActiveJobs') -and $null -ne $ActiveJobs) {
        @($ActiveJobs)
    } else {
        @(Get-ActiveJobsForSignalAnalysis -Jobs $Jobs)
    }
    $jobsLast30Days = 0
    $jobsLast90Days = 0
    $seniorityTotal = 0.0
    $seniorityCount = 0
    $recruiterTotal = 0.0
    $recruiterCount = 0
    $signatureEntries = New-Object System.Collections.ArrayList
    [void]$signatureEntries.Add($ReferenceNow.ToString('yyyy-MM-dd'))
    $cutoff30 = $ReferenceNow.AddDays(-30)
    $cutoff90 = $ReferenceNow.AddDays(-90)

    $titleLoopStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    foreach ($job in @($activeJobs)) {
        $jobCacheKey = Get-JobSignalCacheKey -Job $job
        $jobTimestamp = Get-CachedJobSignalTimestamp -Job $job -Cache $JobSignalTimestampCache
        [void]$signatureEntries.Add(([string]::Join('|', @(
                        [string]$jobCacheKey,
                        [string]$jobTimestamp.Ticks,
                        [string](Get-ObjectValue -Object $job -Name 'title' -Default '')
                    ))))
        if ($jobTimestamp -gt [DateTime]::MinValue) {
            if ($jobTimestamp -ge $cutoff30) { $jobsLast30Days += 1 }
            if ($jobTimestamp -ge $cutoff90) { $jobsLast90Days += 1 }
        }

        $title = [string](Get-ObjectValue -Object $job -Name 'title' -Default '')
        if (-not [string]::IsNullOrWhiteSpace($title)) {
            $seniorityTotal += (Get-RoleSeniorityScore -Title $title)
            $seniorityCount += 1
        }

    }
    $titleLoopStopwatch.Stop()

    $signatureStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $hiringMetricsSignature = New-DeterministicId -Prefix 'hsig' -Seed ([string]::Join('||', @($signatureEntries | Sort-Object)))
    $signatureStopwatch.Stop()
    $existingHiringMetricsSignature = [string](Get-ObjectValue -Object $Company -Name 'hiringSignalMetricsSignature' -Default '')
    if ($existingHiringMetricsSignature -eq $hiringMetricsSignature) {
        if ($TimingBag) {
            $TimingBag['titleLoopMs'] = [int]$titleLoopStopwatch.ElapsedMilliseconds
            $TimingBag['signatureMs'] = [int]$signatureStopwatch.ElapsedMilliseconds
            $TimingBag['textAnalysisMs'] = 0
        }
        return [ordered]@{
            jobsLast30Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast30Days' -Default 0))
            jobsLast90Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast90Days' -Default 0))
            avgRoleSeniorityScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'avgRoleSeniorityScore' -Default 0))
            hiringSpikeRatio = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringSpikeRatio' -Default 0))
            externalRecruiterLikelihoodScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'externalRecruiterLikelihoodScore' -Default 0))
            hiringVelocity = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringVelocity' -Default 0))
            hiringSignalMetricsSignature = $hiringMetricsSignature
            metricsCacheHit = $true
        }
    }

    $jobsForTextAnalysis = if ($PSBoundParameters.ContainsKey('JobsForTextAnalysis') -and $null -ne $JobsForTextAnalysis) {
        @($JobsForTextAnalysis)
    } elseif (@($activeJobs).Count -gt 6) {
        @(Select-MostRecentJobsForSignalAnalysis -Jobs $activeJobs -Limit 6 -JobSignalTimestampCache $JobSignalTimestampCache)
    } else {
        @($activeJobs)
    }

    $textAnalysisStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    foreach ($job in @($jobsForTextAnalysis)) {
        $title = [string](Get-ObjectValue -Object $job -Name 'title' -Default '')
        $jobText = Get-CachedJobSignalText -Job $job -Cache $JobSignalTextCache -MaxLength 2400
        if ($jobText) {
            $jobScore = 18 +
                (Get-PatternHitCount -Text $jobText -Patterns $script:HiringSignalUrgencyPatterns) * 10 +
                (Get-PatternHitCount -Text $jobText -Patterns $script:HiringSignalHardRolePatterns) * 7 +
                (Get-PatternHitCount -Text $jobText -Patterns $script:HiringSignalPartnerFriendlyPatterns) * 9 +
                (Get-PatternHitCount -Text $jobText -Patterns $script:HiringSignalRemotePatterns) * 4 -
                (Get-PatternHitCount -Text $jobText -Patterns $script:HiringSignalNegativePatterns) * 24
            if ($title -match 'recruiter|talent acquisition|sourcer') { $jobScore += 6 }
            if ($title -match 'director|vp|vice president|head|chief|lead|principal|staff|architect') { $jobScore += 6 }
            $recruiterTotal += [Math]::Min(100, [Math]::Max(0, $jobScore))
            $recruiterCount += 1
        }
    }
    $textAnalysisStopwatch.Stop()

    $avgRoleSeniorityScore = if ($seniorityCount -gt 0) { [Math]::Round($seniorityTotal / $seniorityCount, 1) } else { 0 }
    $externalRecruiterLikelihoodScore = if ($recruiterCount -gt 0) { [Math]::Round($recruiterTotal / $recruiterCount, 1) } else { 0 }
    $baseline30Days = [Math]::Max(1.0, ($jobsLast90Days / 3.0))
    $hiringSpikeRatio = if ($jobsLast30Days -gt 0) { [Math]::Round(($jobsLast30Days / $baseline30Days), 2) } else { 0 }
    $hiringVelocity = [Math]::Min(100, [Math]::Round(([Math]::Min(60, ($jobsLast30Days * 8))) + ([Math]::Min(20, ($jobsLast90Days * 1.5))) + ([Math]::Min(20, ([Math]::Max(0, $hiringSpikeRatio - 1) * 25))), 0))

    if ($TimingBag) {
        $TimingBag['titleLoopMs'] = [int]$titleLoopStopwatch.ElapsedMilliseconds
        $TimingBag['signatureMs'] = [int]$signatureStopwatch.ElapsedMilliseconds
        $TimingBag['textAnalysisMs'] = [int]$textAnalysisStopwatch.ElapsedMilliseconds
    }

    return [ordered]@{
        jobsLast30Days = [int]$jobsLast30Days
        jobsLast90Days = [int]$jobsLast90Days
        avgRoleSeniorityScore = [double]$avgRoleSeniorityScore
        hiringSpikeRatio = [double]$hiringSpikeRatio
        externalRecruiterLikelihoodScore = [double]$externalRecruiterLikelihoodScore
        hiringVelocity = [double]$hiringVelocity
        hiringSignalMetricsSignature = $hiringMetricsSignature
        metricsCacheHit = $false
    }
}

function Get-CompanyEngagementMetrics {
    param(
        $Company,
        $Activities = $null,
        [datetime]$ReferenceNow = (Get-Date)
    )

    if ($null -eq $Activities) {
        return [ordered]@{
            score = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'engagementScore' -Default 0))
            summary = [string](Get-ObjectValue -Object $Company -Name 'engagementSummary' -Default '')
        }
    }

    $openCount = 0
    $clickCount = 0
    $replyCount = 0
    $meetingCount = 0
    $activityCount = 0
    $recentSignalBonus = 0

    foreach ($activity in @($Activities)) {
        $occurredAt = Get-DateSortValue ([string](Get-ObjectValue -Object $activity -Name 'occurredAt' -Default ''))
        $ageDays = if ($occurredAt -gt [DateTime]::MinValue) { ($ReferenceNow - $occurredAt).TotalDays } else { 9999 }
        if ($ageDays -le 120) {
            $activityCount += 1
        }

        $type = [string](Get-ObjectValue -Object $activity -Name 'type' -Default '')
        $summary = [string](Get-ObjectValue -Object $activity -Name 'summary' -Default '')
        $notes = [string](Get-ObjectValue -Object $activity -Name 'notes' -Default '')
        $pipelineStage = [string](Get-ObjectValue -Object $activity -Name 'pipelineStage' -Default '')
        $metadata = Get-ObjectValue -Object $activity -Name 'metadata' -Default $null
        $activityText = Normalize-TextKey ([string]::Join(' ', @($type, $summary, $notes, $pipelineStage)))

        $openCount += [int](Get-ActivityMetadataNumber -Metadata $metadata -Names @('opens', 'openCount', 'emailOpens'))
        $clickCount += [int](Get-ActivityMetadataNumber -Metadata $metadata -Names @('clicks', 'clickCount', 'emailClicks'))
        $replyCount += [int](Get-ActivityMetadataNumber -Metadata $metadata -Names @('replies', 'replyCount', 'emailReplies'))

        if ($activityText -match '\bopen(ed)?\b') { $openCount += 1 }
        if ($activityText -match '\b(click|clicked|link)\b') { $clickCount += 1 }
        if ($activityText -match '\b(reply|replied|responded|response)\b') { $replyCount += 1 }
        if ($activityText -match '\b(meeting|met|call|zoom|intro|screen|interested|opportunity)\b') { $meetingCount += 1 }

        if ($ageDays -le 7) {
            $recentSignalBonus += 6
        } elseif ($ageDays -le 30) {
            $recentSignalBonus += 3
        }
    }

    $stageBonus = switch -Regex (Normalize-TextKey ([string](Get-ObjectValue -Object $Company -Name 'outreachStatus' -Default ''))) {
        'opportunity' { 24; break }
        'replied|interested' { 18; break }
        'contacted' { 10; break }
        'ready_to_contact|researching' { 6; break }
        default { 0 }
    }

    $score = [Math]::Min(100, [Math]::Round(($openCount * 3) + ($clickCount * 8) + ($replyCount * 22) + ($meetingCount * 20) + ([Math]::Min(12, ($activityCount * 2))) + $recentSignalBonus + $stageBonus, 0))
    $summaryParts = New-Object System.Collections.ArrayList
    if ($replyCount -gt 0) { [void]$summaryParts.Add(('{0} repl{1}' -f $replyCount, $(if ($replyCount -eq 1) { 'y' } else { 'ies' }))) }
    if ($meetingCount -gt 0) { [void]$summaryParts.Add(('{0} high-intent touch{1}' -f $meetingCount, $(if ($meetingCount -eq 1) { '' } else { 'es' }))) }
    if ($clickCount -gt 0) { [void]$summaryParts.Add(('{0} click{1}' -f $clickCount, $(if ($clickCount -eq 1) { '' } else { 's' }))) }
    if ($openCount -gt 0) { [void]$summaryParts.Add(('{0} open{1}' -f $openCount, $(if ($openCount -eq 1) { '' } else { 's' }))) }
    if ($summaryParts.Count -eq 0) { [void]$summaryParts.Add('No live engagement captured yet') }

    return [ordered]@{
        score = [int]$score
        summary = [string]([string]::Join(', ', @($summaryParts.ToArray())))
    }
}

function Get-CompanyGrowthSignalMetrics {
    param(
        $Company,
        $Jobs = $null,
        $ActiveJobs = $null,
        $JobsForGrowthSignals = $null,
        [int]$JobsLast30Days = 0,
        [double]$HiringSpikeRatio = 0,
        [hashtable]$JobSignalTextCache = $null,
        [hashtable]$JobSignalTimestampCache = $null
    )

    $companyTextParts = New-Object System.Collections.ArrayList
    foreach ($value in @(
            [string](Get-ObjectValue -Object $Company -Name 'notes' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'enrichmentNotes' -Default ''),
            [string](Get-ObjectValue -Object $Company -Name 'enrichmentEvidence' -Default ''),
            [string]([string]::Join(' ', @(Get-StringList (Get-ObjectValue -Object $Company -Name 'tags' -Default @()))))
        )) {
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            [void]$companyTextParts.Add($value)
        }
    }

    $signalText = Normalize-TextKey ([string]::Join(' ', @($companyTextParts.ToArray())))
    if (-not $signalText -and -not $Jobs) {
        return [ordered]@{
            score = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'companyGrowthSignalScore' -Default 0))
            summary = [string](Get-ObjectValue -Object $Company -Name 'companyGrowthSignalSummary' -Default '')
        }
    }

    $fundingHits = Get-PatternHitCount -Text $signalText -Patterns $script:GrowthSignalFundingPatterns
    $growthHits = Get-PatternHitCount -Text $signalText -Patterns $script:GrowthSignalExpansionPatterns
    if ($Jobs) {
        $activeJobs = if ($PSBoundParameters.ContainsKey('ActiveJobs') -and $null -ne $ActiveJobs) {
            @($ActiveJobs)
        } else {
            @(Get-ActiveJobsForSignalAnalysis -Jobs $Jobs)
        }
        $jobsForGrowthSignals = if ($PSBoundParameters.ContainsKey('JobsForGrowthSignals') -and $null -ne $JobsForGrowthSignals) {
            @($JobsForGrowthSignals)
        } elseif ($activeJobs.Count -gt 6) {
            @(Select-MostRecentJobsForSignalAnalysis -Jobs $activeJobs -Limit 6 -JobSignalTimestampCache $JobSignalTimestampCache)
        } else {
            @($activeJobs)
        }
        foreach ($job in @($jobsForGrowthSignals)) {
            $jobText = Get-CachedJobSignalText -Job $job -Cache $JobSignalTextCache -MaxLength 2400
            if (-not [string]::IsNullOrWhiteSpace($jobText)) {
                $fundingHits += Get-PatternHitCount -Text $jobText -Patterns $script:GrowthSignalFundingPatterns
                $growthHits += Get-PatternHitCount -Text $jobText -Patterns $script:GrowthSignalExpansionPatterns
            }
        }
    }
    $fundingScore = [Math]::Min(45, ($fundingHits * 14) + ($growthHits * 6))
    $hiringSurgeScore = [Math]::Min(55, ($JobsLast30Days * 5) + ([Math]::Max(0, $HiringSpikeRatio - 1) * 25))
    $score = [Math]::Min(100, [Math]::Round($fundingScore + $hiringSurgeScore, 0))

    $summaryParts = New-Object System.Collections.ArrayList
    if ($fundingHits -gt 0) { [void]$summaryParts.Add('Funding or expansion language detected') }
    if ($growthHits -gt 0) { [void]$summaryParts.Add('Growth-stage hiring language detected') }
    if ($JobsLast30Days -gt 0) { [void]$summaryParts.Add(('{0} recent role{1}' -f $JobsLast30Days, $(if ($JobsLast30Days -eq 1) { '' } else { 's' }))) }
    if ($summaryParts.Count -eq 0) { [void]$summaryParts.Add('Signals driven mainly by hiring volume') }

    return [ordered]@{
        score = [int]$score
        summary = [string]([string]::Join(', ', @($summaryParts.ToArray())))
    }
}

function Get-TargetScoreExplanation {
    param($Components)

    $topDrivers = @(
        @($Components |
            Sort-Object @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'contribution' -Default 0)) }; Descending = $true } |
            Select-Object -First 3) |
            ForEach-Object {
                [ordered]@{
                    key = [string](Get-ObjectValue -Object $_ -Name 'key' -Default '')
                    label = [string](Get-ObjectValue -Object $_ -Name 'label' -Default '')
                    contribution = [int][Math]::Round((Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'contribution' -Default 0)))
                    score = [int][Math]::Round((Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'score' -Default 0)))
                    value = [string](Get-ObjectValue -Object $_ -Name 'value' -Default '')
                    summary = [string](Get-ObjectValue -Object $_ -Name 'summary' -Default '')
                }
            }
    )

    $summary = if ($topDrivers.Count -gt 0) {
        [string]::Join('; ', @($topDrivers | ForEach-Object { '{0}: {1}' -f $_.label, $_.summary }))
    } else {
        'No strong target-score drivers yet.'
    }

    return [ordered]@{
        model = 'target-score-v2'
        generatedAt = (Get-Date).ToString('o')
        topDrivers = $topDrivers
        summary = $summary
    }
}

function Get-CompanyTargetScoreMetrics {
    param(
        $Company,
        $Jobs = $null,
        $ActiveJobs = $null,
        $JobsForTextAnalysis = $null,
        $JobsForGrowthSignals = $null,
        $Activities = $null,
        [datetime]$ReferenceNow = (Get-Date),
        [hashtable]$JobSignalTextCache = $null,
        [hashtable]$JobSignalTimestampCache = $null,
        [hashtable]$JobHiringSignalAnalysisCache = $null,
        [System.Collections.IDictionary]$TimingBag = $null
    )

    if (-not $JobSignalTextCache) {
        $JobSignalTextCache = @{}
    }
    if (-not $JobSignalTimestampCache) {
        $JobSignalTimestampCache = @{}
    }
    $activeJobsStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $activeJobs = if ($PSBoundParameters.ContainsKey('ActiveJobs') -and $null -ne $ActiveJobs) {
        @($ActiveJobs)
    } else {
        $null
    }
    $jobsForTextAnalysis = if ($PSBoundParameters.ContainsKey('JobsForTextAnalysis') -and $null -ne $JobsForTextAnalysis) {
        @($JobsForTextAnalysis)
    } else {
        $null
    }
    $jobsForGrowthSignals = if ($PSBoundParameters.ContainsKey('JobsForGrowthSignals') -and $null -ne $JobsForGrowthSignals) {
        @($JobsForGrowthSignals)
    } else {
        $null
    }
    if ($null -ne $Jobs -and $null -eq $activeJobs) {
        $activeJobs = @(Get-ActiveJobsForSignalAnalysis -Jobs $Jobs)
    }
    if ($null -ne $activeJobs -and $null -eq $jobsForTextAnalysis) {
        if (@($activeJobs).Count -gt 6) {
            $jobsForTextAnalysis = @(Select-MostRecentJobsForSignalAnalysis -Jobs $activeJobs -Limit 6 -JobSignalTimestampCache $JobSignalTimestampCache)
        } else {
            $jobsForTextAnalysis = @($activeJobs)
        }
    }
    if ($null -ne $jobsForTextAnalysis -and $null -eq $jobsForGrowthSignals) {
        if (@($jobsForTextAnalysis).Count -gt 6) {
            $jobsForGrowthSignals = @($jobsForTextAnalysis | Select-Object -First 6)
        } else {
            $jobsForGrowthSignals = @($jobsForTextAnalysis)
        }
    }
    $activeJobsStopwatch.Stop()

    $hiringStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $hiringTimingBag = [ordered]@{}
    $hiringMetrics = Get-CompanyHiringSignalMetrics -Company $Company -Jobs $Jobs -ActiveJobs $activeJobs -JobsForTextAnalysis $jobsForTextAnalysis -ReferenceNow $ReferenceNow -JobSignalTextCache $JobSignalTextCache -JobSignalTimestampCache $JobSignalTimestampCache -JobHiringSignalAnalysisCache $JobHiringSignalAnalysisCache -TimingBag $hiringTimingBag
    $hiringStopwatch.Stop()

    $engagementStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $engagementMetrics = Get-CompanyEngagementMetrics -Company $Company -Activities $Activities -ReferenceNow $ReferenceNow
    $engagementStopwatch.Stop()

    $growthStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $growthMetrics = Get-CompanyGrowthSignalMetrics -Company $Company -Jobs $Jobs -ActiveJobs $activeJobs -JobsForGrowthSignals $jobsForGrowthSignals -JobsLast30Days ([int](Convert-ToNumber $hiringMetrics.jobsLast30Days)) -HiringSpikeRatio ([double](Convert-ToNumber $hiringMetrics.hiringSpikeRatio)) -JobSignalTextCache $JobSignalTextCache -JobSignalTimestampCache $JobSignalTimestampCache
    $growthStopwatch.Stop()

    $volumeScore = [Math]::Min(100, [Math]::Round(([Math]::Min(70, ((Convert-ToNumber $hiringMetrics.jobsLast30Days) * 10))) + ([Math]::Min(30, ((Convert-ToNumber $hiringMetrics.jobsLast90Days) * 2))), 0))
    $spikeScore = [Math]::Min(100, [Math]::Round(([Math]::Max(0, (Convert-ToNumber $hiringMetrics.hiringSpikeRatio)) * 50), 0))

    $components = @(
        [ordered]@{
            key = 'hiringVolume'
            label = 'Fresh hiring volume'
            score = $volumeScore
            weight = 0.26
            value = '{0} / {1}' -f ([int](Convert-ToNumber $hiringMetrics.jobsLast30Days)), ([int](Convert-ToNumber $hiringMetrics.jobsLast90Days))
            summary = '{0} jobs in 30d and {1} in 90d' -f ([int](Convert-ToNumber $hiringMetrics.jobsLast30Days)), ([int](Convert-ToNumber $hiringMetrics.jobsLast90Days))
        },
        [ordered]@{
            key = 'roleSeniority'
            label = 'Role seniority mix'
            score = [double](Convert-ToNumber $hiringMetrics.avgRoleSeniorityScore)
            weight = 0.14
            value = [string]([Math]::Round((Convert-ToNumber $hiringMetrics.avgRoleSeniorityScore), 1))
            summary = 'Average role seniority {0}/100' -f ([string]([Math]::Round((Convert-ToNumber $hiringMetrics.avgRoleSeniorityScore), 1)))
        },
        [ordered]@{
            key = 'hiringSpike'
            label = 'Hiring spike'
            score = $spikeScore
            weight = 0.18
            value = '{0}x' -f ([string]([Math]::Round((Convert-ToNumber $hiringMetrics.hiringSpikeRatio), 2)))
            summary = '{0}x versus the 90-day baseline' -f ([string]([Math]::Round((Convert-ToNumber $hiringMetrics.hiringSpikeRatio), 2)))
        },
        [ordered]@{
            key = 'externalRecruiter'
            label = 'External recruiter fit'
            score = [double](Convert-ToNumber $hiringMetrics.externalRecruiterLikelihoodScore)
            weight = 0.16
            value = [string]([Math]::Round((Convert-ToNumber $hiringMetrics.externalRecruiterLikelihoodScore), 1))
            summary = 'JD patterns suggest a {0}/100 partner-likelihood' -f ([string]([Math]::Round((Convert-ToNumber $hiringMetrics.externalRecruiterLikelihoodScore), 1)))
        },
        [ordered]@{
            key = 'growthSignals'
            label = 'Growth signals'
            score = [double](Convert-ToNumber $growthMetrics.score)
            weight = 0.14
            value = [string](Convert-ToNumber $growthMetrics.score)
            summary = [string]$growthMetrics.summary
        },
        [ordered]@{
            key = 'engagement'
            label = 'Engagement'
            score = [double](Convert-ToNumber $engagementMetrics.score)
            weight = 0.12
            value = [string](Convert-ToNumber $engagementMetrics.score)
            summary = [string]$engagementMetrics.summary
        }
    )

    $scoreBreakdown = [ordered]@{}
    $weightedTotal = 0.0
    foreach ($component in @($components)) {
        $contribution = [Math]::Round(((Convert-ToNumber $component.score) * [double]$component.weight), 1)
        $component.contribution = $contribution
        $weightedTotal += $contribution
        $scoreBreakdown[[string]$component.key] = [int][Math]::Round($contribution)
    }

    $normalizedTargetScore = [Math]::Min(100, [Math]::Round($weightedTotal, 0))
    $explanationSignature = [string]::Join('||', @(
            @($components) |
                ForEach-Object {
                    [string]::Join('|', @(
                            [string](Get-ObjectValue -Object $_ -Name 'key' -Default ''),
                            [string](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'score' -Default 0)),
                            [string](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'contribution' -Default 0)),
                            [string](Get-ObjectValue -Object $_ -Name 'value' -Default '')
                        ))
                }
        ))
    $existingExplanationSignature = [string](Get-ObjectValue -Object $Company -Name 'targetScoreExplanationSignature' -Default '')
    $existingExplanation = Get-ObjectValue -Object $Company -Name 'targetScoreExplanation' -Default $null
    $explanationStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    if ($existingExplanationSignature -eq $explanationSignature -and $existingExplanation) {
        $explanation = $existingExplanation
    } else {
        $explanation = Get-TargetScoreExplanation -Components $components
    }
    $explanationStopwatch.Stop()

    if ($TimingBag) {
        $TimingBag['activeJobsMs'] = [int]$activeJobsStopwatch.ElapsedMilliseconds
        $TimingBag['hiringMs'] = [int]$hiringStopwatch.ElapsedMilliseconds
        $TimingBag['hiringTitleLoopMs'] = [int](Convert-ToNumber (Get-ObjectValue -Object $hiringTimingBag -Name 'titleLoopMs' -Default 0))
        $TimingBag['hiringSignatureMs'] = [int](Convert-ToNumber (Get-ObjectValue -Object $hiringTimingBag -Name 'signatureMs' -Default 0))
        $TimingBag['hiringTextAnalysisMs'] = [int](Convert-ToNumber (Get-ObjectValue -Object $hiringTimingBag -Name 'textAnalysisMs' -Default 0))
        $TimingBag['engagementMs'] = [int]$engagementStopwatch.ElapsedMilliseconds
        $TimingBag['growthMs'] = [int]$growthStopwatch.ElapsedMilliseconds
        $TimingBag['explanationMs'] = [int]$explanationStopwatch.ElapsedMilliseconds
        $TimingBag['explanationCacheHit'] = [bool]($existingExplanationSignature -eq $explanationSignature -and $existingExplanation)
        $TimingBag['hiringMetricsCacheHit'] = [bool](Test-Truthy (Get-ObjectValue -Object $hiringMetrics -Name 'metricsCacheHit' -Default $false))
        $TimingBag['activeJobsCount'] = @($activeJobs).Count
        $TimingBag['jobsForTextAnalysisCount'] = @($jobsForTextAnalysis).Count
        $TimingBag['jobsForGrowthSignalsCount'] = @($jobsForGrowthSignals).Count
    }

    return [ordered]@{
        targetScore = [int]$normalizedTargetScore
        normalizedTargetScore = [int]$normalizedTargetScore
        jobsLast30Days = [int](Convert-ToNumber $hiringMetrics.jobsLast30Days)
        jobsLast90Days = [int](Convert-ToNumber $hiringMetrics.jobsLast90Days)
        avgRoleSeniorityScore = [double](Convert-ToNumber $hiringMetrics.avgRoleSeniorityScore)
        hiringSpikeRatio = [double](Convert-ToNumber $hiringMetrics.hiringSpikeRatio)
        externalRecruiterLikelihoodScore = [double](Convert-ToNumber $hiringMetrics.externalRecruiterLikelihoodScore)
        companyGrowthSignalScore = [double](Convert-ToNumber $growthMetrics.score)
        companyGrowthSignalSummary = [string]$growthMetrics.summary
        engagementScore = [double](Convert-ToNumber $engagementMetrics.score)
        engagementSummary = [string]$engagementMetrics.summary
        hiringVelocity = [double](Convert-ToNumber $hiringMetrics.hiringVelocity)
        hiringSignalMetricsSignature = [string](Get-ObjectValue -Object $hiringMetrics -Name 'hiringSignalMetricsSignature' -Default '')
        scoreBreakdown = $scoreBreakdown
        targetScoreExplanation = $explanation
        targetScoreExplanationSignature = $explanationSignature
    }
}

function Get-EmptyConnectionGraph {
    return [ordered]@{
        shortestPathToDecisionMaker = [ordered]@{
            pathLength = 0
            summary = 'No warm intro path mapped yet.'
            path = @()
            confidence = 'low'
        }
        warmIntroCandidates = @()
        relationshipStrengthScore = 0
        pastPlacementCount = 0
        decisionMakerCount = 0
    }
}

function Get-EmptySequenceState {
    return [ordered]@{
        status = 'idle'
        nextStep = 'step_1'
        nextStepLabel = 'Email'
        nextStepAt = $null
        adaptiveDelayDays = 2
        adaptiveTimingReason = 'Default cadence because no live engagement has been captured yet.'
        stopReason = ''
        replyDetected = $false
        steps = @()
    }
}

function Get-EmptyPipelineState {
    return [ordered]@{
        stage = 'not_started'
        stageRank = 0
        stageSource = 'account'
        activityCount = 0
        recentActivityCount30d = 0
        lastInteractionAt = $null
        lastInteractionType = ''
        recentSignals = @()
    }
}

function Get-NormalizedOutreachStage {
    param([string]$Stage)

    $key = Normalize-TextKey $Stage
    switch -Regex ($key) {
        '^$' { return '' }
        'not started|not_started' { return 'not_started' }
        'research' { return 'researching' }
        'ready to contact|ready_to_contact|warm intro|warm_intro' { return 'ready_to_contact' }
        'contacted|outreach|emailed|email sent|sent email' { return 'contacted' }
        'replied|reply|responded|response|interested' { return 'replied' }
        'opportunity|meeting|call|demo|proposal|qualified|client|in conversation|in_conversation' { return 'opportunity' }
        default { return ($key -replace ' ', '_') }
    }
}

function Get-PipelineStageRank {
    param([string]$Stage)

    switch (Get-NormalizedOutreachStage $Stage) {
        'not_started' { return 0 }
        'researching' { return 1 }
        'ready_to_contact' { return 2 }
        'contacted' { return 3 }
        'replied' { return 4 }
        'opportunity' { return 5 }
        default { return -1 }
    }
}

function Get-ActivitySignalText {
    param($Activity)

    $metadata = Get-ObjectValue -Object $Activity -Name 'metadata' -Default $null
    $metadataParts = @()
    if ($metadata -is [System.Collections.IDictionary]) {
        $metadataParts = @($metadata.Values | ForEach-Object { [string]$_ })
    } elseif ($metadata -is [System.Collections.IEnumerable] -and $metadata -isnot [string]) {
        $metadataParts = @($metadata | ForEach-Object { [string]$_ })
    } elseif ($null -ne $metadata) {
        $metadataParts = @([string]$metadata)
    }

    return (Normalize-TextKey ([string]::Join(' ', @(
                [string](Get-ObjectValue -Object $Activity -Name 'type' -Default ''),
                [string](Get-ObjectValue -Object $Activity -Name 'summary' -Default ''),
                [string](Get-ObjectValue -Object $Activity -Name 'notes' -Default ''),
                [string](Get-ObjectValue -Object $Activity -Name 'pipelineStage' -Default ''),
                [string]::Join(' ', @($metadataParts))
            ))))
}

function Resolve-ActivityPipelineStage {
    param($Activity)

    $explicitStage = Get-NormalizedOutreachStage ([string](Get-ObjectValue -Object $Activity -Name 'pipelineStage' -Default ''))
    if ($explicitStage) {
        return $explicitStage
    }

    $signalText = Get-ActivitySignalText -Activity $Activity
    if (-not $signalText) {
        return ''
    }

    if ($signalText -match '\b(reply|replied|responded|response|interested|accepted)\b') {
        return 'replied'
    }
    if ($signalText -match '\b(meeting|met|call|phone|demo|proposal|qualified|opportunity|intro call|screen)\b') {
        return 'opportunity'
    }
    if ($signalText -match '\b(outreach|email|emailed|sent|message|intro)\b') {
        return 'contacted'
    }
    if ($signalText -match '\b(linkedin|profile view|viewed profile|warm intro|mutual)\b') {
        return 'ready_to_contact'
    }
    if ($signalText -match '\b(research|mapped|sourced|identified)\b') {
        return 'researching'
    }

    return ''
}

function Get-CompanyPastPlacementCount {
    param(
        $Company,
        $Activities = $null
    )

    $count = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'pastPlacementCount' -Default 0))
    $placements = Get-ObjectValue -Object $Company -Name 'pastPlacements' -Default @()
    if ($placements -is [System.Collections.IEnumerable] -and $placements -isnot [string]) {
        $count += @($placements).Count
    } elseif ($placements) {
        $count += [int](Convert-ToNumber $placements)
    }

    foreach ($activity in @($Activities)) {
        $signalText = Get-ActivitySignalText -Activity $activity
        if ($signalText -match '\bplacement|placed|candidate placed|hired through\b') {
            $count += 1
        }
    }

    return $count
}

function Get-DecisionMakerFitScore {
    param($Contact)

    $title = Normalize-TextKey ([string](Get-ObjectValue -Object $Contact -Name 'title' -Default ''))
    $buyerFlag = Test-Truthy (Get-ObjectValue -Object $Contact -Name 'buyerFlag' -Default $false)
    $seniorFlag = Test-Truthy (Get-ObjectValue -Object $Contact -Name 'seniorFlag' -Default $false)
    $talentFlag = Test-Truthy (Get-ObjectValue -Object $Contact -Name 'talentFlag' -Default $false)
    $cacheKey = [string]::Join('|', @($title, [string][int]$buyerFlag, [string][int]$seniorFlag, [string][int]$talentFlag))
    if ($script:DecisionMakerFitScoreCache.ContainsKey($cacheKey)) {
        return [int]$script:DecisionMakerFitScoreCache[$cacheKey]
    }

    $score = 0
    if ($buyerFlag) { $score += 35 }
    if ($seniorFlag) { $score += 25 }
    if ($talentFlag) { $score += 12 }

    if ($title -match 'chief|founder|coo|ceo|cfo|cto|president|vice president|vp|head|director') {
        $score += 28
    } elseif ($title -match 'manager|lead|principal|staff') {
        $score += 16
    }

    if ($title -match 'talent|people|recruit|staffing|human resources|hr|hiring') {
        $score += 22
    } elseif ($title -match 'engineering|product|sales|marketing|operations|data|finance') {
        $score += 8
    }

    $score = [int][Math]::Min(100, $score)
    $script:DecisionMakerFitScoreCache[$cacheKey] = $score
    return $score
}

function Get-ContactRelationshipStrengthScore {
    param(
        $Contact,
        [int]$PastPlacementCount = 0,
        [int]$DecisionMakerFitScore = -1
    )

    $yearsConnected = [double](Convert-ToNumber (Get-ObjectValue -Object $Contact -Name 'yearsConnected' -Default 0))
    $priorityScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Contact -Name 'priorityScore' -Default 0))
    $companyOverlapCount = [double](Convert-ToNumber (Get-ObjectValue -Object $Contact -Name 'companyOverlapCount' -Default 0))
    $decisionMakerFitScore = if ($DecisionMakerFitScore -ge 0) { $DecisionMakerFitScore } else { Get-DecisionMakerFitScore -Contact $Contact }
    $score =
        ([Math]::Min(35, ($priorityScore * 0.55))) +
        ([Math]::Min(24, ($yearsConnected * 4))) +
        ([Math]::Min(14, ($companyOverlapCount * 2))) +
        ([Math]::Min(16, ($PastPlacementCount * 6))) +
        ([Math]::Round($decisionMakerFitScore * 0.18, 0))

    if (Test-Truthy (Get-ObjectValue -Object $Contact -Name 'seniorFlag' -Default $false)) { $score += 8 }
    if (Test-Truthy (Get-ObjectValue -Object $Contact -Name 'buyerFlag' -Default $false)) { $score += 10 }
    if (Get-ObjectValue -Object $Contact -Name 'linkedinUrl' -Default '') { $score += 4 }
    if (Get-ObjectValue -Object $Contact -Name 'email' -Default '') { $score += 3 }

    return [int][Math]::Min(100, [Math]::Round($score, 0))
}

function Get-ConnectionGraphInsights {
    param(
        $Company,
        $Contacts = $null,
        $Activities = $null,
        [int]$PastPlacementCount = -1,
        [System.Collections.IDictionary]$TimingBag = $null
    )

    $totalStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    if ($null -eq $Contacts) {
        $existing = Get-ObjectValue -Object $Company -Name 'connectionGraph' -Default $null
        if ($existing) {
            return (ConvertTo-PlainObject -InputObject $existing)
        }
        return (Get-EmptyConnectionGraph)
    }

    $pastPlacementCount = if ($PastPlacementCount -ge 0) { $PastPlacementCount } else { Get-CompanyPastPlacementCount -Company $Company -Activities $Activities }
    $rankedCandidates = New-Object System.Collections.ArrayList
    $decisionMakerCount = 0
    $rankingStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    foreach ($contact in @($Contacts)) {
        if ($null -eq $contact) {
            continue
        }

        $decisionMakerFitScore = Get-DecisionMakerFitScore -Contact $contact
        $seniorFlag = Test-Truthy (Get-ObjectValue -Object $contact -Name 'seniorFlag' -Default $false)
        $buyerFlag = Test-Truthy (Get-ObjectValue -Object $contact -Name 'buyerFlag' -Default $false)
        $talentFlag = Test-Truthy (Get-ObjectValue -Object $contact -Name 'talentFlag' -Default $false)
        $yearsConnected = [double](Convert-ToNumber (Get-ObjectValue -Object $contact -Name 'yearsConnected' -Default 0))
        if ($decisionMakerFitScore -ge 60) {
            $decisionMakerCount += 1
        }
        $relationshipStrengthScore = Get-ContactRelationshipStrengthScore -Contact $contact -PastPlacementCount $pastPlacementCount -DecisionMakerFitScore $decisionMakerFitScore
        $title = [string](Get-ObjectValue -Object $contact -Name 'title' -Default '')
        $fullName = [string](Get-ObjectValue -Object $contact -Name 'fullName' -Default '')
        $pathLength = if ($decisionMakerFitScore -ge 60) { 1 } else { 2 }
        $entry = [ordered]@{
            contact = $contact
            id = [string](Get-ObjectValue -Object $contact -Name 'id' -Default '')
            fullName = $fullName
            title = $title
            relationshipStrengthScore = [int]$relationshipStrengthScore
            decisionMakerFitScore = [int]$decisionMakerFitScore
            pathLength = $pathLength
            introPath = if ($pathLength -eq 1) { 'Direct path to a likely decision maker' } else { 'Best direct connection to broker an intro' }
            connectedOn = Get-ObjectValue -Object $contact -Name 'connectedOn' -Default $null
            yearsConnected = $yearsConnected
            seniorFlag = [bool]$seniorFlag
            buyerFlag = [bool]$buyerFlag
            talentFlag = [bool]$talentFlag
        }

        $insertIndex = -1
        for ($index = 0; $index -lt $rankedCandidates.Count; $index++) {
            $existing = $rankedCandidates[$index]
            if ($entry.relationshipStrengthScore -gt [int]$existing.relationshipStrengthScore) {
                $insertIndex = $index
                break
            }
            if ($entry.relationshipStrengthScore -eq [int]$existing.relationshipStrengthScore -and $entry.decisionMakerFitScore -gt [int]$existing.decisionMakerFitScore) {
                $insertIndex = $index
                break
            }
            if ($entry.relationshipStrengthScore -eq [int]$existing.relationshipStrengthScore -and $entry.decisionMakerFitScore -eq [int]$existing.decisionMakerFitScore -and [string]::CompareOrdinal([string]$entry.fullName, [string]$existing.fullName) -lt 0) {
                $insertIndex = $index
                break
            }
        }

        if ($insertIndex -ge 0) {
            $rankedCandidates.Insert($insertIndex, $entry)
        } elseif ($rankedCandidates.Count -lt 5) {
            [void]$rankedCandidates.Add($entry)
        }

        if ($rankedCandidates.Count -gt 5) {
            $rankedCandidates.RemoveAt($rankedCandidates.Count - 1)
        }
    }
    $rankingStopwatch.Stop()

    $formattingStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $warmIntroCandidates = @(
        @($rankedCandidates.ToArray()) |
            ForEach-Object {
                $why = New-Object System.Collections.ArrayList
                $yearsConnected = [double](Convert-ToNumber $_.yearsConnected)
                if ($yearsConnected -gt 0) {
                    [void]$why.Add(('{0}y connection' -f [string]([Math]::Round($yearsConnected, 1))))
                }
                if ([bool]$_.seniorFlag) { [void]$why.Add('senior contact') }
                if ([bool]$_.buyerFlag) { [void]$why.Add('buyer-side title') }
                if ([bool]$_.talentFlag) { [void]$why.Add('talent access') }
                if ($pastPlacementCount -gt 0) {
                    [void]$why.Add(('{0} prior placement signal{1}' -f $pastPlacementCount, $(if ($pastPlacementCount -eq 1) { '' } else { 's' })))
                }

                [ordered]@{
                    id = [string](Get-ObjectValue -Object $_ -Name 'id' -Default '')
                    fullName = [string](Get-ObjectValue -Object $_ -Name 'fullName' -Default '')
                    title = [string](Get-ObjectValue -Object $_ -Name 'title' -Default '')
                    relationshipStrengthScore = [int](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'relationshipStrengthScore' -Default 0))
                    decisionMakerFitScore = [int](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'decisionMakerFitScore' -Default 0))
                    pathLength = [int](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'pathLength' -Default 0))
                    introPath = [string](Get-ObjectValue -Object $_ -Name 'introPath' -Default '')
                    connectedOn = Get-ObjectValue -Object $_ -Name 'connectedOn' -Default $null
                    why = [string]([string]::Join(', ', @($why.ToArray())))
                }
            }
    )
    $formattingStopwatch.Stop()
    $pathStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $directDecisionMaker = @($warmIntroCandidates | Where-Object { (Convert-ToNumber $_.pathLength) -eq 1 } | Select-Object -First 1)
    $shortestPath = if ($directDecisionMaker) {
        [ordered]@{
            pathLength = 1
            summary = ('You are directly connected to {0}, a likely hiring decision maker at {1}.' -f $directDecisionMaker.fullName, [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default 'this company'))
            path = @('You', [string]$directDecisionMaker.fullName)
            confidence = 'high'
        }
    } elseif (@($warmIntroCandidates).Count -gt 0) {
        [ordered]@{
            pathLength = 2
            summary = ('Best warm route is through {0} into a hiring leader at {1}.' -f [string]$warmIntroCandidates[0].fullName, [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default 'this company'))
            path = @('You', [string]$warmIntroCandidates[0].fullName, ('Hiring leader at {0}' -f [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default 'the account')))
            confidence = 'medium'
        }
    } elseif ($pastPlacementCount -gt 0) {
        [ordered]@{
            pathLength = 2
            summary = ('No direct warm intro is mapped yet, but {0} prior placement signal{1} give you a credible way in.' -f $pastPlacementCount, $(if ($pastPlacementCount -eq 1) { '' } else { 's' }))
            path = @('You', 'Placement history', ('Decision maker at {0}' -f [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default 'the account')))
            confidence = 'medium'
        }
    } else {
        (Get-EmptyConnectionGraph).shortestPathToDecisionMaker
    }

    $relationshipStrengthScore = if (@($warmIntroCandidates).Count -gt 0) {
        [int][Math]::Min(100, [Math]::Round(
                ((Convert-ToNumber $warmIntroCandidates[0].relationshipStrengthScore) * 0.68) +
                (@($warmIntroCandidates).Count * 6) +
                ($pastPlacementCount * 7) +
                $(if ($directDecisionMaker) { 12 } else { 0 }),
                0
            ))
    } else {
        [int][Math]::Min(100, ($pastPlacementCount * 10))
    }
    $pathStopwatch.Stop()
    $totalStopwatch.Stop()

    if ($TimingBag) {
        $TimingBag['rankingMs'] = [int]$rankingStopwatch.ElapsedMilliseconds
        $TimingBag['formattingMs'] = [int]$formattingStopwatch.ElapsedMilliseconds
        $TimingBag['pathMs'] = [int]$pathStopwatch.ElapsedMilliseconds
        $TimingBag['contactCount'] = @($Contacts).Count
        $TimingBag['totalMs'] = [int]$totalStopwatch.ElapsedMilliseconds
    }

    return [ordered]@{
        shortestPathToDecisionMaker = $shortestPath
        warmIntroCandidates = $warmIntroCandidates
        relationshipStrengthScore = $relationshipStrengthScore
        pastPlacementCount = [int]$pastPlacementCount
        decisionMakerCount = [int]$decisionMakerCount
    }
}

function Get-CompanyTriggerAlerts {
    param(
        $Company,
        $Jobs = $null,
        $Contacts = $null,
        $Activities = $null,
        [datetime]$ReferenceNow = (Get-Date),
        [switch]$SkipContactAlertRefresh,
        [System.Collections.IDictionary]$TimingBag = $null
    )

    $totalStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    if ($null -eq $Jobs -and $null -eq $Contacts -and $null -eq $Activities) {
        $existing = Get-ObjectValue -Object $Company -Name 'triggerAlerts' -Default $null
        if ($existing) {
            return @(ConvertTo-PlainObject -InputObject $existing)
        }
        return @()
    }

    $alerts = New-Object System.Collections.ArrayList
    $newRoleCount7d = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'newRoleCount7d' -Default 0))
    $jobsLast90Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast90Days' -Default 0))
    $jobsLast30Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast30Days' -Default 0))
    $hiringSpikeRatio = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringSpikeRatio' -Default 0))
    $staleRoleCount30d = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'staleRoleCount30d' -Default 0))
    $jobSpikeThreshold = [Math]::Max(3, [Math]::Min(8, [Math]::Ceiling($jobsLast90Days / 6.0)))
    $jobAlertStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    if ($newRoleCount7d -ge $jobSpikeThreshold -or ($hiringSpikeRatio -ge 1.6 -and $newRoleCount7d -ge 3)) {
        [void]$alerts.Add([ordered]@{
                id = 'job_spike'
                type = 'job_spike'
                title = 'Hiring spike'
                summary = ('{0} new roles in the last 7 days versus a {1}x recent baseline.' -f $newRoleCount7d, [string]([Math]::Round($hiringSpikeRatio, 2)))
                priorityScore = [int][Math]::Min(100, [Math]::Round(($newRoleCount7d * 11) + ([Math]::Max(0, $hiringSpikeRatio - 1) * 28), 0))
                recommendedAction = 'Lead with the current hiring burst while the signal is still fresh.'
            })
    }

    $staleJobs = @()
    $repeatedTitle = ''
    $repeatedCount = 0
    $titleSamples = @{}
    if ($null -ne $Jobs) {
        $staleCutoff = $ReferenceNow.AddDays(-30)
        $staleCandidates = New-Object System.Collections.ArrayList
        $titleCounts = @{}
        foreach ($job in @($Jobs)) {
            if ($null -eq $job -or (Get-ObjectValue -Object $job -Name 'active' -Default $true) -eq $false) {
                continue
            }

            $postedAt = Get-DateSortValue ([string](Get-ObjectValue -Object $job -Name 'postedAt' -Default ''))
            if ($staleRoleCount30d -gt 0 -and $postedAt -gt [DateTime]::MinValue -and $postedAt -lt $staleCutoff) {
                $insertIndex = -1
                for ($index = 0; $index -lt $staleCandidates.Count; $index++) {
                    $existingPostedAt = Get-DateSortValue ([string](Get-ObjectValue -Object $staleCandidates[$index] -Name 'postedAt' -Default ''))
                    if ($postedAt -lt $existingPostedAt) {
                        $insertIndex = $index
                        break
                    }
                }

                if ($insertIndex -ge 0) {
                    $staleCandidates.Insert($insertIndex, $job)
                } elseif ($staleCandidates.Count -lt 3) {
                    [void]$staleCandidates.Add($job)
                }

                if ($staleCandidates.Count -gt 3) {
                    $staleCandidates.RemoveAt($staleCandidates.Count - 1)
                }
            }

            $normalizedTitle = [string](Get-ObjectValue -Object $job -Name 'normalizedTitle' -Default (Normalize-TextKey ([string](Get-ObjectValue -Object $job -Name 'title' -Default ''))))
            if ([string]::IsNullOrWhiteSpace($normalizedTitle)) {
                continue
            }
            if (-not $titleCounts.ContainsKey($normalizedTitle)) {
                $titleCounts[$normalizedTitle] = 0
                $titleSamples[$normalizedTitle] = $job
            }
            $titleCounts[$normalizedTitle] = [int]$titleCounts[$normalizedTitle] + 1
            $entryCount = [int]$titleCounts[$normalizedTitle]
            if ($entryCount -ge 2 -and ($entryCount -gt $repeatedCount -or ($entryCount -eq $repeatedCount -and [string]::CompareOrdinal($normalizedTitle, $repeatedTitle) -lt 0))) {
                $repeatedTitle = [string]$normalizedTitle
                $repeatedCount = $entryCount
            }
        }
        $staleJobs = @($staleCandidates.ToArray())
    }

    if ($staleRoleCount30d -gt 0) {
        $oldestAgeDays = if (@($staleJobs).Count -gt 0) {
            [int][Math]::Floor(($ReferenceNow - (Get-DateSortValue ([string](Get-ObjectValue -Object $staleJobs[0] -Name 'postedAt' -Default '')))).TotalDays)
        } else {
            30
        }
        [void]$alerts.Add([ordered]@{
                id = 'stale_roles'
                type = 'stale_roles'
                title = 'Stale open roles'
                summary = ('{0} open role{1} have been live for 30+ days; oldest signal is about {2} days old.' -f $staleRoleCount30d, $(if ($staleRoleCount30d -eq 1) { '' } else { 's' }), $oldestAgeDays)
                priorityScore = [int][Math]::Min(100, [Math]::Round(($staleRoleCount30d * 14) + ([Math]::Min(25, $oldestAgeDays / 2)), 0))
                recommendedAction = 'Reference the age of the search and position yourself around hard-to-fill roles.'
            })
    }

    if ($repeatedCount -ge 2) {
        [void]$alerts.Add([ordered]@{
                id = 'repeated_postings'
                type = 'repeated_postings'
                title = 'Repeated postings'
                summary = ('{0} active postings are clustered around "{1}", which usually means the team still has not closed the gap.' -f $repeatedCount, [string](Get-ObjectValue -Object $titleSamples[$repeatedTitle] -Name 'title' -Default 'that role'))
                priorityScore = [int][Math]::Min(100, [Math]::Round(($repeatedCount * 18) + ([Math]::Min(24, $jobsLast30Days * 2)), 0))
                recommendedAction = 'Use the repeated title pattern as proof of sustained hiring pressure.'
            })
    }
    $jobAlertStopwatch.Stop()

    $contactAlertStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    if ($SkipContactAlertRefresh) {
        $existingAlerts = @(Get-ObjectValue -Object $Company -Name 'triggerAlerts' -Default @())
        foreach ($existingAlert in @($existingAlerts)) {
            if ([string](Get-ObjectValue -Object $existingAlert -Name 'id' -Default '') -eq 'new_hiring_manager_detected') {
                [void]$alerts.Add((ConvertTo-PlainObject -InputObject $existingAlert))
                break
            }
        }
    } elseif ($null -ne $Contacts) {
        $recentManager = $null
        $recentManagerScore = -1
        $recentCutoff = $ReferenceNow.AddDays(-180)
        foreach ($contact in @($Contacts)) {
            if ($null -eq $contact) {
                continue
            }
            $decisionMakerFitScore = Get-DecisionMakerFitScore -Contact $contact
            if ($decisionMakerFitScore -lt 60) {
                continue
            }
            $connectedAt = Get-DateSortValue ([string](Get-ObjectValue -Object $contact -Name 'connectedOn' -Default ''))
            if ($connectedAt -le [DateTime]::MinValue -or $connectedAt -lt $recentCutoff) {
                continue
            }

            if ($decisionMakerFitScore -gt $recentManagerScore) {
                $recentManagerScore = $decisionMakerFitScore
                $recentManager = [ordered]@{
                    fullName = [string](Get-ObjectValue -Object $contact -Name 'fullName' -Default '')
                    title = [string](Get-ObjectValue -Object $contact -Name 'title' -Default '')
                    decisionMakerFitScore = $decisionMakerFitScore
                }
            }
        }

        if ($recentManager) {
            [void]$alerts.Add([ordered]@{
                    id = 'new_hiring_manager_detected'
                    type = 'new_hiring_manager_detected'
                    title = 'New hiring manager detected'
                    summary = ('{0} looks like a recent hiring-side connection at {1}.' -f [string]$recentManager.fullName, [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default 'this company'))
                    priorityScore = [int][Math]::Min(100, [Math]::Round(45 + (Convert-ToNumber $recentManager.decisionMakerFitScore * 0.45), 0))
                    recommendedAction = ('Use {0} as the first route into the account.' -f [string]$recentManager.fullName)
                })
        }
    }
    $contactAlertStopwatch.Stop()

    $sortStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $sortedAlerts = @(
        $alerts |
            Sort-Object @(
                @{ Expression = { [double](Convert-ToNumber $_.priorityScore) }; Descending = $true },
                @{ Expression = { [string]$_.title }; Descending = $false }
            )
    )
    $sortStopwatch.Stop()
    $totalStopwatch.Stop()

    if ($TimingBag) {
        $TimingBag['jobAlertsMs'] = [int]$jobAlertStopwatch.ElapsedMilliseconds
        $TimingBag['contactAlertsMs'] = [int]$contactAlertStopwatch.ElapsedMilliseconds
        $TimingBag['sortMs'] = [int]$sortStopwatch.ElapsedMilliseconds
        $TimingBag['totalMs'] = [int]$totalStopwatch.ElapsedMilliseconds
        $TimingBag['jobCount'] = @($Jobs).Count
        $TimingBag['contactCount'] = @($Contacts).Count
    }

    return $sortedAlerts
}

function Get-AccountSequenceState {
    param(
        $Company,
        $Activities = $null,
        [datetime]$ReferenceNow = (Get-Date),
        $ConnectionGraph = $null
    )

    if ($null -eq $Activities) {
        $existing = Get-ObjectValue -Object $Company -Name 'sequenceState' -Default $null
        if ($existing) {
            return (ConvertTo-PlainObject -InputObject $existing)
        }
        return (Get-EmptySequenceState)
    }

    $existingConnectionGraph = if ($ConnectionGraph) { $ConnectionGraph } else { Get-ObjectValue -Object $Company -Name 'connectionGraph' -Default (Get-EmptyConnectionGraph) }
    $engagementScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'engagementScore' -Default 0))
    $relationshipStrengthScore = [double](Convert-ToNumber (Get-ObjectValue -Object $existingConnectionGraph -Name 'relationshipStrengthScore' -Default 0))
    $adaptiveDelayDays = if ($engagementScore -ge 55 -or $relationshipStrengthScore -ge 70) {
        1
    } elseif ($engagementScore -le 12 -and $relationshipStrengthScore -lt 35) {
        3
    } else {
        2
    }
    $adaptiveTimingReason = if ($adaptiveDelayDays -eq 1) {
        'Cadence is compressed because the account is warm or already showing engagement.'
    } elseif ($adaptiveDelayDays -eq 3) {
        'Cadence is spaced out because the account is still cold.'
    } else {
        'Cadence is using the default mixed-intent timing.'
    }

    $orderedActivities = @(
        $Activities |
            Sort-Object @{ Expression = { Get-DateSortValue ([string](Get-ObjectValue -Object $_ -Name 'occurredAt' -Default '')) } }
    )

    $emailEvents = @($orderedActivities | Where-Object { (Get-ActivitySignalText -Activity $_) -match '\b(outreach|email|emailed|sent|message)\b' })
    $linkedinEvents = @($orderedActivities | Where-Object { (Get-ActivitySignalText -Activity $_) -match '\b(linkedin|profile view|viewed profile)\b' })
    $replyEvents = @($orderedActivities | Where-Object { (Get-ActivitySignalText -Activity $_) -match '\b(reply|replied|responded|response|interested)\b' })
    $followUpEvents = @($orderedActivities | Where-Object { (Get-ActivitySignalText -Activity $_) -match '\bfollow up|follow-up\b' })
    if (@($followUpEvents).Count -eq 0 -and @($emailEvents).Count -ge 2) {
        $followUpEvents = @($emailEvents | Select-Object -Skip 1)
    }
    $callEvents = @($orderedActivities | Where-Object { (Get-ActivitySignalText -Activity $_) -match '\b(call|phone|voicemail)\b' })

    $stepDefinitions = @(
        [ordered]@{ key = 'step_1'; label = 'Email'; channel = 'email'; completedAt = $(if (@($emailEvents).Count -gt 0) { Get-ObjectValue -Object $emailEvents[0] -Name 'occurredAt' -Default $null } else { $null }) },
        [ordered]@{ key = 'step_2'; label = 'LinkedIn view'; channel = 'linkedin'; completedAt = $(if (@($linkedinEvents).Count -gt 0) { Get-ObjectValue -Object $linkedinEvents[0] -Name 'occurredAt' -Default $null } else { $null }) },
        [ordered]@{ key = 'step_3'; label = 'Follow-up email'; channel = 'email'; completedAt = $(if (@($followUpEvents).Count -gt 0) { Get-ObjectValue -Object $followUpEvents[0] -Name 'occurredAt' -Default $null } else { $null }) },
        [ordered]@{ key = 'step_4'; label = 'Call reminder'; channel = 'call'; completedAt = $(if (@($callEvents).Count -gt 0) { Get-ObjectValue -Object $callEvents[0] -Name 'occurredAt' -Default $null } else { $null }) }
    )

    $baseTimeline = @(
        [ordered]@{ key = 'step_1'; offsetDays = 0 },
        [ordered]@{ key = 'step_2'; offsetDays = $adaptiveDelayDays },
        [ordered]@{ key = 'step_3'; offsetDays = $adaptiveDelayDays + 2 },
        [ordered]@{ key = 'step_4'; offsetDays = ($adaptiveDelayDays * 2) + 4 }
    )

    $sequenceAnchor = if (@($orderedActivities).Count -gt 0) {
        Get-DateSortValue ([string](Get-ObjectValue -Object $orderedActivities[0] -Name 'occurredAt' -Default ''))
    } else {
        $ReferenceNow
    }

    $steps = New-Object System.Collections.ArrayList
    foreach ($definition in @($stepDefinitions)) {
        $timeline = @($baseTimeline | Where-Object { $_.key -eq $definition.key } | Select-Object -First 1)
        $recommendedAt = if ($timeline) { $sequenceAnchor.AddDays([double](Convert-ToNumber $timeline.offsetDays)).ToString('o') } else { $null }
        [void]$steps.Add([ordered]@{
                key = [string]$definition.key
                label = [string]$definition.label
                channel = [string]$definition.channel
                status = $(if ($definition.completedAt) { 'completed' } else { 'pending' })
                completedAt = $definition.completedAt
                recommendedAt = $recommendedAt
            })
    }

    $replyDetected = (@($replyEvents).Count -gt 0) -or ((Get-PipelineStageRank (Get-ObjectValue -Object $Company -Name 'outreachStatus' -Default '')) -ge (Get-PipelineStageRank 'replied'))
    if ($replyDetected) {
        return [ordered]@{
            status = 'stopped'
            nextStep = ''
            nextStepLabel = ''
            nextStepAt = $null
            adaptiveDelayDays = [int]$adaptiveDelayDays
            adaptiveTimingReason = $adaptiveTimingReason
            stopReason = 'reply_detected'
            replyDetected = $true
            steps = @($steps.ToArray())
        }
    }

    $nextPendingStep = @($steps.ToArray() | Where-Object { $_.status -eq 'pending' } | Select-Object -First 1)
    return [ordered]@{
        status = $(if ($nextPendingStep) { 'active' } else { 'completed' })
        nextStep = [string]$(if ($nextPendingStep) { $nextPendingStep.key } else { '' })
        nextStepLabel = [string]$(if ($nextPendingStep) { $nextPendingStep.label } else { '' })
        nextStepAt = $(if ($nextPendingStep) { $nextPendingStep.recommendedAt } else { $null })
        adaptiveDelayDays = [int]$adaptiveDelayDays
        adaptiveTimingReason = $adaptiveTimingReason
        stopReason = ''
        replyDetected = $false
        steps = @($steps.ToArray())
    }
}

function Get-AccountPipelineState {
    param(
        $Company,
        $Activities = $null,
        [datetime]$ReferenceNow = (Get-Date)
    )

    if ($null -eq $Activities) {
        $existing = Get-ObjectValue -Object $Company -Name 'pipelineState' -Default $null
        if ($existing) {
            return (ConvertTo-PlainObject -InputObject $existing)
        }
        return (Get-EmptyPipelineState)
    }

    $normalizedStages = @()
    $recentSignals = New-Object System.Collections.ArrayList
    $recentActivityCount30d = 0
    $latestActivity = @(
        $Activities |
            Where-Object { $null -ne $_ } |
            Sort-Object @{ Expression = { Get-DateSortValue ([string](Get-ObjectValue -Object $_ -Name 'occurredAt' -Default '')) }; Descending = $true }
    ) | Select-Object -First 1

    foreach ($activity in @($Activities)) {
        $stage = Resolve-ActivityPipelineStage -Activity $activity
        if ($stage) {
            $normalizedStages += $stage
        }
        $occurredAt = Get-DateSortValue ([string](Get-ObjectValue -Object $activity -Name 'occurredAt' -Default ''))
        if ($occurredAt -gt [DateTime]::MinValue -and $occurredAt -ge $ReferenceNow.AddDays(-30)) {
            $recentActivityCount30d += 1
        }
        $summary = [string](Get-ObjectValue -Object $activity -Name 'summary' -Default '')
        if ($summary -and $recentSignals.Count -lt 4) {
            [void]$recentSignals.Add($summary)
        }
    }

    $resolvedStage = Get-NormalizedOutreachStage ([string](Get-ObjectValue -Object $Company -Name 'outreachStatus' -Default ''))
    $resolvedRank = Get-PipelineStageRank $resolvedStage
    foreach ($stage in @($normalizedStages)) {
        $rank = Get-PipelineStageRank $stage
        if ($rank -gt $resolvedRank) {
            $resolvedStage = $stage
            $resolvedRank = $rank
        }
    }
    if (-not $resolvedStage) {
        $resolvedStage = 'not_started'
        $resolvedRank = 0
    }

    return [ordered]@{
        stage = $resolvedStage
        stageRank = [int]$resolvedRank
        stageSource = $(if (@($normalizedStages).Count -gt 0) { 'activity' } else { 'account' })
        activityCount = [int]@($Activities).Count
        recentActivityCount30d = [int]$recentActivityCount30d
        lastInteractionAt = $(if ($latestActivity) { Get-ObjectValue -Object $latestActivity -Name 'occurredAt' -Default $null } else { $null })
        lastInteractionType = $(if ($latestActivity) { [string](Get-ObjectValue -Object $latestActivity -Name 'type' -Default '') } else { '' })
        recentSignals = @($recentSignals.ToArray())
    }
}

function Get-EnrichmentFunnelStats {
    param($State)
    $total = @($State.companies).Count
    $enriched = @($State.companies | Where-Object { $es = [string](Get-ObjectValue -Object $_ -Name 'enrichmentStatus'); $es -eq 'enriched' -or $es -eq 'verified' -or $es -eq 'manual' }).Count
    $verified = @($State.companies | Where-Object { $es = [string](Get-ObjectValue -Object $_ -Name 'enrichmentStatus'); $es -eq 'verified' -or $es -eq 'manual' }).Count
    $importing = @($State.boardConfigs | Where-Object { (Get-ObjectValue -Object $_ -Name 'importEnabled') -eq $true -or (Get-ObjectValue -Object $_ -Name 'lastImportAt') }).Count
    $unresolved = @($State.companies | Where-Object { $es = [string](Get-ObjectValue -Object $_ -Name 'enrichmentStatus'); $es -eq 'unresolved' -or $es -eq 'failed' }).Count
    $pending = $total - $enriched - $unresolved
    if ($pending -lt 0) { $pending = 0 }
    return [ordered]@{ total = $total; pending = $pending; enriched = $enriched; verified = $verified; importing = $importing; unresolved = $unresolved }
}

function Find-DuplicateContacts {
    param($State)
    $groups = @{}
    foreach ($contact in @($State.contacts | Where-Object { $null -ne $_ })) {
        $key = ([string]$contact.fullName).Trim().ToLowerInvariant()
        if (-not $key) { continue }
        if (-not $groups.ContainsKey($key)) { $groups[$key] = @() }
        $groups[$key] += $contact
    }
    return @($groups.GetEnumerator() |
        Where-Object { $_.Value.Count -gt 1 } |
        Sort-Object @{ Expression = { $_.Value.Count }; Descending = $true } |
        Select-Object -First 20 |
        ForEach-Object {
            [ordered]@{
                name = $_.Key
                count = $_.Value.Count
                contacts = @($_.Value | ForEach-Object {
                    [ordered]@{ id = [string]$_.id; fullName = [string]$_.fullName; companyName = [string]$_.companyName; title = [string]$_.title; connectedOn = $_.connectedOn }
                })
            }
        })
}

function Invoke-BulkAccountUpdate {
    param($State, [array]$AccountIds, $Patch)
    $updated = 0
    foreach ($id in $AccountIds) {
        try {
            $result = Set-AccountFields -State $State -AccountId $id -Patch $Patch
            $updated++
        } catch { }
    }
    return [ordered]@{ updated = $updated; total = $AccountIds.Count }
}

function Get-RecommendationAction {
    param($Company)

    if ($Company.nextAction) {
        return [string]$Company.nextAction
    }

    $triggerAlerts = @($(if (Get-ObjectValue -Object $Company -Name 'triggerAlerts' -Default $null) { Get-ObjectValue -Object $Company -Name 'triggerAlerts' -Default @() } else { @() }))
    $topAlert = @($triggerAlerts | Sort-Object @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'priorityScore' -Default 0)) }; Descending = $true } | Select-Object -First 1)
    $sequenceState = Get-ObjectValue -Object $Company -Name 'sequenceState' -Default $null
    $connectionGraph = Get-ObjectValue -Object $Company -Name 'connectionGraph' -Default $null
    $warmIntroCandidates = @($(if ($connectionGraph) { Get-ObjectValue -Object $connectionGraph -Name 'warmIntroCandidates' -Default @() } else { @() }))
    $shortestPath = if ($connectionGraph) { Get-ObjectValue -Object $connectionGraph -Name 'shortestPathToDecisionMaker' -Default $null } else { $null }

    if ($sequenceState -and [string](Get-ObjectValue -Object $sequenceState -Name 'stopReason' -Default '') -eq 'reply_detected') {
        return "Reply detected at $($Company.displayName). Pause outbound steps and work the response."
    }

    if ($topAlert) {
        $alertType = [string](Get-ObjectValue -Object $topAlert -Name 'type' -Default '')
        if ($alertType -eq 'job_spike' -and @($warmIntroCandidates).Count -gt 0) {
            return ('Ask {0} for the warmest intro while hiring is spiking at {1}.' -f [string](Get-ObjectValue -Object $warmIntroCandidates[0] -Name 'fullName' -Default 'your best contact'), $Company.displayName)
        }
        if ($alertType -eq 'new_hiring_manager_detected') {
            return [string](Get-ObjectValue -Object $topAlert -Name 'recommendedAction' -Default ('Lead with the new hiring-side contact at {0}.' -f $Company.displayName))
        }
        if ($alertType -eq 'stale_roles') {
            return "Use the stale-role pattern at $($Company.displayName) to anchor a sharper outreach angle."
        }
        if ($alertType -eq 'repeated_postings') {
            return "Reference the repeated opening pattern at $($Company.displayName) to show you understand the pain point."
        }
    }

    if ($shortestPath -and (Convert-ToNumber (Get-ObjectValue -Object $shortestPath -Name 'pathLength' -Default 0)) -eq 1 -and @($warmIntroCandidates).Count -gt 0) {
        return ('Start with your direct connection {0} at {1}.' -f [string](Get-ObjectValue -Object $warmIntroCandidates[0] -Name 'fullName' -Default 'there'), $Company.displayName)
    }

    if ($Company.staleFlag -eq 'STALE') {
        return "Follow up with $($Company.displayName); the account is stale and still looks active."
    }

    if (($Company.jobCount -gt 0) -and ($Company.outreachStatus -eq 'not_started' -or [string]::IsNullOrWhiteSpace([string]$Company.outreachStatus))) {
        return "Research and contact the best hiring lead at $($Company.displayName)."
    }

    if (($Company.jobCount -gt 0) -and ($Company.networkStrength -eq 'Hot')) {
        return "Use your warm overlap to open a conversation at $($Company.displayName)."
    }

    return "Review $($Company.displayName) for a tailored outreach angle."
}

function Get-DateSortValue {
    param([string]$Value)

    $parsed = [DateTime]::MinValue
    if ($Value -and [DateTime]::TryParse($Value, [ref]$parsed)) {
        return $parsed
    }
    return [DateTime]::MinValue
}

function Get-StringList {
    param($Value)

    if ($null -eq $Value) {
        return @()
    }

    if ($Value -is [string]) {
        if ([string]::IsNullOrWhiteSpace($Value)) {
            return @()
        }
        return @($Value)
    }

    if ($Value -is [System.Collections.IDictionary]) {
        if (@($Value.Keys).Count -eq 0) {
            return @()
        }
        return @($Value.Values | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    if ($Value -is [System.Collections.IEnumerable]) {
        return @($Value | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    return @([string]$Value)
}

function Select-AccountSummary {
    param(
        [Parameter(Mandatory = $true)]
        $Company
    )

    $displayName = [string](Get-ObjectValue -Object $Company -Name 'displayName')
    $domain = [string](Get-ObjectValue -Object $Company -Name 'domain')
    $canonicalDomain = [string]$(if (Get-ObjectValue -Object $Company -Name 'canonicalDomain') { Get-ObjectValue -Object $Company -Name 'canonicalDomain' } else { $domain })
    $careersUrl = [string](Get-ObjectValue -Object $Company -Name 'careersUrl')
    $aliases = @(Get-GeneratedCompanyAliases -CompanyName $displayName -Domain $canonicalDomain -ExistingAliases @(Get-ObjectValue -Object $Company -Name 'aliases' -Default @()))

    return [ordered]@{
        id = [string](Get-ObjectValue -Object $Company -Name 'id')
        normalizedName = [string](Get-ObjectValue -Object $Company -Name 'normalizedName')
        displayName = $displayName
        domain = $domain
        careersUrl = $careersUrl
        canonicalDomain = $canonicalDomain
        linkedinCompanySlug = [string](Get-ObjectValue -Object $Company -Name 'linkedinCompanySlug')
        aliases = $aliases
        enrichmentStatus = [string](Get-ObjectValue -Object $Company -Name 'enrichmentStatus')
        enrichmentSource = [string](Get-ObjectValue -Object $Company -Name 'enrichmentSource')
        enrichmentConfidence = [string](Get-ObjectValue -Object $Company -Name 'enrichmentConfidence')
        enrichmentConfidenceScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'enrichmentConfidenceScore'))
        lastEnrichedAt = Get-ObjectValue -Object $Company -Name 'lastEnrichedAt' -Default $null
        lastVerifiedAt = Get-ObjectValue -Object $Company -Name 'lastVerifiedAt' -Default $null
        nextEnrichmentAttemptAt = Get-ObjectValue -Object $Company -Name 'nextEnrichmentAttemptAt' -Default $null
        enrichmentNotes = [string](Get-ObjectValue -Object $Company -Name 'enrichmentNotes')
        enrichmentEvidence = [string](Get-ObjectValue -Object $Company -Name 'enrichmentEvidence')
        enrichmentFailureReason = [string](Get-ObjectValue -Object $Company -Name 'enrichmentFailureReason')
        owner = [string](Get-ObjectValue -Object $Company -Name 'owner')
        ownerId = [string](Get-ObjectValue -Object $Company -Name 'ownerId')
        ownerAssignedAt = Get-ObjectValue -Object $Company -Name 'ownerAssignedAt' -Default $null
        ownerAssignedBy = [string](Get-ObjectValue -Object $Company -Name 'ownerAssignedBy')
        priority = [string](Get-ObjectValue -Object $Company -Name 'priority')
        status = [string](Get-ObjectValue -Object $Company -Name 'status')
        outreachStatus = [string](Get-ObjectValue -Object $Company -Name 'outreachStatus')
        nextAction = [string](Get-ObjectValue -Object $Company -Name 'nextAction')
        nextActionAt = Get-ObjectValue -Object $Company -Name 'nextActionAt' -Default $null
        dailyScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'dailyScore'))
        targetScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'targetScore'))
        normalizedTargetScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'normalizedTargetScore' -Default (Get-ObjectValue -Object $Company -Name 'targetScore' -Default 0)))
        connectionCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'connectionCount'))
        seniorContactCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'seniorContactCount'))
        talentContactCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'talentContactCount'))
        jobCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobCount'))
        openRoleCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'openRoleCount'))
        jobsLast30Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast30Days'))
        jobsLast90Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast90Days'))
        newRoleCount7d = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'newRoleCount7d'))
        staleRoleCount30d = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'staleRoleCount30d'))
        avgRoleSeniorityScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'avgRoleSeniorityScore'))
        hiringSpikeRatio = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringSpikeRatio'))
        externalRecruiterLikelihoodScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'externalRecruiterLikelihoodScore'))
        companyGrowthSignalScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'companyGrowthSignalScore'))
        engagementScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'engagementScore'))
        hiringVelocity = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringVelocity'))
        departmentFocus = [string](Get-ObjectValue -Object $Company -Name 'departmentFocus')
        networkStrength = [string](Get-ObjectValue -Object $Company -Name 'networkStrength')
        hiringStatus = [string](Get-ObjectValue -Object $Company -Name 'hiringStatus')
        lastJobPostedAt = Get-ObjectValue -Object $Company -Name 'lastJobPostedAt' -Default $null
        lastContactedAt = Get-ObjectValue -Object $Company -Name 'lastContactedAt' -Default $null
        followUpScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'followUpScore'))
        relationshipStrengthScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'relationshipStrengthScore' -Default 0))
        alertPriorityScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'alertPriorityScore' -Default 0))
        sequenceStatus = [string](Get-ObjectValue -Object (Get-ObjectValue -Object $Company -Name 'sequenceState' -Default $null) -Name 'status' -Default '')
        sequenceNextStep = [string](Get-ObjectValue -Object (Get-ObjectValue -Object $Company -Name 'sequenceState' -Default $null) -Name 'nextStep' -Default '')
        sequenceNextStepAt = Get-ObjectValue -Object (Get-ObjectValue -Object $Company -Name 'sequenceState' -Default $null) -Name 'nextStepAt' -Default $null
        daysSinceContact = Get-ObjectValue -Object $Company -Name 'daysSinceContact' -Default $null
        staleFlag = [string]$Company.staleFlag
        recommendedAction = [string]$Company.recommendedAction
        outreachDraft = [string]$Company.outreachDraft
        atsTypes = @(Get-StringList $Company.atsTypes)
        topContactName = [string]$Company.topContactName
        topContactTitle = [string]$Company.topContactTitle
    }
}

function Select-AccountDetailModel {
    param(
        [Parameter(Mandatory = $true)]
        $Company
    )

    $summary = Select-AccountSummary -Company $Company
    $summary.industry = [string]$Company.industry
    $summary.location = [string]$Company.location
    $summary.notes = [string]$Company.notes
    $summary.tags = @(Get-StringList $Company.tags)
    $summary.enrichmentAttemptedUrls = @(Get-StringList $Company.enrichmentAttemptedUrls)
    $summary.enrichmentHttpSummary = if ($Company.enrichmentHttpSummary) { ConvertTo-PlainObject -InputObject $Company.enrichmentHttpSummary } else { @() }
    $summary.priorityTier = [string]$Company.priorityTier
    $summary.departmentFocusCount = [int](Convert-ToNumber $Company.departmentFocusCount)
    $summary.departmentConcentration = [double](Convert-ToNumber $Company.departmentConcentration)
    $summary.hiringSpikeScore = [double](Convert-ToNumber $Company.hiringSpikeScore)
    $summary.scoreBreakdown = if ($Company.scoreBreakdown) { ConvertTo-PlainObject -InputObject $Company.scoreBreakdown } else { [ordered]@{} }
    $summary.targetScoreExplanation = if ($Company.targetScoreExplanation) { ConvertTo-PlainObject -InputObject $Company.targetScoreExplanation } else { [ordered]@{} }
    $summary.companyGrowthSignalSummary = [string](Get-ObjectValue -Object $Company -Name 'companyGrowthSignalSummary' -Default '')
    $summary.engagementSummary = [string](Get-ObjectValue -Object $Company -Name 'engagementSummary' -Default '')
    $summary.lastContactedAt = $Company.lastContactedAt
    $summary.pipelineState = if (Get-ObjectValue -Object $Company -Name 'pipelineState' -Default $null) { ConvertTo-PlainObject -InputObject (Get-ObjectValue -Object $Company -Name 'pipelineState' -Default $null) } else { Get-EmptyPipelineState }
    $summary.connectionGraph = if (Get-ObjectValue -Object $Company -Name 'connectionGraph' -Default $null) { ConvertTo-PlainObject -InputObject (Get-ObjectValue -Object $Company -Name 'connectionGraph' -Default $null) } else { Get-EmptyConnectionGraph }
    $summary.triggerAlerts = @(
        @($(if (Get-ObjectValue -Object $Company -Name 'triggerAlerts' -Default $null) { ConvertTo-PlainObject -InputObject (Get-ObjectValue -Object $Company -Name 'triggerAlerts' -Default @()) } else { @() })) |
            Where-Object { $null -ne $_ }
    )
    $summary.sequenceState = if (Get-ObjectValue -Object $Company -Name 'sequenceState' -Default $null) { ConvertTo-PlainObject -InputObject (Get-ObjectValue -Object $Company -Name 'sequenceState' -Default $null) } else { Get-EmptySequenceState }
    $summary.relationshipStrengthScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'relationshipStrengthScore' -Default 0))
    $summary.alertPriorityScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'alertPriorityScore' -Default 0))
    return $summary
}

function Select-ContactSummary {
    param(
        [Parameter(Mandatory = $true)]
        $Contact
    )

    return [ordered]@{
        id = [string]$Contact.id
        accountId = [string]$Contact.accountId
        companyName = [string]$Contact.companyName
        fullName = [string]$Contact.fullName
        title = [string]$Contact.title
        linkedinUrl = [string]$Contact.linkedinUrl
        email = [string](Get-ObjectValue -Object $Contact -Name 'email' -Default '')
        connectedOn = $Contact.connectedOn
        yearsConnected = [double](Convert-ToNumber (Get-ObjectValue -Object $Contact -Name 'yearsConnected' -Default 0))
        companyOverlapCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Contact -Name 'companyOverlapCount' -Default 0))
        buyerFlag = [bool](Test-Truthy (Get-ObjectValue -Object $Contact -Name 'buyerFlag' -Default $false))
        seniorFlag = [bool](Test-Truthy (Get-ObjectValue -Object $Contact -Name 'seniorFlag' -Default $false))
        talentFlag = [bool](Test-Truthy (Get-ObjectValue -Object $Contact -Name 'talentFlag' -Default $false))
        techFlag = [bool](Test-Truthy (Get-ObjectValue -Object $Contact -Name 'techFlag' -Default $false))
        financeFlag = [bool](Test-Truthy (Get-ObjectValue -Object $Contact -Name 'financeFlag' -Default $false))
        priorityScore = [int](Convert-ToNumber $Contact.priorityScore)
        outreachStatus = [string]$Contact.outreachStatus
        notes = [string]$Contact.notes
    }
}

function Select-JobSummary {
    param(
        [Parameter(Mandatory = $true)]
        $Job
    )

    return [ordered]@{
        id = [string]$Job.id
        accountId = [string]$Job.accountId
        companyName = [string]$Job.companyName
        title = [string]$Job.title
        department = [string]$Job.department
        location = [string]$Job.location
        employmentType = [string]$Job.employmentType
        jobId = [string]$Job.jobId
        url = [string]$Job.url
        jobUrl = [string]$Job.jobUrl
        sourceUrl = [string]$Job.sourceUrl
        atsType = [string]$Job.atsType
        postedAt = $Job.postedAt
        retrievedAt = $Job.retrievedAt
        importedAt = $Job.importedAt
        lastSeenAt = $Job.lastSeenAt
        rawPayload = Get-ObjectValue -Object $Job -Name 'rawPayload' -Default $null
        active = [bool](Test-Truthy $Job.active)
        isGta = [bool](Test-Truthy $Job.isGta)
        isNew = [bool](Test-Truthy $Job.isNew)
    }
}

function Select-ConfigSummary {
    param(
        [Parameter(Mandatory = $true)]
        $Config
    )

    return [ordered]@{
        id = [string]$Config.id
        accountId = [string]$Config.accountId
        companyName = [string]$Config.companyName
        atsType = [string]$Config.atsType
        boardId = [string]$Config.boardId
        domain = [string]$Config.domain
        careersUrl = [string]$Config.careersUrl
        resolvedBoardUrl = [string](Get-ObjectValue -Object $Config -Name 'resolvedBoardUrl')
        source = [string]$Config.source
        notes = [string]$Config.notes
        active = [bool](Test-Truthy $Config.active)
        supportedImport = [bool](Test-Truthy (Get-ObjectValue -Object $Config -Name 'supportedImport'))
        lastCheckedAt = Get-ObjectValue -Object $Config -Name 'lastCheckedAt'
        discoveryStatus = [string]$Config.discoveryStatus
        discoveryMethod = [string]$Config.discoveryMethod
        confidenceScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Config -Name 'confidenceScore'))
        confidenceBand = [string](Get-ObjectValue -Object $Config -Name 'confidenceBand')
        evidenceSummary = [string](Get-ObjectValue -Object $Config -Name 'evidenceSummary')
        reviewStatus = [string](Get-ObjectValue -Object $Config -Name 'reviewStatus')
        lastResolutionAttemptAt = Get-ObjectValue -Object $Config -Name 'lastResolutionAttemptAt'
        nextResolutionAttemptAt = Get-ObjectValue -Object $Config -Name 'nextResolutionAttemptAt'
        failureReason = [string](Get-ObjectValue -Object $Config -Name 'failureReason')
        redirectTarget = [string](Get-ObjectValue -Object $Config -Name 'redirectTarget')
        matchedSignatures = @($(if (Test-ObjectHasKey -Object $Config -Name 'matchedSignatures') { $Config.matchedSignatures } else { @() }))
        attemptedUrls = @($(if (Test-ObjectHasKey -Object $Config -Name 'attemptedUrls') { $Config.attemptedUrls } else { @() }))
        httpSummary = @($(if (Test-ObjectHasKey -Object $Config -Name 'httpSummary') { $Config.httpSummary } else { @() }))
        lastImportAt = Get-ObjectValue -Object $Config -Name 'lastImportAt'
        lastImportStatus = [string](Get-ObjectValue -Object $Config -Name 'lastImportStatus')
    }
}

function Select-ActivitySummary {
    param(
        [Parameter(Mandatory = $true)]
        $Activity
    )

    return [ordered]@{
        id = [string]$Activity.id
        summary = [string]$Activity.summary
        type = [string]$Activity.type
        notes = [string]$Activity.notes
        occurredAt = $Activity.occurredAt
        pipelineStage = [string]$Activity.pipelineStage
        accountId = [string]$Activity.accountId
        metadata = if ($Activity.metadata) { ConvertTo-PlainObject -InputObject $Activity.metadata } else { [ordered]@{} }
    }
}

function New-CompanyProjection {
    param(
        [string]$WorkspaceId,
        [string]$NormalizedName,
        [string]$DisplayName
    )

    $identity = Resolve-CompanyIdentity -CompanyName $(if ($DisplayName) { $DisplayName } else { $NormalizedName })
    $normalized = if ($identity.key) { [string]$identity.key } else { Normalize-TextKey $NormalizedName }
    $label = if ($identity.displayName) { [string]$identity.displayName } elseif ($DisplayName) { [string]$DisplayName } elseif ($normalized) { $normalized } else { 'Unknown company' }
    $timestamp = (Get-Date).ToString('o')

    return [ordered]@{
        id = New-DeterministicId -Prefix 'acct' -Seed $(if ($normalized) { $normalized } else { $label })
        workspaceId = if ($WorkspaceId) { $WorkspaceId } else { 'workspace-default' }
        normalizedName = $normalized
        displayName = $label
        domain = ''
        canonicalDomain = ''
        owner = ''
        ownerId = ''
        ownerAssignedAt = ''
        ownerAssignedBy = ''
        priority = 'medium'
        industry = ''
        location = ''
        status = 'new'
        outreachStatus = 'not_started'
        priorityTier = 'Tier 3'
        notes = ''
        tags = @()
        nextAction = ''
        nextActionAt = $null
        connectionCount = 0
        seniorContactCount = 0
        talentContactCount = 0
        buyerTitleCount = 0
        targetScore = 0
        normalizedTargetScore = 0
        dailyScore = 0
        openRoleCount = 0
        jobsLast30Days = 0
        jobsLast90Days = 0
        newRoleCount7d = 0
        staleRoleCount30d = 0
        avgRoleSeniorityScore = 0
        hiringSpikeRatio = 0
        externalRecruiterLikelihoodScore = 0
        companyGrowthSignalScore = 0
        companyGrowthSignalSummary = ''
        engagementScore = 0
        engagementSummary = ''
        hiringVelocity = 0
        hiringSignalMetricsSignature = ''
        departmentFocus = ''
        departmentFocusCount = 0
        departmentConcentration = 0
        hiringSpikeScore = 0
        followUpScore = 0
        scoreBreakdown = [ordered]@{}
        targetScoreExplanation = [ordered]@{}
        networkStrength = 'Cold'
        jobCount = 0
        lastJobPostedAt = $null
        hiringStatus = 'No active jobs'
        lastContactedAt = $null
        daysSinceContact = $null
        staleFlag = ''
        careersUrl = ''
        linkedinCompanySlug = ''
        aliases = @()
        enrichmentStatus = 'missing_inputs'
        enrichmentSource = ''
        enrichmentConfidence = 'unresolved'
        enrichmentConfidenceScore = 0
        enrichmentNotes = ''
        enrichmentEvidence = ''
        enrichmentFailureReason = ''
        enrichmentAttemptedUrls = @()
        enrichmentHttpSummary = @()
        nextEnrichmentAttemptAt = $null
        lastEnrichedAt = $null
        lastVerifiedAt = $null
        atsTypes = @()
        topContactName = ''
        topContactTitle = ''
        recommendedAction = ''
        recommendationSignature = ''
        outreachDraft = ''
        outreachDraftSignature = ''
        targetScoreExplanationSignature = ''
        pipelineState = [ordered]@{}
        connectionGraph = [ordered]@{}
        connectionGraphSignature = ''
        triggerAlerts = @()
        sequenceState = [ordered]@{}
        relationshipStrengthScore = 0
        alertPriorityScore = 0
        createdAt = $timestamp
        updatedAt = $timestamp
    }
}

function Update-CompanyProjection {
    param(
        [Parameter(Mandatory = $true)]
        $Company,
        $Contacts = $null,
        $Jobs = $null,
        $JobProjectionContext = $null,
        $Configs = $null,
        $Activities = $null,
        [hashtable]$JobSignalTextCache = $null,
        [hashtable]$JobSignalTimestampCache = $null,
        [hashtable]$JobHiringSignalAnalysisCache = $null,
        [switch]$SkipContactProjectionRefresh,
        [switch]$SkipConnectionGraphRefresh,
        [switch]$SkipOutreachDraftRefresh,
        [datetime]$ReferenceNow = [DateTime]::MinValue,
        [System.Collections.IDictionary]$TimingBag = $null
    )

    $now = if ($ReferenceNow -gt [DateTime]::MinValue) { $ReferenceNow } else { Get-Date }
    if (-not $JobSignalTextCache) {
        $JobSignalTextCache = @{}
    }
    if (-not $JobSignalTimestampCache) {
        $JobSignalTimestampCache = @{}
    }
    $existingDisplayName = [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default '')
    $existingNormalizedName = [string](Get-ObjectValue -Object $Company -Name 'normalizedName' -Default '')
    $companyName = if ($existingDisplayName) { $existingDisplayName } elseif ($existingNormalizedName) { $existingNormalizedName } else { 'Unknown company' }
    $Company.displayName = Get-CanonicalCompanyDisplayName $companyName
    $Company.normalizedName = Get-CanonicalCompanyKey $(if ($existingNormalizedName) { $existingNormalizedName } else { $companyName })
    if (-not (Get-ObjectValue -Object $Company -Name 'id' -Default '')) {
        $Company.id = New-DeterministicId -Prefix 'acct' -Seed $(if ($Company.normalizedName) { $Company.normalizedName } else { $Company.displayName })
    }
    $Company.tags = @(Get-StringList (Get-ObjectValue -Object $Company -Name 'tags' -Default @()))
    $Company.connectionCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'connectionCount' -Default 0))
    $Company.seniorContactCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'seniorContactCount' -Default 0))
    $Company.talentContactCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'talentContactCount' -Default 0))
    $Company.buyerTitleCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'buyerTitleCount' -Default 0))
    $Company.targetScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'targetScore' -Default 0))
    $Company.normalizedTargetScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'normalizedTargetScore' -Default $Company.targetScore))
    $Company.priority = Normalize-AccountPriority (Get-ObjectValue -Object $Company -Name 'priority' -Default '')
    $Company.status = Normalize-AccountStatus (Get-ObjectValue -Object $Company -Name 'status' -Default '')
    if (-not (Get-ObjectValue -Object $Company -Name 'outreachStatus' -Default '')) { $Company.outreachStatus = 'not_started' }
    if (-not (Get-ObjectValue -Object $Company -Name 'notes' -Default '')) { $Company.notes = '' }
    if (-not (Get-ObjectValue -Object $Company -Name 'industry' -Default '')) { $Company.industry = '' }
    if (-not (Get-ObjectValue -Object $Company -Name 'location' -Default '')) { $Company.location = '' }
    $domain = [string](Get-ObjectValue -Object $Company -Name 'domain')
    $canonicalDomain = [string](Get-ObjectValue -Object $Company -Name 'canonicalDomain')
    $careersUrl = [string](Get-ObjectValue -Object $Company -Name 'careersUrl')
    $linkedinCompanySlug = [string](Get-ObjectValue -Object $Company -Name 'linkedinCompanySlug')
    $aliases = @(Get-ObjectValue -Object $Company -Name 'aliases' -Default @())
    $enrichmentStatus = [string](Get-ObjectValue -Object $Company -Name 'enrichmentStatus')
    $enrichmentSource = [string](Get-ObjectValue -Object $Company -Name 'enrichmentSource')
    $enrichmentConfidence = [string](Get-ObjectValue -Object $Company -Name 'enrichmentConfidence')
    $enrichmentConfidenceScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'enrichmentConfidenceScore'))
    $enrichmentNotes = [string](Get-ObjectValue -Object $Company -Name 'enrichmentNotes')
    $enrichmentEvidence = [string](Get-ObjectValue -Object $Company -Name 'enrichmentEvidence')
    $enrichmentFailureReason = [string](Get-ObjectValue -Object $Company -Name 'enrichmentFailureReason')
    $enrichmentAttemptedUrls = @(Get-StringList (Get-ObjectValue -Object $Company -Name 'enrichmentAttemptedUrls' -Default @()))
    $enrichmentHttpSummary = Get-ObjectValue -Object $Company -Name 'enrichmentHttpSummary' -Default @()
    $lastEnrichedAt = Convert-ToDateString (Get-ObjectValue -Object $Company -Name 'lastEnrichedAt' -Default $null)
    $lastVerifiedAt = Convert-ToDateString (Get-ObjectValue -Object $Company -Name 'lastVerifiedAt' -Default $null)
    $nextEnrichmentAttemptAt = Convert-ToDateString (Get-ObjectValue -Object $Company -Name 'nextEnrichmentAttemptAt' -Default $null)

    if (-not $domain) { $domain = '' }
    if (-not $canonicalDomain) { $canonicalDomain = '' }
    if ($domain -and -not $canonicalDomain) {
        $canonicalDomain = Get-DomainName $domain
    }
    if ($canonicalDomain) {
        $canonicalDomain = Get-DomainName $canonicalDomain
    }
    if ($careersUrl -and -not $canonicalDomain) {
        $canonicalDomain = Get-DomainName $careersUrl
    }
    if ($canonicalDomain -and -not $domain) {
        $domain = $canonicalDomain
    }
    if (-not $careersUrl) { $careersUrl = '' }
    if (-not $linkedinCompanySlug) { $linkedinCompanySlug = '' }
    $linkedinCompanySlug = ([string]$linkedinCompanySlug).Trim().ToLowerInvariant()
    $aliases = @(Get-GeneratedCompanyAliases -CompanyName ([string]$Company.displayName) -Domain ([string]$(if ($canonicalDomain) { $canonicalDomain } else { $domain })) -ExistingAliases $aliases)
    if (-not $enrichmentStatus) {
        $enrichmentStatus = if ($canonicalDomain -or $careersUrl) { 'enriched' } else { 'missing_inputs' }
    }
    if (-not $enrichmentSource) { $enrichmentSource = '' }
    if (-not $enrichmentConfidence) {
        $enrichmentConfidence = if ($canonicalDomain -and $careersUrl) { 'high' } elseif ($canonicalDomain -or $careersUrl) { 'medium' } else { 'unresolved' }
    }
    if (-not $enrichmentNotes) { $enrichmentNotes = '' }
    if (-not $enrichmentEvidence) { $enrichmentEvidence = '' }
    if (-not $enrichmentFailureReason) { $enrichmentFailureReason = '' }
    if (-not $enrichmentHttpSummary) { $enrichmentHttpSummary = @() }

    [void](Set-ObjectValue -Object $Company -Name 'domain' -Value $domain)
    [void](Set-ObjectValue -Object $Company -Name 'canonicalDomain' -Value $canonicalDomain)
    [void](Set-ObjectValue -Object $Company -Name 'careersUrl' -Value $careersUrl)
    [void](Set-ObjectValue -Object $Company -Name 'linkedinCompanySlug' -Value $linkedinCompanySlug)
    [void](Set-ObjectValue -Object $Company -Name 'aliases' -Value $aliases)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentStatus' -Value $enrichmentStatus)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentSource' -Value $enrichmentSource)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentConfidence' -Value $enrichmentConfidence)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentConfidenceScore' -Value $enrichmentConfidenceScore)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentNotes' -Value $enrichmentNotes)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentEvidence' -Value $enrichmentEvidence)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentFailureReason' -Value $enrichmentFailureReason)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentAttemptedUrls' -Value $enrichmentAttemptedUrls)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentHttpSummary' -Value $enrichmentHttpSummary)
    [void](Set-ObjectValue -Object $Company -Name 'lastEnrichedAt' -Value $lastEnrichedAt)
    [void](Set-ObjectValue -Object $Company -Name 'lastVerifiedAt' -Value $lastVerifiedAt)
    [void](Set-ObjectValue -Object $Company -Name 'nextEnrichmentAttemptAt' -Value $nextEnrichmentAttemptAt)
    if (-not (Get-ObjectValue -Object $Company -Name 'owner' -Default '')) { $Company.owner = '' }
    if (-not (Get-ObjectValue -Object $Company -Name 'ownerId' -Default '')) { [void](Set-ObjectValue -Object $Company -Name 'ownerId' -Value '') }
    if (-not (Get-ObjectValue -Object $Company -Name 'ownerAssignedAt' -Default '')) { [void](Set-ObjectValue -Object $Company -Name 'ownerAssignedAt' -Value '') }
    if (-not (Get-ObjectValue -Object $Company -Name 'ownerAssignedBy' -Default '')) { [void](Set-ObjectValue -Object $Company -Name 'ownerAssignedBy' -Value '') }
    if (-not (Get-ObjectValue -Object $Company -Name 'nextAction' -Default '')) { $Company.nextAction = '' }
    if (-not (Get-ObjectValue -Object $Company -Name 'topContactName' -Default '')) { $Company.topContactName = '' }
    if (-not (Get-ObjectValue -Object $Company -Name 'topContactTitle' -Default '')) { $Company.topContactTitle = '' }
    if (-not (Get-ObjectValue -Object $Company -Name 'createdAt' -Default '')) { $Company.createdAt = $now.ToString('o') }

    $contactsStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $contactList = @()
    if ($PSBoundParameters.ContainsKey('Contacts')) {
        $contactList = @($Contacts | Where-Object { $null -ne $_ })
        if ($SkipContactProjectionRefresh) {
            $Company.connectionCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'connectionCount' -Default 0))
            $Company.seniorContactCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'seniorContactCount' -Default 0))
            $Company.talentContactCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'talentContactCount' -Default 0))
            $Company.buyerTitleCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'buyerTitleCount' -Default 0))
            $Company.topContactName = [string](Get-ObjectValue -Object $Company -Name 'topContactName' -Default '')
            $Company.topContactTitle = [string](Get-ObjectValue -Object $Company -Name 'topContactTitle' -Default '')
        } else {
            $Company.connectionCount = @($contactList).Count
            $seniorContactCount = 0
            $talentContactCount = 0
            $buyerTitleCount = 0
            $topContact = $null
            $topContactPriorityScore = -1.0
            foreach ($contact in @($contactList)) {
                if ($null -eq $contact) { continue }
                if (Test-Truthy (Get-ObjectValue -Object $contact -Name 'seniorFlag' -Default $false)) { $seniorContactCount += 1 }
                if (Test-Truthy (Get-ObjectValue -Object $contact -Name 'talentFlag' -Default $false)) { $talentContactCount += 1 }
                if (Test-Truthy (Get-ObjectValue -Object $contact -Name 'buyerFlag' -Default $false)) { $buyerTitleCount += 1 }
                [void](Set-ObjectValue -Object $contact -Name 'accountId' -Value ([string]$Company.id))
                [void](Set-ObjectValue -Object $contact -Name 'companyOverlapCount' -Value ([int]$Company.connectionCount))
                $priorityScore = Get-ContactPriorityScore -Contact $contact -CompanyContacts $Company.connectionCount
                [void](Set-ObjectValue -Object $contact -Name 'priorityScore' -Value $priorityScore)
                [void](Set-ObjectValue -Object $contact -Name 'relevanceScore' -Value $priorityScore)
                if ([double](Convert-ToNumber $priorityScore) -gt $topContactPriorityScore) {
                    $topContact = $contact
                    $topContactPriorityScore = [double](Convert-ToNumber $priorityScore)
                }
            }
            $Company.seniorContactCount = $seniorContactCount
            $Company.talentContactCount = $talentContactCount
            $Company.buyerTitleCount = $buyerTitleCount
            $Company.topContactName = if ($topContact) { [string](Get-ObjectValue -Object $topContact -Name 'fullName' -Default '') } else { '' }
            $Company.topContactTitle = if ($topContact) { [string](Get-ObjectValue -Object $topContact -Name 'title' -Default '') } else { '' }
        }
    } else {
        $Company.topContactName = [string](Get-ObjectValue -Object $Company -Name 'topContactName' -Default '')
        $Company.topContactTitle = [string](Get-ObjectValue -Object $Company -Name 'topContactTitle' -Default '')
    }
    $contactsStopwatch.Stop()

    $jobsStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $jobList = @()
    $jobsForTextAnalysis = $null
    $jobsForGrowthSignals = $null
    if ($PSBoundParameters.ContainsKey('Jobs')) {
        if ($null -ne $JobProjectionContext) {
            $jobList = @((Get-ObjectValue -Object $JobProjectionContext -Name 'activeJobs' -Default @()) | Where-Object { $null -ne $_ })
            $topDepartment = [string](Get-ObjectValue -Object $JobProjectionContext -Name 'departmentFocus' -Default '')
            $topDepartmentCount = [int](Convert-ToNumber (Get-ObjectValue -Object $JobProjectionContext -Name 'departmentFocusCount' -Default 0))
            $newRoleCount7d = [int](Convert-ToNumber (Get-ObjectValue -Object $JobProjectionContext -Name 'newRoleCount7d' -Default 0))
            $staleRoleCount30d = [int](Convert-ToNumber (Get-ObjectValue -Object $JobProjectionContext -Name 'staleRoleCount30d' -Default 0))
            $latestJob = Get-ObjectValue -Object $JobProjectionContext -Name 'latestJob' -Default $null
            $jobsForTextAnalysis = @((Get-ObjectValue -Object $JobProjectionContext -Name 'jobsForTextAnalysis' -Default @()) | Where-Object { $null -ne $_ })
        } else {
            $jobListBuffer = New-Object System.Collections.ArrayList
            $departmentCounts = @{}
            $topDepartment = ''
            $topDepartmentCount = 0
            $newRoleCount7d = 0
            $staleRoleCount30d = 0
            $latestJob = $null
            $latestJobTimestamp = [DateTime]::MinValue
            $recentCutoff7 = $now.AddDays(-7)
            $staleCutoff30 = $now.AddDays(-30)
            $rankedJobsForSignals = New-Object System.Collections.ArrayList
            foreach ($job in @($Jobs)) {
                if ($null -eq $job) { continue }
                if ((Get-ObjectValue -Object $job -Name 'active' -Default $true) -eq $false) { continue }
                [void]$jobListBuffer.Add($job)
                $department = ([string](Get-ObjectValue -Object $job -Name 'department' -Default 'General')).Trim()
                if (-not $department) {
                    $department = 'General'
                }
                if (-not $departmentCounts.ContainsKey($department)) {
                    $departmentCounts[$department] = 0
                }
                $departmentCounts[$department] += 1
                if ([int]$departmentCounts[$department] -gt $topDepartmentCount) {
                    $topDepartment = [string]$department
                    $topDepartmentCount = [int]$departmentCounts[$department]
                }
                $jobTimestamp = Get-CachedJobSignalTimestamp -Job $job -Cache $JobSignalTimestampCache
                if ($jobTimestamp -gt [DateTime]::MinValue) {
                    if ($jobTimestamp -ge $recentCutoff7) { $newRoleCount7d += 1 }
                    if ($jobTimestamp -lt $staleCutoff30) { $staleRoleCount30d += 1 }
                    if ($jobTimestamp -gt $latestJobTimestamp) {
                        $latestJobTimestamp = $jobTimestamp
                        $latestJob = $job
                    }
                }
                Add-RankedSignalJobEntry -RankedJobs $rankedJobsForSignals -Job $job -Timestamp $jobTimestamp -Limit 6
            }
            $jobList = @($jobListBuffer.ToArray())
            $jobsForTextAnalysis = if ($rankedJobsForSignals.Count -gt 0) {
                @($rankedJobsForSignals | ForEach-Object { Get-ObjectValue -Object $_ -Name 'job' -Default $null } | Where-Object { $null -ne $_ })
            } else {
                @($jobList)
            }
        }
        $Company.jobCount = @($jobList).Count
        $Company.openRoleCount = $Company.jobCount
        $Company.newRoleCount7d = $newRoleCount7d
        $Company.staleRoleCount30d = $staleRoleCount30d
        $Company.departmentFocus = [string]$topDepartment
        $Company.departmentFocusCount = [int]$topDepartmentCount
        $Company.departmentConcentration = if ($Company.jobCount -gt 0) { [double][math]::Round(([double]$topDepartmentCount / [double]$Company.jobCount), 2) } else { 0 }
        $Company.hiringSpikeScore = [math]::Round([math]::Min(30, ($newRoleCount7d * 4) + ($topDepartmentCount * 1.5)))
        $Company.lastJobPostedAt = if ($latestJob) {
            $latestPostedAt = Get-ObjectValue -Object $latestJob -Name 'postedAt' -Default ''
            if ($latestPostedAt) { $latestPostedAt } else { Get-ObjectValue -Object $latestJob -Name 'importedAt' -Default $null }
        } else {
            $null
        }
        if (-not $Company.location) {
            $locationMap = @{}
            foreach ($job in @($jobList)) {
                if ($null -eq $job) { continue }
                Add-UniqueTextValue -Map $locationMap -Value (Get-ObjectValue -Object $job -Name 'location' -Default '')
            }
            $locations = @(Get-SortedUniqueTextValues -Map $locationMap | Select-Object -First 3)
            if ($locations.Count -gt 0) {
                $Company.location = [string]([string]::Join(', ', @($locations)))
            }
        }
        if (@($jobsForTextAnalysis).Count -gt 6) {
            $jobsForGrowthSignals = @($jobsForTextAnalysis | Select-Object -First 6)
        } else {
            $jobsForGrowthSignals = @($jobsForTextAnalysis)
        }
    } else {
        $Company.jobCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobCount' -Default 0))
        $Company.openRoleCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'openRoleCount' -Default 0))
        $Company.jobsLast30Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast30Days' -Default 0))
        $Company.jobsLast90Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobsLast90Days' -Default 0))
        $Company.newRoleCount7d = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'newRoleCount7d' -Default 0))
        $Company.staleRoleCount30d = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'staleRoleCount30d' -Default 0))
        $Company.avgRoleSeniorityScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'avgRoleSeniorityScore' -Default 0))
        $Company.hiringSpikeRatio = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringSpikeRatio' -Default 0))
        $Company.externalRecruiterLikelihoodScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'externalRecruiterLikelihoodScore' -Default 0))
        $Company.companyGrowthSignalScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'companyGrowthSignalScore' -Default 0))
        $Company.companyGrowthSignalSummary = [string](Get-ObjectValue -Object $Company -Name 'companyGrowthSignalSummary' -Default '')
        $Company.engagementScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'engagementScore' -Default 0))
        $Company.engagementSummary = [string](Get-ObjectValue -Object $Company -Name 'engagementSummary' -Default '')
        $Company.hiringVelocity = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringVelocity' -Default 0))
        $Company.departmentFocus = [string](Get-ObjectValue -Object $Company -Name 'departmentFocus' -Default '')
        $Company.departmentFocusCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'departmentFocusCount' -Default 0))
        $Company.departmentConcentration = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'departmentConcentration' -Default 0))
        $Company.hiringSpikeScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringSpikeScore' -Default 0))
        $Company.targetScoreExplanation = if (Get-ObjectValue -Object $Company -Name 'targetScoreExplanation' -Default $null) { Get-ObjectValue -Object $Company -Name 'targetScoreExplanation' -Default ([ordered]@{}) } else { [ordered]@{} }
    }
    $jobsStopwatch.Stop()

    $configsStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    if ($PSBoundParameters.ContainsKey('Configs')) {
        $configList = @($Configs | Where-Object { $null -ne $_ })
        $atsTypeMap = @{}
        $primaryCareersUrl = ''
        $primaryDomain = ''
        foreach ($config in @($configList)) {
            if ($null -eq $config) { continue }
            if ((Get-ObjectValue -Object $config -Name 'active' -Default $true) -eq $false) {
                continue
            }

            $atsType = ([string](Get-ObjectValue -Object $config -Name 'atsType' -Default '')).ToLowerInvariant()
            if (-not [string]::IsNullOrWhiteSpace($atsType)) {
                $atsTypeMap[$atsType] = $true
            }

            if (-not $primaryCareersUrl) {
                $candidateCareersUrl = [string](Get-ObjectValue -Object $config -Name 'careersUrl' -Default '')
                if (-not [string]::IsNullOrWhiteSpace($candidateCareersUrl)) {
                    $primaryCareersUrl = $candidateCareersUrl
                }
            }

            if (-not $primaryDomain) {
                $candidateDomain = [string](Get-ObjectValue -Object $config -Name 'domain' -Default '')
                if (-not [string]::IsNullOrWhiteSpace($candidateDomain)) {
                    $primaryDomain = $candidateDomain
                }
            }
        }
        $Company.atsTypes = @($atsTypeMap.Keys | Sort-Object)
        if ($primaryCareersUrl) {
            $Company.careersUrl = $primaryCareersUrl
        } elseif (-not $Company.careersUrl) {
            $Company.careersUrl = ''
        }
        if ($primaryDomain) {
            $Company.domain = $primaryDomain
        }
    } else {
        $Company.atsTypes = @(Get-StringList (Get-ObjectValue -Object $Company -Name 'atsTypes' -Default @()))
        if (-not (Get-ObjectValue -Object $Company -Name 'careersUrl' -Default '')) { $Company.careersUrl = '' }
    }
    $configsStopwatch.Stop()

    $identityStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $currentDomain = [string](Get-ObjectValue -Object $Company -Name 'domain' -Default $domain)
    $currentCareersUrl = [string](Get-ObjectValue -Object $Company -Name 'careersUrl' -Default $careersUrl)
    $currentCanonicalDomain = [string](Get-ObjectValue -Object $Company -Name 'canonicalDomain' -Default $canonicalDomain)
    $currentCareersDomain = Get-DomainName $currentCareersUrl
    $currentDomainIdentity = if ($currentDomain -and -not (Test-HostedCompanyIdentityDomain -Value $currentDomain)) { Get-DomainName $currentDomain } else { '' }
    $currentCareersIdentity = if ($currentCareersDomain -and -not (Test-HostedCompanyIdentityDomain -Value $currentCareersDomain)) { $currentCareersDomain } else { '' }

    if (-not $currentCanonicalDomain) {
        if ($currentDomainIdentity) {
            $currentCanonicalDomain = $currentDomainIdentity
        } elseif ($currentCareersIdentity) {
            $currentCanonicalDomain = $currentCareersIdentity
        }
    }
    if (-not $currentDomain -and $currentCanonicalDomain) {
        $currentDomain = $currentCanonicalDomain
    }

    $hasUsableEnrichment = (-not [string]::IsNullOrWhiteSpace($currentCanonicalDomain) -or -not [string]::IsNullOrWhiteSpace($currentCareersUrl))
    if ($hasUsableEnrichment -and ([string]::IsNullOrWhiteSpace($enrichmentStatus) -or $enrichmentStatus -in @('missing_inputs', 'unresolved', 'failed'))) {
        $enrichmentStatus = 'enriched'
    } elseif (-not $hasUsableEnrichment -and [string]::IsNullOrWhiteSpace($enrichmentStatus)) {
        $enrichmentStatus = 'missing_inputs'
    }

    $targetConfidence = if ($currentCanonicalDomain -and $currentCareersUrl -and $currentCareersIdentity) {
        'high'
    } elseif ($hasUsableEnrichment) {
        'medium'
    } else {
        'unresolved'
    }
    $confidenceRank = @{ unresolved = 0; low = 1; medium = 2; high = 3 }
    $existingConfidenceRank = if ($confidenceRank.ContainsKey($enrichmentConfidence)) { [int]$confidenceRank[$enrichmentConfidence] } else { 0 }
    $targetConfidenceRank = if ($confidenceRank.ContainsKey($targetConfidence)) { [int]$confidenceRank[$targetConfidence] } else { 0 }
    if ($targetConfidenceRank -gt $existingConfidenceRank) {
        $enrichmentConfidence = $targetConfidence
    } elseif ([string]::IsNullOrWhiteSpace($enrichmentConfidence)) {
        $enrichmentConfidence = $targetConfidence
    }
    if (([int]$enrichmentConfidenceScore) -le 0 -and $hasUsableEnrichment) {
        $enrichmentConfidenceScore = if ($currentCanonicalDomain -and $currentCareersUrl -and $currentCareersIdentity) { 84 } else { 72 }
    }

    [void](Set-ObjectValue -Object $Company -Name 'domain' -Value $currentDomain)
    [void](Set-ObjectValue -Object $Company -Name 'canonicalDomain' -Value $currentCanonicalDomain)
    [void](Set-ObjectValue -Object $Company -Name 'careersUrl' -Value $currentCareersUrl)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentStatus' -Value $enrichmentStatus)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentConfidence' -Value $enrichmentConfidence)
    [void](Set-ObjectValue -Object $Company -Name 'enrichmentConfidenceScore' -Value $enrichmentConfidenceScore)
    $identityStopwatch.Stop()

    $activitiesStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $activitiesList = @()
    if ($PSBoundParameters.ContainsKey('Activities')) {
        $activitiesList = @($Activities | Where-Object { $null -ne $_ })
        $latestActivity = $null
        $latestActivityTimestamp = [DateTime]::MinValue
        foreach ($activity in @($activitiesList)) {
            if ($null -eq $activity) { continue }
            $occurredAt = [string](Get-ObjectValue -Object $activity -Name 'occurredAt' -Default '')
            $activityTimestamp = if ($occurredAt) { Get-DateSortValue $occurredAt } else { [DateTime]::MinValue }
            if ($activityTimestamp -gt $latestActivityTimestamp) {
                $latestActivityTimestamp = $activityTimestamp
                $latestActivity = $activity
            }
            [void](Set-ObjectValue -Object $activity -Name 'accountId' -Value ([string]$Company.id))
        }
        if ($latestActivity) {
            $Company.lastContactedAt = Get-ObjectValue -Object $latestActivity -Name 'occurredAt' -Default $Company.lastContactedAt
            $latestStage = Resolve-ActivityPipelineStage -Activity $latestActivity
            if ($latestStage) {
                $Company.outreachStatus = $latestStage
            }
        }
    }
    $activitiesStopwatch.Stop()

    $daysSinceContact = $null
    $lastContact = [DateTime]::MinValue
    if ($Company.lastContactedAt -and [DateTime]::TryParse([string]$Company.lastContactedAt, [ref]$lastContact)) {
        $daysSinceContact = [int][Math]::Floor(($now - $lastContact).TotalDays)
    }
    $Company.daysSinceContact = $daysSinceContact
    $Company.staleFlag = if ($null -ne $daysSinceContact -and $daysSinceContact -ge 14) { 'STALE' } else { '' }
    $Company.followUpScore = Get-FollowUpBonus -Status $Company.status -NextActionAt ([string](Get-ObjectValue -Object $Company -Name 'nextActionAt' -Default '')) -LastContactedAt ([string](Get-ObjectValue -Object $Company -Name 'lastContactedAt' -Default ''))

    $scoringStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $scoringTimingBag = [ordered]@{}
    $targetMetrics = Get-CompanyTargetScoreMetrics -Company $Company -Jobs $(if ($PSBoundParameters.ContainsKey('Jobs')) { $jobList } else { $null }) -ActiveJobs $(if ($PSBoundParameters.ContainsKey('Jobs')) { $jobList } else { $null }) -JobsForTextAnalysis $jobsForTextAnalysis -JobsForGrowthSignals $jobsForGrowthSignals -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null }) -ReferenceNow $now -JobSignalTextCache $JobSignalTextCache -JobSignalTimestampCache $JobSignalTimestampCache -JobHiringSignalAnalysisCache $JobHiringSignalAnalysisCache -TimingBag $scoringTimingBag
    $Company.targetScore = [int](Convert-ToNumber $targetMetrics.targetScore)
    $Company.normalizedTargetScore = [int](Convert-ToNumber $targetMetrics.normalizedTargetScore)
    $Company.jobsLast30Days = [int](Convert-ToNumber $targetMetrics.jobsLast30Days)
    $Company.jobsLast90Days = [int](Convert-ToNumber $targetMetrics.jobsLast90Days)
    $Company.avgRoleSeniorityScore = [double](Convert-ToNumber $targetMetrics.avgRoleSeniorityScore)
    $Company.hiringSpikeRatio = [double](Convert-ToNumber $targetMetrics.hiringSpikeRatio)
    $Company.externalRecruiterLikelihoodScore = [double](Convert-ToNumber $targetMetrics.externalRecruiterLikelihoodScore)
      $Company.companyGrowthSignalScore = [double](Convert-ToNumber $targetMetrics.companyGrowthSignalScore)
      $Company.companyGrowthSignalSummary = [string](Get-ObjectValue -Object $targetMetrics -Name 'companyGrowthSignalSummary' -Default '')
      $Company.engagementScore = [double](Convert-ToNumber $targetMetrics.engagementScore)
      $Company.engagementSummary = [string](Get-ObjectValue -Object $targetMetrics -Name 'engagementSummary' -Default '')
      $Company.hiringVelocity = [double](Convert-ToNumber $targetMetrics.hiringVelocity)
      [void](Set-ObjectValue -Object $Company -Name 'hiringSignalMetricsSignature' -Value ([string](Get-ObjectValue -Object $targetMetrics -Name 'hiringSignalMetricsSignature' -Default '')))
      $Company.scoreBreakdown = if ($targetMetrics.scoreBreakdown) { $targetMetrics.scoreBreakdown } else { [ordered]@{} }
    $Company.targetScoreExplanation = if ($targetMetrics.targetScoreExplanation) { $targetMetrics.targetScoreExplanation } else { [ordered]@{} }
    [void](Set-ObjectValue -Object $Company -Name 'targetScoreExplanationSignature' -Value ([string](Get-ObjectValue -Object $targetMetrics -Name 'targetScoreExplanationSignature' -Default '')))
    $scoringStopwatch.Stop()

    $pipelineStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $Company.pipelineState = Get-AccountPipelineState -Company $Company -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null }) -ReferenceNow $now
    $Company.outreachStatus = Get-NormalizedOutreachStage ([string](Get-ObjectValue -Object $Company.pipelineState -Name 'stage' -Default $Company.outreachStatus))
    if (-not $Company.outreachStatus) { $Company.outreachStatus = 'not_started' }
    $pipelineStopwatch.Stop()

    $graphStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $graphCacheHit = $false
    if ($PSBoundParameters.ContainsKey('Contacts')) {
        $existingGraphSignature = [string](Get-ObjectValue -Object $Company -Name 'connectionGraphSignature' -Default '')
        $existingGraph = Get-ObjectValue -Object $Company -Name 'connectionGraph' -Default $null
        if ($SkipConnectionGraphRefresh -and $existingGraph) {
            $Company.connectionGraph = $existingGraph
            $Company.relationshipStrengthScore = [int](Convert-ToNumber (Get-ObjectValue -Object $existingGraph -Name 'relationshipStrengthScore' -Default 0))
            $graphCacheHit = $true
        } else {
            $graphSignatureData = Get-ConnectionGraphSignatureData -Company $Company -Contacts $contactList -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null })
            $graphSignature = [string](Get-ObjectValue -Object $graphSignatureData -Name 'signature' -Default '')
            if ($existingGraphSignature -eq $graphSignature -and $existingGraph) {
                $Company.connectionGraph = $existingGraph
                $Company.relationshipStrengthScore = [int](Convert-ToNumber (Get-ObjectValue -Object $existingGraph -Name 'relationshipStrengthScore' -Default 0))
                $graphCacheHit = $true
            } else {
                $Company.connectionGraph = Get-ConnectionGraphInsights -Company $Company -Contacts $contactList -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null }) -PastPlacementCount ([int](Convert-ToNumber (Get-ObjectValue -Object $graphSignatureData -Name 'pastPlacementCount' -Default 0)))
                $Company.relationshipStrengthScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company.connectionGraph -Name 'relationshipStrengthScore' -Default 0))
                [void](Set-ObjectValue -Object $Company -Name 'connectionGraphSignature' -Value $graphSignature)
            }
        }
    } else {
        $Company.connectionGraph = Get-ConnectionGraphInsights -Company $Company -Contacts $(if ($PSBoundParameters.ContainsKey('Contacts')) { $contactList } else { $null }) -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null })
        $Company.relationshipStrengthScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company.connectionGraph -Name 'relationshipStrengthScore' -Default 0))
    }
    $graphStopwatch.Stop()

    $sequenceStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $Company.sequenceState = Get-AccountSequenceState -Company $Company -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null }) -ReferenceNow $now -ConnectionGraph $Company.connectionGraph
    $sequenceStopwatch.Stop()

    $alertsStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $alertTimingBag = [ordered]@{}
    $Company.triggerAlerts = @(Get-CompanyTriggerAlerts -Company $Company -Jobs $(if ($PSBoundParameters.ContainsKey('Jobs')) { $jobList } else { $null }) -Contacts $(if ($PSBoundParameters.ContainsKey('Contacts')) { $contactList } else { $null }) -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null }) -ReferenceNow $now -SkipContactAlertRefresh:$SkipContactProjectionRefresh -TimingBag $alertTimingBag)
    $Company.alertPriorityScore = if (@($Company.triggerAlerts).Count -gt 0) { [int](Convert-ToNumber (Get-ObjectValue -Object $Company.triggerAlerts[0] -Name 'priorityScore' -Default 0)) } else { 0 }
    $alertsStopwatch.Stop()
    if (-not $Company.priorityTier) {
        $Company.priorityTier = Get-PriorityTierFromScore -TargetScore $Company.targetScore
    }
    $Company.networkStrength = Get-NetworkStrength -Connections $Company.connectionCount -SeniorContacts $Company.seniorContactCount
    $Company.hiringStatus = Get-HiringStatus -JobCount $Company.jobCount -LastJobPostedAt $Company.lastJobPostedAt
    $departmentBonus = if ($Company.departmentConcentration -ge 0.6 -and $Company.departmentFocusCount -ge 3) { 14 } elseif ($Company.departmentConcentration -ge 0.4 -and $Company.departmentFocusCount -ge 2) { 8 } else { 0 }
    $stalePenalty = $Company.staleRoleCount30d * 2
    $Company.dailyScore = [int][math]::Round(
        ($Company.openRoleCount * 3) +
        ($Company.newRoleCount7d * 8) +
        ($Company.connectionCount * 1.5) +
        ($Company.seniorContactCount * 6) +
        ($Company.talentContactCount * 5) +
        $departmentBonus +
        $Company.hiringSpikeScore +
        $Company.followUpScore +
        (Get-RecencyBonus -LastJobPostedAt $Company.lastJobPostedAt) +
        (Get-PriorityTierBonus -PriorityTier $Company.priorityTier) +
        (Get-ManualPriorityBonus -Priority $Company.priority) -
        $stalePenalty
    )

    $actionDraftStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $recommendationSignature = Get-CompanyRecommendationSignature -Company $Company
    $existingRecommendationSignature = [string](Get-ObjectValue -Object $Company -Name 'recommendationSignature' -Default '')
    $existingRecommendedAction = [string](Get-ObjectValue -Object $Company -Name 'recommendedAction' -Default '')
    if ($existingRecommendationSignature -eq $recommendationSignature -and -not [string]::IsNullOrWhiteSpace($existingRecommendedAction)) {
        $Company.recommendedAction = $existingRecommendedAction
    } else {
        $Company.recommendedAction = Get-RecommendationAction -Company $Company
        [void](Set-ObjectValue -Object $Company -Name 'recommendationSignature' -Value $recommendationSignature)
    }

    $outreachDraftSignature = Get-CompanyOutreachDraftSignature -Company $Company
    $existingOutreachDraftSignature = [string](Get-ObjectValue -Object $Company -Name 'outreachDraftSignature' -Default '')
    $existingOutreachDraft = [string](Get-ObjectValue -Object $Company -Name 'outreachDraft' -Default '')
    if ($SkipOutreachDraftRefresh -and -not [string]::IsNullOrWhiteSpace($existingOutreachDraft)) {
        $Company.outreachDraft = $existingOutreachDraft
    } elseif ($existingOutreachDraftSignature -eq $outreachDraftSignature -and -not [string]::IsNullOrWhiteSpace($existingOutreachDraft)) {
        $Company.outreachDraft = $existingOutreachDraft
    } else {
        $Company.outreachDraft = Get-OutreachDraft -Company $Company
        [void](Set-ObjectValue -Object $Company -Name 'outreachDraftSignature' -Value $outreachDraftSignature)
    }
    $actionDraftStopwatch.Stop()
    $Company.updatedAt = $now.ToString('o')

    if ($TimingBag) {
        $TimingBag['contactsMs'] = [int]$contactsStopwatch.ElapsedMilliseconds
        $TimingBag['jobsMs'] = [int]$jobsStopwatch.ElapsedMilliseconds
        $TimingBag['configsMs'] = [int]$configsStopwatch.ElapsedMilliseconds
        $TimingBag['identityMs'] = [int]$identityStopwatch.ElapsedMilliseconds
        $TimingBag['activitiesMs'] = [int]$activitiesStopwatch.ElapsedMilliseconds
        $TimingBag['scoringMs'] = [int]$scoringStopwatch.ElapsedMilliseconds
        $TimingBag['scoringDetails'] = $scoringTimingBag
        $TimingBag['pipelineMs'] = [int]$pipelineStopwatch.ElapsedMilliseconds
        $TimingBag['graphMs'] = [int]$graphStopwatch.ElapsedMilliseconds
        $TimingBag['graphCacheHit'] = [bool]$graphCacheHit
        $TimingBag['sequenceMs'] = [int]$sequenceStopwatch.ElapsedMilliseconds
        $TimingBag['alertsMs'] = [int]$alertsStopwatch.ElapsedMilliseconds
        $TimingBag['alertDetails'] = $alertTimingBag
        $TimingBag['actionDraftMs'] = [int]$actionDraftStopwatch.ElapsedMilliseconds
        $TimingBag['recommendationCacheHit'] = [bool]($existingRecommendationSignature -eq $recommendationSignature -and -not [string]::IsNullOrWhiteSpace($existingRecommendedAction))
        $TimingBag['outreachDraftCacheHit'] = [bool](($SkipOutreachDraftRefresh -and -not [string]::IsNullOrWhiteSpace($existingOutreachDraft)) -or ($existingOutreachDraftSignature -eq $outreachDraftSignature -and -not [string]::IsNullOrWhiteSpace($existingOutreachDraft)))
    }

    return $Company
}

function Get-CompanySortKey {
    param($Company)
    $ts = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'targetScore' -Default 0))
    $hv = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'hiringVelocity' -Default 0))
    $es = [double](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'engagementScore' -Default 0))
    $dn = [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default '')
    return @($ts, $hv, $es, $dn)
}

function Compare-CompanySortKeys {
    param($KeyA, $KeyB)
    # Compare targetScore DESC
    if ($KeyA[0] -ne $KeyB[0]) { return if ($KeyA[0] -gt $KeyB[0]) { -1 } else { 1 } }
    # Compare hiringVelocity DESC
    if ($KeyA[1] -ne $KeyB[1]) { return if ($KeyA[1] -gt $KeyB[1]) { -1 } else { 1 } }
    # Compare engagementScore DESC
    if ($KeyA[2] -ne $KeyB[2]) { return if ($KeyA[2] -gt $KeyB[2]) { -1 } else { 1 } }
    # Compare displayName ASC
    return [string]::Compare([string]$KeyA[3], [string]$KeyB[3], [StringComparison]::OrdinalIgnoreCase)
}

function Sort-Companies {
    param(
        $Companies,
        [System.Collections.Generic.HashSet[string]]$ChangedKeys = $null
    )

    $items = @($Companies)
    if ($items.Count -le 1) {
        return $items
    }

    # If few companies changed and the list is large, use incremental re-insertion
    if ($ChangedKeys -and $ChangedKeys.Count -gt 0 -and $ChangedKeys.Count -lt ([Math]::Max(20, [int]($items.Count * 0.15)))) {
        # Extract changed and unchanged items
        $unchanged = New-Object System.Collections.ArrayList
        $changed = New-Object System.Collections.ArrayList
        foreach ($c in $items) {
            $key = [string](Get-ObjectValue -Object $c -Name 'normalizedName' -Default '')
            if ($key -and $ChangedKeys.Contains($key)) {
                [void]$changed.Add($c)
            } else {
                [void]$unchanged.Add($c)
            }
        }

        # Binary insert each changed company into the already-sorted unchanged list
        foreach ($company in $changed) {
            $companyKey = Get-CompanySortKey -Company $company
            $lo = 0
            $hi = $unchanged.Count
            while ($lo -lt $hi) {
                $mid = [int](($lo + $hi) / 2)
                $midKey = Get-CompanySortKey -Company $unchanged[$mid]
                if ((Compare-CompanySortKeys -KeyA $companyKey -KeyB $midKey) -le 0) {
                    $hi = $mid
                } else {
                    $lo = $mid + 1
                }
            }
            $unchanged.Insert($lo, $company)
        }
        return @($unchanged.ToArray())
    }

    # Full sort fallback
    return @(
        $items | Sort-Object @(
            @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'targetScore' -Default 0)) }; Descending = $true },
            @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'hiringVelocity' -Default 0)) }; Descending = $true },
            @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'engagementScore' -Default 0)) }; Descending = $true },
            @{ Expression = { [string](Get-ObjectValue -Object $_ -Name 'displayName' -Default '') }; Descending = $false }
        )
    )
}

function Update-DerivedData {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [scriptblock]$ProgressCallback,
        [int]$ProgressInterval = 150,
        [System.Collections.IDictionary]$TimingBag,
        [string[]]$TouchedCompanyKeys = $null
    )

    $startedAt = (Get-Date).ToString('o')
    $isIncremental = $null -ne $TouchedCompanyKeys -and @($TouchedCompanyKeys).Count -gt 0
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Preparing derived data' -StartedAt $startedAt -Message $(if ($isIncremental) { "Incremental update for $(@($TouchedCompanyKeys).Count) companies" } else { 'Grouping contacts, jobs, configs, and activity' })
    $groupingStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    $companyMap = @{}
    foreach ($company in @($State.companies)) {
        $key = Get-CanonicalCompanyKey $(if ($company.normalizedName) { $company.normalizedName } else { $company.displayName })
        if ($key) {
            $companyMap[$key] = $company
        }
    }

    $contactGroups = @{}
    foreach ($contact in @($State.contacts)) {
        $companyKey = Get-CanonicalCompanyKey $(if ($contact.normalizedCompanyName) { $contact.normalizedCompanyName } else { $contact.companyName })
        if (-not $companyKey) { continue }
        $contact.normalizedCompanyName = $companyKey
        if (-not $contactGroups.ContainsKey($companyKey)) {
            $contactGroups[$companyKey] = New-Object System.Collections.ArrayList
        }
        [void]$contactGroups[$companyKey].Add($contact)
    }

    $jobGroups = @{}
    foreach ($job in @($State.jobs)) {
        if ($null -eq $job) { continue }
        $companyKey = Get-CanonicalCompanyKey $(if ($job.normalizedCompanyName) { $job.normalizedCompanyName } else { $job.companyName })
        if (-not $companyKey) { continue }
        $job.normalizedCompanyName = $companyKey
        if (-not $jobGroups.ContainsKey($companyKey)) {
            $jobGroups[$companyKey] = New-Object System.Collections.ArrayList
        }
        [void]$jobGroups[$companyKey].Add($job)
    }

    $configGroups = @{}
    foreach ($config in @($State.boardConfigs)) {
        if ($null -eq $config) { continue }
        $companyKey = Get-CanonicalCompanyKey $(if ($config.normalizedCompanyName) { $config.normalizedCompanyName } else { $config.companyName })
        if (-not $companyKey) { continue }
        $config.normalizedCompanyName = $companyKey
        if (-not $configGroups.ContainsKey($companyKey)) {
            $configGroups[$companyKey] = New-Object System.Collections.ArrayList
        }
        [void]$configGroups[$companyKey].Add($config)
    }

    $activityGroups = @{}
    foreach ($activity in @($State.activities)) {
        if ($null -eq $activity) { continue }
        $companyKey = Get-CanonicalCompanyKey $activity.normalizedCompanyName
        if (-not $companyKey) { continue }
        $activity.normalizedCompanyName = $companyKey
        if (-not $activityGroups.ContainsKey($companyKey)) {
            $activityGroups[$companyKey] = New-Object System.Collections.ArrayList
        }
        [void]$activityGroups[$companyKey].Add($activity)
    }

    $allCompanyKeys = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($key in $companyMap.Keys) { [void]$allCompanyKeys.Add($key) }
    foreach ($key in $contactGroups.Keys) { [void]$allCompanyKeys.Add($key) }
    foreach ($key in $jobGroups.Keys) { [void]$allCompanyKeys.Add($key) }
    foreach ($key in $configGroups.Keys) { [void]$allCompanyKeys.Add($key) }
    foreach ($key in $activityGroups.Keys) { [void]$allCompanyKeys.Add($key) }

    $touchedKeySet = $null
    if ($isIncremental) {
        $touchedKeySet = New-Object 'System.Collections.Generic.HashSet[string]'
        foreach ($tk in @($TouchedCompanyKeys)) {
            $canonical = Get-CanonicalCompanyKey $tk
            if ($canonical) { [void]$touchedKeySet.Add($canonical) }
        }
    }
    $groupingStopwatch.Stop()

    $derivedCompanies = New-Object System.Collections.ArrayList
    $now = Get-Date
    $sharedJobSignalTextCache = @{}
    $sharedJobSignalTimestampCache = @{}
    $companyKeys = @($allCompanyKeys | Sort-Object)
    $totalCompanies = @($companyKeys).Count
    $projectedCount = 0
    $skippedCount = 0
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Recomputing company scores' -Processed 0 -Total $totalCompanies -StartedAt $startedAt -Message 'Updating target accounts and outreach signals'
    $projectionStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    for ($index = 0; $index -lt $companyKeys.Count; $index++) {
        $companyKey = $companyKeys[$index]
        $existing = $companyMap[$companyKey]

        # Incremental mode: skip untouched companies that already have a projection
        if ($touchedKeySet -and $existing -and -not $touchedKeySet.Contains($companyKey)) {
            [void]$derivedCompanies.Add($existing)
            $skippedCount++
            continue
        }

        $contacts = if ($contactGroups.ContainsKey($companyKey)) { @($contactGroups[$companyKey].ToArray()) } else { @() }
        $jobs = if ($jobGroups.ContainsKey($companyKey)) { @($jobGroups[$companyKey].ToArray()) } else { @() }
        $configs = if ($configGroups.ContainsKey($companyKey)) { @($configGroups[$companyKey].ToArray()) } else { @() }
        $activities = if ($activityGroups.ContainsKey($companyKey)) { @($activityGroups[$companyKey].ToArray()) } else { @() }

        $displayName = if ($existing -and $existing.displayName) {
            Get-CanonicalCompanyDisplayName $existing.displayName
        } elseif (@($contacts).Count -gt 0 -and @($contacts)[0].companyName) {
            Get-CanonicalCompanyDisplayName @($contacts)[0].companyName
        } elseif (@($jobs).Count -gt 0 -and @($jobs)[0].companyName) {
            Get-CanonicalCompanyDisplayName @($jobs)[0].companyName
        } elseif (@($configs).Count -gt 0 -and @($configs)[0].companyName) {
            Get-CanonicalCompanyDisplayName @($configs)[0].companyName
        } else {
            $companyKey
        }

        if (Test-SuppressedCompanyName -CompanyName $displayName) {
            continue
        }

        $workspaceId = [string](Get-ObjectValue -Object $State.workspace -Name 'id' -Default 'workspace-default')
        $company = if ($existing) {
            $existing
        } else {
            New-CompanyProjection -WorkspaceId $workspaceId -NormalizedName $companyKey -DisplayName $displayName
        }
        [void](Set-ObjectValue -Object $company -Name 'workspaceId' -Value $workspaceId)
        [void](Set-ObjectValue -Object $company -Name 'normalizedName' -Value $companyKey)
        [void](Set-ObjectValue -Object $company -Name 'displayName' -Value $displayName)
        $company = Update-CompanyProjection `
            -Company $company `
            -Contacts $contacts `
            -Jobs $jobs `
            -Configs $configs `
            -Activities $activities `
            -JobSignalTextCache $sharedJobSignalTextCache `
            -JobSignalTimestampCache $sharedJobSignalTimestampCache `
            -ReferenceNow $now

        foreach ($contact in @($contacts)) {
            if ($null -eq $contact) { continue }
            [void](Set-ObjectValue -Object $contact -Name 'accountId' -Value $company.id)
        }
        foreach ($job in @($jobs)) {
            if ($null -eq $job) { continue }
            [void](Set-ObjectValue -Object $job -Name 'accountId' -Value $company.id)
        }
        foreach ($config in @($configs)) {
            if ($null -eq $config) { continue }
            [void](Set-ObjectValue -Object $config -Name 'accountId' -Value $company.id)
        }
        foreach ($activity in @($activities)) {
            if ($null -eq $activity) { continue }
            [void](Set-ObjectValue -Object $activity -Name 'accountId' -Value $company.id)
        }

        [void]$derivedCompanies.Add($company)
        $projectedCount++

        $processed = $index + 1
        if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $totalCompanies -or ($ProgressInterval -gt 0 -and ($processed % $ProgressInterval) -eq 0))) {
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Recomputing company scores' -Processed $processed -Total $totalCompanies -StartedAt $startedAt -Message 'Updating target accounts and outreach signals'
        }
    }
    $projectionStopwatch.Stop()

    $sortStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $sortedCompanies = @(Sort-Companies -Companies @($derivedCompanies.ToArray()) -ChangedKeys $touchedKeySet)
    [void](Set-ObjectValue -Object $State -Name 'companies' -Value $sortedCompanies)
    $sortStopwatch.Stop()
    if ($TimingBag) {
        $TimingBag['groupingMs'] = [int]$groupingStopwatch.Elapsed.TotalMilliseconds
        $TimingBag['projectionMs'] = [int]$projectionStopwatch.Elapsed.TotalMilliseconds
        $TimingBag['sortMs'] = [int]$sortStopwatch.Elapsed.TotalMilliseconds
        $TimingBag['sortMode'] = if ($touchedKeySet) { 'incremental' } else { 'full' }
        $TimingBag['companyCount'] = [int]$totalCompanies
        $TimingBag['projectedCount'] = [int]$projectedCount
        $TimingBag['skippedCount'] = [int]$skippedCount
        $TimingBag['incremental'] = [bool]$isIncremental
        $TimingBag['jobSignalTextCacheCount'] = [int]$sharedJobSignalTextCache.Count
        $TimingBag['jobSignalTimestampCacheCount'] = [int]$sharedJobSignalTimestampCache.Count
    }
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Recomputing company scores' -Processed $totalCompanies -Total $totalCompanies -StartedAt $startedAt -Message $(if ($isIncremental) { "Finished incremental scoring ($projectedCount projected, $skippedCount skipped)" } else { 'Finished derived scoring' })
    return $State
}

function Repair-AppTargetScoreRollout {
    param(
        [int]$Limit = 250,
        [switch]$Persist,
        [int]$MaxBatches = 1,
        [switch]$SkipSnapshots,
        [scriptblock]$BatchCallback
    )

    if ($Limit -lt 1) {
        $Limit = 250
    }
    if ($MaxBatches -lt 1) {
        $MaxBatches = 1
    }
    if (-not $Persist) {
        $MaxBatches = 1
    }
    if ($Persist -and $MaxBatches -gt 1) {
        $SkipSnapshots = $true
    }

    $totalScopeLoadMs = 0
    $totalDeriveMs = 0
    $totalPersistMs = 0
    $totalAccountCount = 0
    $maxTargetScore = 0
    $batchCount = 0
    $snapshotRefreshMs = 0
    $lastDataRevision = ''
    $batchSummaries = New-Object System.Collections.ArrayList

    while ($batchCount -lt $MaxBatches) {
        $accountIds = @(Get-AppTargetScoreBackfillAccountIds -Limit $Limit)
        if ($accountIds.Count -eq 0) {
            break
        }

        $scopeLoadWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $state = Get-AppScopedStateForAccounts -AccountIds $accountIds -IncludeActivities
        $scopeLoadWatch.Stop()

        $deriveTimingBag = [ordered]@{}
        $deriveWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $state = Update-DerivedData -State $state -TimingBag $deriveTimingBag
        $deriveWatch.Stop()

        $persistMs = 0
        $dataRevision = ''
        if ($Persist) {
            $persistWatch = [System.Diagnostics.Stopwatch]::StartNew()
            $persistence = Sync-AppStateSegmentsPartial -State $state -Segments @('Companies') -SkipSnapshots:$SkipSnapshots
            $persistWatch.Stop()
            $persistMs = [int]$persistWatch.Elapsed.TotalMilliseconds
            $dataRevision = [string](Get-ObjectValue -Object $persistence -Name 'dataRevision' -Default '')
            if (-not [string]::IsNullOrWhiteSpace($dataRevision)) {
                $lastDataRevision = $dataRevision
            }
        }

        $batchMaxTargetScore = 0
        if (@($state.companies).Count -gt 0) {
            foreach ($company in @($state.companies)) {
                $score = [int](Convert-ToNumber (Get-ObjectValue -Object $company -Name 'targetScore' -Default 0))
                if ($score -gt $batchMaxTargetScore) {
                    $batchMaxTargetScore = $score
                }
            }
        }

        $batchCount += 1
        $totalAccountCount += @($state.companies).Count
        $totalScopeLoadMs += [int]$scopeLoadWatch.Elapsed.TotalMilliseconds
        $totalDeriveMs += [int]$deriveWatch.Elapsed.TotalMilliseconds
        $totalPersistMs += $persistMs
        if ($batchMaxTargetScore -gt $maxTargetScore) {
            $maxTargetScore = $batchMaxTargetScore
        }

        [void]$batchSummaries.Add([ordered]@{
                batch = $batchCount
                accountCount = @($state.companies).Count
                scopeLoadMs = [int]$scopeLoadWatch.Elapsed.TotalMilliseconds
                deriveMs = [int]$deriveWatch.Elapsed.TotalMilliseconds
                persistMs = $persistMs
                maxTargetScore = $batchMaxTargetScore
                deriveDetails = $deriveTimingBag
            })

        if ($BatchCallback) {
            & $BatchCallback ([ordered]@{
                    batch = $batchCount
                    accountCount = @($state.companies).Count
                    scopeLoadMs = [int]$scopeLoadWatch.Elapsed.TotalMilliseconds
                    deriveMs = [int]$deriveWatch.Elapsed.TotalMilliseconds
                    persistMs = $persistMs
                    maxTargetScore = $batchMaxTargetScore
                    remainingCount = [int](Convert-ToNumber (Get-AppTargetScoreBackfillCount))
                    deriveDetails = $deriveTimingBag
                })
        }

        if (-not $Persist) {
            break
        }
    }

    if ($batchCount -eq 0) {
        return [ordered]@{
            needed = $false
            accountCount = 0
            batchCount = 0
            deriveMs = 0
            scopeLoadMs = 0
            persistMs = 0
            snapshotRefreshMs = 0
            remainingCount = 0
            batches = @()
        }
    }

    if ($Persist -and $SkipSnapshots -and -not [string]::IsNullOrWhiteSpace($lastDataRevision)) {
        $snapshotWatch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            Update-AppSqliteSnapshots -Names @('filters', 'dashboard') | Out-Null
        } finally {
            $snapshotWatch.Stop()
        }
        $snapshotRefreshMs = [int]$snapshotWatch.Elapsed.TotalMilliseconds
    }

    $remainingCount = [int](Convert-ToNumber (Get-AppTargetScoreBackfillCount))

    return [ordered]@{
        needed = $true
        accountCount = $totalAccountCount
        batchCount = $batchCount
        scopeLoadMs = $totalScopeLoadMs
        deriveMs = $totalDeriveMs
        persistMs = $totalPersistMs
        snapshotRefreshMs = $snapshotRefreshMs
        maxTargetScore = $maxTargetScore
        remainingCount = $remainingCount
        batches = @($batchSummaries)
    }
}

function Get-TodayQueue {
    param(
        [Parameter(Mandatory = $true)]
        $State
    )

    $minConnections = Convert-ToNumber $State.settings.minCompanyConnections
    $minJobs = Convert-ToNumber $State.settings.minJobsPosted
    $maxCompanies = [int](Convert-ToNumber $State.settings.maxCompaniesToReview)
    if ($maxCompanies -lt 1) { $maxCompanies = 25 }

    return @(
        $State.companies |
            Where-Object {
                $_.status -notin @('paused', 'client') -and
                (Convert-ToNumber $_.connectionCount) -ge $minConnections -and
                (Convert-ToNumber $_.jobCount) -ge $minJobs
            } |
            Sort-Object @{ Expression = { [double](Convert-ToNumber $_.targetScore) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.hiringVelocity) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.engagementScore) }; Descending = $true } |
            Select-Object -First $maxCompanies
    )
}

function Get-ContactCountEstimate {
    param($State)

    $contacts = @($State.contacts)
    if ($contacts.Count -gt 0) {
        return $contacts.Count
    }

    $total = 0
    foreach ($company in @($State.companies)) {
        $total += [int](Convert-ToNumber (Get-ObjectValue -Object $company -Name 'connectionCount' -Default 0))
    }

    return $total
}

function Add-UniqueTextValue {
    param(
        [hashtable]$Map,
        $Value
    )

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return
    }

    $trimmed = $text.Trim()
    $key = $trimmed.ToLowerInvariant()
    if (-not $Map.ContainsKey($key)) {
        $Map[$key] = $trimmed
    }
}

function Get-SortedUniqueTextValues {
    param([hashtable]$Map)

    if (-not $Map -or $Map.Count -eq 0) {
        return @()
    }

    return @($Map.Values | Sort-Object)
}

function Get-DashboardModel {
    param(
        [Parameter(Mandatory = $true)]
        $State
    )

    $signature = Get-AppStateSignature
    if ($script:DashboardCache -and $script:DashboardCacheSignature -eq $signature) {
        return $script:DashboardCache
    }

    $todayQueue = @(
        Get-TodayQueue -State $State |
            Select-Object -First 10 |
            ForEach-Object { Select-AccountSummary -Company $_ }
    )

    $networkLeaders = @(
        $State.companies |
            Sort-Object @(
                @{ Expression = { [double]$_.connectionCount }; Descending = $true },
                @{ Expression = { [double](Convert-ToNumber $_.targetScore) }; Descending = $true }
            ) |
            Select-Object -First 8 |
            ForEach-Object { Select-AccountSummary -Company $_ }
    )

    $recommendedActions = @(
        $State.companies |
            Sort-Object @{ Expression = { [double](Convert-ToNumber $_.targetScore) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.hiringVelocity) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.engagementScore) }; Descending = $true } |
            Select-Object -First 8 |
            ForEach-Object {
                [ordered]@{
                    accountId = $_.id
                    company = $_.displayName
                    text = $_.recommendedAction
                    score = [int](Convert-ToNumber $_.targetScore)
                    outreachStatus = $_.outreachStatus
                }
            }
    )

    $newJobsLast24h = @(
        $State.jobs |
            Where-Object {
                $_.importedAt -and (Get-DateSortValue $_.importedAt) -ge (Get-Date).AddHours(-24)
            }
    )

    $recentBoards = @(
        $State.boardConfigs |
            Where-Object {
                $_.lastCheckedAt -and
                $_.discoveryStatus -in @('mapped', 'discovered')
            } |
            Sort-Object @{ Expression = { Get-DateSortValue $_.lastCheckedAt }; Descending = $true } |
            Select-Object -First 8 |
            ForEach-Object { Select-ConfigSummary -Config $_ }
    )

    $followUpAccounts = @(
        $State.companies |
            Where-Object {
                $_.status -notin @('client', 'paused') -and (
                    ($_.nextActionAt -and (Get-DateSortValue $_.nextActionAt) -le (Get-Date).AddDays(2)) -or
                    ($_.staleFlag -eq 'STALE') -or
                    ((Convert-ToNumber $_.followUpScore) -gt 0)
                )
            } |
            Sort-Object @(
                @{ Expression = { [double]$_.followUpScore }; Descending = $true },
                @{ Expression = { [double](Convert-ToNumber $_.targetScore) }; Descending = $true }
            ) |
            Select-Object -First 8 |
            ForEach-Object { Select-AccountSummary -Company $_ }
    )

    $needsResolutionCandidates = New-Object System.Collections.ArrayList
    foreach ($company in @($State.companies)) {
        if ($company.status -in @('client', 'paused')) {
            continue
        }

        $isOperationalCandidate = (
            (Convert-ToNumber $company.targetScore) -ge 25 -or
            (Convert-ToNumber $company.connectionCount) -ge 2 -or
            (Convert-ToNumber $company.jobCount) -gt 0 -or
            (Convert-ToNumber $company.alertPriorityScore) -ge 30
        )
        if (-not $isOperationalCandidate) {
            continue
        }

        $hasStrongBoard = @(
            $State.boardConfigs |
                Where-Object {
                    $_.accountId -eq $company.id -and
                    $_.discoveryStatus -in @('mapped', 'discovered') -and
                    (Convert-ToNumber $_.confidenceScore) -ge 80
                }
        ).Count -gt 0

        $needsIdentityHelp = (
            -not $company.canonicalDomain -or
            -not $company.careersUrl -or
            $company.enrichmentConfidence -in @('unresolved', 'low') -or
            -not $hasStrongBoard
        )

        if ($needsIdentityHelp) {
            [void]$needsResolutionCandidates.Add($company)
        }
    }

    $needsResolution = @(
        $needsResolutionCandidates |
            Sort-Object @(
                @{ Expression = { [double](Convert-ToNumber $_.targetScore) }; Descending = $true },
                @{ Expression = { [double](Convert-ToNumber $_.connectionCount) }; Descending = $true },
                @{ Expression = { [double](Convert-ToNumber $_.alertPriorityScore) }; Descending = $true },
                @{ Expression = { [double](Convert-ToNumber $_.dailyScore) }; Descending = $true }
            ) |
            Select-Object -First 6 |
            ForEach-Object { Select-AccountSummary -Company $_ }
    )

    $result = [ordered]@{
        summary = [ordered]@{
            accountCount = @($State.companies).Count
            hiringAccountCount = @($State.companies | Where-Object { (Convert-ToNumber $_.jobCount) -gt 0 }).Count
            contactCount = Get-ContactCountEstimate -State $State
            jobCount = @($State.jobs).Count
            newJobsLast24h = $newJobsLast24h.Count
            staleAccountCount = @($State.companies | Where-Object { $_.staleFlag -eq 'STALE' }).Count
            discoveredBoardCount = @($State.boardConfigs | Where-Object { $_.discoveryStatus -in @('mapped', 'discovered') }).Count
            needsResolutionCount = $needsResolutionCandidates.Count
        }
        todayQueue = $todayQueue
        newJobsToday = @($newJobsLast24h | Select-Object -First 12 | ForEach-Object { Select-JobSummary -Job $_ })
        recentlyDiscoveredBoards = $recentBoards
        followUpAccounts = $followUpAccounts
        networkLeaders = $networkLeaders
        recommendedActions = $recommendedActions
        needsResolution = $needsResolution
    }

    $script:DashboardCache = $result
    $script:DashboardCacheSignature = $signature
    return $result
}

function Get-DashboardExtendedModel {
    param(
        [Parameter(Mandatory = $true)]
        $State
    )

    return [ordered]@{
        playbook = @(Get-PlaybookAccounts -State $State)
        overdueFollowUps = @(Get-OverdueFollowUps -State $State)
        staleAccounts = @(Get-StaleAccounts -State $State)
        activityFeed = @(Get-GlobalActivityFeed -State $State -Limit 10)
        enrichmentFunnel = Get-EnrichmentFunnelStats -State $State
        alertQueue = @(Get-CommandCenterAlertQueue -State $State)
        sequenceQueue = @(Get-CommandCenterSequenceQueue -State $State)
        introQueue = @(Get-CommandCenterIntroQueue -State $State)
    }
}

function Get-AccountFilterOptions {
    param($State)

    $signature = Get-AppStateSignature
    if ($script:FilterOptionsCache -and $script:FilterOptionsCacheSignature -eq $signature) {
        return $script:FilterOptionsCache
    }

    $atsTypes = @{}
    $priorityTiers = @{}
    $priorities = @{}
    $statuses = @{}
    $owners = @{}
    $outreachStatuses = @{}
    $industries = @{}
    $configDiscoveryStatuses = @{}
    $configImportStatuses = @{}

    foreach ($company in @($State.companies)) {
        Add-UniqueTextValue -Map $priorityTiers -Value (Get-ObjectValue -Object $company -Name 'priorityTier')
        Add-UniqueTextValue -Map $priorities -Value (Get-ObjectValue -Object $company -Name 'priority')
        Add-UniqueTextValue -Map $statuses -Value (Get-ObjectValue -Object $company -Name 'status')
        Add-UniqueTextValue -Map $owners -Value (Get-ObjectValue -Object $company -Name 'owner')
        Add-UniqueTextValue -Map $outreachStatuses -Value (Get-ObjectValue -Object $company -Name 'outreachStatus')
        Add-UniqueTextValue -Map $industries -Value (Get-ObjectValue -Object $company -Name 'industry')
    }

    foreach ($config in @($State.boardConfigs)) {
        Add-UniqueTextValue -Map $atsTypes -Value (Get-ObjectValue -Object $config -Name 'atsType')
        Add-UniqueTextValue -Map $configDiscoveryStatuses -Value (Get-ObjectValue -Object $config -Name 'discoveryStatus')
        Add-UniqueTextValue -Map $configImportStatuses -Value (Get-ObjectValue -Object $config -Name 'lastImportStatus')
    }

    $result = [ordered]@{
        atsTypes = Get-SortedUniqueTextValues -Map $atsTypes
        priorityTiers = Get-SortedUniqueTextValues -Map $priorityTiers
        priorities = Get-SortedUniqueTextValues -Map $priorities
        statuses = Get-SortedUniqueTextValues -Map $statuses
        owners = @(($script:OwnerRoster | ForEach-Object { $_.displayName }) + @(Get-SortedUniqueTextValues -Map $owners) | Select-Object -Unique)
        outreachStatuses = Get-SortedUniqueTextValues -Map $outreachStatuses
        industries = Get-SortedUniqueTextValues -Map $industries
        configDiscoveryStatuses = Get-SortedUniqueTextValues -Map $configDiscoveryStatuses
        configImportStatuses = Get-SortedUniqueTextValues -Map $configImportStatuses
    }

    $script:FilterOptionsCache = $result
    $script:FilterOptionsCacheSignature = $signature
    return $result
}

function Get-PagedResult {
    param(
        [object[]]$Items = @(),
        [int]$Page = 1,
        [int]$PageSize = 25
    )

    $page = if ($Page -lt 1) { 1 } else { $Page }
    $pageSize = if ($PageSize -gt 250) { 250 } elseif ($PageSize -lt 1) { 25 } else { $PageSize }
    $itemsArray = @($Items)
    $total = $itemsArray.Count
    $start = ($page - 1) * $pageSize

    if ($start -ge $total) {
        $slice = @()
    } else {
        $end = [Math]::Min($total - 1, $start + $pageSize - 1)
        if ($start -eq $end) {
            $slice = @($itemsArray[$start])
        } else {
            $slice = @($itemsArray[$start..$end])
        }
    }

    return [ordered]@{
        page = $page
        pageSize = $pageSize
        total = $total
        items = $slice
    }
}

function Find-Accounts {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [hashtable]$Query
    )

    $items = @($State.companies)
    $searchQuery = [string]$Query['q']
    $hiringQuery = [string]$Query['hiring']
    $atsQuery = [string]$Query['ats']
    $minContactsQuery = [string]$Query['minContacts']
    $minTargetScoreQuery = [string]$Query['minTargetScore']
    $priorityTierQuery = [string]$Query['priorityTier']
    $priorityQuery = [string]$Query['priority']
    $statusQuery = [string]$Query['status']
    $ownerQuery = [string]$Query['owner']
    $outreachStatusQuery = [string]$Query['outreachStatus']
    $industryQuery = [string]$Query['industry']
    $geographyQuery = [string]$Query['geography']
    $recencyDaysQuery = [string]$Query['recencyDays']
    $sortByQuery = [string]$Query['sortBy']

    if ($searchQuery) {
        $needle = Normalize-TextKey $searchQuery
        $items = @($items | Where-Object {
            (Normalize-TextKey $_.displayName) -like "*$needle*" -or
            (Normalize-TextKey $_.domain) -like "*$needle*" -or
            (Normalize-TextKey $_.owner) -like "*$needle*" -or
            (Normalize-TextKey $_.notes) -like "*$needle*" -or
            ((@($_.tags) -join ' ') -like "*$needle*")
        })
    }

    if ($hiringQuery -eq 'true') {
        $items = @($items | Where-Object { (Convert-ToNumber $_.jobCount) -gt 0 })
    }

    if ($atsQuery) {
        $needle = $atsQuery.ToLowerInvariant()
        $items = @($items | Where-Object { @($_.atsTypes) -contains $needle })
    }

    if ($minContactsQuery) {
        $minContacts = Convert-ToNumber $minContactsQuery
        $items = @($items | Where-Object { (Convert-ToNumber $_.connectionCount) -ge $minContacts })
    }

    if ($minTargetScoreQuery) {
        $minTargetScore = Convert-ToNumber $minTargetScoreQuery
        $items = @($items | Where-Object { (Convert-ToNumber $_.targetScore) -ge $minTargetScore })
    }

    if ($priorityTierQuery) {
        $items = @($items | Where-Object { $_.priorityTier -eq $priorityTierQuery })
    }

    if ($priorityQuery) {
        $items = @($items | Where-Object { $_.priority -eq $priorityQuery })
    }

    if ($statusQuery) {
        $items = @($items | Where-Object { $_.status -eq $statusQuery })
    }

    if ($ownerQuery) {
        $needle = Normalize-TextKey $ownerQuery
        $items = @($items | Where-Object { (Normalize-TextKey $_.owner) -like "*$needle*" })
    }

    if ($outreachStatusQuery) {
        $items = @($items | Where-Object { $_.outreachStatus -eq $outreachStatusQuery })
    }

    if ($industryQuery) {
        $needle = Normalize-TextKey $industryQuery
        $items = @($items | Where-Object { (Normalize-TextKey $_.industry) -like "*$needle*" })
    }

    if ($geographyQuery) {
        $items = @($items | Where-Object { Test-LocationMatchesGeography -Location ([string]$_.location) -Geography $geographyQuery })
    }

    if ($recencyDaysQuery) {
        $cutoff = (Get-Date).AddDays(-1 * (Convert-ToNumber $recencyDaysQuery))
        $items = @($items | Where-Object {
            $_.lastJobPostedAt -and (Get-DateSortValue $_.lastJobPostedAt) -ge $cutoff
        })
    }

    $sorted = switch ($sortByQuery) {
        'new_roles' {
            @($items | Sort-Object @{ Expression = { [double]$_.newRoleCount7d }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.targetScore) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.hiringVelocity) }; Descending = $true }, @{ Expression = { [string]$_.displayName }; Descending = $false })
        }
        'connections' {
            @($items | Sort-Object @{ Expression = { [double]$_.connectionCount }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.targetScore) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.hiringVelocity) }; Descending = $true }, @{ Expression = { [string]$_.displayName }; Descending = $false })
        }
        'follow_up' {
            @($items | Sort-Object @{ Expression = { [double]$_.followUpScore }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.targetScore) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.hiringVelocity) }; Descending = $true }, @{ Expression = { [string]$_.displayName }; Descending = $false })
        }
        'recent_jobs' {
            @($items | Sort-Object @{ Expression = { Get-DateSortValue $_.lastJobPostedAt }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.targetScore) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.hiringVelocity) }; Descending = $true }, @{ Expression = { [string]$_.displayName }; Descending = $false })
        }
        default {
            @($items)
        }
    }

    $result = Get-PagedResult -Items $sorted -Page ([int]$Query.page) -PageSize ([int]$Query.pageSize)
    $result.items = @($result.items | ForEach-Object { Select-AccountSummary -Company $_ })
    return $result
}

function Find-Contacts {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [hashtable]$Query
    )

    $items = @($State.contacts)
    $searchQuery = [string]$Query['q']
    $minScoreQuery = [string]$Query['minScore']
    $outreachStatusQuery = [string]$Query['outreachStatus']

    if ($searchQuery) {
        $needle = Normalize-TextKey $searchQuery
        $items = @($items | Where-Object {
            (Normalize-TextKey $_.fullName) -like "*$needle*" -or
            (Normalize-TextKey $_.companyName) -like "*$needle*" -or
            (Normalize-TextKey $_.title) -like "*$needle*" -or
            (Normalize-TextKey $_.email) -like "*$needle*"
        })
    }

    if ($minScoreQuery) {
        $minScore = Convert-ToNumber $minScoreQuery
        $items = @($items | Where-Object { (Convert-ToNumber $_.priorityScore) -ge $minScore })
    }

    if ($outreachStatusQuery) {
        $items = @($items | Where-Object { $_.outreachStatus -eq $outreachStatusQuery })
    }

    $sorted = @(
        $items | Sort-Object @(
            @{ Expression = { [double]$_.priorityScore }; Descending = $true },
            @{ Expression = { [double]$_.companyOverlapCount }; Descending = $true },
            @{ Expression = { [string]$_.fullName }; Descending = $false }
        )
    )

    $result = Get-PagedResult -Items $sorted -Page ([int]$Query.page) -PageSize ([int]$Query.pageSize)
    $result.items = @($result.items | ForEach-Object { Select-ContactSummary -Contact $_ })
    return $result
}

function Find-Jobs {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [hashtable]$Query
    )

    $items = @($State.jobs)
    $searchQuery = [string]$Query['q']
    $atsQuery = [string]$Query['ats']
    $companyQuery = [string]$Query['company']
    $activeQuery = [string]$Query['active']
    $isNewQuery = [string]$Query['isNew']
    $recencyDaysQuery = [string]$Query['recencyDays']
    $sortByQuery = [string]$Query['sortBy']

    if ($searchQuery) {
        $needle = Normalize-TextKey $searchQuery
        $items = @($items | Where-Object {
            (Normalize-TextKey $_.title) -like "*$needle*" -or
            (Normalize-TextKey $_.companyName) -like "*$needle*" -or
            (Normalize-TextKey $_.location) -like "*$needle*"
        })
    }

    if ($atsQuery) {
        $items = @($items | Where-Object { $_.atsType -eq $atsQuery })
    }

    if ($companyQuery) {
        $needle = Normalize-TextKey $companyQuery
        $items = @($items | Where-Object { (Normalize-TextKey $_.companyName) -like "*$needle*" })
    }

    if ($activeQuery) {
        $want = Test-Truthy $activeQuery
        $items = @($items | Where-Object { (Test-Truthy $_.active) -eq $want })
    }

    if ($isNewQuery) {
        $want = Test-Truthy $isNewQuery
        $items = @($items | Where-Object { (Test-Truthy $_.isNew) -eq $want })
    }

    if ($recencyDaysQuery) {
        $cutoff = (Get-Date).AddDays(-1 * (Convert-ToNumber $recencyDaysQuery))
        $items = @($items | Where-Object {
            $_.postedAt -and (Get-DateSortValue $_.postedAt) -ge $cutoff
        })
    }

    $sorted = switch ($sortByQuery) {
        'retrieved' {
            @(
                $items | Sort-Object @(
                    @{ Expression = { Get-DateSortValue $(if ($_.retrievedAt) { $_.retrievedAt } else { $_.importedAt }) }; Descending = $true },
                    @{ Expression = { Get-DateSortValue $_.postedAt }; Descending = $true },
                    @{ Expression = { [string]$_.companyName }; Descending = $false }
                )
            )
        }
        default {
            @(
                $items | Sort-Object @(
                    @{ Expression = { Get-DateSortValue $_.postedAt }; Descending = $true },
                    @{ Expression = { [string]$_.companyName }; Descending = $false },
                    @{ Expression = { [string]$_.title }; Descending = $false }
                )
            )
        }
    }

    $result = Get-PagedResult -Items $sorted -Page ([int]$Query.page) -PageSize ([int]$Query.pageSize)
    $result.items = @($result.items | ForEach-Object { Select-JobSummary -Job $_ })
    return $result
}

function Find-SearchResults {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [string]$Query
    )

    if ([string]::IsNullOrWhiteSpace($Query)) {
        return [ordered]@{
            accounts = @()
            contacts = @()
            jobs = @()
        }
    }

    $needle = Normalize-TextKey $Query

    return [ordered]@{
        accounts = @(
            $State.companies |
                Where-Object {
                    (Normalize-TextKey $_.displayName) -like "*$needle*" -or
                    (Normalize-TextKey $_.notes) -like "*$needle*"
                } |
                Sort-Object @{ Expression = { [double](Convert-ToNumber $_.targetScore) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.hiringVelocity) }; Descending = $true }, @{ Expression = { [double](Convert-ToNumber $_.engagementScore) }; Descending = $true } |
                Select-Object -First 5 |
                ForEach-Object { Select-AccountSummary -Company $_ }
        )
        contacts = @(
            $State.contacts |
                Where-Object {
                    (Normalize-TextKey $_.fullName) -like "*$needle*" -or
                    (Normalize-TextKey $_.companyName) -like "*$needle*" -or
                    (Normalize-TextKey $_.title) -like "*$needle*"
                } |
                Sort-Object @{ Expression = { [double]$_.priorityScore }; Descending = $true } |
                Select-Object -First 5 |
                ForEach-Object { Select-ContactSummary -Contact $_ }
        )
        jobs = @(
            $State.jobs |
                Where-Object {
                    (Normalize-TextKey $_.title) -like "*$needle*" -or
                    (Normalize-TextKey $_.companyName) -like "*$needle*" -or
                    (Normalize-TextKey $_.location) -like "*$needle*"
                } |
                Sort-Object @{ Expression = { Get-DateSortValue $_.postedAt }; Descending = $true } |
                Select-Object -First 5 |
                ForEach-Object { Select-JobSummary -Job $_ }
        )
    }
}

function Get-AccountDetail {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [string]$AccountId
    )

    $account = @($State.companies | Where-Object { $_.id -eq $AccountId } | Select-Object -First 1)
    if (-not $account) {
        return $null
    }

    $contacts = @(
        $State.contacts |
            Where-Object { $_.accountId -eq $AccountId -or $_.normalizedCompanyName -eq $account.normalizedName } |
            Sort-Object @{ Expression = { [double]$_.priorityScore }; Descending = $true } |
            Select-Object -First 20 |
            ForEach-Object { Select-ContactSummary -Contact $_ }
    )
    $jobs = @(
        $State.jobs |
            Where-Object { $_.accountId -eq $AccountId -or $_.normalizedCompanyName -eq $account.normalizedName } |
            Sort-Object @{ Expression = { Get-DateSortValue $_.postedAt }; Descending = $true } |
            Select-Object -First 20 |
            ForEach-Object { Select-JobSummary -Job $_ }
    )
    $activity = @(
        $State.activities |
            Where-Object { $_.accountId -eq $AccountId -or $_.normalizedCompanyName -eq $account.normalizedName } |
            Sort-Object @{ Expression = { Get-DateSortValue $_.occurredAt }; Descending = $true } |
            Select-Object -First 12 |
            ForEach-Object { Select-ActivitySummary -Activity $_ }
    )
    $configs = @(
        $State.boardConfigs |
            Where-Object { $_.accountId -eq $AccountId -or $_.normalizedCompanyName -eq $account.normalizedName } |
            Sort-Object @{ Expression = { [string]$_.companyName }; Descending = $false } |
            ForEach-Object { Select-ConfigSummary -Config $_ }
    )

    return [ordered]@{
        account = Select-AccountDetailModel -Company $account
        contacts = $contacts
        jobs = $jobs
        activity = $activity
        configs = $configs
        stats = [ordered]@{
            contactCount = [int](Convert-ToNumber $account.connectionCount)
            jobCount = [int](Convert-ToNumber $account.openRoleCount)
            configCount = @($configs).Count
        }
    }
}

function Set-AccountFields {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [string]$AccountId,
        [Parameter(Mandatory = $true)]
        $Patch
    )

    foreach ($account in @($State.companies)) {
        if ($account.id -ne $AccountId) {
            continue
        }

        foreach ($key in @('canonicalDomain', 'careersUrl', 'domain', 'enrichmentStatus', 'enrichmentSource', 'enrichmentConfidence', 'enrichmentConfidenceScore', 'linkedinCompanySlug', 'aliases', 'tags')) {
            if ($account -is [System.Collections.IDictionary] -and -not $account.Contains($key)) {
                $account[$key] = $null
            }
        }

        foreach ($field in 'status', 'outreachStatus', 'priorityTier', 'notes', 'industry', 'location', 'domain', 'nextAction', 'nextActionAt') {
            if (@($Patch.Keys) -contains $field) {
                if ($field -eq 'status') {
                    $account[$field] = Normalize-AccountStatus $Patch[$field]
                } elseif ($field -eq 'outreachStatus') {
                    $account[$field] = Get-NormalizedOutreachStage ([string]$Patch[$field])
                } else {
                    $account[$field] = [string]$Patch[$field]
                }
            }
        }
        if (@($Patch.Keys) -contains 'owner') {
            $resolvedOwner = Resolve-OwnerDisplayName ([string]$Patch['owner'])
            $previousOwner = [string]$account['owner']
            $account['owner'] = $resolvedOwner
            if ($resolvedOwner -ne $previousOwner) {
                $account['ownerId'] = Resolve-OwnerId $resolvedOwner
                $account['ownerAssignedAt'] = (Get-Date).ToString('o')
                $account['ownerAssignedBy'] = 'ui'
            }
        }
        if (@($Patch.Keys) -contains 'priority') {
            $account.priority = Normalize-AccountPriority $Patch.priority
        }
        if (@($Patch.Keys) -contains 'canonicalDomain') {
            $account.canonicalDomain = Get-DomainName ([string]$Patch.canonicalDomain)
            if ($account.canonicalDomain) {
                $account.domain = $account.canonicalDomain
            }
        }
        if (@($Patch.Keys) -contains 'careersUrl') {
            $account.careersUrl = [string]$Patch.careersUrl
            if (-not $account.canonicalDomain -and $account.careersUrl) {
                $account.canonicalDomain = Get-DomainName $account.careersUrl
            }
            if ($account.canonicalDomain -and -not $account.domain) {
                $account.domain = $account.canonicalDomain
            }
        }
        if (@($Patch.Keys) -contains 'linkedinCompanySlug') {
            $account.linkedinCompanySlug = ([string]$Patch.linkedinCompanySlug).Trim().ToLowerInvariant()
        }
        if (@($Patch.Keys) -contains 'aliases') {
            $aliasValues = if ($Patch.aliases -is [string]) { @([string]$Patch.aliases -split '[,\r\n]+') } else { @($Patch.aliases) }
            $account.aliases = @($aliasValues | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
        }
        foreach ($field in 'enrichmentStatus', 'enrichmentSource', 'enrichmentConfidence', 'enrichmentNotes', 'enrichmentEvidence', 'enrichmentFailureReason', 'nextEnrichmentAttemptAt') {
            if (@($Patch.Keys) -contains $field) {
                $account[$field] = [string]$Patch[$field]
            }
        }
        if (@($Patch.Keys) -contains 'enrichmentConfidenceScore') {
            $account.enrichmentConfidenceScore = [int](Convert-ToNumber $Patch.enrichmentConfidenceScore)
        }
        if (@($Patch.Keys) -contains 'tags') {
            $tagValues = if ($Patch.tags -is [string]) { @($Patch.tags -split ',') } else { @($Patch.tags) }
            $account.tags = @($tagValues | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
        }
        if (@($Patch.Keys) | Where-Object { $_ -in @('canonicalDomain', 'careersUrl', 'linkedinCompanySlug', 'aliases', 'enrichmentStatus', 'enrichmentSource', 'enrichmentConfidence', 'enrichmentConfidenceScore', 'enrichmentNotes', 'enrichmentEvidence', 'enrichmentFailureReason', 'nextEnrichmentAttemptAt') }) {
            if ($account.canonicalDomain -or $account.careersUrl) {
                if (-not $account.enrichmentStatus -or $account.enrichmentStatus -eq 'missing_inputs') {
                    $account.enrichmentStatus = 'enriched'
                }
                if (-not $account.enrichmentSource) {
                    $account.enrichmentSource = 'manual_review'
                }
                if (-not $account.enrichmentConfidence) {
                    $account.enrichmentConfidence = 'high'
                }
                if (-not $account.enrichmentConfidenceScore) {
                    $account.enrichmentConfidenceScore = 92
                }
                $account.lastEnrichedAt = (Get-Date).ToString('o')
                $account.lastVerifiedAt = $account.lastEnrichedAt
                $account.enrichmentFailureReason = ''
            }
        }
        $account.updatedAt = (Get-Date).ToString('o')
        $account = Update-CompanyProjection -Company $account
        break
    }

    $State.companies = Sort-Companies -Companies @($State.companies)
    $account = @($State.companies | Where-Object { $_.id -eq $AccountId } | Select-Object -First 1)
    return [ordered]@{ state = $State; account = $account }
}

function Set-ContactFields {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [string]$ContactId,
        [Parameter(Mandatory = $true)]
        $Patch
    )

    foreach ($contact in @($State.contacts)) {
        if ($contact.id -ne $ContactId) {
            continue
        }

        foreach ($field in 'outreachStatus', 'notes') {
            if (@($Patch.Keys) -contains $field) {
                $contact[$field] = [string]$Patch[$field]
            }
        }
        $contact.updatedAt = (Get-Date).ToString('o')
        break
    }

    $contact = @($State.contacts | Where-Object { $_.id -eq $ContactId } | Select-Object -First 1)
    return [ordered]@{ state = $State; contact = (Select-ContactSummary -Contact $contact) }
}

function Add-Activity {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        $Payload
    )

    $normalizedCompanyName = Normalize-TextKey $Payload.normalizedCompanyName
    if (-not $normalizedCompanyName -and $Payload.accountId) {
        $account = @($State.companies | Where-Object { $_.id -eq $Payload.accountId } | Select-Object -First 1)
        if ($account) {
            $normalizedCompanyName = $account.normalizedName
        }
    }

    # Ensure optional keys exist before access (strict-mode safe)
    foreach ($optKey in 'contactId', 'type', 'summary', 'notes', 'pipelineStage', 'metadata') {
        if ($Payload -is [System.Collections.IDictionary] -and -not $Payload.Contains($optKey)) {
            $Payload[$optKey] = $null
        }
    }

    $activity = [ordered]@{
        id = New-RandomId -Prefix 'act'
        workspaceId = $State.workspace.id
        accountId = [string]$Payload.accountId
        contactId = if ($Payload.contactId) { [string]$Payload.contactId } else { '' }
        normalizedCompanyName = $normalizedCompanyName
        type = if ($Payload.type) { [string]$Payload.type } else { 'note' }
        summary = if ($Payload.summary) { [string]$Payload.summary } else { 'Activity note' }
        notes = if ($Payload.notes) { [string]$Payload.notes } else { '' }
        pipelineStage = if ($Payload.pipelineStage) { [string]$Payload.pipelineStage } else { '' }
        occurredAt = (Get-Date).ToString('o')
        metadata = if ($Payload.metadata) { ConvertTo-PlainObject -InputObject $Payload.metadata } else { [ordered]@{} }
    }
    $resolvedPipelineStage = Resolve-ActivityPipelineStage -Activity $activity
    if ($resolvedPipelineStage) {
        $activity.pipelineStage = $resolvedPipelineStage
    }

    $State.activities = @(@($State.activities) + @($activity))

    $relatedAccount = $null
    if ($activity.accountId) {
        $relatedAccount = $State.companies | Where-Object { $_.id -eq $activity.accountId } | Select-Object -First 1
    }
    if (-not $relatedAccount -and $normalizedCompanyName) {
        $relatedAccount = $State.companies | Where-Object { $_.normalizedName -eq $normalizedCompanyName } | Select-Object -First 1
    }
    if ($relatedAccount) {
        # Ensure keys exist before writing (strict-mode safe)
        foreach ($k in 'lastContactedAt', 'outreachStatus') {
            if ($relatedAccount -is [System.Collections.IDictionary] -and -not $relatedAccount.Contains($k)) {
                $relatedAccount[$k] = $null
            }
        }
        $relatedAccount['lastContactedAt'] = $activity.occurredAt
        if ($activity.pipelineStage) {
            $relatedAccount['outreachStatus'] = $activity.pipelineStage
        }
        $relatedActivities = @($State.activities | Where-Object {
                ([string](Get-ObjectValue -Object $_ -Name 'accountId' -Default '')) -eq [string]$relatedAccount.id -or
                ([string](Get-ObjectValue -Object $_ -Name 'normalizedCompanyName' -Default '')) -eq [string]$normalizedCompanyName
            })
        $relatedAccount = Update-CompanyProjection -Company $relatedAccount -Activities $relatedActivities
        $State.companies = Sort-Companies -Companies @($State.companies)
    }

    $activity = @($State.activities | Where-Object { $_.id -eq $activity.id } | Select-Object -First 1)
    return [ordered]@{ state = $State; activity = $activity }
}

function Add-Account {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        $Payload
    )

    $payloadCompany = [string](Get-ObjectValue -Object $Payload -Name 'company')
    $payloadDisplayName = [string](Get-ObjectValue -Object $Payload -Name 'displayName')
    $payloadDomain = [string](Get-ObjectValue -Object $Payload -Name 'domain')
    $payloadCareersUrl = [string](Get-ObjectValue -Object $Payload -Name 'careersUrl')
    $payloadOwner = [string](Get-ObjectValue -Object $Payload -Name 'owner')
    $payloadPriority = [string](Get-ObjectValue -Object $Payload -Name 'priority')
    $payloadStatus = [string](Get-ObjectValue -Object $Payload -Name 'status')
    $payloadNotes = [string](Get-ObjectValue -Object $Payload -Name 'notes')
    $payloadNextAction = [string](Get-ObjectValue -Object $Payload -Name 'nextAction')
    $payloadNextActionAt = [string](Get-ObjectValue -Object $Payload -Name 'nextActionAt')

    $companyName = Get-CanonicalCompanyDisplayName ([string]$(if ($payloadCompany) { $payloadCompany } elseif ($payloadDisplayName) { $payloadDisplayName } else { '' }))
    $companyKey = Get-CanonicalCompanyKey $companyName
    if (-not $companyKey) {
        throw 'Company is required.'
    }
    if (Test-SuppressedCompanyName -CompanyName $companyName) {
        throw 'That company name looks like a pseudo-company entry and was intentionally rejected.'
    }

    $existing = $State.companies | Where-Object {
        (Get-CanonicalCompanyKey $(if ($_.normalizedName) { $_.normalizedName } else { $_.displayName })) -eq $companyKey
    } | Select-Object -First 1

    if (-not $existing) {
        $existing = New-CompanyProjection -WorkspaceId $State.workspace.id -NormalizedName $companyKey -DisplayName $companyName
        $State.companies = @(@($State.companies) + @($existing))
    }

    $existing.displayName = $companyName
    $existing.normalizedName = $companyKey
    $existing.domain = [string]$(if ($payloadDomain) { $payloadDomain } elseif ($existing.domain) { $existing.domain } else { Get-DomainName $payloadCareersUrl })
    $existing.careersUrl = [string]$(if ($payloadCareersUrl) { $payloadCareersUrl } else { $existing.careersUrl })
    $existing.canonicalDomain = [string]$(if ($payloadDomain) { Get-DomainName $payloadDomain } elseif ($existing.canonicalDomain) { $existing.canonicalDomain } else { Get-DomainName $payloadCareersUrl })
    $resolvedOwner = [string]$(if ($payloadOwner) { Resolve-OwnerDisplayName $payloadOwner } else { $existing.owner })
    $previousOwner = [string](Get-ObjectValue -Object $existing -Name 'owner')
    $existing.owner = $resolvedOwner
    if ($resolvedOwner -ne $previousOwner) {
        [void](Set-ObjectValue -Object $existing -Name 'ownerId' -Value (Resolve-OwnerId $resolvedOwner))
        [void](Set-ObjectValue -Object $existing -Name 'ownerAssignedAt' -Value (Get-Date).ToString('o'))
        [void](Set-ObjectValue -Object $existing -Name 'ownerAssignedBy' -Value 'ui')
    }
    $existing.priority = Normalize-AccountPriority $(if ($payloadPriority) { $payloadPriority } else { $existing.priority })
    $existing.status = Normalize-AccountStatus $(if ($payloadStatus) { $payloadStatus } else { $existing.status })
    $existing.notes = [string]$(if ($payloadNotes) { $payloadNotes } else { $existing.notes })
    $existing.nextAction = [string]$(if ($payloadNextAction) { $payloadNextAction } else { $existing.nextAction })
    $existing.nextActionAt = [string]$(if ($payloadNextActionAt) { $payloadNextActionAt } else { $existing.nextActionAt })
    if (@($Payload.Keys) -contains 'linkedinCompanySlug') {
        $existing.linkedinCompanySlug = ([string]$Payload.linkedinCompanySlug).Trim().ToLowerInvariant()
    }
    if (@($Payload.Keys) -contains 'aliases') {
        $aliasValues = if ($Payload.aliases -is [string]) { @([string]$Payload.aliases -split '[,\r\n]+') } else { @($Payload.aliases) }
        $existing.aliases = @($aliasValues | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
    }
    if (@($Payload.Keys) -contains 'tags') {
        $tagValues = if ($Payload.tags -is [string]) { @([string]$Payload.tags -split ',') } else { @($Payload.tags) }
        $existing.tags = @($tagValues | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
    }
    if ($existing.canonicalDomain -or $existing.careersUrl) {
        $existing.enrichmentStatus = 'enriched'
        $existing.enrichmentSource = if ($payloadDomain -or $payloadCareersUrl) { 'account_input' } else { $existing.enrichmentSource }
        if (-not $existing.enrichmentConfidence) { $existing.enrichmentConfidence = 'medium' }
        if (-not $existing.enrichmentConfidenceScore) { $existing.enrichmentConfidenceScore = if ($existing.canonicalDomain -and $existing.careersUrl) { 84 } else { 72 } }
        $existing.lastEnrichedAt = (Get-Date).ToString('o')
    }
    $existing.updatedAt = (Get-Date).ToString('o')

    $existing = Update-CompanyProjection -Company $existing
    $State.companies = Sort-Companies -Companies @($State.companies)
    $account = @($State.companies | Where-Object { $_.normalizedName -eq $companyKey } | Select-Object -First 1)
    return [ordered]@{ state = $State; account = $account }
}

function Import-Accounts {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [object[]]$Rows
    )

    $created = New-Object System.Collections.ArrayList
    foreach ($row in @($Rows)) {
        $result = Add-Account -State $State -Payload $row
        $State = $result.state
        [void]$created.Add($result.account)
    }

    return [ordered]@{
        state = $State
        accounts = @($created)
        count = @($created).Count
    }
}

function Remove-Account {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [Parameter(Mandatory = $true)]
        [string]$AccountId
    )

    foreach ($account in @($State.companies)) {
        if ($account.id -ne $AccountId) {
            continue
        }

        $account.status = 'paused'
        $account.nextAction = ''
        $account.nextActionAt = $null
        $account.updatedAt = (Get-Date).ToString('o')
        $account = Update-CompanyProjection -Company $account
        break
    }

    $State.companies = Sort-Companies -Companies @($State.companies)
    return [ordered]@{ state = $State; ok = $true }
}

Export-ModuleMember -Function *-*
