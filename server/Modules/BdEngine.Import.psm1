Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'BdEngine.State.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BdEngine.Domain.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BdEngine.JobImport.psm1') -DisableNameChecking
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Open-XlsxContext {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    $entryMap = @{}
    foreach ($entry in $zip.Entries) {
        $entryMap[$entry.FullName] = $entry
    }

    $reader = New-Object System.IO.StreamReader($entryMap['xl/workbook.xml'].Open())
    try { $workbookXml = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }

    $reader = New-Object System.IO.StreamReader($entryMap['xl/_rels/workbook.xml.rels'].Open())
    try { $relsXml = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }

    $relMap = @{}
    foreach ($relationship in @($relsXml.SelectNodes("/*[local-name()='Relationships']/*[local-name()='Relationship']"))) {
        $relMap[$relationship.Id] = $relationship.Target
    }

    $sheetMap = @{}
    foreach ($sheet in @($workbookXml.SelectNodes("/*[local-name()='workbook']/*[local-name()='sheets']/*[local-name()='sheet']"))) {
        $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
        $target = $relMap[$rid]
        if ($target -and $target -notlike 'xl/*') {
            $target = 'xl/' + $target.Replace('../', '')
        }
        $sheetMap[$sheet.name] = $target
    }

    return [ordered]@{
        zip = $zip
        entries = $entryMap
        sheets = $sheetMap
        sharedStrings = $null
    }
}

function Close-XlsxContext {
    param($Context)
    if ($Context -and $Context.zip) {
        $Context.zip.Dispose()
    }
}

function Get-SharedStrings {
    param($Context)

    if ($Context.sharedStrings) {
        return $Context.sharedStrings
    }

    $sharedStrings = New-Object System.Collections.ArrayList
    $entry = $Context.entries['xl/sharedStrings.xml']
    if (-not $entry) {
        $Context.sharedStrings = $sharedStrings
        return $sharedStrings
    }

    $reader = [System.Xml.XmlReader]::Create($entry.Open())
    try {
        while ($reader.Read()) {
            if ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element -and $reader.LocalName -eq 'si') {
                $sub = $reader.ReadSubtree()
                $parts = New-Object System.Collections.ArrayList
                try {
                    while ($sub.Read()) {
                        if ($sub.NodeType -eq [System.Xml.XmlNodeType]::Element -and $sub.LocalName -eq 't') {
                            [void]$parts.Add($sub.ReadElementContentAsString())
                        }
                    }
                } finally {
                    $sub.Close()
                }
                [void]$sharedStrings.Add(($parts -join ''))
            }
        }
    } finally {
        $reader.Close()
    }

    $Context.sharedStrings = $sharedStrings
    return $sharedStrings
}

function Get-SheetEntry {
    param(
        [Parameter(Mandatory = $true)]
        $Context,
        [Parameter(Mandatory = $true)]
        [string]$SheetName
    )

    $target = $Context.sheets[$SheetName]
    if (-not $target) {
        throw "Worksheet '$SheetName' was not found."
    }

    return $Context.entries[$target]
}

function Convert-ColumnLettersToIndex {
    param([string]$Letters)

    $sum = 0
    foreach ($char in $Letters.ToCharArray()) {
        $sum = ($sum * 26) + ([int][char]$char - [int][char]'A' + 1)
    }
    return $sum
}

function Get-CellPayload {
    param(
        [Parameter(Mandatory = $true)]
        $CellReader,
        [Parameter(Mandatory = $true)]
        $SharedStrings
    )

    $cellReference = $CellReader.GetAttribute('r')
    $cellType = $CellReader.GetAttribute('t')
    $cellFormula = $null
    $rawValue = $null
    $inlineParts = New-Object System.Collections.ArrayList

    $sub = $CellReader.ReadSubtree()
    try {
        while ($sub.Read()) {
            if ($sub.NodeType -ne [System.Xml.XmlNodeType]::Element) {
                continue
            }

            switch ($sub.LocalName) {
                'f' {
                    $cellFormula = $sub.ReadElementContentAsString()
                    continue
                }
                'v' {
                    $rawValue = $sub.ReadElementContentAsString()
                    continue
                }
                't' {
                    if ($cellType -eq 'inlineStr') {
                        [void]$inlineParts.Add($sub.ReadElementContentAsString())
                    }
                    continue
                }
            }
        }
    } finally {
        $sub.Close()
    }

    $value = $null
    if ($cellType -eq 's' -and $rawValue -ne $null) {
        $index = [int]$rawValue
        if ($index -lt $SharedStrings.Count) {
            $value = $SharedStrings[$index]
        } else {
            $value = $rawValue
        }
    } elseif ($cellType -eq 'inlineStr') {
        $value = $inlineParts -join ''
    } elseif ($cellType -eq 'b') {
        $value = ($rawValue -eq '1')
    } else {
        $value = $rawValue
    }

    return [ordered]@{
        reference = $cellReference
        value = $value
        formula = $cellFormula
        rawValue = $rawValue
        type = $cellType
    }
}

