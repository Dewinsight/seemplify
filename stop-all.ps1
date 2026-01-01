# Stop All Applications Script
# This script stops all running Node.js processes related to Semplify

Write-Host "============================================" -ForegroundColor Red
Write-Host "  Stopping All Semplify Applications" -ForegroundColor Red
Write-Host "============================================" -ForegroundColor Red
Write-Host ""

$confirm = Read-Host "Are you sure you want to stop all applications? (yes/no)"

if ($confirm -ne "yes") {
    Write-Host "Operation cancelled." -ForegroundColor Yellow
    exit
}

# Stop all node processes in the workspace
$workspace = "C:\Users\Michael\Documents\GitHub\seemplify"
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$workspace*" }

if ($nodeProcesses) {
    Write-Host "Found $($nodeProcesses.Count) Node.js processes running in workspace..." -ForegroundColor Yellow
    Write-Host ""
    
    foreach ($process in $nodeProcesses) {
        Write-Host "Stopping process PID: $($process.Id) - $($process.Path)" -ForegroundColor Gray
        Stop-Process -Id $process.Id -Force
    }
    
    Write-Host ""
    Write-Host "All applications stopped successfully!" -ForegroundColor Green
} else {
    Write-Host "No Node.js processes found running in workspace." -ForegroundColor Yellow
}

# Clean up temporary scripts
Get-ChildItem -Path $workspace -Filter "start-temp.ps1" -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Cleanup Complete" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
