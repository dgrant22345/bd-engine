@echo off
setlocal EnableDelayedExpansion
title BD Engine - Starting...

:: ─── Resolve project root from this script's location ───
set "PROJECT_ROOT=%~dp0"
:: Remove trailing backslash
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

:: ─── Pre-flight checks ───
echo.
echo  ============================================
echo   BD Engine Launcher
echo  ============================================
echo.

:: Check PowerShell exists
where powershell.exe >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] PowerShell is not installed or not in PATH.
    echo          BD Engine requires Windows PowerShell 5.1+
    echo          (included with Windows 10/11 by default).
    echo.
    pause
    exit /b 1
)

:: Check server script exists
if not exist "%PROJECT_ROOT%\server\Server.ps1" (
    echo  [ERROR] Could not find server\Server.ps1
    echo          Make sure this .bat file is in the BD Engine project root.
    echo          Expected location: %PROJECT_ROOT%\server\Server.ps1
    echo.
    pause
    exit /b 1
)

:: Check app directory exists
if not exist "%PROJECT_ROOT%\app\" (
    echo  [ERROR] Could not find the app\ directory.
    echo          The web UI files appear to be missing.
    echo.
    pause
    exit /b 1
)

:: Check SQLite DLL exists
if not exist "%PROJECT_ROOT%\server\vendor\sqlite\System.Data.SQLite.dll" (
    echo  [ERROR] SQLite driver not found at:
    echo          server\vendor\sqlite\System.Data.SQLite.dll
    echo          The database engine cannot start without this file.
    echo.
    pause
    exit /b 1
)

:: Check data directory exists, create if needed
if not exist "%PROJECT_ROOT%\data\" (
    echo  [INFO] Creating data directory...
    mkdir "%PROJECT_ROOT%\data"
)

:: ─── First-run setup check ───
if not exist "%PROJECT_ROOT%\data\license.json" (
    echo  [INFO] No license found. Running first-time setup...
    echo.
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%\Setup-BDEngine.ps1"
    if %ERRORLEVEL% neq 0 (
        echo.
        echo  [ERROR] Setup did not complete. BD Engine cannot start without a license.
        echo.
        pause
        exit /b 1
    )
)

:: ─── Launch ───
echo  [OK] All checks passed.
echo  [..] Starting BD Engine server on http://localhost:8173
echo       (a PowerShell window will open minimized)
echo.
echo  The app will open in your default browser when ready.
echo  This window will close automatically.
echo.

:: Use the existing Open-BD-Engine.ps1 which handles:
::   - Stale process cleanup
::   - Server startup in a minimized window
::   - Health check polling
::   - Auto browser open
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%\Open-BD-Engine.ps1"

if %ERRORLEVEL% neq 0 (
    echo.
    echo  [ERROR] BD Engine failed to start.
    echo          Check the PowerShell window for error details.
    echo.
    pause
    exit /b 1
)

endlocal
