@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer and try again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing the scraper dependency...
  call npm install
  if errorlevel 1 goto :failed
)
echo.
echo Pathfinder AoN Documentary Scraper
echo 1. Fighter pilot
echo 2. Resume configured classes
echo 3. Validate existing output
echo 4. Resume feats collection
choice /c 1234 /n /m "Choose 1, 2, 3 or 4: "
if errorlevel 4 goto :feats
if errorlevel 3 goto :validate
if errorlevel 2 goto :all
call npm run pilot
goto :done
:all
call node src/cli.js run
goto :done
:validate
call npm run validate
goto :done
:feats
call node src/cli.js scrape-collection --profile feats
if errorlevel 1 goto :failed
call npm run extract
call npm run validate
goto :done
:failed
echo The scraper stopped because a command failed.
:done
echo.
echo Finished. See the work\reports folder for details.
pause
