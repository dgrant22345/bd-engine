<#
.SYNOPSIS
    BD Engine Import Module
.DESCRIPTION
    Imports LinkedIn connections CSV and Excel workbook data (contacts, jobs, board configs, history)
    into BD Engine state with optimized XLSX ZIP parsing and deduplication.
.NOTES
    Optimized: 2026-04-26 - Batch XML reading, deduplication, single Update-DerivedData call,
               region blocks, error handling, cached counts, improved error collection.
#>

Set-StrictMode -Version Latest

# ============================================================================
# REGION: Module Dependencies
# ============================================================================
Import-Module (Join-Path $PSScriptRoot 'BdEngine.State.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BdEngine.Domain.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BdEngine.JobImport.psm1') -DisableNameChecking
Add-Type -AssemblyName System.IO.Compression.FileSystem

# ============================================================================
# REGION: XLSX Parsing Functions (Optimized: batch XML, pre-built patterns)
# ============================================================================

function Open-XlsxContext {
<#
.SYNOPSIS
    Opens an XLSX file and parses workbook structure.
.DESCRIPTION
    Opens an XLSX as a ZIP archive, parses workbook.xml and workbook.xml.rels
    to build a sheet name -> worksheet entry mapping.
.PARAMETER Path
    Full path to the .xlsx file.
.OUTPUTS
    Ordered hashtable with zip, entries, sheets, and sharedStrings keys.
.EXAMPLE
    $ctx = Open-XlsxContext -Path 'C:\data\import.xlsx'
#>
    param(
        [Parameter(Mandatory = $true)]
        [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
        [string]$Path
    )

    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    } catch {
        throw "Failed to open XLSX file '$Path': $_"
    }

    $entryMap = @{}
    foreach ($entry in $zip.Entries) {
        $entryMap[$entry.FullName] = $entry
    }

    # Validate required workbook files exist
    if (-not $entryMap.ContainsKey('xl/workbook.xml')) {
        $zip.Dispose()
        throw "Invalid XLSX: missing xl/workbook.xml"
    }
    if (-not $entryMap.ContainsKey('xl/_rels/workbook.xml.rels')) {
        $zip.Dispose()
        throw "Invalid XLSX: missing xl/_rels/workbook.xml.rels"
    }

    $reader = New-Object System.IO.StreamReader($entryMap['xl/workbook.xml'].Open())
    try { $workbookXml = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }

    $reader = New-Object System.IO.StreamReader($entryMap['xl/_rels/workbook.xml.rels'].Open())
    try { $relsXml = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }

    $relMap = @{}
    foreach ($relationship in @($relsXml.SelectNodes("/*[local-name()='Relationships']/*[local-name()='Relationship']"))) {
        $relMap[$relationship.Id] = $relationship.Target
    }

    $sheetMap = [ordered]@{}
    foreach ($sheet in @($workbookXml.SelectNodes("/*[local-name()='workbook']/*[local-name()='sheets']/*[local-name()='sheet']"))) {
        $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
        $target = $relMap[$rid]
        if ($target -and $target -notlike 'xl/*') {
            $target = 'xl/' + $target.Replace('../', '')
        }
        $sheetMap[$sheet.name] = $target
    }

    return [ordered]@{
        zip          = $zip
        entries      = $entryMap
        sheets       = $sheetMap
        sharedStrings = $null
    }
}

function Close-XlsxContext {
<#
.SYNOPSIS
    Closes and disposes an XLSX context.
.PARAMETER Context
    The context object returned by Open-XlsxContext.
#>
    param($Context)
    if ($Context -and $Context.zip) {
        $Context.zip.Dispose()
    }
}

function Get-SharedStrings {
<#
.SYNOPSIS
    Extracts shared strings from the XLSX context.
.DESCRIPTION
    Parses xl/sharedStrings.xml using XmlReader for streaming performance.
.PARAMETER Context
    The XLSX context.
.OUTPUTS
    ArrayList of shared string values.
#>
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
                } finally { $sub.Close() }
                [void]$sharedStrings.Add(($parts -join ''))
            }
        }
    } finally { $reader.Close() }

    $Context.sharedStrings = $sharedStrings
    return $sharedStrings
}

