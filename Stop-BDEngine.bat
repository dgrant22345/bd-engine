@echo off
setlocal EnableDelayedExpansion
title BD Engine - Stopping...

echo.
echo  ============================================
echo   BD Engine - Stop Server
echo  ============================================
echo.

:: Find and stop any PowerShell process running Server.ps1
set "FOUND=0"
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq powershell.exe" /fo list 2^>nul ^| findstr /i "PID:"') do (
    wmic process where "ProcessId=%%i" get CommandLine 2>nul | findstr /i "Server.ps1" >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo  [..] Stopping BD Engine server (PID %%i)...
        taskkill /pid %%i /f >nul 2>&1
        set "FOUND=1"
    )
)

if "%FOUND%"=="0" (
    echo  [INFO] No running BD Engine server found.
) else (
    echo  [OK] BD Engine server stopped.
)

echo.
pause
endlocal
