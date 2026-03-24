function Invoke-AiOutreachDraft {
    param(
        [string]$CompanyId,
        [object]$State
    )

    $company = $State.companies | Where-Object { $_.id -eq $CompanyId } | Select-Object -First 1
    if (-not $company) { throw "Company not found" }

    $jobs = @($State.jobs | Where-Object { $_.accountId -eq $CompanyId -and $_.active -eq $true })
    $contacts = @($State.contacts | Where-Object { $_.accountId -eq $CompanyId })
    $topContact = $contacts | Sort-Object @{ Expression = { $_.priorityScore }; Descending = $true } | Select-Object -First 1

    $jobContext = $jobs | ForEach-Object { "- $($_.title) (Department: $($_.department))" } | Select-Object -First 5
    $jobContextStr = if ($jobContext.Count -gt 0) { ($jobContext -join "\n") } else { "No active jobs currently tracked." }

    $contactName = if ($topContact -and $topContact.fullName) { $topContact.fullName } else { "Decision Maker" }
    $contactTitle = if ($topContact -and $topContact.title) { $topContact.title } else { "Engineering Leadership" }
    $contactEmail = if ($topContact -and $topContact.email) { $topContact.email } else { "" }
    $contactLn = if ($topContact -and $topContact.linkedinUrl) { $topContact.linkedinUrl } else { "" }

    $simEmailSubject = "Accelerating engineering growth at $($company.displayName)"
    $simEmailBody = "Hi $contactName,`n`nI saw that $($company.displayName) is currently hiring for several technical roles, including:`n$jobContextStr`n`nSince you are leading the $contactTitle efforts, I wanted to reach out. We specialize in placing high-retention technical talent for these exact profiles. Are you open to a brief chat this week to see if we can help accelerate your hiring pipeline?`n`nBest,`n[Your Name]"
    
    $simLnMessage = "Hi $contactName, impressive traction with the open roles at $($company.displayName)! I specialize in scaling engineering teams and would love to connect to see if we can support your growth priorities."

    return [ordered]@{
        emailDraft = [ordered]@{
            to = $contactEmail
            subject = $simEmailSubject
            body = $simEmailBody
        }
        linkedinDraft = [ordered]@{
            url = $contactLn
            message = $simLnMessage
            contactName = $contactName
        }
    }
}

Export-ModuleMember -Function 'Invoke-AiOutreachDraft'