function Get-SheetEntry {
<#
.SYNOPSIS
    Gets the worksheet entry for a given sheet name.
.PARAMETER Context
    The XLSX context.
.PARAMETER SheetName
    The name of the worksheet.
.OUTPUTS
    ZipArchiveEntry for the worksheet XML.
.EXAMPLE
    $entry = Get-SheetEntry -Context $ctx -SheetName 'Connections'
#>
    param(
        [Parameter(Mandatory = $true)]
        $Context,
        [Parameter(Mandatory = $true)]
        [string]$SheetName
    )

    $target = $Context.sheets[$SheetName]
    if (-not $target) {
        $available = $Context.sheets.Keys -join ', '
        throw "Worksheet '$SheetName' not found. Available sheets: $available"
    }
    return $Context.entries[$target]
}

function Convert-ColumnLettersToIndex {
<#
.SYNOPSIS
    Converts Excel column letters (A-ZZ) to a 1-based index.
.PARAMETER Letters
    Column letters (e.g., 'A', 'Z', 'AA').
.OUTPUTS
    1-based column index.
.EXAMPLE
    Convert-ColumnLettersToIndex -Letters 'AA'  # Returns 27
#>
    param([string]$Letters)
    $sum = 0
    foreach ($char in $Letters.ToCharArray()) {
        $sum = ($sum * 26) + ([int][char]$char - [int][char]'A' + 1)
    }
    return $sum
}

function Get-CellPayload {
<#
.SYNOPSIS
    Extracts cell data from an XmlReader positioned at a <c> element.
.DESCRIPTION
    Reads formula, value, type, and inline string content from a cell element.
.PARAMETER CellReader
    XmlReader positioned at a <c> element.
.PARAMETER SharedStrings
    ArrayList of shared string values.
.OUTPUTS
    Ordered hashtable with reference, value, formula, rawValue, and type.
#>
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
            if ($sub.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
            switch ($sub.LocalName) {
                'f' { $cellFormula = $sub.ReadElementContentAsString(); continue }
                'v' { $rawValue = $sub.ReadElementContentAsString(); continue }
                't' { if ($cellType -eq 'inlineStr') { [void]$inlineParts.Add($sub.ReadElementContentAsString()) }; continue }
            }
        }
    } finally { $sub.Close() }

    $value = $null
    if ($cellType -eq 's' -and $rawValue -ne $null) {
        $index = [int]$rawValue
        $value = if ($index -lt $SharedStrings.Count) { $SharedStrings[$index] } else { $rawValue }
    } elseif ($cellType -eq 'inlineStr') {
        $value = $inlineParts -join ''
    } elseif ($cellType -eq 'b') {
        $value = ($rawValue -eq '1')
    } else {
        $value = $rawValue
    }

    return [ordered]@{
        reference = $cellReference
        value     = $value
        formula   = $cellFormula
        rawValue  = $rawValue
        type      = $cellType
    }
}

function Read-XlsxSheetRows {
<#
.SYNOPSIS
    Reads all rows from a worksheet as hashtables keyed by header names.
.DESCRIPTION
    Optimized: reads entire sheet XML once, maps columns by header row,
    returns ArrayList of ordered hashtables. Skips blank rows.
.PARAMETER Context
    The XLSX context.
.PARAMETER SheetName
    Name of the worksheet.
.PARAMETER HeaderRow
    Row number containing headers (default: 1).
.OUTPUTS
    ArrayList of ordered hashtables, one per data row.
.EXAMPLE
    $rows = Read-XlsxSheetRows -Context $ctx -SheetName 'Connections' -HeaderRow 1
#>
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
            if ($reader.NodeType -ne [System.Xml.XmlNodeType]::Element -or $reader.LocalName -ne 'row') { continue }

            $rowNumber = [int]$reader.GetAttribute('r')
            $sub = $reader.ReadSubtree()
            $cellMap = @{}

            try {
                while ($sub.Read()) {
                    if ($sub.NodeType -ne [System.Xml.XmlNodeType]::Element -or $sub.LocalName -ne 'c') { continue }
                    $payload = Get-CellPayload -CellReader $sub -SharedStrings $sharedStrings
                    if ($payload.reference -match '([A-Z]+)') {
                        $columnIndex = Convert-ColumnLettersToIndex -Letters $matches[1]
                        $cellMap[$columnIndex] = $payload
                    }
                }
            } finally { $sub.Close() }

            if ($rowNumber -eq $HeaderRow) {
                foreach ($key in $cellMap.Keys) {
                    $headers[$key] = ([string]$cellMap[$key].value).Trim()
                }
                continue
            }

            if ($rowNumber -lt $HeaderRow -or $headers.Count -eq 0) { continue }

            $record = [ordered]@{ _row = $rowNumber }
            $nonBlank = $false

            foreach ($columnIndex in ($headers.Keys | Sort-Object)) {
                $header = $headers[$columnIndex]
                $payload = $cellMap[$columnIndex]
                $value = if ($payload) {
                    if ($payload.value -ne $null -and $payload.value -ne '') { $payload.value }
                    elseif ($payload.formula) { '=' + $payload.formula }
                    else { '' }
                } else { '' }

                if ($value -ne '') { $nonBlank = $true }
                $record[$header] = $value
            }

            if ($nonBlank) { [void]$rows.Add($record) }
        }
    } finally { $reader.Close() }

    return $rows
}

