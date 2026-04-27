<#
.SYNOPSIS
    Pester tests for BdEngine.Import module.
.DESCRIPTION
    Tests for the import functions in BdEngine.Import.psm1.
    Run with: Invoke-Pester -Path .\tests\
.NOTES
    Requires Pester 5+. Install with: Install-Module Pester -Force
#>

BeforeAll {
    # Import the module under test
    $ModulePath = Join-Path $PSScriptRoot '..\server\Modules\BdEngine.Import.psm1'
    Import-Module $ModulePath -Force -DisableNameChecking
}

Describe 'BdEngine.Import Module' -Tag 'Module' {
    It 'Module imports without errors' {
        { Import-Module $ModulePath -Force -DisableNameChecking } | Should -Not -Throw
    }

    It 'Exports expected functions' {
        $expectedFunctions = @(
            'Open-XlsxContext', 'Close-XlsxContext', 'Get-SharedStrings',
            'Get-SheetEntry', 'Convert-ColumnLettersToIndex', 'Get-CellPayload',
            'Read-XlsxSheetRows', 'Get-XlsxCellValues', 'Find-ExistingSheetName',
            'Test-FormulaString', 'Get-FirstResolvedText', 'Get-FirstResolvedNumber',
            'Get-FirstResolvedDateString', 'Get-YearsConnectedFromDate',
            'Test-PlaceholderJobRow', 'Import-BdConnectionsCsv', 'Import-BdWorkbook'
        )
        foreach ($func in $expectedFunctions) {
            Get-Command $func -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty -Because "function $func should be exported"
        }
    }
}

Describe 'Convert-ColumnLettersToIndex' -Tag 'Unit' {
    It 'Converts single letters correctly' {
        Convert-ColumnLettersToIndex -Letters 'A' | Should -Be 1
        Convert-ColumnLettersToIndex -Letters 'Z' | Should -Be 26
    }

    It 'Converts double letters correctly' {
        Convert-ColumnLettersToIndex -Letters 'AA' | Should -Be 27
        Convert-ColumnLettersToIndex -Letters 'AB' | Should -Be 28
        Convert-ColumnLettersToIndex -Letters 'AZ' | Should -Be 52
    }

    It 'Handles BA and ZZ' {
        Convert-ColumnLettersToIndex -Letters 'BA' | Should -Be 53
        Convert-ColumnLettersToIndex -Letters 'ZZ' | Should -Be 702
    }
}

Describe 'Test-FormulaString' -Tag 'Unit' {
    It 'Detects formula strings' {
        Test-FormulaString -Value '=SUM(A1:B1)' | Should -BeTrue
        Test-FormulaString -Value '  =VLOOKUP(A1,B:C,2)' | Should -BeTrue
    }

    It 'Rejects non-formula strings' {
        Test-FormulaString -Value 'Hello World' | Should -BeFalse
        Test-FormulaString -Value '123' | Should -BeFalse
    }

    It 'Handles non-string input' {
        Test-FormulaString -Value 123 | Should -BeFalse
        Test-FormulaString -Value $null | Should -BeFalse
    }
}

Describe 'Get-FirstResolvedText' -Tag 'Unit' {
    It 'Returns first non-blank value' {
        Get-FirstResolvedText -Candidates @('', 'Second', 'Third') | Should -Be 'Second'
    }

    It 'Skips formula strings' {
        Get-FirstResolvedText -Candidates @('=FORMULA()', 'Actual Value') | Should -Be 'Actual Value'
    }

    It 'Returns empty string for all blanks' {
        Get-FirstResolvedText -Candidates @('', '', $null) | Should -Be ''
    }

    It 'Trims whitespace' {
        Get-FirstResolvedText -Candidates @('   Trimmed   ') | Should -Be 'Trimmed'
    }
}

Describe 'Get-FirstResolvedNumber' -Tag 'Unit' {
    It 'Parses numeric strings' {
        Get-FirstResolvedNumber -Candidates @('42.5', '100') | Should -Be 42.5
    }

    It 'Returns default when no candidate parses' {
        Get-FirstResolvedNumber -Candidates @('', '=FORMULA()', $null) -Default 99 | Should -Be 99
    }

    It 'Skips blanks and formulas' {
        Get-FirstResolvedNumber -Candidates @('', '=A1', '25') | Should -Be 25
    }
}

Describe 'Get-YearsConnectedFromDate' -Tag 'Unit' {
    It 'Calculates years from ISO date' {
        $oneYearAgo = (Get-Date).AddYears(-1).ToString('o')
        Get-YearsConnectedFromDate -ConnectedOn $oneYearAgo | Should -BeGreaterThan 0.9
    }

    It 'Returns 0 for empty input' {
        Get-YearsConnectedFromDate -ConnectedOn '' | Should -Be 0
        Get-YearsConnectedFromDate -ConnectedOn $null | Should -Be 0
    }

    It 'Returns 0 for invalid date' {
        Get-YearsConnectedFromDate -ConnectedOn 'not-a-date' | Should -Be 0
    }
}

Describe 'Test-PlaceholderJobRow' -Tag 'Unit' {
    It 'Detects example row by notes' {
        $row = @{ Notes = 'delete this example row' }
        Test-PlaceholderJobRow -Row $row | Should -BeTrue
    }

    It 'Detects example row by company' {
        $row = @{ Company = 'paste new job-posting exports here' }
        Test-PlaceholderJobRow -Row $row | Should -BeTrue
    }

    It 'Returns false for valid rows' {
        $row = @{ Company = 'Microsoft'; Notes = 'Software Engineer role' }
        Test-PlaceholderJobRow -Row $row | Should -BeFalse
    }
}

Describe 'Open-XlsxContext' -Tag 'Integration' {
    It 'Throws for non-existent file' {
        { Open-XlsxContext -Path 'C:\nonexistent\file.xlsx' } | Should -Throw
    }

    It 'Throws for invalid XLSX (missing workbook.xml)' {
        $tempZip = [System.IO.Path]::GetTempFileName()
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::Open($tempZip, 'Update')
        $zip.Dispose()
        Rename-Item $tempZip -NewName 'invalid.xlsx' -Force
        $invalidPath = $tempZip -replace '\.tmp$', '.xlsx'
        { Open-XlsxContext -Path $invalidPath } | Should -Throw 'Invalid XLSX'
        Remove-Item $invalidPath -Force -ErrorAction SilentlyContinue
    }
}

Describe 'Import-BdConnectionsCsv' -Tag 'Integration' {
    It 'Throws for non-existent CSV' {
        { Import-BdConnectionsCsv -CsvPath 'C:\nonexistent\file.csv' } | Should -Throw
    }
}

Describe 'Import-BdWorkbook' -Tag 'Integration' {
    It 'Throws for non-existent workbook' {
        { Import-BdWorkbook -WorkbookPath 'C:\nonexistent\file.xlsx' } | Should -Throw
    }
}
