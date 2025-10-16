@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "DO_LOCAL=1"
set "DO_REMOTE=1"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--local" (
  set "DO_LOCAL=1"
  set "DO_REMOTE=0"
) else if /I "%~1"=="--remote" (
  set "DO_LOCAL=0"
  set "DO_REMOTE=1"
) else (
  echo Unknown argument: %~1
  exit /b 1
)
shift
goto parse_args

:args_done

if exist ".env" (
  for /f "usebackq delims=" %%L in (".env") do (
    for /f "tokens=1,* delims==" %%A in ("%%L") do (
      set "KEY=%%A"
      set "VALUE=%%B"
      if "!KEY!"=="" (
        rem skip
      ) else if /I "!KEY!"=="SSH_HOSTS" (
        set "SSH_HOSTS=!VALUE!"
      ) else if /I "!KEY!"=="SSH_USER" (
        set "SSH_USER=!VALUE!"
      ) else if /I "!KEY!"=="SSH_PORT" (
        set "SSH_PORT=!VALUE!"
      ) else if /I "!KEY!"=="SSH_KEY" (
        set "SSH_KEY=!VALUE!"
      ) else if /I "!KEY!"=="PM2_NAME" (
        set "PM2_NAME=!VALUE!"
      )
    )
  )
)

if not defined SSH_USER set "SSH_USER=ubuntu"
if not defined SSH_PORT set "SSH_PORT=22"
if not defined PM2_NAME set "PM2_NAME=pawtech"

echo == Pawtropolis Tech stop ==

if "%DO_LOCAL%"=="1" (
  call :STOP_LOCAL
) else (
  echo [LOCAL] skipped per args
)

if "%DO_REMOTE%"=="1" (
  call :STOP_REMOTE
) else (
  echo [REMOTE] skipped per args
)

echo [DONE] stop complete
exit /b 0

:STOP_LOCAL
echo [LOCAL] checking pm2
where pm2 >nul 2>&1
if errorlevel 1 (
  echo [LOCAL] pm2 not found, skipping pm2 cleanup
) else (
  echo [LOCAL] removing pm2 process "%PM2_NAME%"
  pm2 delete "%PM2_NAME%" >nul 2>&1
  if /I not "%PM2_NAME%"=="pawtropolis-tech" (
    pm2 delete "pawtropolis-tech" >nul 2>&1
  )
)

where powershell >nul 2>&1
if errorlevel 1 (
  echo [LOCAL] PowerShell missing, skipping process kill
  goto :eof
)

powershell -NoProfile -Command ^
  "try { $procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*dist\index.js*' }; if ($procs) { $ids = ($procs | Select-Object -ExpandProperty ProcessId); $procs | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }; Write-Host '[LOCAL] dist\index.js stopped PID(s):' ($ids -join ', '); } else { Write-Host '[LOCAL] dist\index.js: nothing to stop'; } } catch { Write-Host '[LOCAL] dist\index.js: query failed' }" 2>nul

powershell -NoProfile -Command ^
  "try { $procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*src\index.ts*' -and $_.CommandLine -match 'tsx' }; if ($procs) { $ids = ($procs | Select-Object -ExpandProperty ProcessId); $procs | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }; Write-Host '[LOCAL] tsx src\index.ts stopped PID(s):' ($ids -join ', '); } else { Write-Host '[LOCAL] tsx src\index.ts: nothing to stop'; } } catch { Write-Host '[LOCAL] tsx src\index.ts: query failed' }" 2>nul
goto :eof

:STOP_REMOTE
if not defined SSH_HOSTS (
  echo [REMOTE] SSH_HOSTS not set, skipping
  goto :eof
)

where ssh >nul 2>&1
if errorlevel 1 (
  echo [REMOTE] ssh not found on PATH, skipping remote
  goto :eof
)

set "HOSTS=%SSH_HOSTS:,= %"
if "%HOSTS%"=="" (
  echo [REMOTE] SSH_HOSTS resolved empty, skipping
  goto :eof
)

for %%H in (%HOSTS%) do (
  if not "%%~H"=="" call :STOP_REMOTE_HOST %%~H
)
goto :eof

:STOP_REMOTE_HOST
setlocal EnableDelayedExpansion
set "TARGET=%~1"
if "!TARGET!"=="" (
  endlocal
  goto :eof
)
echo [REMOTE] !TARGET!: stopping
set "SSH_CMD=ssh -o BatchMode=yes -p %SSH_PORT%"
if defined SSH_KEY (
  set "SSH_CMD=!SSH_CMD! -i ""!SSH_KEY!"""
)
set "REMOTE_COMMAND=pm2 delete ""%PM2_NAME%"" ^|^| pm2 delete pawtropolis-tech ^|^| true; pkill -f 'dist/index.js' ^|^| true; pkill -f 'tsx.*src/index.ts' ^|^| true"
!SSH_CMD! !SSH_USER!@!TARGET! "!REMOTE_COMMAND!" >nul 2>&1
if errorlevel 1 (
  echo [REMOTE] !TARGET!: failed, moving on
) else (
  echo [REMOTE] !TARGET!: ok
)
endlocal
goto :eof
