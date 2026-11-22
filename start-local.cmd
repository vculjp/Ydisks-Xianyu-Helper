@echo off
setlocal
cd /d "%~dp0"
rem Fixed local port: 48188 is outside the Windows dynamic TCP port range.
rem Do not inherit XIANYU_HTTP_PORT from the environment, to avoid changing the URL on restart.
set "XIANYU_HTTP_PORT=48188"
if not exist "%~dp0dist\windows\xianyu-server-ui-layout-23.exe" (
  echo Updated server executable not found. Build dist\windows\xianyu-server-ui-layout-23.exe first.
  pause
  exit /b 1
)
rem Re-running this file must not start a duplicate server or interrupt AI replies.
powershell.exe -NoProfile -Command "try { $r=Invoke-RestMethod -Uri 'http://127.0.0.1:48188/health' -TimeoutSec 3; if ($r.status -eq 'ok' -and $r.database -eq 'ok') { exit 0 } } catch { }; exit 1" >nul 2>&1
if not errorlevel 1 (
  echo Server is already running at http://127.0.0.1:%XIANYU_HTTP_PORT%
  exit /b 0
)
echo Starting updated server. Open http://127.0.0.1:%XIANYU_HTTP_PORT% after the server starts.
"%~dp0dist\windows\xianyu-server-ui-layout-23.exe" -workdir "%~dp0data" -db "%~dp0data\xianyu_data.db" -addr 127.0.0.1:%XIANYU_HTTP_PORT%
pause