function Read-XlsxSheetRows {
    param(
        [Parameter(Mandatory = $true)]
        $Context,
        [Parameter(Mandatory = $true)]
        [string]$SheetName,
        [int]$HeaderRow = 1
    )

    $entry = Get-SheetEntry -Context $Context -SheetName $SheetName
    $sharedStrings = Get-SharedStrings -Context $Context
    $rows = New-Object System.Collections.ArrayList
    $headers = @{}

    $reader = [System.Xml.XmlReader]::Create($entry.Open())
    try {
        while ($reader.Read()) {
            if ($reader.NodeType -ne [System.Xml.XmlNodeType]::Element -or $reader.LocalName -ne 'row') {
                continue
            }

            $rowNumber = [int]$reader.GetAttribute('r')
            $sub = $reader.ReadSubtree()
            $cellMap = @{}
            try {
                while ($sub.Read()) {
                    if ($sub.NodeType -ne [System.Xml.XmlNodeType]::Element -or $sub.LocalName -ne 'c') {
                        continue
                    }

                    $payload = Get-CellPayload -CellReader $sub -SharedStrings $sharedStrings
                    if ($payload.reference -match '^([A-Z]+)') {
                        $columnIndex = Convert-ColumnLettersToIndex -Letters $matches[1]
                        $cellMap[$columnIndex] = $payload
                    }
                }
            } finally {
                $sub.Close()
            }

            if ($rowNumber -eq $HeaderRow) {
                foreach ($key in $cellMap.Keys) {
                    $headers[$key] = ([string]$cellMap[$key].value).Trim()
                }
                continue
            }

            if ($rowNumber -lt $HeaderRow -or $headers.Count -eq 0) {
                continue
            }

            $record = [ordered]@{ _row = $rowNumber }
            $nonBlank = $false

            foreach ($columnIndex in ($headers.Keys | Sort-Object)) {
                $header = $headers[$columnIndex]
                $payload = $cellMap[$columnIndex]
                $value = if ($payload) {
                    if ($payload.value -ne $null -and $payload.value -ne '') { $payload.value } elseif ($payload.formula) { '=' + $payload.formula } else { '' }
                } else {
                    ''
                }

                if ($value -ne '') {
                    $nonBlank = $true
                }
                $record[$header] = $value
            }

            if ($nonBlank) {
                [void]$rows.Add($record)
            }
        }
    } finally {
        $reader.Close()
    }

    return $rows
}

function Get-XlsxCellValues {
    param(
        [Parameter(Mandatory = $true)]
        $Context,
        [Parameter(Mandatory = $true)]
        [string]$SheetName,
        [Parameter(Mandatory = $true)]
        [string[]]$Addresses
    )

    $targets = @{}
    foreach ($address in $Addresses) {
        $targets[$address] = $true
    }

    $entry = Get-SheetEntry -Context $Context -SheetName $SheetName
    $sharedStrings = Get-SharedStrings -Context $Context
    $values = [ordered]@{}

    $reader = [System.Xml.XmlReader]::Create($entry.Open())
    try {
        while ($reader.Read()) {
            if ($reader.NodeType -ne [System.Xml.XmlNodeType]::Element -or $reader.LocalName -ne 'c') {
                continue
            }

            $reference = $reader.GetAttribute('r')
            if (-not $targets.ContainsKey($reference)) {
                continue
            }

            $payload = Get-CellPayload -CellReader $reader -SharedStrings $sharedStrings
            if ($payload.value -ne $null -and $payload.value -ne '') {
                $values[$reference] = $payload.value
            } elseif ($payload.formula) {
                $values[$reference] = '=' + $payload.formula
            } else {
                $values[$reference] = ''
            }
        }
    } finally {
        $reader.Close()
    }

    return $values
}

function Find-ExistingSheetName {
    param(
        [Parameter(Mandatory = $true)]
        $Context,
        [Parameter(Mandatory = $true)]
        [string[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        if ($Context.sheets.Keys -contains $candidate) {
            return $candidate
        }
    }

    return $null
}

function Test-FormulaString {
    param($Value)

    if ($Value -isnot [string]) {
        return $false
    }

    return $Value.TrimStart().StartsWith('=')
}

function Get-FirstResolvedText {
    param([object[]]$Candidates)

    foreach ($candidate in $Candidates) {
        if ($null -eq $candidate) {
            continue
        }

        $text = [string]$candidate
        if ([string]::IsNullOrWhiteSpace($text) -or (Test-FormulaString $text)) {
            continue
        }

        return $text.Trim()
    }

    return ''
}

function Get-FirstResolvedNumber {
    param(
        [object[]]$Candidates,
        [double]$Default = 0
    )

    foreach ($candidate in $Candidates) {
        if ($null -eq $candidate) {
            continue
        }

        $text = [string]$candidate
        if ([string]::IsNullOrWhiteSpace($text) -or (Test-FormulaString $text)) {
            continue
        }

        $parsed = 0.0
        if ([double]::TryParse($text, [ref]$parsed)) {
            return $parsed
        }
    }

    return $Default
}

function Get-FirstResolvedDateString {
    param([object[]]$Candidates)

    foreach ($candidate in $Candidates) {
        $text = Get-FirstResolvedText -Candidates @($candidate)
        if (-not $text) {
            continue
        }

        $dateValue = Convert-ToDateString $text
        if ($dateValue) {
            return $dateValue
        }
    }

    return $null
}

function Get-YearsConnectedFromDate {
    param([string]$ConnectedOn)

    if (-not $ConnectedOn) {
        return 0
    }

    $parsed = [DateTime]::MinValue
    if (-not [DateTime]::TryParse($ConnectedOn, [ref]$parsed)) {
        return 0
    }

    return [math]::Round(((Get-Date) - $parsed).TotalDays / 365.25, 1)
}

function Test-PlaceholderJobRow {
    param($Row)

    $company = Get-FirstResolvedText -Candidates @($Row.Company)
    $notes = Get-FirstResolvedText -Candidates @($Row.Notes)

    if ($notes -match 'delete this example row') {
        return $true
    }

    if ($company -match '^paste new job-posting exports') {
        return $true
    }

    return $false
}

function Get-LinkedInCsvValue {
    param(
        [Parameter(Mandatory = $true)]
        $Row,
        [Parameter(Mandatory = $true)]
        [string[]]$Names
    )

    foreach ($property in @($Row.PSObject.Properties)) {
        $propertyKey = Normalize-TextKey $property.Name
        foreach ($name in $Names) {
            if ($propertyKey -eq (Normalize-TextKey $name)) {
                return [string]$property.Value
            }
        }
    }

    return ''
}

function Normalize-LinkedInImportText {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }

    return (($Value -replace '\s+', ' ').Trim())
}

function Normalize-LinkedInEmail {
    param([string]$Value)

    $email = (Normalize-LinkedInImportText $Value).ToLowerInvariant()
    if ($email -and $email -match '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
        return $email
    }

    return ''
}

function Normalize-LinkedInUrlKey {
    param([string]$Value)

    $url = (Normalize-LinkedInImportText $Value)
    if (-not $url) {
        return ''
    }

    if ($url -match '^linkedin\.com/') {
        $url = 'https://www.' + $url
    } elseif ($url -match '^www\.linkedin\.com/') {
        $url = 'https://' + $url
    }

    return ($url.TrimEnd('/') -replace '^http://', 'https://').ToLowerInvariant()
}

function Get-LinkedInContactDedupeKeys {
    param($Contact)

    $linkedinUrl = [string](Get-ObjectValue -Object $Contact -Name 'linkedinUrl' -Default '')
    $email = [string](Get-ObjectValue -Object $Contact -Name 'email' -Default '')
    $fullName = [string](Get-ObjectValue -Object $Contact -Name 'fullName' -Default '')
    $companyName = [string](Get-ObjectValue -Object $Contact -Name 'companyName' -Default '')
    if (-not $companyName) {
        $companyName = [string](Get-ObjectValue -Object $Contact -Name 'normalizedCompanyName' -Default '')
    }

    $nameCompany = ''
    $nameKey = Normalize-TextKey $fullName
    $companyKey = Get-CanonicalCompanyKey $companyName
    if ($nameKey -and $companyKey) {
        $nameCompany = '{0}|{1}' -f $nameKey, $companyKey
    }

    return [ordered]@{
        linkedinUrl = Normalize-LinkedInUrlKey $linkedinUrl
        email = Normalize-LinkedInEmail $email
        nameCompany = $nameCompany
    }
}

function Add-LinkedInContactToIndex {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Index,
        [Parameter(Mandatory = $true)]
        $Contact
    )

    $keys = Get-LinkedInContactDedupeKeys -Contact $Contact
    if ($keys.linkedinUrl -and -not $Index.linkedinUrl.ContainsKey($keys.linkedinUrl)) {
        $Index.linkedinUrl[$keys.linkedinUrl] = $Contact
    }
    if ($keys.email -and -not $Index.email.ContainsKey($keys.email)) {
        $Index.email[$keys.email] = $Contact
    }
    if ($keys.nameCompany -and -not $Index.nameCompany.ContainsKey($keys.nameCompany)) {
        $Index.nameCompany[$keys.nameCompany] = $Contact
    }
}

