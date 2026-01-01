# SSH into Semplify VM
# Usage: .\ssh-vm.ps1
# Or: .\ssh-vm.ps1 -VMPublicIP "1.2.3.4"

param(
    [string]$VMPublicIP
)

$ADMIN_USER = "seemplify"

# If no IP provided, try to read from file
if ([string]::IsNullOrEmpty($VMPublicIP)) {
    $vmIpFile = "$PSScriptRoot\vm-ip.txt"
    if (Test-Path $vmIpFile) {
        $VMPublicIP = Get-Content $vmIpFile -Raw
        $VMPublicIP = $VMPublicIP.Trim()
    } else {
        # Try to get from Azure
        Write-Host "Getting VM IP from Azure..." -ForegroundColor Yellow
        $VMPublicIP = az network public-ip show --resource-group seemplify-vm-rg --name seemplify-vm-ip --query ipAddress --output tsv 2>$null
        
        if ([string]::IsNullOrEmpty($VMPublicIP)) {
            Write-Host "Error: Could not determine VM IP" -ForegroundColor Red
            Write-Host "Usage: .\ssh-vm.ps1 -VMPublicIP '1.2.3.4'" -ForegroundColor Yellow
            exit 1
        }
    }
}

Write-Host "Connecting to Semplify VM..." -ForegroundColor Cyan
Write-Host "  IP: $VMPublicIP" -ForegroundColor White
Write-Host "  User: $ADMIN_USER" -ForegroundColor White
Write-Host ""

ssh $ADMIN_USER@$VMPublicIP
