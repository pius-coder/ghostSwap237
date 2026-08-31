@echo off
REM Process-level Bypass: works even when the machine is Restricted.
REM vcam.ps1 still requires an elevated token (UAC).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0vcam.ps1" %*
exit /b %ERRORLEVEL%