function Find-LinkedInExistingContact {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Index,
        [Parameter(Mandatory = $true)]
        $Keys
    )

    if ($Keys.linkedinUrl -and $Index.linkedinUrl.ContainsKey($Keys.linkedinUrl)) {
        return $Index.linkedinUrl[$Keys.linkedinUrl]
    }
    if ($Keys.email -and $Index.email.ContainsKey($Keys.email)) {
        return $Index.email[$Keys.email]
    }
    if ($Keys.nameCompany -and $Index.nameCompany.ContainsKey($Keys.nameCompany)) {
        return $Index.nameCompany[$Keys.nameCompany]
    }

    return $null
}

function Test-LinkedInIncomingDuplicate {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Seen,
        [Parameter(Mandatory = $true)]
        $Keys
    )

    foreach ($keyName in 'linkedinUrl', 'email', 'nameCompany') {
        $key = [string]$Keys[$keyName]
        if ($key -and $Seen[$keyName].Contains($key)) {
            return $true
        }
    }

    return $false
}

function Add-LinkedInIncomingKeys {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Seen,
        [Parameter(Mandatory = $true)]
        $Keys
    )

    foreach ($keyName in 'linkedinUrl', 'email', 'nameCompany') {
        $key = [string]$Keys[$keyName]
        if ($key) {
            [void]$Seen[$keyName].Add($key)
        }
    }
}

