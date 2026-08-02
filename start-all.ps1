# Start All Applications Script
# This script starts all backend and frontend services in separate windows

$workspace = "C:\Users\Michael\Documents\GitHub\seemplify"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Starting All Semplify Applications" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Define all apps with their paths and startup commands
$apps = @(
    @{ Name = "Identityprovider (Backend)"; Path = "$workspace\Identityprovider"; Command = "npm run dev"; Color = "Green" },
    @{ Name = "Leave Management Backend"; Path = "$workspace\leave-management\backend"; Command = "npm run dev"; Color = "Yellow" },
    @{ Name = "Payroll Backend"; Path = "$workspace\payroll\backend"; Command = "npm run dev"; Color = "Magenta" },
    @{ Name = "Performance Management Backend"; Path = "$workspace\performance\backend"; Command = "npm run dev"; Color = "Cyan" },
    @{ Name = "Recruiter Backend"; Path = "$workspace\recruiter\backend"; Command = "npm run dev"; Color = "Blue" },
    @{ Name = "Time Attendance Backend"; Path = "$workspace\time-attendance\backend"; Command = "npm run dev"; Color = "DarkYellow" },
    @{ Name = "Leave Management Frontend"; Path = "$workspace\leave-management\frontend"; Command = "npm run dev"; Color = "Yellow" },
    @{ Name = "Payroll Frontend"; Path = "$workspace\payroll\frontend"; Command = "npm run dev"; Color = "Magenta" },
    @{ Name = "Performance Management Frontend"; Path = "$workspace\performance\frontend"; Command = "npm run dev"; Color = "Cyan" },
    @{ Name = "Recruiter Frontend"; Path = "$workspace\recruiter\frontend"; Command = "npm run dev"; Color = "Blue" },
    @{ Name = "Time Attendance Frontend"; Path = "$workspace\time-attendance\frontend"; Command = "npm run dev"; Color = "DarkYellow" }
)

# Start each app in a new PowerShell window
foreach ($app in $apps) {
    Write-Host "Starting $($app.Name)..." -ForegroundColor $app.Color
    
    $scriptPath = @"
cd $($app.Path)
Write-Host "========================================" -ForegroundColor $app.Color
Write-Host "  $($app.Name)" -ForegroundColor $app.Color
Write-Host "  Path: $($app.Path)" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor $app.Color
Write-Host ""
$($app.Command)
"@
    
    $scriptPath | Out-File -FilePath "$($app.Path)\start-temp.ps1" -Encoding UTF8
    
    Start-Process powershell -ArgumentList "-NoExit", "-File", "$($app.Path)\start-temp.ps1" -WindowStyle Normal
    
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  All applications started!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Application URLs:" -ForegroundColor Cyan
Write-Host "  - Recruiter Frontend:     http://localhost:5000" -ForegroundColor White
Write-Host "  - Leave Management:       http://localhost:5003" -ForegroundColor White
Write-Host "  - Performance Management:  http://localhost:5005" -ForegroundColor White
Write-Host "  - Payroll:                http://localhost:5007" -ForegroundColor White
Write-Host "  - Time Attendance:        http://localhost:5009" -ForegroundColor White
Write-Host ""
Write-Host "Note: Backend services will start on their configured ports." -ForegroundColor Gray
Write-Host ""
Write-Host "Close this window to keep all apps running." -ForegroundColor Yellow
Write-Host "Close individual app windows to stop specific services." -ForegroundColor Yellow
