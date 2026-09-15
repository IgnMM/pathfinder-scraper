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
if errorlevel 1 goto :failed
goto :done
:all
call node src/cli.js run
if errorlevel 1 goto :failed
goto :done
:validate
call npm run validate
if errorlevel 1 goto :failed
goto :done
:feats
call node src/cli.js scrape-collection --profile feats
if errorlevel 1 goto :failed
call npm run extract
call npm run validate
goto :done
:failed
echo.
echo FAILED. Cached pages and checkpoints were preserved.
echo Run the same option again to resume. Do not treat this run as complete.
goto :end
:done
echo.
echo PASS. See the work\reports folder for details.
:end
pause