function New-BdConnectionsCsvImportPlan {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CsvPath,
        [Parameter(Mandatory = $true)]
        $State,
        [int]$PreviewLimit = 25
    )

    $csvContent = [System.IO.File]::ReadAllText($CsvPath)
    $csvContent = $csvContent -replace '^\uFEFF', ''
    $csvContent = $csvContent -replace '^(?:[ \t]*\r?\n)+', ''
    $rows = if ([string]::IsNullOrWhiteSpace($csvContent)) {
        @()
    } else {
        @(($csvContent -split '\r?\n') | ConvertFrom-Csv)
    }
    $contacts = New-Object System.Collections.ArrayList
    $preview = New-Object System.Collections.ArrayList
    $existingIndex = @{
        linkedinUrl = @{}
        email = @{}
        nameCompany = @{}
    }
    $seen = @{
        linkedinUrl = New-Object 'System.Collections.Generic.HashSet[string]'
        email = New-Object 'System.Collections.Generic.HashSet[string]'
        nameCompany = New-Object 'System.Collections.Generic.HashSet[string]'
    }
    $touchedIds = New-Object 'System.Collections.Generic.HashSet[string]'
    $stats = [ordered]@{
        rows = @($rows).Count
        imported = 0
        updated = 0
        skipped = 0
        failed = 0
    }

    foreach ($existingContact in @($State.contacts)) {
        Add-LinkedInContactToIndex -Index $existingIndex -Contact $existingContact
    }

    for ($index = 0; $index -lt $rows.Count; $index++) {
        $row = $rows[$index]
        $rowNumber = $index + 2

        try {
            $firstName = Normalize-LinkedInImportText (Get-LinkedInCsvValue -Row $row -Names @('First Name', 'FirstName', 'First'))
            $lastName = Normalize-LinkedInImportText (Get-LinkedInCsvValue -Row $row -Names @('Last Name', 'LastName', 'Last'))
            $fullName = Normalize-LinkedInImportText (Get-LinkedInCsvValue -Row $row -Names @('Full Name', 'Name'))
            if (-not $fullName) {
                $fullName = (('{0} {1}' -f $firstName, $lastName) -replace '\s+', ' ').Trim()
            }

            $companyName = Get-CanonicalCompanyDisplayName (Get-FirstResolvedText -Candidates @(
                (Get-LinkedInCsvValue -Row $row -Names @('Clean Company')),
                (Get-LinkedInCsvValue -Row $row -Names @('Company', 'Company Name', 'Organization'))
            ))
            $normalizedCompanyName = Get-CanonicalCompanyKey $companyName
            $title = Normalize-LinkedInImportText (Get-FirstResolvedText -Candidates @(
                (Get-LinkedInCsvValue -Row $row -Names @('Position')),
                (Get-LinkedInCsvValue -Row $row -Names @('Title', 'Job Title'))
            ))
            $email = Normalize-LinkedInEmail (Get-LinkedInCsvValue -Row $row -Names @('Email Address', 'Email', 'EmailAddress'))
            $linkedinUrl = Normalize-LinkedInImportText (Get-FirstResolvedText -Candidates @(
                (Get-LinkedInCsvValue -Row $row -Names @('URL', 'Profile URL', 'LinkedIn URL', 'LinkedIn'))
            ))
            $connectedOnRaw = Normalize-LinkedInImportText (Get-LinkedInCsvValue -Row $row -Names @('Connected On', 'ConnectedOn', 'Connected Date'))
            $connectedOn = Get-FirstResolvedDateString -Candidates @($connectedOnRaw)

            $keys = [ordered]@{
                linkedinUrl = Normalize-LinkedInUrlKey $linkedinUrl
                email = $email
                nameCompany = if ((Normalize-TextKey $fullName) -and $normalizedCompanyName) { '{0}|{1}' -f (Normalize-TextKey $fullName), $normalizedCompanyName } else { '' }
            }

            if (-not $fullName -and -not $companyName -and -not $email -and -not $linkedinUrl) {
                $stats.skipped++
                if ($preview.Count -lt $PreviewLimit) {
                    [void]$preview.Add([ordered]@{
                        rowNumber = $rowNumber
                        action = 'skipped'
                        fullName = ''
                        companyName = ''
                        title = ''
                        email = ''
                        linkedinUrl = ''
                        connectedOn = ''
                        message = 'Row did not include a name, company, email, or LinkedIn URL.'
                    })
                }
                continue
            }

            if (Test-LinkedInIncomingDuplicate -Seen $seen -Keys $keys) {
                $stats.skipped++
                if ($preview.Count -lt $PreviewLimit) {
                    [void]$preview.Add([ordered]@{
                        rowNumber = $rowNumber
                        action = 'skipped'
                        fullName = $fullName
                        companyName = $companyName
                        title = $title
                        email = $email
                        linkedinUrl = $linkedinUrl
                        connectedOn = $connectedOn
                        message = 'Duplicate row in this CSV.'
                    })
                }
                continue
            }

            Add-LinkedInIncomingKeys -Seen $seen -Keys $keys
            $existing = Find-LinkedInExistingContact -Index $existingIndex -Keys $keys
            $action = if ($existing) { 'updated' } else { 'imported' }
            $contactId = if ($existing) { [string](Get-ObjectValue -Object $existing -Name 'id' -Default '') } else { '' }
            if (-not $contactId) {
                $seed = '{0}|{1}|{2}|{3}|{4}' -f $normalizedCompanyName, $fullName, $title, $keys.linkedinUrl, $email
                $contactId = New-DeterministicId -Prefix 'con' -Seed $seed
            }

            if ($existing) {
                if (-not $firstName) { $firstName = [string](Get-ObjectValue -Object $existing -Name 'firstName' -Default '') }
                if (-not $lastName) { $lastName = [string](Get-ObjectValue -Object $existing -Name 'lastName' -Default '') }
                if (-not $fullName) { $fullName = [string](Get-ObjectValue -Object $existing -Name 'fullName' -Default '') }
                if (-not $companyName) { $companyName = [string](Get-ObjectValue -Object $existing -Name 'companyName' -Default '') }
                if (-not $normalizedCompanyName) { $normalizedCompanyName = [string](Get-ObjectValue -Object $existing -Name 'normalizedCompanyName' -Default '') }
                if (-not $title) { $title = [string](Get-ObjectValue -Object $existing -Name 'title' -Default '') }
                if (-not $linkedinUrl) { $linkedinUrl = [string](Get-ObjectValue -Object $existing -Name 'linkedinUrl' -Default '') }
                if (-not $email) { $email = [string](Get-ObjectValue -Object $existing -Name 'email' -Default '') }
                if (-not $connectedOn) { $connectedOn = [string](Get-ObjectValue -Object $existing -Name 'connectedOn' -Default '') }
            }

            $yearsConnectedRaw = Get-LinkedInCsvValue -Row $row -Names @('Years Connected')
            $companyContacts = Get-LinkedInCsvValue -Row $row -Names @('Company Contacts')
            $priorityScore = Get-LinkedInCsvValue -Row $row -Names @('Priority Score')
            $yearsConnected = Get-FirstResolvedNumber -Candidates @($yearsConnectedRaw)
            if ($yearsConnected -le 0 -and $connectedOn) {
                $yearsConnected = Get-YearsConnectedFromDate -ConnectedOn $connectedOn
            }
            $titleFlags = Get-TitleFlags -Title $title

            $contact = [ordered]@{
                id = $contactId
                workspaceId = [string](Get-ObjectValue -Object $State.workspace -Name 'id' -Default 'workspace-default')
                accountId = if ($existing) { Get-ObjectValue -Object $existing -Name 'accountId' -Default $null } else { $null }
                normalizedCompanyName = $normalizedCompanyName
                companyName = $companyName
                fullName = $fullName
                firstName = $firstName
                lastName = $lastName
                title = $title
                linkedinUrl = $linkedinUrl
                email = $email
                connectedOn = $connectedOn
                yearsConnected = $yearsConnected
                buyerFlag = $titleFlags.buyer
                seniorFlag = $titleFlags.senior
                talentFlag = $titleFlags.talent
                techFlag = $titleFlags.tech
                financeFlag = $titleFlags.finance
                companyOverlapCount = Get-FirstResolvedNumber -Candidates @($companyContacts)
                priorityScore = Get-FirstResolvedNumber -Candidates @($priorityScore)
                relevanceScore = Get-FirstResolvedNumber -Candidates @($priorityScore)
                outreachStatus = if ($existing -and (Get-ObjectValue -Object $existing -Name 'outreachStatus' -Default '')) { Get-ObjectValue -Object $existing -Name 'outreachStatus' -Default '' } else { 'not_started' }
                notes = if ($existing -and (Get-ObjectValue -Object $existing -Name 'notes' -Default '')) { Get-ObjectValue -Object $existing -Name 'notes' -Default '' } else { '' }
                createdAt = if ($existing -and (Get-ObjectValue -Object $existing -Name 'createdAt' -Default '')) { Get-ObjectValue -Object $existing -Name 'createdAt' -Default '' } else { (Get-Date).ToString('o') }
                updatedAt = (Get-Date).ToString('o')
            }

            [void]$contacts.Add($contact)
            [void]$touchedIds.Add($contactId)
            if ($action -eq 'updated') { $stats.updated++ } else { $stats.imported++ }
            if ($preview.Count -lt $PreviewLimit) {
                $message = if ($connectedOnRaw -and -not $connectedOn) { 'Connected date could not be parsed and was left blank.' } else { '' }
                [void]$preview.Add([ordered]@{
                    rowNumber = $rowNumber
                    action = $action
                    fullName = $fullName
                    companyName = $companyName
                    title = $title
                    email = $email
                    linkedinUrl = $linkedinUrl
                    connectedOn = $connectedOn
                    message = $message
                })
            }
        } catch {
            $stats.failed++
            if ($preview.Count -lt $PreviewLimit) {
                [void]$preview.Add([ordered]@{
                    rowNumber = $rowNumber
                    action = 'failed'
                    fullName = ''
                    companyName = ''
                    title = ''
                    email = ''
                    linkedinUrl = ''
                    connectedOn = ''
                    message = $_.Exception.Message
                })
            }
        }
    }

    return [ordered]@{
        contacts = @($contacts)
        touchedIds = @($touchedIds)
        preview = @($preview)
        stats = $stats
        totalRows = @($rows).Count
    }
}

