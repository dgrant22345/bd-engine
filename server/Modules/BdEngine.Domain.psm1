Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'BdEngine.State.psm1') -DisableNameChecking

$script:DashboardCache = $null
$script:DashboardCacheSignature = ''
$script:FilterOptionsCache = $null
$script:FilterOptionsCacheSignature = ''

# ─── Fixed owner roster ───
$script:OwnerRoster = @(
    [ordered]@{ ownerId = 'derek-grant';  displayName = 'Derek Grant' }
    [ordered]@{ ownerId = 'alex-chong';   displayName = 'Alex Chong' }
    [ordered]@{ ownerId = 'danny-chung';  displayName = 'Danny Chung' }
)

function Get-OwnerRoster {
    return @($script:OwnerRoster)
}

function Resolve-OwnerDisplayName {
    param([string]$OwnerIdOrName)
    if (-not $OwnerIdOrName) { return '' }
    $match = $script:OwnerRoster | Where-Object {
        $_.ownerId -eq $OwnerIdOrName -or $_.displayName -eq $OwnerIdOrName
    } | Select-Object -First 1
    if ($match) { return [string]$match.displayName }
    return $OwnerIdOrName
}

function Resolve-OwnerId {
    param([string]$OwnerIdOrName)
    if (-not $OwnerIdOrName) { return '' }
    $match = $script:OwnerRoster | Where-Object {
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
    foreach ($job in @($Jobs)) {
        $department = ([string](Get-ObjectValue -Object $job -Name 'department' -Default 'General')).Trim()
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

    $draft = Build-SmartOutreachDraft -Account $Company -Jobs @() -Contacts @()
    return [string](Get-ObjectValue -Object $draft -Name 'message_body' -Default '')
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
    $industry = [string](Get-ObjectValue -Object $Account -Name 'industry' -Default '')
    $jobSignalTextCache = @{}
    $activeJobs = @($Jobs | Where-Object { $null -ne $_ -and (Get-ObjectValue -Object $_ -Name 'active' -Default $true) -ne $false })
    $openRoles = if ($activeJobs.Count -gt 0) { $activeJobs.Count } else { [int](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'openRoleCount' -Default 0)) }
    $jobsLast30Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'jobsLast30Days' -Default 0))
    $jobsLast90Days = [int](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'jobsLast90Days' -Default 0))
    $hiringSpikeRatio = [double](Convert-ToNumber (Get-ObjectValue -Object $Account -Name 'hiringSpikeRatio' -Default 0))
    $roleTitleInsights = Get-OutreachRoleTitleInsights -Jobs $activeJobs
    $roleKeywordInsights = Get-OutreachKeywordInsights -Jobs $activeJobs -JobSignalTextCache $jobSignalTextCache
    $techStackInsights = Get-OutreachTechStackInsights -Jobs $activeJobs -JobSignalTextCache $jobSignalTextCache

    $subjectFocus = if ($roleTitleInsights.items.Count -gt 0) {
        [string]$roleTitleInsights.items[0]
    } elseif ($roleKeywordInsights.items.Count -gt 0) {
        [string]$roleKeywordInsights.items[0]
    } elseif ($techStackInsights.items.Count -gt 0) {
        [string]$techStackInsights.items[0]
    } elseif ($openRoles -gt 0) {
        ('{0} open role{1}' -f $openRoles, $(if ($openRoles -eq 1) { '' } else { 's' }))
    } else {
        'hiring signal'
    }
    $subjectLine = if ($subjectFocus -match 'open role') {
        '{0}: {1}' -f $companyName, $subjectFocus
    } else {
        '{0}: {1} hiring' -f $companyName, $subjectFocus
    }

    if ($jobsLast30Days -gt 0 -and $roleTitleInsights.summary -and $techStackInsights.summary -and $hiringSpikeRatio -ge 1.4) {
        $firstSentence = 'Noticed {0} opened {1} roles in the last 30 days, with a clear spike across {2} and repeated mentions of {3}.' -f $companyName, $jobsLast30Days, $roleTitleInsights.summary, $techStackInsights.summary
    } elseif ($jobsLast30Days -gt 0 -and $roleTitleInsights.summary) {
        $firstSentence = 'Noticed {0} opened {1} roles in the last 30 days, concentrated across {2}.' -f $companyName, $jobsLast30Days, $roleTitleInsights.summary
    } elseif ($openRoles -gt 0 -and $roleTitleInsights.summary -and $techStackInsights.summary) {
        $firstSentence = 'Noticed {0} has {1} open role{2} across {3}, with repeated mentions of {4}.' -f $companyName, $openRoles, $(if ($openRoles -eq 1) { '' } else { 's' }), $roleTitleInsights.summary, $techStackInsights.summary
    } elseif ($openRoles -gt 0 -and $roleTitleInsights.summary) {
        $firstSentence = 'Noticed {0} has {1} open role{2} across {3}.' -f $companyName, $openRoles, $(if ($openRoles -eq 1) { '' } else { 's' }), $roleTitleInsights.summary
    } elseif ($openRoles -gt 0 -and $roleKeywordInsights.summary) {
        $firstSentence = 'Noticed {0} has {1} open role{2} clustered around {3}.' -f $companyName, $openRoles, $(if ($openRoles -eq 1) { '' } else { 's' }), $roleKeywordInsights.summary
    } elseif ($jobsLast90Days -gt 0) {
        $firstSentence = 'Noticed {0} has kept hiring active with {1} roles over the last 90 days.' -f $companyName, $jobsLast90Days
    } elseif ($openRoles -gt 0) {
        $firstSentence = 'Noticed {0} is carrying {1} open role{2} right now.' -f $companyName, $openRoles, $(if ($openRoles -eq 1) { '' } else { 's' })
    } elseif ($roleKeywordInsights.summary) {
        $firstSentence = 'Noticed {0}''s hiring pattern is concentrated around {1}.' -f $companyName, $roleKeywordInsights.summary
    } else {
        $firstSentence = 'Noticed live hiring activity at {0}.' -f $companyName
    }

    if ($industry -and $roleKeywordInsights.summary -and $techStackInsights.summary) {
        $contextSentence = 'In {0}, that mix usually means the team is scaling real capability on {1}, not just backfilling.' -f $industry, $techStackInsights.summary
    } elseif ($techStackInsights.summary -and $roleKeywordInsights.summary) {
        $contextSentence = 'The mix of {0} hiring around {1} usually means the team is tightening a core build, not just filling seats.' -f $roleKeywordInsights.summary, $techStackInsights.summary
    } elseif ($industry -and $roleKeywordInsights.summary) {
        $contextSentence = 'In {0}, that mix usually means the team is adding capability quickly, not just backfilling.' -f $industry
    } elseif ($techStackInsights.summary) {
        $contextSentence = 'That usually signals a team standardizing the stack while delivery pressure is rising.'
    } elseif ($roleTitleInsights.summary) {
        $contextSentence = 'That usually points to a team building real capability, not just adding headcount.'
    } else {
        $contextSentence = 'That usually points to real execution pressure, not a routine hiring cycle.'
    }

    $closeSentence = switch (([string]$Template).ToLowerInvariant()) {
        'follow_up' { 'Happy to compare notes on which search in that mix tends to bottleneck first.'; break }
        're_engage' { 'Happy to compare notes on which seat in that cluster tends to bottleneck first.'; break }
        'warm_intro' { 'Happy to compare notes if that pattern is a priority this quarter.'; break }
        default { 'Happy to compare notes on where that hiring mix usually gets hardest.' }
    }

    $messageBody = Limit-TextWords -Text ([string]::Join(' ', @($firstSentence, $contextSentence, $closeSentence))) -MaxWords 75

    return [ordered]@{
        subject_line = $subjectLine.Trim()
        message_body = $messageBody.Trim()
        outreach = $messageBody.Trim()
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
        [string[]]$Patterns
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return 0
    }

    $count = 0
    foreach ($pattern in @($Patterns)) {
        if ($Text -match $pattern) {
            $count += 1
        }
    }

    return $count
}

