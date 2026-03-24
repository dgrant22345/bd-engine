$path = '.\server\Modules\BdEngine.JobImport.psm1'
$lines = Get-Content $path
$startIdx = -1
$endIdx = -1

for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'myworkdayjobs' -and $lines[$i] -match 'cxs') {
        $startIdx = $i
    }
    if ($startIdx -ge 0 -and $i -gt $startIdx -and $lines[$i] -match '\$candidate.matchedSignatures = @\(''successfactors''\)') {
        $endIdx = $i
        break
    }
}

if ($startIdx -ge 0 -and $endIdx -ge 0) {
    Write-Host "Replaced lines $startIdx to $endIdx"

    $newLines = @"
    } elseif (`$lower -match '([a-z0-9-]+)\.myworkdayjobs\.com' -or `$lower -match '/wday/cxs/[^/]+/[^/?#]+') {
        `$candidate.atsType = 'workday'
        if (`$lower -match '/wday/cxs/([^/]+)/([^/?#]+)') {
            `$candidate.boardId = ('{0}/{1}' -f `$matches[1], `$matches[2])
            `$candidate.supportedImport = `$true
            `$candidate.source = if (`$rawUrl -match '(https?://[^/]+/wday/cxs/[^/]+/[^/?#]+)') { "`$(`$matches[1])/jobs" } else { '' }
            `$candidate.confidenceScore = 88
        } elseif (`$lower -match '([a-z0-9-]+)\.myworkdayjobs\.com') {
            `$candidate.boardId = `$matches[1]
            `$candidate.confidenceScore = 82
        } else {
            `$candidate.confidenceScore = 72
        }
        `$candidate.matchedSignatures = @('workday')
    } elseif (`$lower -match '([a-z0-9-]+)\.icims\.com' -or `$lower -match 'icims\.jobs') {
        `$candidate.atsType = 'icims'
        `$candidate.boardId = if (`$matches[1]) { `$matches[1] } else { `$domain }
        `$candidate.supportedImport = `$false
        `$candidate.confidenceScore = 76
        `$candidate.matchedSignatures = @('icims')
    } elseif (`$lower -match 'taleo\.net' -or `$lower -match 'oraclecloud\.com/.+candidateexperience') {
        `$candidate.atsType = 'taleo'
        `$candidate.boardId = `$domain
        `$candidate.supportedImport = `$false
        `$candidate.confidenceScore = 76
        `$candidate.matchedSignatures = @('taleo')
    } elseif (`$lower -match 'successfactors\.com' -or `$lower -match 'jobs\.sap\.com|career[s]?\.?successfactors') {
        `$candidate.atsType = 'successfactors'
        `$candidate.boardId = `$domain
        `$candidate.supportedImport = `$false
        `$candidate.confidenceScore = 74
        `$candidate.matchedSignatures = @('successfactors')
"@ -split "`r?`n"

    $finalLines = $lines[0..($startIdx-1)] + $newLines + $lines[($endIdx+1)..($lines.Count-1)]
    $finalLines | Set-Content -Path $path
} else {
    Write-Host "Failed to find the lines to replace"
}
