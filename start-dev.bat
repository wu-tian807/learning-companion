@echo off
setlocal
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"

if not exist "C:\Program Files\nodejs\node.exe" (
  echo ERROR: Node.js was not found.
  pause
  exit /b 1
)

if "%~1"=="--check" (
  "C:\Program Files\nodejs\node.exe" --version
  call "C:\Program Files\nodejs\corepack.cmd" pnpm --version
  exit /b %errorlevel%
)

if not exist node_modules (
  echo Installing dependencies for the first run...
  call "C:\Program Files\nodejs\corepack.cmd" pnpm install
  if errorlevel 1 (
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting Learning Companion...
echo Close this window or press Ctrl+C to stop the app.
echo.
call "C:\Program Files\nodejs\corepack.cmd" pnpm dev
pause
