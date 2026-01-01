# Delete Semplify Azure VM and all resources
# Usage: .\delete-vm.ps1
# WARNING: This will delete all VM resources!

Write-Host "========================================" -ForegroundColor Red
Write-Host "  DELETE Semplify Azure VM" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red
Write-Host ""
Write-Host "WARNING: This will permanently delete:" -ForegroundColor Yellow
Write-Host "  - Virtual Machine (seemplify-vm)" -ForegroundColor White
Write-Host "  - Network Interface" -ForegroundColor White
Write-Host "  - Public IP Address" -ForegroundColor White
Write-Host "  - Network Security Group" -ForegroundColor White
Write-Host "  - Virtual Network" -ForegroundColor White
Write-Host "  - OS Disk" -ForegroundColor White
Write-Host "  - Resource Group (seemplify-vm-rg)" -ForegroundColor White
Write-Host ""
Write-Host "This action CANNOT be undone!" -ForegroundColor Red
Write-Host ""

$confirm = Read-Host "Type 'DELETE' to confirm"
if ($confirm -ne 'DELETE') {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Deleting resource group (this may take several minutes)..." -ForegroundColor Yellow

az group delete --name seemplify-vm-rg --yes --no-wait

Write-Host ""
Write-Host "Deletion initiated!" -ForegroundColor Green
Write-Host "The resource group and all resources are being deleted in the background." -ForegroundColor White
Write-Host ""
Write-Host "To check status:" -ForegroundColor Cyan
Write-Host "  az group show --name seemplify-vm-rg" -ForegroundColor White
Write-Host ""

# Clean up local files
$vmIpFile = "$PSScriptRoot\vm-ip.txt"
if (Test-Path $vmIpFile) {
    Remove-Item $vmIpFile
    Write-Host "Cleaned up: vm-ip.txt" -ForegroundColor Gray
}
