@echo off
cd /d "%~dp0"
start "" http://localhost:3400
node server.mjs
pause
