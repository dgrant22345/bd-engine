<#
.BdEngine.Import.psd1
Module manifest for BdEngine.Import module
#>

@{
    RootModule        = 'BdEngine.Import.psm1'
    ModuleVersion     = '1.1.0'
    GUID              = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    Author            = 'dgrant22345'
    CompanyName       = 'Talencity'
    Copyright         = '(c) 2026 dgrant22345. All rights reserved.'
    Description       = 'BD Engine Import Module - Imports LinkedIn CSV connections and Excel workbook data into BD Engine state.'
    PowerShellVersion = '5.1'
    DotNetFrameworkVersion = '4.7.2'
    RequiredAssemblies = @('System.IO.Compression.FileSystem')
    FunctionsToExport = @(
        'Open-XlsxContext',
        'Close-XlsxContext',
        'Get-SharedStrings',
        'Get-SheetEntry',
        'Convert-ColumnLettersToIndex',
        'Get-CellPayload',
        'Read-XlsxSheetRows',
        'Get-XlsxCellValues',
        'Find-ExistingSheetName',
        'Test-FormulaString',
        'Get-FirstResolvedText',
        'Get-FirstResolvedNumber',
        'Get-FirstResolvedDateString',
        'Get-YearsConnectedFromDate',
        'Test-PlaceholderJobRow',
        'Import-BdConnectionsCsv',
        'Import-BdWorkbook'
    )
    CmdletsToExport   = @()
    VariablesToExport = @()
    AliasesToExport   = @()
    PrivateData       = @{
        PSData = @{
            Tags         = @('BD', 'Import', 'Excel', 'XLSX', 'CSV', 'LinkedIn', 'BusinessDevelopment')
            LicenseUri   = ''
            ProjectUri   = 'https://github.com/dgrant22345/bd-engine'
            ReleaseNotes = @'
Version 1.1.0 (2026-04-26) - Optimization Release
- Single Update-DerivedData call in Import-BdWorkbook (was 3x)
- Contact and job deduplication in workbook imports
- Per-row error handling with error collection in import runs
- XLSX validation (ZIP structure, required files)
- Cached collection counts in all progress loops
- Array concatenation using semicolon syntax
- Pre-compiled regex for formula detection
- Region blocks for code organization
- Comment-based help on all exported functions
- ValidateScript on file path parameters
'@
        }
    }
}
