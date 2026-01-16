# Copy setup script to Semplify VM
# Usage: .\copy-setup-to-vm.ps1
# Or: .\copy-setup-to-vm.ps1 -VMPublicIP "1.2.3.4"

param(
    [string]$VMPublicIP
)

$ADMIN_USER = "seemplify"
$SCRIPT_PATH = "$PSScriptRoot\setup-vm.sh"

# If no IP provided, try to read from file
if ([string]::IsNullOrEmpty($VMPublicIP)) {
    $vmIpFile = "$PSScriptRoot\vm-ip.txt"
    if (Test-Path $vmIpFile) {
        $VMPublicIP = Get-Content $vmIpFile -Raw
        $VMPublicIP = $VMPublicIP.Trim()
    } else {
        Write-Host "Getting VM IP from Azure..." -ForegroundColor Yellow
        $VMPublicIP = az network public-ip show --resource-group seemplify-vm-rg --name seemplify-vm-ip --query ipAddress --output tsv 2>$null
        
        if ([string]::IsNullOrEmpty($VMPublicIP)) {
            Write-Host "Error: Could not determine VM IP" -ForegroundColor Red
            Write-Host "Usage: .\copy-setup-to-vm.ps1 -VMPublicIP '1.2.3.4'" -ForegroundColor Yellow
            exit 1
        }
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Copy Setup Script to VM" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Source: $SCRIPT_PATH" -ForegroundColor White
Write-Host "Target: $ADMIN_USER@${VMPublicIP}:~/setup-vm.sh" -ForegroundColor White
Write-Host ""

# Copy the script
Write-Host "Copying setup-vm.sh to VM..." -ForegroundColor Yellow
scp $SCRIPT_PATH "${ADMIN_USER}@${VMPublicIP}:~/setup-vm.sh"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "File copied successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "  1. SSH into VM: ssh $ADMIN_USER@$VMPublicIP" -ForegroundColor White
    Write-Host "  2. Make executable: chmod +x setup-vm.sh" -ForegroundColor White
    Write-Host "  3. Run setup: ./setup-vm.sh" -ForegroundColor White
    Write-Host ""
    Write-Host "Or run this one-liner:" -ForegroundColor Yellow
    Write-Host "  ssh $ADMIN_USER@$VMPublicIP 'chmod +x setup-vm.sh && ./setup-vm.sh'" -ForegroundColor Cyan
} else {
    Write-Host "Failed to copy file" -ForegroundColor Red
}
