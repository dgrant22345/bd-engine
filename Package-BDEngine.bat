@echo off
setlocal
title BD Engine - Create Distribution Package

echo.
echo  ============================================
echo   BD Engine - Package for Distribution
echo  ============================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Package-Distribution.ps1"

echo.
pause
endlocal
