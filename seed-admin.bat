@echo off
REM Admin Account Seeding Script
REM This script seeds the admin account with proper permissions

echo ========================================
echo ADMIN SEEDING SCRIPT
echo ========================================
echo.
echo Changing to Identityprovider directory...
cd /d "%~dp0\Identityprovider"

echo Running seed script...
node src\seeds\seedAdminSimple.js

echo.
echo ========================================
echo DONE!
echo ========================================
echo.
echo Visit http://localhost:4000/admin/login
echo.
echo Press any key to close...
pause > nul
