Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object {
    Write-Host "PID: $($_.ProcessId) CMD: $($_.CommandLine)"
}
