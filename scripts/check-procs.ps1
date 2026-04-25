Get-Process -Name powershell, pwsh -ErrorAction SilentlyContinue | ForEach-Object {
    $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
    Write-Host "PID: $($_.Id) | Start: $($_.StartTime)"
    Write-Host "  CMD: $cmdLine"
}
