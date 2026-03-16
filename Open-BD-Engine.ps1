param(
    [int]$Port = 8173,
    [int]$StartupTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$serverScript = Join-Path $projectRoot 'server\Server.ps1'
$baseUrl = "http://localhost:$Port/"
$dashboardUrl = "${baseUrl}#/dashboard"
$healthUrl = "${baseUrl}api/health"
$runtimeUrl = "${baseUrl}api/runtime/status"

function Test-AppHealth {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
    } catch {
        return $false
    }
}

function Test-AppReady {
    param(
        [string]$RuntimeEndpoint,
        [string]$HealthEndpoint
    )

    try {
        $runtime = Invoke-RestMethod -Uri $RuntimeEndpoint -Method Get -UseBasicParsing -TimeoutSec 5
        if ($runtime -and $runtime.ok -and $runtime.warmed) {
            return $true
        }
    } catch {
    }

    return (Test-AppHealth -Url $HealthEndpoint)
}

function Get-AppListenerProcessId {
    param([int]$PortNumber)

    $connection = Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $connection) {
        return $null
    }

    return [int]$connection.OwningProcess
}

function Test-AppServerProcess {
    param([int]$ProcessId)

    if (-not $ProcessId) {
        return $false
    }

    $processInfo = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ProcessId) -ErrorAction SilentlyContinue
    if (-not $processInfo) {
        return $false
    }

    $commandLine = [string]$processInfo.CommandLine
    $normalizedCommandLine = $commandLine.Replace('\', '/').ToLowerInvariant()
    $normalizedServerScript = $serverScript.Replace('\', '/').ToLowerInvariant()
    $serverLeaf = (Split-Path -Leaf $serverScript).ToLowerInvariant()

    return (
        $normalizedCommandLine -like ('*{0}*' -f $normalizedServerScript) -or
        $normalizedCommandLine -like '*server/server.ps1*' -or
        $normalizedCommandLine -like ('*-file {0}*' -f $serverLeaf)
    )
}

function Stop-StaleAppServer {
    param([int]$PortNumber)

    $listenerProcessId = Get-AppListenerProcessId -PortNumber $PortNumber
    if (-not $listenerProcessId) {
        return
    }

    if (-not (Test-AppServerProcess -ProcessId $listenerProcessId)) {
        throw "Port $PortNumber is already in use by another process ($listenerProcessId)."
    }

    Stop-Process -Id $listenerProcessId -Force -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-AppListenerProcessId -PortNumber $PortNumber)) {
            return
        }
    }

    throw "Stopped stale BD Engine process $listenerProcessId but port $PortNumber is still busy."
}

if (-not (Test-Path -LiteralPath $serverScript)) {
    throw "Could not find server script at $serverScript"
}

if (Test-AppReady -RuntimeEndpoint $runtimeUrl -HealthEndpoint $healthUrl) {
    Start-Process $dashboardUrl | Out-Null
    return
}

Stop-StaleAppServer -PortNumber $Port

$argumentList = @(
    '-NoExit'
    '-NoProfile'
    '-ExecutionPolicy'
    'Bypass'
    '-File'
    $serverScript
    '-Port'
    $Port
)

Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -WindowStyle Minimized | Out-Null

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if (Test-AppReady -RuntimeEndpoint $runtimeUrl -HealthEndpoint $healthUrl) {
        Start-Process $dashboardUrl | Out-Null
        return
    }
}

throw "BD Engine did not finish starting within $StartupTimeoutSeconds seconds."
