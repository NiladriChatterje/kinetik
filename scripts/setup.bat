@echo off
echo ============================================
echo    Kinetik - Project Setup
echo ============================================
echo.
echo Step 1: Generating placeholder assets...
python "%~dp0generate_assets.py"
if %errorlevel% neq 0 (
    echo [!] Python not found. Please install Python or run the script manually.
    pause
    exit /b 1
)
echo.
echo Step 2: Installing npm dependencies (this may take a while)...
cd /d "%~dp0.."
call npm install
if %errorlevel% neq 0 (
    echo [!] npm install failed. Check your Node.js installation.
    pause
    exit /b 1
)
echo.
echo ============================================
echo    Setup complete!
echo    Run 'npm run dev' to start backend services
echo    Run 'npm run start:mobile' for the mobile app
echo ============================================
pause