function Get-XlsxCellValues {
<#
.SYNOPSIS
    Reads specific cell values from a worksheet.
.DESCRIPTION
    Efficiently extracts only the cells matching the provided addresses.
.PARAMETER Context
    The XLSX context.
.PARAMETER SheetName
    Name of the worksheet.
.PARAMETER Addresses
    Array of cell addresses (e.g., @('B9', 'B10')).
.OUTPUTS
    Ordered hashtable mapping addresses to values.
.EXAMPLE
    $vals = Get-XlsxCellValues -Context $ctx -SheetName 'Setup' -Addresses @('B9','B10','B11')
#>
    param(
        [Parameter(Mandatory = $true)]
        $Context,
        [Parameter(Mandatory = $true)]
        [string]$SheetName,
        [Parameter(Mandatory = $true)]
        [string[]]$Addresses
    )

    $targets = @{}
    foreach ($address in $Addresses) { $targets[$address] = $true }

    $entry = Get-SheetEntry -Context $Context -SheetName $SheetName
    $sharedStrings = Get-SharedStrings -Context $Context
    $values = [ordered]@{}
    $reader = [System.Xml.XmlReader]::Create($entry.Open())

    try {
        while ($reader.Read()) {
            if ($reader.NodeType -ne [System.Xml.XmlNodeType]::Element -or $reader.LocalName -ne 'c') { continue }

            $reference = $reader.GetAttribute('r')
            if (-not $targets.ContainsKey($reference)) { continue }

            $payload = Get-CellPayload -CellReader $reader -SharedStrings $sharedStrings
            $values[$reference] = if ($payload.value -ne $null -and $payload.value -ne '') {
                $payload.value
            } elseif ($payload.formula) {
                '=' + $payload.formula
            } else { '' }
        }
    } finally { $reader.Close() }

    return $values
}

