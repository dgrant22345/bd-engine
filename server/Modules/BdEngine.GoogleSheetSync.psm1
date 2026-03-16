Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'BdEngine.GoogleSheets.psm1') -DisableNameChecking

function Convert-ToSheetDateText {
    param($Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return ''
    }

    $parsed = [datetime]::MinValue
    if ([datetime]::TryParse([string]$Value, [ref]$parsed)) {
        return $parsed.ToString('yyyy-MM-dd')
    }

    return [string]$Value
}

function Convert-ToSheetDateTimeText {
    param($Value)

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return ''
    }

    $parsed = [datetime]::MinValue
    if ([datetime]::TryParse([string]$Value, [ref]$parsed)) {
        return $parsed.ToString('yyyy-MM-dd HH:mm:ss')
    }

    return [string]$Value
}

function Convert-ToSafeSheetCell {
    param($Value)

    $text = [string]$Value
    $text = $text.Replace("`r", ' ').Replace("`n", ' ').Replace("`t", ' ')
    $text = $text.Replace([char]0x201C, '"').Replace([char]0x201D, '"').Replace([char]0x2018, "'").Replace([char]0x2019, "'")
    return $text.Trim()
}

function Write-GoogleSheetTab {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId,
        [Parameter(Mandatory = $true)]
        [string]$SheetName,
        [Parameter(Mandatory = $true)]
        [string]$EndColumn,
        [Parameter(Mandatory = $true)]
        [object[]]$Rows
    )

    Ensure-GoogleSheetExists -SpreadsheetId $SpreadsheetId -SheetName $SheetName | Out-Null
    Clear-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range ("'{0}'!A:{1}" -f $SheetName, $EndColumn) | Out-Null

    if (-not $Rows -or $Rows.Count -eq 0) {
        return 0
    }

    $chunkSize = 500
    $offset = 0
    while ($offset -lt $Rows.Count) {
        $take = [Math]::Min($chunkSize, $Rows.Count - $offset)
        $startRow = $offset + 1
        $endRow = $startRow + $take - 1
        $slice = New-Object System.Collections.ArrayList
        for ($index = $offset; $index -lt ($offset + $take); $index++) {
            $row = @($Rows[$index] | ForEach-Object { Convert-ToSafeSheetCell $_ })
            [void]$slice.Add($row)
        }
        Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range ("'{0}'!A{1}:{2}{3}" -f $SheetName, $startRow, $EndColumn, $endRow) -Values @($slice.ToArray()) | Out-Null
        $offset += $take
        Start-Sleep -Milliseconds 600
    }

    return $Rows.Count
}

function Get-ConnectionsInputSheetRows {
    param($State)

    $rows = New-Object System.Collections.ArrayList
    [void]$rows.Add(@('First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On'))

    foreach ($contact in @(
        $State.contacts |
            Sort-Object @{
                Expression = { [string]$_.companyName }
                Descending = $false
            }, @{
                Expression = { [string]$_.lastName }
                Descending = $false
            }, @{
                Expression = { [string]$_.firstName }
                Descending = $false
            }
    )) {
        [void]$rows.Add(@(
            [string]$contact.firstName,
            [string]$contact.lastName,
            [string]$contact.linkedinUrl,
            [string]$contact.email,
            [string]$contact.companyName,
            [string]$contact.title,
            (Convert-ToSheetDateText $contact.connectedOn)
        ))
    }

    return @($rows)
}

function Get-HiringImportSheetRows {
    param($State)

    $rows = New-Object System.Collections.ArrayList
    [void]$rows.Add(@('Company', 'ATS', 'Job Title', 'Location', 'Department', 'Employment Type', 'Job URL', 'Updated At', 'Source URL'))

    foreach ($job in @(
        $State.jobs |
            Sort-Object @{
                Expression = {
                    $value = if ($_.postedAt) { $_.postedAt } else { $_.importedAt }
                    $parsed = [datetime]::MinValue
                    if ($value -and [datetime]::TryParse([string]$value, [ref]$parsed)) { $parsed } else { [datetime]::MinValue }
                }
                Descending = $true
            }, @{
                Expression = { [string]$_.companyName }
                Descending = $false
            }
    )) {
        [void]$rows.Add(@(
            [string]$job.companyName,
            [string]$job.atsType,
            [string]$job.title,
            [string]$job.location,
            [string]$job.department,
            [string]$job.employmentType,
            [string]$job.jobUrl,
            (Convert-ToSheetDateTimeText $(if ($job.postedAt) { $job.postedAt } else { $job.importedAt })),
            [string]$(if ($job.sourceUrl) { $job.sourceUrl } else { $job.atsType })
        ))
    }

    return @($rows)
}

