@echo off
:: deploy.bat — Windows launcher for the household app deploy agent.
:: Runs privacy scan + smoke tests, then pushes to GitHub.
:: Vercel picks up the push automatically.
::
:: Usage (from Windows PowerShell or cmd):
::   deploy --app triathlon

setlocal

set "ARGS=%*"

wsl -e /bin/bash -lc "node ~/household-infrastructure/deploy.js %ARGS%"

endlocal
