param(
    [int]$Port = 8173,
    [switch]$OpenBrowser
)

$serverPath = Join-Path $PSScriptRoot 'server\Server.ps1'
$args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serverPath, '-Port', $Port)
if ($OpenBrowser) {
    $args += '-OpenBrowser'
}
& powershell.exe @args
