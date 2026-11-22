@echo off
setlocal
rem Installs Android SDK Build-Tools. The SDK license must be read and accepted by the user.
set "SDK=%LOCALAPPDATA%\Android\Sdk"
if not exist "%SDK%\cmdline-tools\latest\bin\sdkmanager.bat" (
  echo Android SDK command-line tools are not installed.
  pause
  exit /b 2
)
echo Android SDK requires you to review its terms and accept them yourself.
call "%SDK%\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="%SDK%" "build-tools;36.0.0"
if errorlevel 1 (
  echo Android SDK Build-Tools installation was not completed.
) else (
  echo Android SDK Build-Tools installation command finished.
)
pause
endlocal
