@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0xianyu-server-ollama-dev.exe" (
  echo Ollama-compatible server executable not found. Build xianyu-server-ollama-dev.exe first.
  pause
  exit /b 1
)
echo Starting Ollama-compatible server. Open http://127.0.0.1:59188 after the server starts.
"%~dp0xianyu-server-ollama-dev.exe" -workdir "%~dp0data" -db "%~dp0data\xianyu_data.db" -addr 127.0.0.1:59188
pause
