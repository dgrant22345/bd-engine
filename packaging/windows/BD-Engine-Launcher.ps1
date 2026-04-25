param(
    [int]$Port = 8173,
    [string]$DataRoot = ''
)

$ErrorActionPreference = 'Stop'

function Write-LauncherLog {
    param([string]$Message)

    $timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -LiteralPath $script:LauncherLogPath -Value ("[{0}] {1}" -f $timestamp, $Message)
}

function Show-LaunchError {
    param([string]$Message)

    try {
        $shell = New-Object -ComObject WScript.Shell
        $shell.Popup($Message, 0, 'BD Engine', 16) | Out-Null
    } catch {
        Write-Host $Message
    }
}

function Test-BdEngineRuntime {
    param([string]$BaseUrl)

    try {
        $status = Invoke-RestMethod -Uri "$BaseUrl/api/runtime/status" -Method GET -TimeoutSec 2
        return [bool]$status
    } catch {
        try {
            $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -Method GET -TimeoutSec 2
            return [bool]$health.ok
        } catch {
            return $false
        }
    }
}

function Wait-BdEngineRuntime {
    param(
        [string]$BaseUrl,
        [int]$TimeoutSeconds = 45
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-BdEngineRuntime -BaseUrl $BaseUrl) {
            return $true
        }
        Start-Sleep -Milliseconds 750
    }

    return $false
}

function Get-ServerPid {
    param([string]$PidPath)

    if (-not (Test-Path -LiteralPath $PidPath)) {
        return 0
    }

    $raw = (Get-Content -LiteralPath $PidPath -Raw -ErrorAction SilentlyContinue).Trim()
    $pidValue = 0
    if ([int]::TryParse($raw, [ref]$pidValue)) {
        return $pidValue
    }

    return 0
}

function Test-ProcessIsRunning {
    param([int]$ProcessId)

    if ($ProcessId -le 0) {
        return $false
    }

    return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

$installRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$appDataRoot = Join-Path $localAppData 'BD Engine'
if ([string]::IsNullOrWhiteSpace($DataRoot)) {
    $DataRoot = Join-Path $appDataRoot 'Data'
}
$logsRoot = Join-Path $appDataRoot 'Logs'
$serverPidPath = Join-Path $DataRoot 'server.pid'
$script:LauncherLogPath = Join-Path $logsRoot 'launcher.log'

try {
    foreach ($path in @($appDataRoot, $DataRoot, $logsRoot)) {
        if (-not (Test-Path -LiteralPath $path)) {
            New-Item -ItemType Directory -Path $path -Force | Out-Null
        }
    }

    $env:BD_ENGINE_DATA_ROOT = $DataRoot
    $baseUrl = "http://127.0.0.1:$Port"
    $appUrl = "$baseUrl/"
    Write-LauncherLog "Launch requested. installRoot=$installRoot dataRoot=$DataRoot port=$Port"

    if (Test-BdEngineRuntime -BaseUrl $baseUrl) {
        Write-LauncherLog 'Existing BD Engine runtime is healthy; opening browser.'
        Start-Process $appUrl | Out-Null
        exit 0
    }

    $existingPid = Get-ServerPid -PidPath $serverPidPath
    if (Test-ProcessIsRunning -ProcessId $existingPid) {
        Write-LauncherLog "Server process $existingPid is already running; waiting for health."
        if (Wait-BdEngineRuntime -BaseUrl $baseUrl -TimeoutSeconds 30) {
            Start-Process $appUrl | Out-Null
            exit 0
        }

        throw "BD Engine server process $existingPid is running but did not become healthy at $baseUrl."
    }

    $serverScript = Join-Path $installRoot 'server\Server.ps1'
    if (-not (Test-Path -LiteralPath $serverScript)) {
        throw "Server script was not found at $serverScript."
    }

    $stdoutLog = Join-Path $logsRoot 'server.out.log'
    $stderrLog = Join-Path $logsRoot 'server.err.log'
    $powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $serverScript),
        '-Port', [string]$Port,
        '-LocalOnly'
    )

    $process = Start-Process -FilePath $powershellExe `
        -ArgumentList $arguments `
        -WorkingDirectory $installRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru

    Set-Content -LiteralPath $serverPidPath -Value ([string]$process.Id) -Encoding ASCII
    Write-LauncherLog "Started server process $($process.Id). Waiting for health."

    if (-not (Wait-BdEngineRuntime -BaseUrl $baseUrl -TimeoutSeconds 60)) {
        throw "BD Engine did not become ready at $baseUrl. See $stderrLog and $stdoutLog."
    }

    Write-LauncherLog 'Runtime is healthy; opening browser.'
    Start-Process $appUrl | Out-Null
} catch {
    $message = "BD Engine could not start.`r`n`r`n$($_.Exception.Message)`r`n`r`nLogs: $logsRoot"
    try { Write-LauncherLog "ERROR $($_.Exception.Message)" } catch {}
    Show-LaunchError -Message $message
    exit 1
}