function Import-BdConnectionsCsv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CsvPath,
        [string]$SourceLabel = 'linkedin-connections-csv',
        [switch]$DryRun,
        [switch]$UseEmptyState,
        [switch]$MergeExisting,
        [switch]$SkipPersistence,
        [scriptblock]$ProgressCallback
    )

    if (-not (Test-Path -LiteralPath $CsvPath)) {
        throw "CSV file not found: $CsvPath"
    }

    if ($UseEmptyState) {
        $state = [ordered]@{
            workspace = [ordered]@{ id = 'workspace-default'; name = 'Dry Run Workspace' }
            settings = New-DefaultSettings
            companies = @()
            contacts = @()
            jobs = @()
            boardConfigs = @()
            activities = @()
            importRuns = @()
        }
    } else {
        $state = Get-AppState
        if ($DryRun) {
            $state = ConvertTo-PlainObject -InputObject $state
        }
        foreach ($collectionName in 'companies', 'contacts', 'jobs', 'boardConfigs', 'activities', 'importRuns') {
            if ($null -eq $state[$collectionName]) {
                $state[$collectionName] = @()
            }
        }
    }

    $startedAt = (Get-Date).ToString('o')
    $plan = New-BdConnectionsCsvImportPlan -CsvPath $CsvPath -State $state
    $totalRows = [int]$plan.totalRows
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Parsing connections CSV' -Processed 0 -Total $totalRows -StartedAt $startedAt -Message 'Normalizing LinkedIn contacts'

    if ($ProgressCallback) {
        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Parsing connections CSV' -Processed $totalRows -Total $totalRows -StartedAt $startedAt -Message 'Normalizing LinkedIn contacts'
    }

    if ($MergeExisting) {
        $mergedContacts = New-Object System.Collections.ArrayList
        foreach ($contact in @($state.contacts)) {
            $contactId = [string](Get-ObjectValue -Object $contact -Name 'id' -Default '')
            if (-not $contactId -or -not $plan.touchedIds.Contains($contactId)) {
                [void]$mergedContacts.Add($contact)
            }
        }
        foreach ($contact in @($plan.contacts)) {
            [void]$mergedContacts.Add($contact)
        }
        $state.contacts = @($mergedContacts)
    } else {
        $state.contacts = @($plan.contacts)
    }

    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Refreshing derived data' -Processed $totalRows -Total $totalRows -StartedAt $startedAt -Message 'Recomputing target accounts from contacts'
    $state = Update-DerivedData -State $state -ProgressCallback $ProgressCallback
    $preConfigKeys = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($cfg in @($state.boardConfigs)) { $k = Get-CanonicalCompanyKey ([string]$cfg.companyName); if ($k) { [void]$preConfigKeys.Add($k) } }
    $state = Sync-BoardConfigsFromCompanies -State $state -ProgressCallback $ProgressCallback
    $postConfigTouched = @($state.boardConfigs | ForEach-Object { Get-CanonicalCompanyKey ([string]$_.companyName) } | Where-Object { $_ -and -not $preConfigKeys.Contains($_) } | Select-Object -Unique)
    $configTouchedKeys = if ($postConfigTouched.Count -gt 0) { $postConfigTouched } else { $null }
    $state = Update-DerivedData -State $state -ProgressCallback $ProgressCallback -TouchedCompanyKeys $configTouchedKeys

    $importRun = [ordered]@{
        id = New-RandomId -Prefix 'run'
        workspaceId = [string](Get-ObjectValue -Object $state.workspace -Name 'id' -Default 'workspace-default')
        type = 'connections-csv-import'
        status = if ($DryRun) { 'dry_run' } else { 'completed' }
        startedAt = $startedAt
        finishedAt = (Get-Date).ToString('o')
        summary = if ($DryRun) { "Dry-run parsed LinkedIn connections CSV from $CsvPath" } else { "Imported LinkedIn connections CSV from $CsvPath" }
        stats = [ordered]@{
            contacts = @($state.contacts).Count
            companies = @($state.companies).Count
            rows = [int]$plan.stats.rows
            imported = [int]$plan.stats.imported
            updated = [int]$plan.stats.updated
            skipped = [int]$plan.stats.skipped
            failed = [int]$plan.stats.failed
            source = $SourceLabel
        }
        metadata = [ordered]@{
            dedupeKeys = @('linkedinUrl', 'email', 'name+company')
            mergeExisting = [bool]$MergeExisting
            previewCount = @($plan.preview).Count
        }
        errors = @()
    }

    if (-not $DryRun) {
        $state.importRuns = @(@($state.importRuns) + @($importRun))
        if (-not $SkipPersistence) {
            Sync-AppStateSegments -State $state -Segments @('Contacts', 'Companies', 'BoardConfigs', 'ImportRuns')
        }
    }

    return [ordered]@{
        state = $state
        importRun = $importRun
        preview = @($plan.preview)
    }
}

