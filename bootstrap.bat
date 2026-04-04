@echo off
:: bootstrap.bat — Windows launcher for the Household App Infrastructure bootstrap agent.
:: Opens WSL and runs bootstrap.js with all arguments forwarded.
::
:: Usage (from Windows PowerShell or cmd):
::   bootstrap                                   — interactive bootstrap
::   bootstrap migrate --app triathlon           — apply pending migrations
::   bootstrap update  --app triathlon --file src/App.tsx

setlocal

:: Forward all Windows arguments to the WSL command
set "ARGS=%*"

:: Run in WSL using the login shell so PATH (nvm, node, supabase CLI) is fully loaded
wsl -e /bin/bash -lc "node ~/household-infrastructure/bootstrap.js %ARGS%"

endlocal
