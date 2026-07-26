@echo off
REM ─── Kinetik Database Migration Runner (Windows) ───────────
REM Applies pending migration files from scripts\migrations\ in order.
REM Uses a _migrations tracking table in PostgreSQL for safety.
REM
REM Environment variables (with defaults):
REM   DB_HOST=localhost   DB_PORT=5432   DB_USER=kinetik
REM   DB_PASSWORD=kinetik_dev_2024       DB_NAME=kinetik
REM
REM Usage:
REM   scripts\run-migrations.bat
REM   set DB_PASSWORD=secret && scripts\run-migrations.bat
REM ──────────────────────────────────────────────────────────

setlocal enabledelayedexpansion

REM ── Connection ────────────────────────────────────────────
if "%DB_HOST%"=="" set DB_HOST=localhost
if "%DB_PORT%"=="" set DB_PORT=5432
if "%DB_USER%"=="" set DB_USER=kinetik
if "%DB_PASSWORD%"=="" set DB_PASSWORD=kinetik_dev_2024
if "%DB_NAME%"=="" set DB_NAME=kinetik

REM Resolve migrations directory relative to script location
set "SCRIPT_DIR=%~dp0"
set "MIGRATIONS_DIR=%SCRIPT_DIR%migrations"

echo =======================================================
echo   Kinetik - Migration Runner (Windows)
echo =======================================================
echo   Host:      %DB_HOST%:%DB_PORT%
echo   Database:  %DB_NAME%
echo   User:      %DB_USER%
echo   Migrations: %MIGRATIONS_DIR%
echo.

REM ── Wait for PostgreSQL ───────────────────────────────────
echo   Waiting for PostgreSQL...
set WAIT_COUNT=0
:WAIT_LOOP
set /a WAIT_COUNT+=1
if %WAIT_COUNT% gtr 30 (
    echo   [ERROR] PostgreSQL did not become ready in time.
    exit /b 1
)
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -c "SELECT 1;" >nul 2>&1
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto WAIT_LOOP
)
echo   PostgreSQL is ready.
echo.

REM ── Ensure tracking table ────────────────────────────────
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -q -c "
  CREATE TABLE IF NOT EXISTS _migrations (
    id          SERIAL PRIMARY KEY,
    filename    VARCHAR(255) NOT NULL UNIQUE,
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    checksum    VARCHAR(64)  NOT NULL
  );
" 2>nul

echo   Tracking table ready.
echo.

REM ── Apply pending migrations ──────────────────────────────
set COUNT_APPLIED=0
set COUNT_SKIPPED=0

for %%f in ("%MIGRATIONS_DIR%\*.sql") do (
    set "FILENAME=%%~nxf"
    set "FULLPATH=%%f"

    REM Check if already applied
    for /f "tokens=*" %%a in ('psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -t -A -c "SELECT COUNT(*) FROM _migrations WHERE filename='%%~nxf';" 2^>nul') do set ALREADY=%%a
    if "!ALREADY!"=="" set ALREADY=0

    if "!ALREADY!"=="1" (
        echo   Skipping %%~nxf - already applied
        set /a COUNT_SKIPPED+=1
    ) else (
        echo   Applying %%~nxf ...

        REM Run migration
        psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -q -1 -f "%%f"
        if errorlevel 1 (
            echo   [FAIL] %%~nxf - migration returned an error!
            exit /b 1
        )

        REM Mark as applied
        psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d %DB_NAME% -q -c "INSERT INTO _migrations (filename, checksum) VALUES ('%%~nxf', 'batch');" 2>nul
        echo   [DONE] %%~nxf
        set /a COUNT_APPLIED+=1
    )
)

echo.
echo =======================================================
echo   Applied:  %COUNT_APPLIED%
echo   Skipped:  %COUNT_SKIPPED%
echo =======================================================
echo   Migration run complete.
echo.
endlocal