function Get-HistorySheetRows {
    param($State)

    $rows = New-Object System.Collections.ArrayList
    [void]$rows.Add(@('Date', 'Company', 'Jobs Posted', 'Your Contacts', 'Notes', 'Pipeline Stage'))

    foreach ($activity in @(
        $State.activities |
            Sort-Object @{
                Expression = {
                    $parsed = [datetime]::MinValue
                    if ($_.occurredAt -and [datetime]::TryParse([string]$_.occurredAt, [ref]$parsed)) { $parsed } else { [datetime]::MinValue }
                }
                Descending = $true
            }
    )) {
        [void]$rows.Add(@(
            (Convert-ToSheetDateTimeText $activity.occurredAt),
            [string]$activity.companyName,
            [string]$(if ($null -ne $activity.jobCount) { $activity.jobCount } else { '' }),
            [string]$(if ($null -ne $activity.connectionCount) { $activity.connectionCount } else { '' }),
            [string]$activity.notes,
            [string]$activity.pipelineStage
        ))
    }

    return @($rows)
}

function Restore-BdSheetLogic {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId
    )

    $connectionsHeaders = @('First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On', 'Clean Company', 'Buyer Title', 'Senior Flag', 'Talent Flag', 'Tech Flag', 'Finance Flag', 'Company Contacts', 'Years Connected', 'Priority Score')
    $dailyHeaders = @('Company', 'Jobs Posted', 'Most Recent Posting', 'Your Contacts', 'Senior Contacts', 'Talent Contacts', 'Target Score', 'Daily Score', 'Network Strength', 'Pipeline Stage', 'Days Since Contact', 'Stale?', 'Careers Page')
    $contactsHeaders = @('Full Name', 'Company', 'Title', 'Priority Score', 'URL', 'Connected On', 'Email Address')

    $connectionsFormulas = @(
        '=ARRAYFORMULA(IF(E2:E="","",TRIM(E2:E)))',
        '=ARRAYFORMULA(IF(F2:F="","",IF(REGEXMATCH(LOWER(F2:F),"vp|vice president|head|director|chief|ceo|cfo|coo|cto|cio|founder|owner|partner|principal|managing director|general manager|gm|manager|lead|talent|recruit|acquisition|human resources|people|hr|hiring"),1,0)))',
        '=ARRAYFORMULA(IF(F2:F="","",IF(REGEXMATCH(LOWER(F2:F),"vp|vice president|head|director|chief|ceo|cfo|coo|cto|cio|founder|owner|partner|principal|managing director|general manager|gm"),1,0)))',
        '=ARRAYFORMULA(IF(F2:F="","",IF(REGEXMATCH(LOWER(F2:F),"talent|recruit|acquisition|human resources|people|hr"),1,0)))',
        '=ARRAYFORMULA(IF(F2:F="","",IF(REGEXMATCH(LOWER(F2:F),"engineer|engineering|developer|software|data|analytics|technology|it|product|architect|security|cloud|devops|ai|machine learning"),1,0)))',
        '=ARRAYFORMULA(IF(F2:F="","",IF(REGEXMATCH(LOWER(F2:F),"finance|financial|accounting|fp&a|controller|treasury|audit|risk|compliance|analyst|investment|capital markets"),1,0)))',
        '=ARRAYFORMULA(IF(H2:H="","",COUNTIF(H2:H,H2:H)))',
        '=ARRAYFORMULA(IF(G2:G="","",IFERROR(ROUND((TODAY()-DATEVALUE(G2:G))/365.25,1),"")))',
        @'
=ARRAYFORMULA(IF(H2:H="","",IFERROR(N(I2:I)*20+N(J2:J)*20+N(K2:K)*25+N(L2:L)*10+N(M2:M)*6+IF(N(N2:N)>=50,20,IF(N(N2:N)>=20,15,IF(N(N2:N)>=10,10,IF(N(N2:N)>=5,5,0)))),"")))
'@.Trim()
    )

    $targetFormula = @'
