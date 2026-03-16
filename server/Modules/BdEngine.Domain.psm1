Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'BdEngine.State.psm1') -DisableNameChecking

$script:DashboardCache = $null
$script:DashboardCacheSignature = ''
$script:FilterOptionsCache = $null
$script:FilterOptionsCacheSignature = ''

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

    if ($TargetScore -ge 600) { return 'Tier 1' }
    if ($TargetScore -ge 150) { return 'Tier 2' }
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
    foreach ($job in @($Jobs)) {
        $department = ([string]$(if ($job.department) { $job.department } else { 'General' })).Trim()
        if (-not $department) {
            $department = 'General'
        }
        if (-not $counts.ContainsKey($department)) {
            $counts[$department] = 0
        }
        $counts[$department] += 1
    }

    if ($counts.Count -eq 0) {
        return [ordered]@{
            topDepartment = ''
            topDepartmentCount = 0
            concentration = 0
        }
    }

    $top = $counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1
    $total = @($Jobs).Count
    return [ordered]@{
        topDepartment = [string]$top.Key
        topDepartmentCount = [int]$top.Value
        concentration = if ($total -gt 0) { [math]::Round(([double]$top.Value / [double]$total), 2) } else { 0 }
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

    $jobs = [int](Convert-ToNumber $Company.jobCount)
    $connections = [int](Convert-ToNumber $Company.connectionCount)
    $topContact = if ($Company.topContactName) { $Company.topContactName } else { '[Top contact]' }

    return "Hi $topContact, I noticed $($Company.displayName) is actively hiring ($jobs open roles) and I already have a strong network overlap there ($connections connections). I would love to compare notes on where your team is leaning hardest and see where I can help."
}

function Get-RecommendationAction {
    param($Company)

    if ($Company.nextAction) {
        return [string]$Company.nextAction
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
        priority = [string](Get-ObjectValue -Object $Company -Name 'priority')
        status = [string](Get-ObjectValue -Object $Company -Name 'status')
        outreachStatus = [string](Get-ObjectValue -Object $Company -Name 'outreachStatus')
        nextAction = [string](Get-ObjectValue -Object $Company -Name 'nextAction')
        nextActionAt = Get-ObjectValue -Object $Company -Name 'nextActionAt' -Default $null
        dailyScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'dailyScore'))
        targetScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'targetScore'))
        connectionCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'connectionCount'))
        seniorContactCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'seniorContactCount'))
        talentContactCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'talentContactCount'))
        jobCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'jobCount'))
        openRoleCount = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'openRoleCount'))
        newRoleCount7d = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'newRoleCount7d'))
        staleRoleCount30d = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'staleRoleCount30d'))
        departmentFocus = [string](Get-ObjectValue -Object $Company -Name 'departmentFocus')
        networkStrength = [string](Get-ObjectValue -Object $Company -Name 'networkStrength')
        hiringStatus = [string](Get-ObjectValue -Object $Company -Name 'hiringStatus')
        lastJobPostedAt = Get-ObjectValue -Object $Company -Name 'lastJobPostedAt' -Default $null
        followUpScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company -Name 'followUpScore'))
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
    $summary.lastContactedAt = $Company.lastContactedAt
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
        connectedOn = $Contact.connectedOn
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
        dailyScore = 0
        openRoleCount = 0
        newRoleCount7d = 0
        staleRoleCount30d = 0
        departmentFocus = ''
        departmentFocusCount = 0
        departmentConcentration = 0
        hiringSpikeScore = 0
        followUpScore = 0
        scoreBreakdown = [ordered]@{}
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
        outreachDraft = ''
        createdAt = $timestamp
        updatedAt = $timestamp
    }
}