function Import-BdWorkbook {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkbookPath,
        [string]$SourceLabel = 'spreadsheet-import',
        [switch]$SkipPersistence,
        [scriptblock]$ProgressCallback
    )

    $state = Get-AppState
    foreach ($collectionName in 'companies', 'contacts', 'jobs', 'boardConfigs', 'activities', 'importRuns') {
        if ($null -eq $state[$collectionName]) {
            $state[$collectionName] = @()
        }
    }
    $context = Open-XlsxContext -Path $WorkbookPath
    $startedAt = (Get-Date).ToString('o')
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Reading workbook' -StartedAt $startedAt -Message 'Opening workbook and reading sheets'

    try {
        $settingsSheetName = Find-ExistingSheetName -Context $context -Candidates @('Setup')
        if ($settingsSheetName) {
            $settingsCells = Get-XlsxCellValues -Context $context -SheetName $settingsSheetName -Addresses @('B9', 'B10', 'B11', 'B12')
            $settings = $state.settings
            $settings.minCompanyConnections = [int](Convert-ToNumber $settingsCells['B9'])
            $settings.minJobsPosted = [int](Convert-ToNumber $settingsCells['B10'])
            $settings.contactPriorityThreshold = [int](Convert-ToNumber $settingsCells['B11'])
            $settings.maxCompaniesToReview = [int](Convert-ToNumber $settingsCells['B12'])
            $settings.updatedAt = (Get-Date).ToString('o')
            $state.settings = $settings
        }

        $existingCompanies = @{}
        foreach ($company in @($state.companies)) {
            $key = Get-CanonicalCompanyKey $(if ($company.normalizedName) { $company.normalizedName } else { $company.displayName })
            if ($key) {
                $existingCompanies[$key] = $company
            }
        }

        $existingContacts = @{}
        foreach ($contact in @($state.contacts)) {
            $existingContacts[$contact.id] = $contact
        }

        $existingConfigs = @{}
        foreach ($config in @($state.boardConfigs)) {
            $existingConfigs[$config.id] = $config
        }

        $connectionsSheetName = Find-ExistingSheetName -Context $context -Candidates @('Connections')
        $connectionsRows = if ($connectionsSheetName) {
            @(Read-XlsxSheetRows -Context $context -SheetName $connectionsSheetName -HeaderRow 1)
        } else {
            @()
        }
        $contacts = New-Object System.Collections.ArrayList
        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook contacts' -Processed 0 -Total @($connectionsRows).Count -StartedAt $startedAt -Message 'Parsing Connections sheet'
        for ($rowIndex = 0; $rowIndex -lt @($connectionsRows).Count; $rowIndex++) {
            $row = $connectionsRows[$rowIndex]
            $companyName = Get-CanonicalCompanyDisplayName (Get-FirstResolvedText -Candidates @($row.'Clean Company', $row.Company))
            $normalizedCompanyName = Get-CanonicalCompanyKey $companyName
            $fullName = ('{0} {1}' -f $row.'First Name', $row.'Last Name').Trim()
            if (-not $fullName -and -not $normalizedCompanyName) {
                continue
            }

            $titleFlags = Get-TitleFlags -Title ([string]$row.Position)
            $buyerFlag = if (Get-FirstResolvedText -Candidates @($row.'Buyer Title')) { Test-Truthy $row.'Buyer Title' } else { $titleFlags.buyer }
            $seniorFlag = if (Get-FirstResolvedText -Candidates @($row.'Senior Flag')) { Test-Truthy $row.'Senior Flag' } else { $titleFlags.senior }
            $talentFlag = if (Get-FirstResolvedText -Candidates @($row.'Talent Flag')) { Test-Truthy $row.'Talent Flag' } else { $titleFlags.talent }
            $techFlag = if (Get-FirstResolvedText -Candidates @($row.'Tech Flag')) { Test-Truthy $row.'Tech Flag' } else { $titleFlags.tech }
            $financeFlag = if (Get-FirstResolvedText -Candidates @($row.'Finance Flag')) { Test-Truthy $row.'Finance Flag' } else { $titleFlags.finance }
            $connectedOn = Get-FirstResolvedDateString -Candidates @($row.'Connected On')
            $yearsConnected = Get-FirstResolvedNumber -Candidates @($row.'Years Connected')
            if ($yearsConnected -le 0 -and $connectedOn) {
                $yearsConnected = Get-YearsConnectedFromDate -ConnectedOn $connectedOn
            }

            $seed = '{0}|{1}|{2}|{3}' -f $normalizedCompanyName, $fullName, $row.Position, $row.URL
            $id = New-DeterministicId -Prefix 'con' -Seed $seed
            $existing = $existingContacts[$id]

            $contact = [ordered]@{
                id = $id
                workspaceId = $state.workspace.id
                accountId = $null
                normalizedCompanyName = $normalizedCompanyName
                companyName = $companyName
                fullName = $fullName
                firstName = [string]$row.'First Name'
                lastName = [string]$row.'Last Name'
                title = [string]$row.Position
                linkedinUrl = [string]$row.URL
                email = [string]$row.'Email Address'
                connectedOn = $connectedOn
                yearsConnected = $yearsConnected
                buyerFlag = $buyerFlag
                seniorFlag = $seniorFlag
                talentFlag = $talentFlag
                techFlag = $techFlag
                financeFlag = $financeFlag
                companyOverlapCount = Get-FirstResolvedNumber -Candidates @($row.'Company Contacts')
                priorityScore = Get-FirstResolvedNumber -Candidates @($row.'Priority Score')
                relevanceScore = Get-FirstResolvedNumber -Candidates @($row.'Priority Score')
                outreachStatus = if ($existing -and $existing.outreachStatus) { $existing.outreachStatus } else { 'not_started' }
                notes = if ($existing -and $existing.notes) { $existing.notes } else { '' }
                createdAt = if ($existing -and $existing.createdAt) { $existing.createdAt } else { (Get-Date).ToString('o') }
                updatedAt = (Get-Date).ToString('o')
            }
            [void]$contacts.Add($contact)

            $processed = $rowIndex + 1
            if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq @($connectionsRows).Count -or ($processed % 100) -eq 0)) {
                Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook contacts' -Processed $processed -Total @($connectionsRows).Count -StartedAt $startedAt -Message 'Parsing Connections sheet'
            }
        }
        $state.contacts = @($contacts)

        $configSheetName = Find-ExistingSheetName -Context $context -Candidates @('Job_Boards_Config', 'Job Boards Config')
        if ($configSheetName) {
            $configRows = Read-XlsxSheetRows -Context $context -SheetName $configSheetName -HeaderRow 1
            $configRows = @($configRows)
            $configs = New-Object System.Collections.ArrayList
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook configs' -Processed 0 -Total @($configRows).Count -StartedAt $startedAt -Message 'Parsing Job_Boards_Config sheet'
            for ($rowIndex = 0; $rowIndex -lt @($configRows).Count; $rowIndex++) {
                $row = $configRows[$rowIndex]
                $companyName = Get-CanonicalCompanyDisplayName (Get-FirstResolvedText -Candidates @($row.Company, $row.'Company Name'))
                $normalizedCompanyName = Get-CanonicalCompanyKey $companyName
                if (-not $normalizedCompanyName) {
                    continue
                }

                $atsType = Get-FirstResolvedText -Candidates @($row.ATS_Type, $row.ATS, $row.Source)
                $boardId = Get-FirstResolvedText -Candidates @($row.Board_ID, $row.'Board Id', $row.'Board ID')
                $careersUrl = Get-FirstResolvedText -Candidates @($row.Careers_URL, $row.'Careers URL')
                $seed = '{0}|{1}|{2}|{3}' -f $normalizedCompanyName, $atsType, $boardId, $careersUrl
                $id = New-DeterministicId -Prefix 'cfg' -Seed $seed
                $existing = $existingConfigs[$id]

                $config = [ordered]@{
                    id = $id
                    workspaceId = $state.workspace.id
                    accountId = $null
                    companyName = $companyName
                    normalizedCompanyName = $normalizedCompanyName
                    atsType = $atsType.ToLowerInvariant()
                    boardId = $boardId
                    domain = Get-FirstResolvedText -Candidates @($row.Domain, $row.'Company Domain')
                    careersUrl = $careersUrl
                    source = Get-FirstResolvedText -Candidates @($row.Source)
                    notes = if ($existing -and $existing.notes) { $existing.notes } elseif ($row.'Notes ') { [string]$row.'Notes ' } elseif ($row.Notes) { [string]$row.Notes } else { '' }
                    active = if (Get-FirstResolvedText -Candidates @($row.Active)) { Test-Truthy $row.Active } else { $true }
                    lastCheckedAt = Get-FirstResolvedDateString -Candidates @($row.Last_Checked, $row.'Last Checked')
                    discoveryStatus = Get-FirstResolvedText -Candidates @($row.Discovery_Status, $row.'Discovery Status')
                    discoveryMethod = Get-FirstResolvedText -Candidates @($row.Discovery_Method, $row.'Discovery Method')
                    lastImportAt = if ($existing) { $existing.lastImportAt } else { $null }
                    lastImportStatus = if ($existing) { $existing.lastImportStatus } else { '' }
                }
                [void]$configs.Add($config)

                $processed = $rowIndex + 1
                if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq @($configRows).Count -or ($processed % 100) -eq 0)) {
                    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook configs' -Processed $processed -Total @($configRows).Count -StartedAt $startedAt -Message 'Parsing Job_Boards_Config sheet'
                }
            }
            $state.boardConfigs = @($configs)
        }

        $jobSheetName = Find-ExistingSheetName -Context $context -Candidates @('Hiring_Import', 'Hiring Import')
        if ($jobSheetName) {
            $jobRows = Read-XlsxSheetRows -Context $context -SheetName $jobSheetName -HeaderRow 1
            $jobRows = @($jobRows)
            $jobs = New-Object System.Collections.ArrayList
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook jobs' -Processed 0 -Total @($jobRows).Count -StartedAt $startedAt -Message 'Parsing Hiring_Import sheet'
            for ($rowIndex = 0; $rowIndex -lt @($jobRows).Count; $rowIndex++) {
                $row = $jobRows[$rowIndex]
                if (Test-PlaceholderJobRow -Row $row) {
                    continue
                }

                $companyName = Get-CanonicalCompanyDisplayName (Get-FirstResolvedText -Candidates @($row.Company, $row.'Company Name'))
                $normalizedCompanyName = Get-CanonicalCompanyKey $companyName
                $jobTitle = Get-FirstResolvedText -Candidates @($row.'Job Title', $row.Title)
                $jobUrl = Get-FirstResolvedText -Candidates @($row.'Job URL', $row.URL)
                if (-not $normalizedCompanyName -or -not $jobTitle) {
                    continue
                }

                $location = Get-FirstResolvedText -Candidates @($row.Location)
                $atsType = Get-FirstResolvedText -Candidates @($row.ATS, $row.ATS_Type, $row.Source)
                $seed = '{0}|{1}|{2}|{3}' -f $normalizedCompanyName, (Normalize-TextKey $jobTitle), (Normalize-TextKey $location), $jobUrl
                $job = [ordered]@{
                    id = New-DeterministicId -Prefix 'job' -Seed $seed
                    workspaceId = $state.workspace.id
                    accountId = $null
                    companyName = $companyName
                    normalizedCompanyName = $normalizedCompanyName
                    title = $jobTitle
                    normalizedTitle = Normalize-TextKey $jobTitle
                    location = $location
                    department = Get-FirstResolvedText -Candidates @($row.Department, $row.Team)
                    employmentType = Get-FirstResolvedText -Candidates @($row.'Employment Type', $row.Commitment)
                    jobUrl = $jobUrl
                    sourceUrl = Get-FirstResolvedText -Candidates @($row.'Source URL', $row.URL, $row.'Job URL')
                    atsType = $atsType.ToLowerInvariant()
                    postedAt = Get-FirstResolvedDateString -Candidates @($row.'Updated At', $row.'Posted Date', $row.Date)
                    importedAt = (Get-Date).ToString('o')
                    dedupeKey = $seed
                    rawPayload = $null
                    active = $true
                    isGta = [bool]([string]$location -match 'toronto|mississauga|markham|vaughan|richmond hill|gta')
                }
                [void]$jobs.Add($job)

                $processed = $rowIndex + 1
                if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq @($jobRows).Count -or ($processed % 100) -eq 0)) {
                    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook jobs' -Processed $processed -Total @($jobRows).Count -StartedAt $startedAt -Message 'Parsing Hiring_Import sheet'
                }
            }

            $jobMap = @{}
            foreach ($job in @($jobs)) {
                if (-not $jobMap.ContainsKey($job.id)) {
                    $jobMap[$job.id] = $job
                }
            }
            $state.jobs = @($jobMap.GetEnumerator() | ForEach-Object { $_.Value })
        }

        $historySheetName = Find-ExistingSheetName -Context $context -Candidates @('History')
        $manualActivities = @($state.activities | Where-Object { $_.type -ne 'history-import' })
        if ($historySheetName) {
            $historyRows = Read-XlsxSheetRows -Context $context -SheetName $historySheetName -HeaderRow 1
            $historyRows = @($historyRows)
            $historyActivities = New-Object System.Collections.ArrayList
            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook history' -Processed 0 -Total @($historyRows).Count -StartedAt $startedAt -Message 'Parsing History sheet'
            for ($rowIndex = 0; $rowIndex -lt @($historyRows).Count; $rowIndex++) {
                $row = $historyRows[$rowIndex]
                $companyName = Get-CanonicalCompanyDisplayName (Get-FirstResolvedText -Candidates @($row.Company))
                if (-not $companyName) {
                    continue
                }

                $normalizedCompanyName = Get-CanonicalCompanyKey $companyName
                $occurredAt = Get-FirstResolvedDateString -Candidates @($row.Date, $row.'Archived On')
                $summary = Get-FirstResolvedText -Candidates @($row.Notes)
                $pipelineStage = Get-FirstResolvedText -Candidates @($row.'Pipeline Stage')
                $seed = '{0}|{1}|{2}|{3}' -f $normalizedCompanyName, $occurredAt, $summary, $pipelineStage
                $activity = [ordered]@{
                    id = New-DeterministicId -Prefix 'act' -Seed $seed
                    workspaceId = $state.workspace.id
                    accountId = $null
                    contactId = $null
                    normalizedCompanyName = $normalizedCompanyName
                    type = 'history-import'
                    summary = if ($summary) { $summary } else { 'Imported history item' }
                    notes = $summary
                    pipelineStage = $pipelineStage
                    occurredAt = if ($occurredAt) { $occurredAt } else { (Get-Date).ToString('o') }
                    metadata = [ordered]@{
                        jobsPosted = Get-FirstResolvedNumber -Candidates @($row.'Jobs Posted')
                        contacts = Get-FirstResolvedNumber -Candidates @($row.'Your Contacts')
                        source = $SourceLabel
                    }
                }
                [void]$historyActivities.Add($activity)

                $processed = $rowIndex + 1
                if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq @($historyRows).Count -or ($processed % 100) -eq 0)) {
                    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook history' -Processed $processed -Total @($historyRows).Count -StartedAt $startedAt -Message 'Parsing History sheet'
                }
            }
            $state.activities = @($manualActivities + @($historyActivities))
        } else {
            $state.activities = @($manualActivities)
        }

        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Refreshing workbook state' -StartedAt $startedAt -Message 'Recomputing accounts and config relationships'
        $state = Update-DerivedData -State $state -ProgressCallback $ProgressCallback
        $state = Sync-BoardConfigsFromCompanies -State $state -ProgressCallback $ProgressCallback

        $restoredCompanyKeys = New-Object System.Collections.ArrayList
        foreach ($company in @($state.companies)) {
            $existing = $existingCompanies[$company.normalizedName]
            if (-not $existing) {
                continue
            }

            foreach ($field in 'status', 'outreachStatus', 'priorityTier', 'notes', 'tags', 'industry', 'location', 'createdAt') {
                if ($existing.Contains($field) -and $existing[$field] -ne $null -and $existing[$field] -ne '') {
                    $company[$field] = $existing[$field]
                }
            }
            [void]$restoredCompanyKeys.Add([string]$company.normalizedName)
        }

        $restoredTouched = if ($restoredCompanyKeys.Count -gt 0) { @($restoredCompanyKeys) } else { $null }
        $state = Update-DerivedData -State $state -ProgressCallback $ProgressCallback -TouchedCompanyKeys $restoredTouched

        $importRun = [ordered]@{
            id = New-RandomId -Prefix 'run'
            workspaceId = $state.workspace.id
            type = 'spreadsheet-seed'
            status = 'completed'
            startedAt = $startedAt
            finishedAt = (Get-Date).ToString('o')
            summary = "Imported workbook seed data from $WorkbookPath"
            stats = [ordered]@{
                companies = @($state.companies).Count
                contacts = @($state.contacts).Count
                jobs = @($state.jobs).Count
                boardConfigs = @($state.boardConfigs).Count
                activities = @($state.activities).Count
            }
            errors = @()
        }

        $state.importRuns = @(@($state.importRuns) + @($importRun))
        if (-not $SkipPersistence) {
            Save-AppState -State $state
        }

        return [ordered]@{
            state = $state
            importRun = $importRun
        }
    } finally {
        Close-XlsxContext -Context $context
    }
}

Export-ModuleMember -Function *-*