=QUERY({Connections!H2:H,Connections!J2:J,Connections!K2:K,Connections!I2:I},"select Col1, count(Col1), sum(Col2), sum(Col3), sum(Col4), count(Col1)*2+sum(Col2)*10+sum(Col3)*8+sum(Col4)*15 where Col1 is not null and not Col1 matches '(?i)self-employed|self employed|freelance|freelancer|independent consultant|confidential|open to work|seeking.*opportunit.*|retired|#.*' group by Col1 order by count(Col1)*2+sum(Col2)*10+sum(Col3)*8+sum(Col4)*15 desc label Col1 'Company', count(Col1) 'Connections', sum(Col2) 'Senior Contacts', sum(Col3) 'Talent Contacts', sum(Col4) 'Buyer Titles', count(Col1)*2+sum(Col2)*10+sum(Col3)*8+sum(Col4)*15 'Target Score'",0)
'@.Trim()

    $dailyCompanyFormula = '=QUERY({Hiring_Import!A2:A,Hiring_Import!C2:C,Hiring_Import!H2:H},"select Col1, count(Col2), max(Col3) where Col1 is not null group by Col1 label Col1 ''Company'', count(Col2) ''Jobs Posted'', max(Col3) ''Most Recent Posting''",0)'
    $dailyConnectionsFormula = '=ARRAYFORMULA(IF(A2:A="","",COUNTIF(Connections!H2:H,A2:A)))'
    $dailySeniorFormula = '=ARRAYFORMULA(IF(A2:A="","",COUNTIFS(Connections!H2:H,A2:A,Connections!J2:J,1)))'
    $dailyTalentFormula = '=ARRAYFORMULA(IF(A2:A="","",COUNTIFS(Connections!H2:H,A2:A,Connections!K2:K,1)))'
    $dailyTargetFormula = '=ARRAYFORMULA(IF(A2:A="","",IFERROR(VLOOKUP(A2:A,Target_Accounts!A:F,6,FALSE),0)))'
    $dailyScoreFormula = '=ARRAYFORMULA(IF(A2:A="","",B2:B*5 + D2:D*2 + E2:E*3 + F2:F*4))'
    $dailyNetworkFormula = '=ARRAYFORMULA(IF(A2:A="","",IF((D2:D>=50)+(E2:E>=5),"Hot",IF((D2:D>=10)+(E2:E>=1),"Warm","Cold"))))'
    $dailyStageFormula = '=MAP(A2:A,LAMBDA(company,IF(company="","",IFERROR(LOOKUP(2,1/(History!B$2:B=company),History!F$2:F),""))))'
    $dailyDaysFormula = '=MAP(A2:A,LAMBDA(company,IF(company="","",IFERROR(TODAY()-INT(LOOKUP(2,1/(History!B$2:B=company),History!A$2:A)),""))))'
    $dailyStaleFormula = '=ARRAYFORMULA(IF(K2:K="","",IF(K2:K>=14,"STALE","")))'
    $dailyCareersFormula = '=MAP(A2:A,LAMBDA(company,IF(company="","",IFERROR(VLOOKUP(company,{Job_Boards_Config!A$2:A,Job_Boards_Config!E$2:E},2,FALSE),""))))'

    $todayFormula = '=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER(Daily_Hot_List!A2:M,Daily_Hot_List!A2:A<>"",Daily_Hot_List!B2:B>=Setup!B10,Daily_Hot_List!D2:D>=Setup!B9),8,FALSE),Setup!B12,13),{"","","","","","","","","","","","",""})'
    $topContactsFormula = '=IFERROR(SORT(QUERY({Connections!A2:A&" "&Connections!B2:B,Connections!H2:H,Connections!F2:F,Connections!P2:P,Connections!C2:C,Connections!G2:G,Connections!D2:D},"select Col1, Col2, Col3, Col4, Col5, Col6, Col7 where Col2 is not null and Col4 >= "&Setup!B11&" and Col2 matches ''"&TEXTJOIN("|",TRUE,ARRAYFORMULA(REGEXREPLACE(FILTER(Today_View!A2:A,Today_View!A2:A<>""),"([.^$*+?(){}\\[\\]\\\\|])","\\\\$1")))&"''",0),4,FALSE),{"","","","","","",""})'

    Ensure-GoogleSheetExists -SpreadsheetId $SpreadsheetId -SheetName 'Connections' | Out-Null
    Ensure-GoogleSheetExists -SpreadsheetId $SpreadsheetId -SheetName 'Target_Accounts' | Out-Null
    Ensure-GoogleSheetExists -SpreadsheetId $SpreadsheetId -SheetName 'Daily_Hot_List' | Out-Null
    Ensure-GoogleSheetExists -SpreadsheetId $SpreadsheetId -SheetName 'Today_View' | Out-Null
    Ensure-GoogleSheetExists -SpreadsheetId $SpreadsheetId -SheetName 'Top_Contacts' | Out-Null
    Ensure-GoogleSheetExists -SpreadsheetId $SpreadsheetId -SheetName 'Automation_Log' | Out-Null

    # Preserve input columns in Connections; only restore the formula side.
    Clear-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Connections'!H:P" | Out-Null
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Connections'!A1:P1" -Values @(,($connectionsHeaders)) | Out-Null
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Connections'!H2:P2" -Values @(,($connectionsFormulas)) | Out-Null

    Clear-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Target_Accounts'!A:Z" | Out-Null
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Target_Accounts'!A1" -Values @(,(@($targetFormula))) | Out-Null

    Clear-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Daily_Hot_List'!A:Z" | Out-Null
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Daily_Hot_List'!A1" -Values @(,(@($dailyCompanyFormula))) | Out-Null
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Daily_Hot_List'!D1:M1" -Values @(,(@($dailyHeaders[3..12]))) | Out-Null
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Daily_Hot_List'!D2:M2" -Values @(,(@(
        $dailyConnectionsFormula,
        $dailySeniorFormula,
        $dailyTalentFormula,
        $dailyTargetFormula,
        $dailyScoreFormula,
        $dailyNetworkFormula,
        $dailyStageFormula,
        $dailyDaysFormula,
        $dailyStaleFormula,
        $dailyCareersFormula
    ))) | Out-Null

    Clear-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Today_View'!A:Z" | Out-Null
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Today_View'!A1:M1" -Values @(,($dailyHeaders)) | Out-Null
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Today_View'!A2" -Values @(,(@($todayFormula))) | Out-Null

    Clear-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Top_Contacts'!A:Z" | Out-Null
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Top_Contacts'!A1:G1" -Values @(,($contactsHeaders)) | Out-Null
    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Top_Contacts'!A2" -Values @(,(@($topContactsFormula))) | Out-Null

    Set-GoogleSheetValues -SpreadsheetId $SpreadsheetId -Range "'Automation_Log'!A1:B1" -Values @(,(@('Timestamp', 'Message'))) | Out-Null

    Set-BdSheetFormatting -SpreadsheetId $SpreadsheetId | Out-Null

    return [ordered]@{
        Connections = 1
        Target_Accounts = 1
        Daily_Hot_List = 1
        Today_View = 1
        Top_Contacts = 1
        Automation_Log = 1
    }
}

