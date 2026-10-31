@echo off
cd /d "%~dp0"
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js is not installed. Install Node.js LTS, then reopen this file.
  pause
  exit /b 1
)
echo Starting CODE-ROYALE...
node server.js
pause
