@echo off
setlocal
rem Open the local Android device mirror only after a single authorized phone is detected.
rem No login, captcha, sale, or publish operations are automated by this launcher.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-mirror.ps1"
if not %ERRORLEVEL%==0 (
  echo.
  echo Phone not ready. Connect an Android phone using a data USB cable, enable USB debugging, and allow this computer on the phone.
)
pause
endlocal