function Export-BdStateToGoogleSheets {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId,
        [Parameter(Mandatory = $true)]
        $State
    )

    $results = [ordered]@{
        Connections = Write-GoogleSheetTab -SpreadsheetId $SpreadsheetId -SheetName 'Connections' -EndColumn 'G' -Rows (Get-ConnectionsInputSheetRows -State $State)
        Hiring_Import = Write-GoogleSheetTab -SpreadsheetId $SpreadsheetId -SheetName 'Hiring_Import' -EndColumn 'I' -Rows (Get-HiringImportSheetRows -State $State)
        History = Write-GoogleSheetTab -SpreadsheetId $SpreadsheetId -SheetName 'History' -EndColumn 'F' -Rows (Get-HistorySheetRows -State $State)
    }

    $logicResult = Restore-BdSheetLogic -SpreadsheetId $SpreadsheetId
    foreach ($key in $logicResult.Keys) {
        $results[$key] = $logicResult[$key]
    }

    return $results
}

function Set-BdSheetFormatting {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SpreadsheetId
    )

    $metadata = Get-GoogleSpreadsheetMetadata -SpreadsheetId $SpreadsheetId
    $sheetIdByName = @{}
    foreach ($sheet in @($metadata.sheets)) {
        $sheetIdByName[[string]$sheet.properties.title] = [int]$sheet.properties.sheetId
    }

    $requests = New-Object System.Collections.ArrayList
    foreach ($formatSpec in @(
        @{ sheet = 'Hiring_Import'; startColumn = 7; endColumn = 8; pattern = 'yyyy-mm-dd hh:mm:ss' }
        @{ sheet = 'History'; startColumn = 0; endColumn = 1; pattern = 'yyyy-mm-dd hh:mm:ss' }
        @{ sheet = 'Daily_Hot_List'; startColumn = 2; endColumn = 3; pattern = 'yyyy-mm-dd hh:mm:ss' }
        @{ sheet = 'Today_View'; startColumn = 2; endColumn = 3; pattern = 'yyyy-mm-dd hh:mm:ss' }
        @{ sheet = 'Top_Contacts'; startColumn = 5; endColumn = 6; pattern = 'dd/mm/yyyy' }
        @{ sheet = 'Automation_Log'; startColumn = 0; endColumn = 1; pattern = 'yyyy-mm-dd hh:mm:ss' }
    )) {
        if (-not $sheetIdByName.ContainsKey($formatSpec.sheet)) {
            continue
        }

        [void]$requests.Add(@{
            repeatCell = @{
                range = @{
                    sheetId = $sheetIdByName[$formatSpec.sheet]
                    startRowIndex = 1
                    startColumnIndex = $formatSpec.startColumn
                    endColumnIndex = $formatSpec.endColumn
                }
                cell = @{
                    userEnteredFormat = @{
                        numberFormat = @{
                            type = 'DATE_TIME'
                            pattern = $formatSpec.pattern
                        }
                    }
                }
                fields = 'userEnteredFormat.numberFormat'
            }
        })
    }

    if ($requests.Count -gt 0) {
        Invoke-GoogleSheetsBatchUpdate -SpreadsheetId $SpreadsheetId -Requests @($requests.ToArray()) | Out-Null
    }

    return [ordered]@{ ok = $true; requests = $requests.Count }
}

Export-ModuleMember -Function *-*