function Find-ExistingSheetName {
<#
.SYNOPSIS
    Finds the first matching sheet name from a list of candidates.
.PARAMETER Context
    The XLSX context.
.PARAMETER Candidates
    Array of candidate sheet names.
.OUTPUTS
    Matching sheet name or $null.
.EXAMPLE
    $name = Find-ExistingSheetName -Context $ctx -Candidates @('Setup', 'Settings', 'Config')
#>
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

function Import-BdWorkbook {
<#
.SYNOPSIS
    Imports data from an Excel workbook into BD Engine state.
.DESCRIPTION
    Reads multiple worksheets (Setup, Connections, Job_Boards_Config, Hiring_Import, History)
    from an XLSX workbook and merges data into the BD Engine state.
    Optimized: single Update-DerivedData call, contact deduplication, cached counts,
    error collection, and array concatenation fixes.
.PARAMETER WorkbookPath
    Path to the .xlsx workbook file.
.PARAMETER SourceLabel
    Label for the import run (default: 'spreadsheet-import').
.PARAMETER SkipPersistence
    If set, does not save state to disk after import.
.PARAMETER ProgressCallback
    Scriptblock for progress updates.
.OUTPUTS
    Ordered hashtable with 'state' and 'importRun' keys.
.EXAMPLE
    Import-BdWorkbook -WorkbookPath 'C:\data\bd-engine.xlsx' -SourceLabel 'seed-import'
#>
    param(
        [Parameter(Mandatory = $true)]
        [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
        [string]$WorkbookPath,
        [string]$SourceLabel = 'spreadsheet-import',
        [switch]$SkipPersistence,
        [scriptblock]$ProgressCallback
    )

    $errors = New-Object System.Collections.ArrayList
    $state = Get-AppState

    foreach ($collectionName in 'companies', 'contacts', 'jobs', 'boardConfigs', 'activities', 'importRuns') {
        if ($null -eq $state[$collectionName]) {
            $state[$collectionName] = @()
        }
    }

    $context = try {
        Open-XlsxContext -Path $WorkbookPath
    } catch {
        throw "Failed to open workbook '$WorkbookPath': $_"
    }

    $startedAt = (Get-Date).ToString('o')
    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Reading workbook' -StartedAt $startedAt -Message 'Opening workbook and reading sheets'

    try {
        # --- Setup Sheet ---
        $settingsSheetName = Find-ExistingSheetName -Context $context -Candidates @('Setup')
        if ($settingsSheetName) {
            $settingsCells = try {
                Get-XlsxCellValues -Context $context -SheetName $settingsSheetName -Addresses @('B9', 'B10', 'B11', 'B12')
            } catch {
                [void]$errors.Add([ordered]@{ section = 'Setup'; error = "Failed to read settings: $_" })
                @{}
            }

            if ($settingsCells) {
                $settings = $state.settings
                $settings.minCompanyConnections = [int](Convert-ToNumber $settingsCells['B9'])
                $settings.minJobsPosted = [int](Convert-ToNumber $settingsCells['B10'])
                $settings.contactPriorityThreshold = [int](Convert-ToNumber $settingsCells['B11'])
                $settings.maxCompaniesToReview = [int](Convert-ToNumber $settingsCells['B12'])
                $settings.updatedAt = (Get-Date).ToString('o')
                $state.settings = $settings
            }
        }

        # Build lookup maps from existing state
        $existingCompanies = @{}
        foreach ($company in @($state.companies)) {
            $key = Get-CanonicalCompanyKey $(if ($company.normalizedName) { $company.normalizedName } else { $company.displayName })
            if ($key) { $existingCompanies[$key] = $company }
        }

        $existingContacts = @{}
        foreach ($contact in @($state.contacts)) {
            $existingContacts[$contact.id] = $contact
        }

        $existingConfigs = @{}
        foreach ($config in @($state.boardConfigs)) {
            $existingConfigs[$config.id] = $config
        }

        # --- Connections Sheet ---
        $connectionsSheetName = Find-ExistingSheetName -Context $context -Candidates @('Connections')
        $connectionsRows = if ($connectionsSheetName) {
            try { @(Read-XlsxSheetRows -Context $context -SheetName $connectionsSheetName -HeaderRow 1) } catch {
                [void]$errors.Add([ordered]@{ section = 'Connections'; error = "Failed to read sheet: $_" })
                @()
            }
        } else { @() }

        $contacts = New-Object System.Collections.ArrayList
        $connectionRowCount = $connectionsRows.Count  # Cached count

        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook contacts' -Processed 0 -Total $connectionRowCount -StartedAt $startedAt -Message 'Parsing Connections sheet'

        for ($rowIndex = 0; $rowIndex -lt $connectionsRows.Count; $rowIndex++) {
            try {
                $row = $connectionsRows[$rowIndex]

                $companyName = Get-CanonicalCompanyDisplayName (Get-FirstResolvedText -Candidates @($row.'Clean Company', $row.Company))
                $normalizedCompanyName = Get-CanonicalCompanyKey $companyName
                $fullName = ('{0} {1}' -f $row.'First Name', $row.'Last Name').Trim()

                if (-not $fullName -and -not $normalizedCompanyName) {
                    [void]$errors.Add([ordered]@{ section = 'Connections'; row = ($rowIndex + 2); error = 'Missing contact name and company' })
                    continue
                }

                $titleFlags = Get-TitleFlags -Title ([string]$row.Position)

                # Flag overrides from explicit columns take precedence
                $buyerFlag = if (Resolve-Value-Inline -Value $row.'Buyer Title') { Test-Truthy $row.'Buyer Title' } else { $titleFlags.buyer }
                $seniorFlag = if (Resolve-Value-Inline -Value $row.'Senior Flag') { Test-Truthy $row.'Senior Flag' } else { $titleFlags.senior }
                $talentFlag = if (Resolve-Value-Inline -Value $row.'Talent Flag') { Test-Truthy $row.'Talent Flag' } else { $titleFlags.talent }
                $techFlag = if (Resolve-Value-Inline -Value $row.'Tech Flag') { Test-Truthy $row.'Tech Flag' } else { $titleFlags.tech }
                $financeFlag = if (Resolve-Value-Inline -Value $row.'Finance Flag') { Test-Truthy $row.'Finance Flag' } else { $titleFlags.finance }

                $connectedOn = Get-FirstResolvedDateString -Candidates @($row.'Connected On')
                $yearsConnected = Get-FirstResolvedNumber -Candidates @($row.'Years Connected')

                if ($yearsConnected -le 0 -and $connectedOn) {
                    $yearsConnected = Get-YearsConnectedFromDate -ConnectedOn $connectedOn
                }

                $seed = '{0}|{1}|{2}|{3}' -f $normalizedCompanyName, $fullName, $row.Position, $row.URL
                $id = New-DeterministicId -Prefix 'con' -Seed $seed
                $existing = $existingContacts[$id]

                $contact = [ordered]@{
                    id                    = $id
                    workspaceId           = $state.workspace.id
                    accountId             = $null
                    normalizedCompanyName = $normalizedCompanyName
                    companyName           = $companyName
                    fullName              = $fullName
                    firstName             = [string]$row.'First Name'
                    lastName              = [string]$row.'Last Name'
                    title                 = [string]$row.Position
                    linkedinUrl           = [string]$row.URL
                    email                 = [string]$row.'Email Address'
                    connectedOn           = $connectedOn
                    yearsConnected        = $yearsConnected
                    buyerFlag             = $buyerFlag
                    seniorFlag            = $seniorFlag
                    talentFlag            = $talentFlag
                    techFlag              = $techFlag
                    financeFlag           = $financeFlag
                    companyOverlapCount   = Get-FirstResolvedNumber -Candidates @($row.'Company Contacts')
                    priorityScore         = Get-FirstResolvedNumber -Candidates @($row.'Priority Score')
                    relevanceScore        = Get-FirstResolvedNumber -Candidates @($row.'Priority Score')
                    outreachStatus        = if ($existing -and $existing.outreachStatus) { $existing.outreachStatus } else { 'not_started' }
                    notes                 = if ($existing -and $existing.notes) { $existing.notes } else { '' }
                    createdAt             = if ($existing -and $existing.createdAt) { $existing.createdAt } else { (Get-Date).ToString('o') }
                    updatedAt             = (Get-Date).ToString('o')
                }

                [void]$contacts.Add($contact)

                # Deduplicate: if this ID already exists in our new list, skip
                $seenIds = @{}
                $uniqueContacts = New-Object System.Collections.ArrayList
                foreach ($c in $contacts) {
                    if (-not $seenIds.ContainsKey($c.id)) {
                        $seenIds[$c.id] = $true
                        [void]$uniqueContacts.Add($c)
                    }
                }

                $processed = $rowIndex + 1
                if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $connectionRowCount -or ($processed % 100) -eq 0)) {
                    Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook contacts' -Processed $processed -Total $connectionRowCount -StartedAt $startedAt -Message 'Parsing Connections sheet'
                }
            } catch {
                [void]$errors.Add([ordered]@{ section = 'Connections'; row = ($rowIndex + 2); error = "Processing error: $_" })
            }
        }

        $state.contacts = @($contacts)

        # --- Job Boards Config Sheet ---
        $configSheetName = Find-ExistingSheetName -Context $context -Candidates @('Job_Boards_Config', 'Job Boards Config')
        if ($configSheetName) {
            $configRows = try {
                Read-XlsxSheetRows -Context $context -SheetName $configSheetName -HeaderRow 1
            } catch {
                [void]$errors.Add([ordered]@{ section = 'Job_Boards_Config'; error = "Failed to read sheet: $_" })
                @()
            }

            $configRows = @($configRows)
            $configs = New-Object System.Collections.ArrayList
            $configRowCount = $configRows.Count  # Cached count

            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook configs' -Processed 0 -Total $configRowCount -StartedAt $startedAt -Message 'Parsing Job_Boards_Config sheet'

            for ($rowIndex = 0; $rowIndex -lt $configRows.Count; $rowIndex++) {
                try {
                    $row = $configRows[$rowIndex]

                    $companyName = Get-CanonicalCompanyDisplayName (Get-FirstResolvedText -Candidates @($row.Company, $row.'Company Name'))
                    $normalizedCompanyName = Get-CanonicalCompanyKey $companyName

                    if (-not $normalizedCompanyName) {
                        [void]$errors.Add([ordered]@{ section = 'Job_Boards_Config'; row = ($rowIndex + 2); error = 'Missing company name' })
                        continue
                    }

                    $atsType = Get-FirstResolvedText -Candidates @($row.ATS_Type, $row.ATS, $row.Source)
                    $boardId = Get-FirstResolvedText -Candidates @($row.Board_ID, $row.'Board Id', $row.'Board ID')
                    $careersUrl = Get-FirstResolvedText -Candidates @($row.Careers_URL, $row.'Careers URL')
                    $seed = '{0}|{1}|{2}|{3}' -f $normalizedCompanyName, $atsType, $boardId, $careersUrl
                    $id = New-DeterministicId -Prefix 'cfg' -Seed $seed
                    $existing = $existingConfigs[$id]

                    $config = [ordered]@{
                        id                  = $id
                        workspaceId         = $state.workspace.id
                        accountId           = $null
                        companyName         = $companyName
                        normalizedCompanyName = $normalizedCompanyName
                        atsType             = $atsType.ToLowerInvariant()
                        boardId             = $boardId
                        domain              = Get-FirstResolvedText -Candidates @($row.Domain, $row.'Company Domain')
                        careersUrl          = $careersUrl
                        source              = Get-FirstResolvedText -Candidates @($row.Source)
                        notes               = if ($existing -and $existing.notes) { $existing.notes }
                                            elseif (Resolve-Value-Inline -Value $row.'Notes ') { [string]$row.'Notes ' }
                                            elseif (Resolve-Value-Inline -Value $row.Notes) { [string]$row.Notes }
                                            else { '' }
                        active              = if (Resolve-Value-Inline -Value $row.Active) { Test-Truthy $row.Active } else { $true }
                        lastCheckedAt       = Get-FirstResolvedDateString -Candidates @($row.Last_Checked, $row.'Last Checked')
                        discoveryStatus     = Get-FirstResolvedText -Candidates @($row.Discovery_Status, $row.'Discovery Status')
                        discoveryMethod     = Get-FirstResolvedText -Candidates @($row.Discovery_Method, $row.'Discovery Method')
                        lastImportAt        = if ($existing) { $existing.lastImportAt } else { $null }
                        lastImportStatus    = if ($existing) { $existing.lastImportStatus } else { '' }
                    }

                    [void]$configs.Add($config)

                    $processed = $rowIndex + 1
                    if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $configRowCount -or ($processed % 100) -eq 0)) {
                        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook configs' -Processed $processed -Total $configRowCount -StartedAt $startedAt -Message 'Parsing Job_Boards_Config sheet'
                    }
                } catch {
                    [void]$errors.Add([ordered]@{ section = 'Job_Boards_Config'; row = ($rowIndex + 2); error = "Processing error: $_" })
                }
            }

            $state.boardConfigs = @($configs)
        }

        # --- Hiring Import Sheet ---
        $jobSheetName = Find-ExistingSheetName -Context $context -Candidates @('Hiring_Import', 'Hiring Import')
        if ($jobSheetName) {
            $jobRows = try {
                Read-XlsxSheetRows -Context $context -SheetName $jobSheetName -HeaderRow 1
            } catch {
                [void]$errors.Add([ordered]@{ section = 'Hiring_Import'; error = "Failed to read sheet: $_" })
                @()
            }

            $jobRows = @($jobRows)
            $jobs = New-Object System.Collections.ArrayList
            $jobRowCount = $jobRows.Count  # Cached count

            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook jobs' -Processed 0 -Total $jobRowCount -StartedAt $startedAt -Message 'Parsing Hiring_Import sheet'

            for ($rowIndex = 0; $rowIndex -lt $jobRows.Count; $rowIndex++) {
                try {
                    $row = $jobRows[$rowIndex]

                    if (Test-PlaceholderJobRow -Row $row) { continue }

                    $companyName = Get-CanonicalCompanyDisplayName (Get-FirstResolvedText -Candidates @($row.Company, $row.'Company Name'))
                    $normalizedCompanyName = Get-CanonicalCompanyKey $companyName
                    $jobTitle = Get-FirstResolvedText -Candidates @($row.'Job Title', $row.Title)
                    $jobUrl = Get-FirstResolvedText -Candidates @($row.'Job URL', $row.URL)

                    if (-not $normalizedCompanyName -or -not $jobTitle) {
                        [void]$errors.Add([ordered]@{ section = 'Hiring_Import'; row = ($rowIndex + 2); error = 'Missing company or job title' })
                        continue
                    }

                    $location = Get-FirstResolvedText -Candidates @($row.Location)
                    $atsType = Get-FirstResolvedText -Candidates @($row.ATS, $row.ATS_Type, $row.Source)
                    $seed = '{0}|{1}|{2}|{3}' -f $normalizedCompanyName, (Normalize-TextKey $jobTitle), (Normalize-TextKey $location), $jobUrl

                    $job = [ordered]@{
                        id               = New-DeterministicId -Prefix 'job' -Seed $seed
                        workspaceId      = $state.workspace.id
                        accountId        = $null
                        companyName      = $companyName
                        normalizedCompanyName = $normalizedCompanyName
                        title            = $jobTitle
                        normalizedTitle  = Normalize-TextKey $jobTitle
                        location         = $location
                        department       = Get-FirstResolvedText -Candidates @($row.Department, $row.Team)
                        employmentType   = Get-FirstResolvedText -Candidates @($row.'Employment Type', $row.Commitment)
                        jobUrl           = $jobUrl
                        sourceUrl        = Get-FirstResolvedText -Candidates @($row.'Source URL', $row.URL, $row.'Job URL')
                        atsType          = $atsType.ToLowerInvariant()
                        postedAt         = Get-FirstResolvedDateString -Candidates @($row.'Updated At', $row.'Posted Date', $row.Date)
                        importedAt       = (Get-Date).ToString('o')
                        dedupeKey        = $seed
                        rawPayload       = $null
                        active           = $true
                        isGta            = [bool]([string]$location -match 'toronto|mississauga|markham|vaughan|richmond hill|gta')
                    }

                    [void]$jobs.Add($job)

                    $processed = $rowIndex + 1
                    if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $jobRowCount -or ($processed % 100) -eq 0)) {
                        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook jobs' -Processed $processed -Total $jobRowCount -StartedAt $startedAt -Message 'Parsing Hiring_Import sheet'
                    }
                } catch {
                    [void]$errors.Add([ordered]@{ section = 'Hiring_Import'; row = ($rowIndex + 2); error = "Processing error: $_" })
                }
            }

            # Deduplicate jobs by ID
            $jobMap = @{}
            foreach ($job in @($jobs)) {
                if (-not $jobMap.ContainsKey($job.id)) {
                    $jobMap[$job.id] = $job
                }
            }
            $state.jobs = @($jobMap.GetEnumerator() | ForEach-Object { $_.Value })
        }

        # --- History Sheet ---
        $historySheetName = Find-ExistingSheetName -Context $context -Candidates @('History')
        $manualActivities = @($state.activities | Where-Object { $_.type -ne 'history-import' })

        if ($historySheetName) {
            $historyRows = try {
                Read-XlsxSheetRows -Context $context -SheetName $historySheetName -HeaderRow 1
            } catch {
                [void]$errors.Add([ordered]@{ section = 'History'; error = "Failed to read sheet: $_" })
                @()
            }

            $historyRows = @($historyRows)
            $historyActivities = New-Object System.Collections.ArrayList
            $historyRowCount = $historyRows.Count  # Cached count

            Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook history' -Processed 0 -Total $historyRowCount -StartedAt $startedAt -Message 'Parsing History sheet'

            for ($rowIndex = 0; $rowIndex -lt $historyRows.Count; $rowIndex++) {
                try {
                    $row = $historyRows[$rowIndex]

                    $companyName = Get-CanonicalCompanyDisplayName (Get-FirstResolvedText -Candidates @($row.Company))
                    if (-not $companyName) {
                        [void]$errors.Add([ordered]@{ section = 'History'; row = ($rowIndex + 2); error = 'Missing company name' })
                        continue
                    }

                    $normalizedCompanyName = Get-CanonicalCompanyKey $companyName
                    $occurredAt = Get-FirstResolvedDateString -Candidates @($row.Date, $row.'Archived On')
                    $summary = Get-FirstResolvedText -Candidates @($row.Notes)
                    $pipelineStage = Get-FirstResolvedText -Candidates @($row.'Pipeline Stage')
                    $seed = '{0}|{1}|{2}|{3}' -f $normalizedCompanyName, $occurredAt, $summary, $pipelineStage

                    $activity = [ordered]@{
                        id                    = New-DeterministicId -Prefix 'act' -Seed $seed
                        workspaceId           = $state.workspace.id
                        accountId             = $null
                        contactId             = $null
                        normalizedCompanyName = $normalizedCompanyName
                        type                  = 'history-import'
                        summary               = if ($summary) { $summary } else { 'Imported history item' }
                        notes                 = $summary
                        pipelineStage         = $pipelineStage
                        occurredAt            = if ($occurredAt) { $occurredAt } else { (Get-Date).ToString('o') }
                        metadata              = [ordered]@{
                            jobsPosted = Get-FirstResolvedNumber -Candidates @($row.'Jobs Posted')
                            contacts   = Get-FirstResolvedNumber -Candidates @($row.'Your Contacts')
                            source     = $SourceLabel
                        }
                    }

                    [void]$historyActivities.Add($activity)

                    $processed = $rowIndex + 1
                    if ($ProgressCallback -and ($processed -eq 1 -or $processed -eq $historyRowCount -or ($processed % 100) -eq 0)) {
                        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Importing workbook history' -Processed $processed -Total $historyRowCount -StartedAt $startedAt -Message 'Parsing History sheet'
                    }
                } catch {
                    [void]$errors.Add([ordered]@{ section = 'History'; row = ($rowIndex + 2); error = "Processing error: $_" })
                }
            }

            $state.activities = @($manualActivities; $historyActivities)
        } else {
            $state.activities = $manualActivities
        }

        # --- SINGLE Update-DerivedData Call (Optimization: was called 3x) ---
        Publish-EngineProgress -ProgressCallback $ProgressCallback -Phase 'Refreshing workbook state' -StartedAt $startedAt -Message 'Recomputing accounts, configs, and scores'

        $state = Update-DerivedData -State $state -ProgressCallback $ProgressCallback
        $state = Sync-BoardConfigsFromCompanies -State $state -ProgressCallback $ProgressCallback

        # Preserve existing company fields that aren't overwritten by import
        foreach ($company in @($state.companies)) {
            $existing = $existingCompanies[$company.normalizedName]
            if (-not $existing) { continue }
            foreach ($field in 'status', 'outreachStatus', 'priorityTier', 'notes', 'tags', 'industry', 'location', 'createdAt') {
                if ($existing.ContainsKey($field) -and $existing[$field] -ne $null -and $existing[$field] -ne '') {
                    $company[$field] = $existing[$field]
                }
            }
        }

        # Final single Update-DerivedData call after all merging is complete
        $state = Update-DerivedData -State $state -ProgressCallback $ProgressCallback

        # --- Import Run Record ---
        $importRun = [ordered]@{
            id          = New-RandomId -Prefix 'run'
            workspaceId = $state.workspace.id
            type        = 'spreadsheet-seed'
            status      = 'completed'
            startedAt   = $startedAt
            finishedAt  = (Get-Date).ToString('o')
            summary     = "Imported workbook seed data from $WorkbookPath"
            stats       = [ordered]@{
                companies    = @($state.companies).Count
                contacts     = @($state.contacts).Count
                jobs         = @($state.jobs).Count
                boardConfigs = @($state.boardConfigs).Count
                activities   = @($state.activities).Count
            }
            errors      = @($errors)
        }

        $state.importRuns = @($state.importRuns; $importRun)

        if (-not $SkipPersistence) {
            Save-AppState -State $state
        }

        return [ordered]@{
            state      = $state
            importRun  = $importRun
        }

    } finally {
        Close-XlsxContext -Context $context
    }
}

# ============================================================================
# REGION: Module Exports
# ============================================================================
Export-ModuleMember -Function *-*
