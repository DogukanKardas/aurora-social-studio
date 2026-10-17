@echo off
title Aurora Social Studio
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kur.
  pause
  exit /b 1
)
if not exist ".env" copy ".env.example" ".env" >nul
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:3000"
node server.js
pause
