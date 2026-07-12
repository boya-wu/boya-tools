@echo off
cd /d "%~dp0\.."
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5001" ^| findstr "LISTENING"') do taskkill /f /pid %%a
.\venv\Scripts\python.exe server.py
