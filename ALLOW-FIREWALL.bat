@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Please right-click this file and choose RUN AS ADMINISTRATOR.
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="CODE-ROYALE Local Game" >nul 2>&1
netsh advfirewall firewall add rule name="CODE-ROYALE Local Game" dir=in action=allow protocol=TCP localport=3000 profile=any remoteip=localsubnet
if %errorlevel% equ 0 (
  echo Firewall rule added for local-network devices on TCP port 3000.
) else (
  echo Could not add firewall rule. Please check Windows Firewall permissions.
)
pause