function Get-RoleSeniorityScore {
    param([string]$Title)

    $needle = Normalize-TextKey $Title
    if (-not $needle) { return 0 }

    if ($needle -match '\b(chief|ceo|coo|cto|cfo|cio|cro|cmo|chief [a-z]+ officer|president|founder|cofounder|general counsel)\b') { return 96 }
    if ($needle -match '\b(svp|evp|vp|vice president|head of|general manager|gm)\b') { return 88 }
    if ($needle -match '\bdirector|managing director\b') { return 76 }
    if ($needle -match '\b(principal|staff|lead|manager|architect|supervisor)\b') { return 66 }
    if ($needle -match '\b(senior|sr\.?)\b') { return 56 }
    if ($needle -match '\b(intern|junior|jr\.?|entry level|apprentice)\b') { return 18 }
    if ($needle -match '\b(associate|specialist|analyst|coordinator|administrator|recruiter|sourcer)\b') { return 34 }
    return 45
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
        [datetime]$ReferenceNow = (Get-Date),
        [hashtable]$JobSignalTextCache = $null,
        [hashtable]$JobSignalTimestampCache = $null
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

    $activeJobs = @($Jobs | Where-Object { $null -ne $_ -and (Get-ObjectValue -Object $_ -Name 'active' -Default $true) -ne $false })
    $jobsLast30Days = 0
    $jobsLast90Days = 0
    $seniorityTotal = 0.0
    $seniorityCount = 0
    $recruiterTotal = 0.0
    $recruiterCount = 0
    $cutoff30 = $ReferenceNow.AddDays(-30)
    $cutoff90 = $ReferenceNow.AddDays(-90)

    foreach ($job in @($activeJobs)) {
        $jobTimestamp = Get-CachedJobSignalTimestamp -Job $job -Cache $JobSignalTimestampCache
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

    $jobsForTextAnalysis = if (@($activeJobs).Count -gt 12) {
        @(
            $activeJobs |
                Sort-Object @{ Expression = { Get-CachedJobSignalTimestamp -Job $_ -Cache $JobSignalTimestampCache }; Descending = $true } |
                Select-Object -First 12
        )
    } else {
        @($activeJobs)
    }

    foreach ($job in @($jobsForTextAnalysis)) {
        $title = [string](Get-ObjectValue -Object $job -Name 'title' -Default '')
        $jobText = Get-CachedJobSignalText -Job $job -Cache $JobSignalTextCache -MaxLength 2400
        if ($jobText) {
            $urgencyHits = Get-PatternHitCount -Text $jobText -Patterns @('\burgent\b', '\bimmediately\b', '\basap\b', '\bhigh volume\b', '\bmultiple openings\b', '\bscale quickly\b', '\bhypergrowth\b', '\bbuild(ing)? out\b')
            $hardRoleHits = Get-PatternHitCount -Text $jobText -Patterns @('\bprincipal\b', '\bstaff\b', '\barchitect\b', '\bsecurity\b', '\bmachine learning\b', '\bai\b', '\bdata platform\b', '\bsite reliability\b', '\bembedded\b', '\bbilingual\b', '\blicensed\b', '\bclearance\b')
            $partnerFriendlyHits = Get-PatternHitCount -Text $jobText -Patterns @('\bcontract\b', '\bconsultant\b', '\bproject based\b', '\bsearch\b', '\bpartner\b', '\boutside support\b')
            $negativeHits = Get-PatternHitCount -Text $jobText -Patterns @('\bno agencies\b', '\bno recruiters\b', '\bunsolicited resumes\b', '\bthird[- ]party\b', '\bagency resumes\b')
            $remoteHits = Get-PatternHitCount -Text $jobText -Patterns @('\bremote\b', '\bhybrid\b', '\bmultiple locations\b', '\bcanada\b', '\bunited states\b')
            $jobScore = 18 + ($urgencyHits * 10) + ($hardRoleHits * 7) + ($partnerFriendlyHits * 9) + ($remoteHits * 4) - ($negativeHits * 24)
            if ($title -match 'recruiter|talent acquisition|sourcer') { $jobScore += 6 }
            if ($title -match 'director|vp|vice president|head|chief|lead|principal|staff|architect') { $jobScore += 6 }
            $recruiterTotal += [Math]::Min(100, [Math]::Max(0, $jobScore))
            $recruiterCount += 1
        }
    }

    $avgRoleSeniorityScore = if ($seniorityCount -gt 0) { [Math]::Round($seniorityTotal / $seniorityCount, 1) } else { 0 }
    $externalRecruiterLikelihoodScore = if ($recruiterCount -gt 0) { [Math]::Round($recruiterTotal / $recruiterCount, 1) } else { 0 }
    $baseline30Days = [Math]::Max(1.0, ($jobsLast90Days / 3.0))
    $hiringSpikeRatio = if ($jobsLast30Days -gt 0) { [Math]::Round(($jobsLast30Days / $baseline30Days), 2) } else { 0 }
    $hiringVelocity = [Math]::Min(100, [Math]::Round(([Math]::Min(60, ($jobsLast30Days * 8))) + ([Math]::Min(20, ($jobsLast90Days * 1.5))) + ([Math]::Min(20, ([Math]::Max(0, $hiringSpikeRatio - 1) * 25))), 0))

    return [ordered]@{
        jobsLast30Days = [int]$jobsLast30Days
        jobsLast90Days = [int]$jobsLast90Days
        avgRoleSeniorityScore = [double]$avgRoleSeniorityScore
        hiringSpikeRatio = [double]$hiringSpikeRatio
        externalRecruiterLikelihoodScore = [double]$externalRecruiterLikelihoodScore
        hiringVelocity = [double]$hiringVelocity
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

    $fundingPatterns = @('\bseries [a-z]+\b', '\bseed\b', '\bfunding\b', '\braised\b', '\bventure backed\b', '\bbacked by\b', '\bprivate equity\b', '\bacquisition\b')
    $growthPatterns = @('\bhypergrowth\b', '\brapid(ly)? growing\b', '\bscal(e|ing)\b', '\bexpan(d|sion)\b', '\bnew office\b', '\bnew market\b', '\bhiring surge\b', '\bbuild(ing)? out\b', '\bgrowth stage\b')
    $fundingHits = Get-PatternHitCount -Text $signalText -Patterns $fundingPatterns
    $growthHits = Get-PatternHitCount -Text $signalText -Patterns $growthPatterns
    if ($Jobs) {
        $jobsForGrowthSignals = @(
            @($Jobs | Where-Object { $null -ne $_ -and (Get-ObjectValue -Object $_ -Name 'active' -Default $true) -ne $false } |
                Sort-Object @{ Expression = { Get-CachedJobSignalTimestamp -Job $_ -Cache $JobSignalTimestampCache }; Descending = $true } |
                Select-Object -First 6)
        )
        foreach ($job in @($jobsForGrowthSignals)) {
            $jobText = Get-CachedJobSignalText -Job $job -Cache $JobSignalTextCache -MaxLength 1800
            if (-not [string]::IsNullOrWhiteSpace($jobText)) {
                $fundingHits += Get-PatternHitCount -Text $jobText -Patterns $fundingPatterns
                $growthHits += Get-PatternHitCount -Text $jobText -Patterns $growthPatterns
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
        $Activities = $null,
        [datetime]$ReferenceNow = (Get-Date)
    )

    $jobSignalTextCache = @{}
    $jobSignalTimestampCache = @{}
    $hiringMetrics = Get-CompanyHiringSignalMetrics -Company $Company -Jobs $Jobs -ReferenceNow $ReferenceNow -JobSignalTextCache $jobSignalTextCache -JobSignalTimestampCache $jobSignalTimestampCache
    $engagementMetrics = Get-CompanyEngagementMetrics -Company $Company -Activities $Activities -ReferenceNow $ReferenceNow
    $growthMetrics = Get-CompanyGrowthSignalMetrics -Company $Company -Jobs $Jobs -JobsLast30Days ([int](Convert-ToNumber $hiringMetrics.jobsLast30Days)) -HiringSpikeRatio ([double](Convert-ToNumber $hiringMetrics.hiringSpikeRatio)) -JobSignalTextCache $jobSignalTextCache -JobSignalTimestampCache $jobSignalTimestampCache

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
    $explanation = Get-TargetScoreExplanation -Components $components

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
        scoreBreakdown = $scoreBreakdown
        targetScoreExplanation = $explanation
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
    $score = 0
    if (Test-Truthy (Get-ObjectValue -Object $Contact -Name 'buyerFlag' -Default $false)) { $score += 35 }
    if (Test-Truthy (Get-ObjectValue -Object $Contact -Name 'seniorFlag' -Default $false)) { $score += 25 }
    if (Test-Truthy (Get-ObjectValue -Object $Contact -Name 'talentFlag' -Default $false)) { $score += 12 }

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

    return [int][Math]::Min(100, $score)
}

function Get-ContactRelationshipStrengthScore {
    param(
        $Contact,
        [int]$PastPlacementCount = 0
    )

    $yearsConnected = [double](Convert-ToNumber (Get-ObjectValue -Object $Contact -Name 'yearsConnected' -Default 0))
    $priorityScore = [double](Convert-ToNumber (Get-ObjectValue -Object $Contact -Name 'priorityScore' -Default 0))
    $companyOverlapCount = [double](Convert-ToNumber (Get-ObjectValue -Object $Contact -Name 'companyOverlapCount' -Default 0))
    $decisionMakerFitScore = Get-DecisionMakerFitScore -Contact $Contact
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
        $Activities = $null
    )

    if ($null -eq $Contacts) {
        $existing = Get-ObjectValue -Object $Company -Name 'connectionGraph' -Default $null
        if ($existing) {
            return (ConvertTo-PlainObject -InputObject $existing)
        }
        return (Get-EmptyConnectionGraph)
    }

    $pastPlacementCount = Get-CompanyPastPlacementCount -Company $Company -Activities $Activities
    $rankedCandidates = @(
        @($Contacts | Where-Object { $null -ne $_ }) |
            ForEach-Object {
                $decisionMakerFitScore = Get-DecisionMakerFitScore -Contact $_
                $relationshipStrengthScore = Get-ContactRelationshipStrengthScore -Contact $_ -PastPlacementCount $pastPlacementCount
                $title = [string](Get-ObjectValue -Object $_ -Name 'title' -Default '')
                $fullName = [string](Get-ObjectValue -Object $_ -Name 'fullName' -Default '')
                $pathLength = if ($decisionMakerFitScore -ge 60) { 1 } else { 2 }
                $why = @()
                if ((Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'yearsConnected' -Default 0)) -gt 0) {
                    $why += ('{0}y connection' -f [string]([Math]::Round((Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'yearsConnected' -Default 0)), 1)))
                }
                if (Test-Truthy (Get-ObjectValue -Object $_ -Name 'seniorFlag' -Default $false)) { $why += 'senior contact' }
                if (Test-Truthy (Get-ObjectValue -Object $_ -Name 'buyerFlag' -Default $false)) { $why += 'buyer-side title' }
                if (Test-Truthy (Get-ObjectValue -Object $_ -Name 'talentFlag' -Default $false)) { $why += 'talent access' }
                if ($pastPlacementCount -gt 0) { $why += ('{0} prior placement signal{1}' -f $pastPlacementCount, $(if ($pastPlacementCount -eq 1) { '' } else { 's' })) }
                [ordered]@{
                    id = [string](Get-ObjectValue -Object $_ -Name 'id' -Default '')
                    fullName = $fullName
                    title = $title
                    relationshipStrengthScore = [int]$relationshipStrengthScore
                    decisionMakerFitScore = [int]$decisionMakerFitScore
                    pathLength = $pathLength
                    introPath = if ($pathLength -eq 1) { 'Direct path to a likely decision maker' } else { 'Best direct connection to broker an intro' }
                    connectedOn = Get-ObjectValue -Object $_ -Name 'connectedOn' -Default $null
                    why = [string]([string]::Join(', ', @($why)))
                }
            } |
            Sort-Object @(
                @{ Expression = { [double](Convert-ToNumber $_.relationshipStrengthScore) }; Descending = $true },
                @{ Expression = { [double](Convert-ToNumber $_.decisionMakerFitScore) }; Descending = $true },
                @{ Expression = { [string]$_.fullName }; Descending = $false }
            )
    )

    $warmIntroCandidates = @($rankedCandidates | Select-Object -First 5)
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

    return [ordered]@{
        shortestPathToDecisionMaker = $shortestPath
        warmIntroCandidates = $warmIntroCandidates
        relationshipStrengthScore = $relationshipStrengthScore
        pastPlacementCount = [int]$pastPlacementCount
        decisionMakerCount = [int]@($rankedCandidates | Where-Object { (Convert-ToNumber $_.decisionMakerFitScore) -ge 60 }).Count
    }
}

function Get-CompanyTriggerAlerts {
    param(
        $Company,
        $Jobs = $null,
        $Contacts = $null,
        $Activities = $null,
        [datetime]$ReferenceNow = (Get-Date)
    )

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

    if ($staleRoleCount30d -gt 0) {
        $staleJobs = @()
        if ($null -ne $Jobs) {
            $staleJobs = @(
                $Jobs |
                    Where-Object {
                        $postedAt = Get-DateSortValue ([string](Get-ObjectValue -Object $_ -Name 'postedAt' -Default ''))
                        $postedAt -gt [DateTime]::MinValue -and $postedAt -lt $ReferenceNow.AddDays(-30)
                    } |
                    Sort-Object @{ Expression = { Get-DateSortValue ([string](Get-ObjectValue -Object $_ -Name 'postedAt' -Default '')) } } |
                    Select-Object -First 3
            )
        }
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

    if ($null -ne $Jobs) {
        $repeatedPostings = @(
            @($Jobs | Where-Object { $null -ne $_ -and (Get-ObjectValue -Object $_ -Name 'active' -Default $true) -ne $false }) |
                Group-Object -Property { [string](Get-ObjectValue -Object $_ -Name 'normalizedTitle' -Default (Normalize-TextKey ([string](Get-ObjectValue -Object $_ -Name 'title' -Default '')))) } |
                Where-Object { $_.Count -ge 2 } |
                Sort-Object @{ Expression = { $_.Count }; Descending = $true } |
                Select-Object -First 1
        )
        if (@($repeatedPostings).Count -gt 0) {
            $sampleJob = @($repeatedPostings[0].Group | Select-Object -First 1)
            [void]$alerts.Add([ordered]@{
                    id = 'repeated_postings'
                    type = 'repeated_postings'
                    title = 'Repeated postings'
                    summary = ('{0} active postings are clustered around "{1}", which usually means the team still has not closed the gap.' -f $repeatedPostings[0].Count, [string](Get-ObjectValue -Object $sampleJob -Name 'title' -Default 'that role'))
                    priorityScore = [int][Math]::Min(100, [Math]::Round(($repeatedPostings[0].Count * 18) + ([Math]::Min(24, $jobsLast30Days * 2)), 0))
                    recommendedAction = 'Use the repeated title pattern as proof of sustained hiring pressure.'
                })
        }
    }

    if ($null -ne $Contacts) {
        $recentManagers = @(
            @($Contacts | Where-Object { $null -ne $_ }) |
                ForEach-Object {
                    $decisionMakerFitScore = Get-DecisionMakerFitScore -Contact $_
                    $connectedAt = Get-DateSortValue ([string](Get-ObjectValue -Object $_ -Name 'connectedOn' -Default ''))
                    [ordered]@{
                        fullName = [string](Get-ObjectValue -Object $_ -Name 'fullName' -Default '')
                        title = [string](Get-ObjectValue -Object $_ -Name 'title' -Default '')
                        decisionMakerFitScore = $decisionMakerFitScore
                        isRecent = ($connectedAt -gt [DateTime]::MinValue -and $connectedAt -ge $ReferenceNow.AddDays(-180))
                    }
                } |
                Where-Object { $_.decisionMakerFitScore -ge 60 -and $_.isRecent } |
                Sort-Object @{ Expression = { [double](Convert-ToNumber $_.decisionMakerFitScore) }; Descending = $true } |
                Select-Object -First 1
        )
        if (@($recentManagers).Count -gt 0) {
            [void]$alerts.Add([ordered]@{
                    id = 'new_hiring_manager_detected'
                    type = 'new_hiring_manager_detected'
                    title = 'New hiring manager detected'
                    summary = ('{0} looks like a recent hiring-side connection at {1}.' -f [string]$recentManagers[0].fullName, [string](Get-ObjectValue -Object $Company -Name 'displayName' -Default 'this company'))
                    priorityScore = [int][Math]::Min(100, [Math]::Round(45 + (Convert-ToNumber $recentManagers[0].decisionMakerFitScore * 0.45), 0))
                    recommendedAction = ('Use {0} as the first route into the account.' -f [string]$recentManagers[0].fullName)
                })
        }
    }

    return @(
        $alerts |
            Sort-Object @(
                @{ Expression = { [double](Convert-ToNumber $_.priorityScore) }; Descending = $true },
                @{ Expression = { [string]$_.title }; Descending = $false }
            )
    )
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
        outreachDraft = ''
        pipelineState = [ordered]@{}
        connectionGraph = [ordered]@{}
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
        $Configs = $null,
        $Activities = $null
    )

    $now = Get-Date
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

    if ($PSBoundParameters.ContainsKey('Contacts')) {
        $contactList = @($Contacts | Where-Object { $null -ne $_ })
        $Company.connectionCount = @($contactList).Count
        $Company.seniorContactCount = (@($contactList | Where-Object { Test-Truthy (Get-ObjectValue -Object $_ -Name 'seniorFlag' -Default $false) })).Count
        $Company.talentContactCount = (@($contactList | Where-Object { Test-Truthy (Get-ObjectValue -Object $_ -Name 'talentFlag' -Default $false) })).Count
        $Company.buyerTitleCount = (@($contactList | Where-Object { Test-Truthy (Get-ObjectValue -Object $_ -Name 'buyerFlag' -Default $false) })).Count
        foreach ($contact in @($contactList)) {
            if ($null -eq $contact) { continue }
            [void](Set-ObjectValue -Object $contact -Name 'accountId' -Value ([string]$Company.id))
            [void](Set-ObjectValue -Object $contact -Name 'companyOverlapCount' -Value ([int]$Company.connectionCount))
            $priorityScore = Get-ContactPriorityScore -Contact $contact -CompanyContacts $Company.connectionCount
            [void](Set-ObjectValue -Object $contact -Name 'priorityScore' -Value $priorityScore)
            [void](Set-ObjectValue -Object $contact -Name 'relevanceScore' -Value $priorityScore)
        }
        $topContact = @(
            $contactList |
                Sort-Object @{ Expression = { [double](Convert-ToNumber (Get-ObjectValue -Object $_ -Name 'priorityScore' -Default 0)) }; Descending = $true }
        ) | Select-Object -First 1
        $Company.topContactName = if ($topContact) { [string](Get-ObjectValue -Object $topContact -Name 'fullName' -Default '') } else { '' }
        $Company.topContactTitle = if ($topContact) { [string](Get-ObjectValue -Object $topContact -Name 'title' -Default '') } else { '' }
    } else {
        $Company.topContactName = [string](Get-ObjectValue -Object $Company -Name 'topContactName' -Default '')
        $Company.topContactTitle = [string](Get-ObjectValue -Object $Company -Name 'topContactTitle' -Default '')
    }

    $jobList = @()
    if ($PSBoundParameters.ContainsKey('Jobs')) {
        $jobList = @($Jobs | Where-Object { $null -ne $_ -and (Get-ObjectValue -Object $_ -Name 'active' -Default $true) -ne $false })
        $insights = Get-DepartmentInsights -Jobs $jobList
        $newRoleCount7d = @($jobList | Where-Object {
                $postedAt = Get-ObjectValue -Object $_ -Name 'postedAt' -Default ''
                $postedAt -and (Get-DateSortValue $postedAt) -ge $now.AddDays(-7)
            }).Count
        $staleRoleCount30d = @($jobList | Where-Object {
                $postedAt = Get-ObjectValue -Object $_ -Name 'postedAt' -Default ''
                $postedAt -and (Get-DateSortValue $postedAt) -lt $now.AddDays(-30)
            }).Count
        $Company.jobCount = @($jobList).Count
        $Company.openRoleCount = $Company.jobCount
        $Company.newRoleCount7d = $newRoleCount7d
        $Company.staleRoleCount30d = $staleRoleCount30d
        $Company.departmentFocus = [string]$insights.topDepartment
        $Company.departmentFocusCount = [int]$insights.topDepartmentCount
        $Company.departmentConcentration = [double]$insights.concentration
        $Company.hiringSpikeScore = [math]::Round([math]::Min(30, ($newRoleCount7d * 4) + (($insights.topDepartmentCount -as [int]) * 1.5)))
        $latestJob = @(
            $jobList | Sort-Object @{
                Expression = {
                    $postedAt = Get-ObjectValue -Object $_ -Name 'postedAt' -Default ''
                    $importedAt = Get-ObjectValue -Object $_ -Name 'importedAt' -Default ''
                    Get-DateSortValue $(if ($postedAt) { $postedAt } else { $importedAt })
                }
                Descending = $true
            }
        ) | Select-Object -First 1
        $Company.lastJobPostedAt = if ($latestJob) {
            $latestPostedAt = Get-ObjectValue -Object $latestJob -Name 'postedAt' -Default ''
            if ($latestPostedAt) { $latestPostedAt } else { Get-ObjectValue -Object $latestJob -Name 'importedAt' -Default $null }
        } else {
            $null
        }
        if (-not $Company.location) {
            $locations = @(
                $jobList |
                    ForEach-Object { [string](Get-ObjectValue -Object $_ -Name 'location' -Default '') } |
                    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
                    Sort-Object -Unique |
                    Select-Object -First 3
            )
            if ($locations.Count -gt 0) {
                $Company.location = [string]([string]::Join(', ', @($locations)))
            }
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

    if ($PSBoundParameters.ContainsKey('Configs')) {
        $configList = @($Configs | Where-Object { $null -ne $_ })
        $activeConfigs = @($configList | Where-Object { (Get-ObjectValue -Object $_ -Name 'active' -Default $true) -ne $false })
        $Company.atsTypes = @($activeConfigs | ForEach-Object { ([string](Get-ObjectValue -Object $_ -Name 'atsType' -Default '')).ToLowerInvariant() } | Where-Object { $_ } | Sort-Object -Unique)
        $primaryCareersUrl = @($activeConfigs | ForEach-Object { [string](Get-ObjectValue -Object $_ -Name 'careersUrl' -Default '') } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
        $primaryDomain = @($activeConfigs | ForEach-Object { [string](Get-ObjectValue -Object $_ -Name 'domain' -Default '') } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
        if ($primaryCareersUrl.Count -gt 0) {
            $Company.careersUrl = $primaryCareersUrl[0]
        } elseif (-not $Company.careersUrl) {
            $Company.careersUrl = ''
        }
        if ($primaryDomain.Count -gt 0) {
            $Company.domain = $primaryDomain[0]
        }
    } else {
        $Company.atsTypes = @(Get-StringList (Get-ObjectValue -Object $Company -Name 'atsTypes' -Default @()))
        if (-not (Get-ObjectValue -Object $Company -Name 'careersUrl' -Default '')) { $Company.careersUrl = '' }
    }

    $activitiesList = @()
    if ($PSBoundParameters.ContainsKey('Activities')) {
        $activitiesList = @($Activities | Where-Object { $null -ne $_ })
        $latestActivity = @(
            $activitiesList |
                Where-Object { (Get-ObjectValue -Object $_ -Name 'occurredAt' -Default '') } |
                Sort-Object @{ Expression = { Get-DateSortValue (Get-ObjectValue -Object $_ -Name 'occurredAt' -Default '') }; Descending = $true }
        ) | Select-Object -First 1
        if ($latestActivity) {
            $Company.lastContactedAt = Get-ObjectValue -Object $latestActivity -Name 'occurredAt' -Default $Company.lastContactedAt
            $latestStage = Resolve-ActivityPipelineStage -Activity $latestActivity
            if ($latestStage) {
                $Company.outreachStatus = $latestStage
            }
        }
        foreach ($activity in @($activitiesList)) {
            if ($null -eq $activity) { continue }
            [void](Set-ObjectValue -Object $activity -Name 'accountId' -Value ([string]$Company.id))
        }
    }

    $daysSinceContact = $null
    $lastContact = [DateTime]::MinValue
    if ($Company.lastContactedAt -and [DateTime]::TryParse([string]$Company.lastContactedAt, [ref]$lastContact)) {
        $daysSinceContact = [int][Math]::Floor(($now - $lastContact).TotalDays)
    }
    $Company.daysSinceContact = $daysSinceContact
    $Company.staleFlag = if ($null -ne $daysSinceContact -and $daysSinceContact -ge 14) { 'STALE' } else { '' }
    $Company.followUpScore = Get-FollowUpBonus -Status $Company.status -NextActionAt ([string](Get-ObjectValue -Object $Company -Name 'nextActionAt' -Default '')) -LastContactedAt ([string](Get-ObjectValue -Object $Company -Name 'lastContactedAt' -Default ''))
    $targetMetrics = Get-CompanyTargetScoreMetrics -Company $Company -Jobs $(if ($PSBoundParameters.ContainsKey('Jobs')) { $jobList } else { $null }) -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null }) -ReferenceNow $now
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
    $Company.scoreBreakdown = if ($targetMetrics.scoreBreakdown) { $targetMetrics.scoreBreakdown } else { [ordered]@{} }
    $Company.targetScoreExplanation = if ($targetMetrics.targetScoreExplanation) { $targetMetrics.targetScoreExplanation } else { [ordered]@{} }
    $Company.pipelineState = Get-AccountPipelineState -Company $Company -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null }) -ReferenceNow $now
    $Company.outreachStatus = Get-NormalizedOutreachStage ([string](Get-ObjectValue -Object $Company.pipelineState -Name 'stage' -Default $Company.outreachStatus))
    if (-not $Company.outreachStatus) { $Company.outreachStatus = 'not_started' }
    $Company.connectionGraph = Get-ConnectionGraphInsights -Company $Company -Contacts $(if ($PSBoundParameters.ContainsKey('Contacts')) { $contactList } else { $null }) -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null })
    $Company.relationshipStrengthScore = [int](Convert-ToNumber (Get-ObjectValue -Object $Company.connectionGraph -Name 'relationshipStrengthScore' -Default 0))
    $Company.sequenceState = Get-AccountSequenceState -Company $Company -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null }) -ReferenceNow $now -ConnectionGraph $Company.connectionGraph
    $Company.triggerAlerts = @(Get-CompanyTriggerAlerts -Company $Company -Jobs $(if ($PSBoundParameters.ContainsKey('Jobs')) { $jobList } else { $null }) -Contacts $(if ($PSBoundParameters.ContainsKey('Contacts')) { $contactList } else { $null }) -Activities $(if ($PSBoundParameters.ContainsKey('Activities')) { $activitiesList } else { $null }) -ReferenceNow $now)
    $Company.alertPriorityScore = if (@($Company.triggerAlerts).Count -gt 0) { [int](Convert-ToNumber (Get-ObjectValue -Object $Company.triggerAlerts[0] -Name 'priorityScore' -Default 0)) } else { 0 }
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
    $Company.recommendedAction = Get-RecommendationAction -Company $Company
    $Company.outreachDraft = Get-OutreachDraft -Company $Company
    $Company.updatedAt = $now.ToString('o')

    return $Company
}

