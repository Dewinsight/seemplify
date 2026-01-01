# Stop All Semplify Services - Standalone Script
# This script stops all Node.js processes running in the Semplify workspace
# Can be run independently without package.json

param(
    [switch]$Force,
    [switch]$All
)

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "============================================" -ForegroundColor Red
Write-Host "  Stopping Semplify Services" -ForegroundColor Red
Write-Host "============================================" -ForegroundColor Red
Write-Host ""

if ($All -or $Force) {
    Write-Host "Mode: Force Stop All Node.js Processes" -ForegroundColor Yellow
    Write-Host "Warning: This will stop ALL Node.js processes on your system!" -ForegroundColor Red
    Write-Host ""
    
    $confirm = Read-Host "Are you sure you want to force stop all Node.js processes? (yes/no)"
    
    if ($confirm -ne "yes") {
        Write-Host ""
        Write-Host "Operation cancelled." -ForegroundColor Yellow
        exit
    }
    
    $nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
    $scope = "system-wide"
} else {
    Write-Host "Mode: Stop Workspace Processes Only" -ForegroundColor Green
    Write-Host "Workspace: $workspace" -ForegroundColor Gray
    Write-Host ""
    
    $nodeProcesses = Get-Process node -ErrorAction SilentlyContinue | 
                  Where-Object { $_.Path -like "*$workspace*" -or 
                             $_.CommandLine -like "*$workspace*" }
    $scope = "workspace only"
}

if ($nodeProcesses) {
    Write-Host "Found $($nodeProcesses.Count) Node.js process(es) running ($scope):" -ForegroundColor Yellow
    Write-Host ""
    
    $stoppedCount = 0
    foreach ($process in $nodeProcesses) {
        try {
            $processPath = if ($process.Path) { $process.Path } else { "Unknown" }
            Write-Host "  - Stopping PID: $($process.Id)" -ForegroundColor Gray
            Write-Host "    Path: $processPath" -ForegroundColor DarkGray
            
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
            $stoppedCount++
            
            Start-Sleep -Milliseconds 500
        } catch {
            Write-Host "  - Failed to stop PID: $($process.Id)" -ForegroundColor Red
            Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor DarkRed
        }
    }
    
    Write-Host ""
    Write-Host "Successfully stopped $stoppedCount out of $($nodeProcesses.Count) processes." -ForegroundColor Green
    
    # Verify cleanup
    Start-Sleep -Seconds 1
    $remaining = Get-Process node -ErrorAction SilentlyContinue
    if ($remaining) {
        Write-Host ""
        Write-Host "Warning: $($remaining.Count) Node.js process(es) still running." -ForegroundColor Yellow
    }
} else {
    Write-Host "No Node.js processes found running in $scope." -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Cleanup Complete" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