function Update-CompanyProjection {
    param(
        [Parameter(Mandatory = $true)]
        $Company,
        $Jobs = $null,
        $Configs = $null
    )

    $now = Get-Date
    $companyName = if ($Company.displayName) { [string]$Company.displayName } elseif ($Company.normalizedName) { [string]$Company.normalizedName } else { 'Unknown company' }
    $Company.displayName = Get-CanonicalCompanyDisplayName $companyName
    $Company.normalizedName = Get-CanonicalCompanyKey $(if ($Company.normalizedName) { $Company.normalizedName } else { $companyName })
    $Company.tags = @(Get-StringList $Company.tags)
    $Company.connectionCount = [int](Convert-ToNumber $Company.connectionCount)
    $Company.seniorContactCount = [int](Convert-ToNumber $Company.seniorContactCount)
    $Company.talentContactCount = [int](Convert-ToNumber $Company.talentContactCount)
    $Company.buyerTitleCount = [int](Convert-ToNumber $Company.buyerTitleCount)
    $Company.targetScore = [int](Convert-ToNumber $Company.targetScore)
    $Company.priority = Normalize-AccountPriority $Company.priority

    if (-not $Company.priorityTier) {
        $Company.priorityTier = Get-PriorityTierFromScore -TargetScore $Company.targetScore
    }
    $Company.status = Normalize-AccountStatus $Company.status
    if (-not $Company.outreachStatus) { $Company.outreachStatus = 'not_started' }
    if (-not $Company.notes) { $Company.notes = '' }
    if (-not $Company.industry) { $Company.industry = '' }
    if (-not $Company.location) { $Company.location = '' }
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
    if (-not $Company.owner) { $Company.owner = '' }
    if (-not $Company.nextAction) { $Company.nextAction = '' }
    if (-not $Company.topContactName) { $Company.topContactName = '' }
    if (-not $Company.topContactTitle) { $Company.topContactTitle = '' }
    if (-not $Company.createdAt) { $Company.createdAt = $now.ToString('o') }

    if ($PSBoundParameters.ContainsKey('Jobs')) {
        $jobList = @($Jobs | Where-Object { $_.active -ne $false })
        $insights = Get-DepartmentInsights -Jobs $jobList
        $newRoleCount7d = @($jobList | Where-Object { $_.postedAt -and (Get-DateSortValue $_.postedAt) -ge $now.AddDays(-7) }).Count
        $staleRoleCount30d = @($jobList | Where-Object { $_.postedAt -and (Get-DateSortValue $_.postedAt) -lt $now.AddDays(-30) }).Count
        $Company.jobCount = @($jobList).Count
        $Company.openRoleCount = $Company.jobCount
        $Company.newRoleCount7d = $newRoleCount7d
        $Company.staleRoleCount30d = $staleRoleCount30d
        $Company.departmentFocus = [string]$insights.topDepartment
        $Company.departmentFocusCount = [int]$insights.topDepartmentCount
        $Company.departmentConcentration = [double]$insights.concentration
        $Company.hiringSpikeScore = [math]::Round([math]::Min(30, ($newRoleCount7d * 4) + (($insights.topDepartmentCount -as [int]) * 1.5)))
        $latestJob = @(
            $jobList | Sort-Object @{ Expression = { Get-DateSortValue $(if ($_.postedAt) { $_.postedAt } else { $_.importedAt }) }; Descending = $true }
        ) | Select-Object -First 1
        $Company.lastJobPostedAt = if ($latestJob) {
            if ($latestJob.postedAt) { $latestJob.postedAt } else { $latestJob.importedAt }
        } else {
            $null
        }
    } else {
        $Company.jobCount = [int](Convert-ToNumber $Company.jobCount)
        $Company.openRoleCount = [int](Convert-ToNumber $Company.openRoleCount)
        $Company.newRoleCount7d = [int](Convert-ToNumber $Company.newRoleCount7d)
        $Company.staleRoleCount30d = [int](Convert-ToNumber $Company.staleRoleCount30d)
        $Company.departmentFocus = [string]$Company.departmentFocus
        $Company.departmentFocusCount = [int](Convert-ToNumber $Company.departmentFocusCount)
        $Company.departmentConcentration = [double](Convert-ToNumber $Company.departmentConcentration)
        $Company.hiringSpikeScore = [double](Convert-ToNumber $Company.hiringSpikeScore)
    }

    if ($PSBoundParameters.ContainsKey('Configs')) {
        $configList = @($Configs)
        $activeConfigs = @($configList | Where-Object { $_.active -ne $false })
        $Company.atsTypes = @($activeConfigs | ForEach-Object { ([string]$_.atsType).ToLowerInvariant() } | Where-Object { $_ } | Sort-Object -Unique)
        $primaryCareersUrl = @($activeConfigs | ForEach-Object { [string]$_.careersUrl } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
        $primaryDomain = @($activeConfigs | ForEach-Object { [string]$_.domain } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
        if ($primaryCareersUrl.Count -gt 0) {
            $Company.careersUrl = $primaryCareersUrl[0]
        } elseif (-not $Company.careersUrl) {
            $Company.careersUrl = ''
        }
        if ($primaryDomain.Count -gt 0) {
            $Company.domain = $primaryDomain[0]
        }
    } else {
        $Company.atsTypes = @(Get-StringList $Company.atsTypes)
        if (-not $Company.careersUrl) { $Company.careersUrl = '' }
    }

    $daysSinceContact = $null
    $lastContact = [DateTime]::MinValue
    if ($Company.lastContactedAt -and [DateTime]::TryParse([string]$Company.lastContactedAt, [ref]$lastContact)) {
        $daysSinceContact = [int][Math]::Floor(($now - $lastContact).TotalDays)
    }
    $Company.daysSinceContact = $daysSinceContact
    $Company.staleFlag = if ($null -ne $daysSinceContact -and $daysSinceContact -ge 14) { 'STALE' } else { '' }
    $Company.followUpScore = Get-FollowUpBonus -Status $Company.status -NextActionAt $Company.nextActionAt -LastContactedAt $Company.lastContactedAt
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
    $Company.scoreBreakdown = [ordered]@{
        openRoles = $Company.openRoleCount * 3
        newRoles = $Company.newRoleCount7d * 8
        network = [int][math]::Round(($Company.connectionCount * 1.5) + ($Company.seniorContactCount * 6) + ($Company.talentContactCount * 5))
        departmentFocus = $departmentBonus
        hiringSpike = [int][math]::Round($Company.hiringSpikeScore)
        followUp = $Company.followUpScore
        manualPriority = Get-ManualPriorityBonus -Priority $Company.priority
        stalePenalty = (-1 * $stalePenalty)
    }
    $Company.recommendedAction = Get-RecommendationAction -Company $Company
    $Company.outreachDraft = Get-OutreachDraft -Company $Company
    $Company.updatedAt = $now.ToString('o')

    return $Company
}

function Sort-Companies {
    param($Companies)

    return @(
        $Companies | Sort-Object @(
            @{ Expression = { [double]$_.dailyScore }; Descending = $true },
            @{ Expression = { [double]$_.jobCount }; Descending = $true },
            @{ Expression = { [double]$_.connectionCount }; Descending = $true },
            @{ Expression = { [string]$_.displayName }; Descending = $false }
        )
    )
}

function Update-DerivedData {
    param(
        [Parameter(Mandatory = $true)]
        $State,
        [scriptblock]$ProgressCallback,
        [int]$ProgressInterval = 150
    )

    $startedAt = (Get-Date).ToString('o')
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Preparing derived data' -StartedAt $startedAt -Message 'Grouping contacts, jobs, configs, and activity'

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

    $derivedCompanies = New-Object System.Collections.ArrayList
    $now = Get-Date
    $companyKeys = @($allCompanyKeys | Sort-Object)
    $totalCompanies = @($companyKeys).Count
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Recomputing company scores' -Processed 0 -Total $totalCompanies -StartedAt $startedAt -Message 'Updating target accounts and outreach signals'

    for ($index = 0; $index -lt $companyKeys.Count; $index++) {
        $companyKey = $companyKeys[$index]
        $existing = $companyMap[$companyKey]
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

        $connectionCount = @($contacts).Count
        $seniorContactCount = (@($contacts | Where-Object { Test-Truthy $_.seniorFlag })).Count
        $talentContactCount = (@($contacts | Where-Object { Test-Truthy $_.talentFlag })).Count
        $buyerTitleCount = (@($contacts | Where-Object { Test-Truthy $_.buyerFlag })).Count
        $targetScore = ($connectionCount * 2) + ($seniorContactCount * 10) + ($talentContactCount * 8) + ($buyerTitleCount * 15)

        foreach ($contact in $contacts) {
            $contact.companyOverlapCount = $connectionCount
            $contact.priorityScore = Get-ContactPriorityScore -Contact $contact -CompanyContacts $connectionCount
            $contact.relevanceScore = $contact.priorityScore
        }

        $activeJobs = @($jobs | Where-Object { $_.active -ne $false })
        $jobCount = @($activeJobs).Count
        $newRoleCount7d = @($activeJobs | Where-Object { $_.postedAt -and (Get-DateSortValue $_.postedAt) -ge $now.AddDays(-7) }).Count
        $staleRoleCount30d = @($activeJobs | Where-Object { $_.postedAt -and (Get-DateSortValue $_.postedAt) -lt $now.AddDays(-30) }).Count
        $departmentInsights = Get-DepartmentInsights -Jobs $activeJobs
        $latestJobPostedAt = $null
        if (@($activeJobs).Count -gt 0) {
            $latestJobPostedAt = ($activeJobs |
                Where-Object { $_.postedAt } |
                Sort-Object @{ Expression = { Get-DateSortValue $_.postedAt }; Descending = $true } |
                Select-Object -First 1).postedAt
        }

        $latestActivity = $activities |
            Where-Object { $_.occurredAt } |
            Sort-Object @{ Expression = { Get-DateSortValue $_.occurredAt }; Descending = $true } |
            Select-Object -First 1

        $lastContactedAt = $null
        $pipelineStage = ''
        if ($latestActivity) {
            $lastContactedAt = $latestActivity.occurredAt
            if ($latestActivity.pipelineStage) {
                $pipelineStage = $latestActivity.pipelineStage
            }
        }

        $daysSinceContact = $null
        if ($lastContactedAt) {
            $daysSinceContact = [math]::Floor(($now - (Get-DateSortValue $lastContactedAt)).TotalDays)
        }

        $manualPriority = if ($existing -and $existing.priority) { Normalize-AccountPriority $existing.priority } else { 'medium' }
        $priorityTier = if ($existing -and $existing.priorityTier) { $existing.priorityTier } else { Get-PriorityTierFromScore -TargetScore $targetScore }
        $departmentBonus = if ($departmentInsights.concentration -ge 0.6 -and $departmentInsights.topDepartmentCount -ge 3) { 14 } elseif ($departmentInsights.concentration -ge 0.4 -and $departmentInsights.topDepartmentCount -ge 2) { 8 } else { 0 }
        $hiringSpikeScore = [math]::Round([math]::Min(30, ($newRoleCount7d * 4) + ($departmentInsights.topDepartmentCount * 1.5)))
        $followUpScore = Get-FollowUpBonus -Status $(if ($existing) { $existing.status } else { '' }) -NextActionAt $(if ($existing) { $existing.nextActionAt } else { '' }) -LastContactedAt $lastContactedAt
        $stalePenalty = $staleRoleCount30d * 2
        $dailyScore = [math]::Round(
            ($jobCount * 3) +
            ($newRoleCount7d * 8) +
            ($connectionCount * 1.5) +
            ($seniorContactCount * 6) +
            ($talentContactCount * 5) +
            $departmentBonus +
            $hiringSpikeScore +
            $followUpScore +
            (Get-RecencyBonus -LastJobPostedAt $latestJobPostedAt) +
            (Get-PriorityTierBonus -PriorityTier $priorityTier) +
            (Get-ManualPriorityBonus -Priority $manualPriority) -
            $stalePenalty
        )

        $topContact = $contacts |
            Sort-Object @{ Expression = { [double]$_.priorityScore }; Descending = $true } |
            Select-Object -First 1

        $companyId = if ($existing -and $existing.id) { $existing.id } else { New-DeterministicId -Prefix 'acct' -Seed $companyKey }
        $careersConfig = $configs | Where-Object { (Test-ObjectHasKey -Object $_ -Name 'careersUrl') -and $_.careersUrl } | Select-Object -First 1
        $domainConfig = $configs | Where-Object { (Test-ObjectHasKey -Object $_ -Name 'domain') -and $_.domain } | Select-Object -First 1
        $careersUrl = if ($careersConfig) { $careersConfig.careersUrl } else { '' }
        $atsTypes = @(
            @($configs | ForEach-Object { if (Test-ObjectHasKey -Object $_ -Name 'atsType') { if ($_['atsType']) { $_['atsType'] } } }) +
            @($jobs | ForEach-Object { if (Test-ObjectHasKey -Object $_ -Name 'atsType') { if ($_['atsType']) { $_['atsType'] } } })
        ) | Where-Object { $_ } | Sort-Object -Unique
        $locations = @($jobs | ForEach-Object { if (Test-ObjectHasKey -Object $_ -Name 'location') { if ($_['location']) { $_['location'] } } } | Sort-Object -Unique | Select-Object -First 3)

        $company = [ordered]@{
            id = $companyId
            workspaceId = $State.workspace.id
            normalizedName = $companyKey
            displayName = $displayName
            domain = if ($existing -and $existing.domain) { $existing.domain } elseif ($domainConfig) { $domainConfig.domain } else { '' }
            owner = if ($existing -and $existing.owner) { $existing.owner } else { '' }
            priority = $manualPriority
            industry = if ($existing -and $existing.industry) { $existing.industry } else { '' }
            location = if ($existing -and $existing.location) { $existing.location } elseif (@($locations).Count -gt 0) { ($locations -join ', ') } else { '' }
            status = Normalize-AccountStatus $(if ($existing -and $existing.status) { $existing.status } else { 'new' })
            outreachStatus = if ($existing -and $existing.outreachStatus) { $existing.outreachStatus } elseif ($pipelineStage) { $pipelineStage } else { 'not_started' }
            priorityTier = $priorityTier
            notes = if ($existing -and $existing.notes) { $existing.notes } else { '' }
            tags = if ($existing -and $existing.tags) { @($existing.tags) } else { @() }
            nextAction = if ($existing -and $existing.nextAction) { $existing.nextAction } else { '' }
            nextActionAt = if ($existing -and $existing.nextActionAt) { $existing.nextActionAt } else { $null }
            connectionCount = $connectionCount
            seniorContactCount = $seniorContactCount
            talentContactCount = $talentContactCount
            buyerTitleCount = $buyerTitleCount
            targetScore = $targetScore
            dailyScore = $dailyScore
            openRoleCount = $jobCount
            newRoleCount7d = $newRoleCount7d
            staleRoleCount30d = $staleRoleCount30d
            departmentFocus = [string]$departmentInsights.topDepartment
            departmentFocusCount = [int]$departmentInsights.topDepartmentCount
            departmentConcentration = [double]$departmentInsights.concentration
            hiringSpikeScore = [double]$hiringSpikeScore
            followUpScore = [double]$followUpScore
            scoreBreakdown = [ordered]@{
                openRoles = ($jobCount * 3)
                newRoles = ($newRoleCount7d * 8)
                network = [int][math]::Round(($connectionCount * 1.5) + ($seniorContactCount * 6) + ($talentContactCount * 5))
                departmentFocus = $departmentBonus
                hiringSpike = $hiringSpikeScore
                followUp = $followUpScore
                manualPriority = Get-ManualPriorityBonus -Priority $manualPriority
                stalePenalty = (-1 * $stalePenalty)
            }
            networkStrength = Get-NetworkStrength -Connections $connectionCount -SeniorContacts $seniorContactCount
            jobCount = $jobCount
            lastJobPostedAt = $latestJobPostedAt
            hiringStatus = Get-HiringStatus -JobCount $jobCount -LastJobPostedAt $latestJobPostedAt
            lastContactedAt = $lastContactedAt
            daysSinceContact = $daysSinceContact
            staleFlag = if ($daysSinceContact -ge 14) { 'STALE' } else { '' }
            careersUrl = $careersUrl
            atsTypes = $atsTypes
            topContactName = if ($topContact) { $topContact.fullName } else { '' }
            topContactTitle = if ($topContact) { $topContact.title } else { '' }
            recommendedAction = ''
            outreachDraft = ''
            createdAt = if ($existing -and $existing.createdAt) { $existing.createdAt } else { (Get-Date).ToString('o') }
            updatedAt = (Get-Date).ToString('o')
        }

        $company.recommendedAction = Get-RecommendationAction -Company $company
        $company.outreachDraft = Get-OutreachDraft -Company $company

        foreach ($contact in $contacts) { $contact.accountId = $companyId }
        foreach ($job in $jobs) { $job.accountId = $companyId }
        foreach ($config in $configs) { $config.accountId = $companyId }
        foreach ($activity in $activities) { $activity.accountId = $companyId }

        [void]$derivedCompanies.Add($company)

        $processed = $index + 1
        if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $totalCompanies -or ($ProgressInterval -gt 0 -and ($processed % $ProgressInterval) -eq 0))) {
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Recomputing company scores' -Processed $processed -Total $totalCompanies -StartedAt $startedAt -Message 'Updating target accounts and outreach signals'
        }
    }

    $State.companies = Sort-Companies -Companies @($derivedCompanies)
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Recomputing company scores' -Processed $totalCompanies -Total $totalCompanies -StartedAt $startedAt -Message 'Finished derived scoring'
    return $State
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
            Sort-Object @{ Expression = { [double]$_.dailyScore }; Descending = $true } |
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
                @{ Expression = { [double]$_.dailyScore }; Descending = $true }
            ) |
            Select-Object -First 8 |
            ForEach-Object { Select-AccountSummary -Company $_ }
    )

    $recommendedActions = @(
        $State.companies |
            Sort-Object @{ Expression = { [double]$_.dailyScore }; Descending = $true } |
            Select-Object -First 8 |
            ForEach-Object {
                [ordered]@{
                    accountId = $_.id
                    company = $_.displayName
                    text = $_.recommendedAction
                    score = [int](Convert-ToNumber $_.dailyScore)
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
                @{ Expression = { [double]$_.dailyScore }; Descending = $true }
            ) |
            Select-Object -First 8 |
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
        }
        todayQueue = $todayQueue
        newJobsToday = @($newJobsLast24h | Select-Object -First 12 | ForEach-Object { Select-JobSummary -Job $_ })
        recentlyDiscoveredBoards = $recentBoards
        followUpAccounts = $followUpAccounts
        networkLeaders = $networkLeaders
        recommendedActions = $recommendedActions
    }

    $script:DashboardCache = $result
    $script:DashboardCacheSignature = $signature
    return $result
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
    $configDiscoveryStatuses = @{}
    $configImportStatuses = @{}

    foreach ($company in @($State.companies)) {
        Add-UniqueTextValue -Map $priorityTiers -Value (Get-ObjectValue -Object $company -Name 'priorityTier')
        Add-UniqueTextValue -Map $priorities -Value (Get-ObjectValue -Object $company -Name 'priority')
        Add-UniqueTextValue -Map $statuses -Value (Get-ObjectValue -Object $company -Name 'status')
        Add-UniqueTextValue -Map $owners -Value (Get-ObjectValue -Object $company -Name 'owner')
        Add-UniqueTextValue -Map $outreachStatuses -Value (Get-ObjectValue -Object $company -Name 'outreachStatus')
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
        owners = Get-SortedUniqueTextValues -Map $owners
        outreachStatuses = Get-SortedUniqueTextValues -Map $outreachStatuses
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
    $priorityTierQuery = [string]$Query['priorityTier']
    $priorityQuery = [string]$Query['priority']
    $statusQuery = [string]$Query['status']
    $ownerQuery = [string]$Query['owner']
    $outreachStatusQuery = [string]$Query['outreachStatus']
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

    if ($recencyDaysQuery) {
        $cutoff = (Get-Date).AddDays(-1 * (Convert-ToNumber $recencyDaysQuery))
        $items = @($items | Where-Object {
            $_.lastJobPostedAt -and (Get-DateSortValue $_.lastJobPostedAt) -ge $cutoff
        })
    }

    $sorted = switch ($sortByQuery) {
        'new_roles' {
            @($items | Sort-Object @{ Expression = { [double]$_.newRoleCount7d }; Descending = $true }, @{ Expression = { [double]$_.dailyScore }; Descending = $true }, @{ Expression = { [string]$_.displayName }; Descending = $false })
        }
        'connections' {
            @($items | Sort-Object @{ Expression = { [double]$_.connectionCount }; Descending = $true }, @{ Expression = { [double]$_.dailyScore }; Descending = $true }, @{ Expression = { [string]$_.displayName }; Descending = $false })
        }
        'follow_up' {
            @($items | Sort-Object @{ Expression = { [double]$_.followUpScore }; Descending = $true }, @{ Expression = { [double]$_.dailyScore }; Descending = $true }, @{ Expression = { [string]$_.displayName }; Descending = $false })
        }
        'recent_jobs' {
            @($items | Sort-Object @{ Expression = { Get-DateSortValue $_.lastJobPostedAt }; Descending = $true }, @{ Expression = { [double]$_.dailyScore }; Descending = $true }, @{ Expression = { [string]$_.displayName }; Descending = $false })
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
                Sort-Object @{ Expression = { [double]$_.dailyScore }; Descending = $true } |
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

        foreach ($field in 'status', 'outreachStatus', 'priorityTier', 'notes', 'industry', 'location', 'domain', 'owner', 'nextAction', 'nextActionAt') {
            if (@($Patch.Keys) -contains $field) {
                if ($field -eq 'status') {
                    $account[$field] = Normalize-AccountStatus $Patch[$field]
                } else {
                    $account[$field] = [string]$Patch[$field]
                }
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

    $activity = [ordered]@{
        id = New-RandomId -Prefix 'act'
        workspaceId = $State.workspace.id
        accountId = [string]$Payload.accountId
        contactId = [string]$Payload.contactId
        normalizedCompanyName = $normalizedCompanyName
        type = if ($Payload.type) { [string]$Payload.type } else { 'note' }
        summary = if ($Payload.summary) { [string]$Payload.summary } else { 'Activity note' }
        notes = if ($Payload.notes) { [string]$Payload.notes } else { '' }
        pipelineStage = if ($Payload.pipelineStage) { [string]$Payload.pipelineStage } else { '' }
        occurredAt = (Get-Date).ToString('o')
        metadata = [ordered]@{}
    }

    $State.activities = @(@($State.activities) + @($activity))

    $relatedAccount = $null
    if ($activity.accountId) {
        $relatedAccount = @($State.companies | Where-Object { $_.id -eq $activity.accountId } | Select-Object -First 1)
    }
    if (-not $relatedAccount -and $normalizedCompanyName) {
        $relatedAccount = @($State.companies | Where-Object { $_.normalizedName -eq $normalizedCompanyName } | Select-Object -First 1)
    }
    if ($relatedAccount) {
        $relatedAccount.lastContactedAt = $activity.occurredAt
        if ($activity.pipelineStage) {
            $relatedAccount.outreachStatus = $activity.pipelineStage
        }
        $relatedAccount = Update-CompanyProjection -Company $relatedAccount
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

    $existing = @($State.companies | Where-Object {
        (Get-CanonicalCompanyKey $(if ($_.normalizedName) { $_.normalizedName } else { $_.displayName })) -eq $companyKey
    } | Select-Object -First 1)

    if (-not $existing) {
        $existing = New-CompanyProjection -WorkspaceId $State.workspace.id -NormalizedName $companyKey -DisplayName $companyName
        $State.companies = @(@($State.companies) + @($existing))
    }

    $existing.displayName = $companyName
    $existing.normalizedName = $companyKey
    $existing.domain = [string]$(if ($payloadDomain) { $payloadDomain } elseif ($existing.domain) { $existing.domain } else { Get-DomainName $payloadCareersUrl })
    $existing.careersUrl = [string]$(if ($payloadCareersUrl) { $payloadCareersUrl } else { $existing.careersUrl })
    $existing.canonicalDomain = [string]$(if ($payloadDomain) { Get-DomainName $payloadDomain } elseif ($existing.canonicalDomain) { $existing.canonicalDomain } else { Get-DomainName $payloadCareersUrl })
    $existing.owner = [string]$(if ($payloadOwner) { $payloadOwner } else { $existing.owner })
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