function Sort-Companies {
    param($Companies)

    return @(
        $Companies | Sort-Object @(
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
    foreach ($job in @($State.jobs | Where-Object { $null -ne $_ })) {
        $companyKey = Get-CanonicalCompanyKey $(if ($job.normalizedCompanyName) { $job.normalizedCompanyName } else { $job.companyName })
        if (-not $companyKey) { continue }
        $job.normalizedCompanyName = $companyKey
        if (-not $jobGroups.ContainsKey($companyKey)) {
            $jobGroups[$companyKey] = New-Object System.Collections.ArrayList
        }
        [void]$jobGroups[$companyKey].Add($job)
    }

    $configGroups = @{}
    foreach ($config in @($State.boardConfigs | Where-Object { $null -ne $_ })) {
        $companyKey = Get-CanonicalCompanyKey $(if ($config.normalizedCompanyName) { $config.normalizedCompanyName } else { $config.companyName })
        if (-not $companyKey) { continue }
        $config.normalizedCompanyName = $companyKey
        if (-not $configGroups.ContainsKey($companyKey)) {
            $configGroups[$companyKey] = New-Object System.Collections.ArrayList
        }
        [void]$configGroups[$companyKey].Add($config)
    }

    $activityGroups = @{}
    foreach ($activity in @($State.activities | Where-Object { $null -ne $_ })) {
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

        $company = if ($existing) {
            $existing
        } else {
            New-CompanyProjection -WorkspaceId $State.workspace.id -NormalizedName $companyKey -DisplayName $displayName
        }
        $company.workspaceId = $State.workspace.id
        $company.normalizedName = $companyKey
        $company.displayName = $displayName
        $company = Update-CompanyProjection -Company $company -Contacts $contacts -Jobs $jobs -Configs $configs -Activities $activities

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

        $processed = $index + 1
        if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $totalCompanies -or ($ProgressInterval -gt 0 -and ($processed % $ProgressInterval) -eq 0))) {
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Recomputing company scores' -Processed $processed -Total $totalCompanies -StartedAt $startedAt -Message 'Updating target accounts and outreach signals'
        }
    }

    $State.companies = Sort-Companies -Companies @($derivedCompanies)
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Recomputing company scores' -Processed $totalCompanies -Total $totalCompanies -StartedAt $startedAt -Message 'Finished derived scoring'
    return $State
}

function Repair-AppTargetScoreRollout {
    param(
        [int]$Limit = 250,
        [switch]$Persist,
        [int]$MaxBatches = 1,
        [switch]$SkipSnapshots
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

        $deriveWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $state = Update-DerivedData -State $state
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
            })

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
        owners = @(($script:OwnerRoster | ForEach-Object { $_.displayName }) + @(Get-SortedUniqueTextValues -Map $owners) | Select-Object -Unique)
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
    $minTargetScoreQuery = [string]$Query['minTargetScore']
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
