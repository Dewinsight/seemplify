# Full Deployment Script for Semplify
# This script orchestrates the entire deployment process
# Usage: .\deploy-full.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Semplify Full Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = $PSScriptRoot

# Step 1: Create Azure VM
Write-Host "STEP 1: Create Azure VM" -ForegroundColor Yellow
Write-Host "  This will create a new Azure VM with:" -ForegroundColor White
Write-Host "    - 4 vCPU, 16 GB RAM (Standard_D4s_v3)" -ForegroundColor Gray
Write-Host "    - 128 GB SSD" -ForegroundColor Gray
Write-Host "    - Ubuntu 22.04" -ForegroundColor Gray
Write-Host "    - Public IP with NSG rules" -ForegroundColor Gray
Write-Host ""
$confirm = Read-Host "Create VM? (y/n)"
if ($confirm -eq 'y') {
    & "$ScriptDir\create-vm.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "VM creation failed!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Skipping VM creation" -ForegroundColor Yellow
}
Write-Host ""

# Get VM IP
$vmIpFile = "$ScriptDir\vm-ip.txt"
if (Test-Path $vmIpFile) {
    $VMPublicIP = Get-Content $vmIpFile -Raw
    $VMPublicIP = $VMPublicIP.Trim()
    Write-Host "VM IP: $VMPublicIP" -ForegroundColor Cyan
} else {
    $VMPublicIP = Read-Host "Enter VM Public IP"
    $VMPublicIP | Out-File -FilePath $vmIpFile -NoNewline
}
Write-Host ""

# Step 2: Copy setup script to VM
Write-Host "STEP 2: Copy Setup Script to VM" -ForegroundColor Yellow
$confirm = Read-Host "Copy setup-vm.sh to VM? (y/n)"
if ($confirm -eq 'y') {
    & "$ScriptDir\copy-setup-to-vm.ps1" -VMPublicIP $VMPublicIP
} else {
    Write-Host "Skipping copy" -ForegroundColor Yellow
}
Write-Host ""

# Step 3: SSH into VM and run setup
Write-Host "STEP 3: Run Setup on VM" -ForegroundColor Yellow
Write-Host "  You need to SSH into the VM and run the setup script" -ForegroundColor White
Write-Host ""
Write-Host "  Command: ssh seemplify@$VMPublicIP" -ForegroundColor Cyan
Write-Host "  Then run: chmod +x setup-vm.sh && ./setup-vm.sh" -ForegroundColor Cyan
Write-Host ""
$confirm = Read-Host "Open SSH session now? (y/n)"
if ($confirm -eq 'y') {
    Write-Host ""
    Write-Host "After setup completes, return here and press Enter" -ForegroundColor Yellow
    Write-Host "Dokploy will be available at: http://${VMPublicIP}:3000" -ForegroundColor Cyan
    Write-Host ""
    & "$ScriptDir\ssh-vm.ps1" -VMPublicIP $VMPublicIP
}
Write-Host ""

# Step 4: Create DNS records
Write-Host "STEP 4: Create Cloudflare DNS Records" -ForegroundColor Yellow
Write-Host "  This will create DNS records pointing to your VM" -ForegroundColor White
Write-Host ""
$confirm = Read-Host "Create DNS records? (y/n)"
if ($confirm -eq 'y') {
    & "$ScriptDir\create-dns-records.ps1" -VMPublicIP $VMPublicIP
} else {
    Write-Host "Skipping DNS creation" -ForegroundColor Yellow
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Deployment Infrastructure Ready!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "VM Public IP: $VMPublicIP" -ForegroundColor Cyan
Write-Host ""
Write-Host "Access Points:" -ForegroundColor Cyan
Write-Host "  Dokploy Dashboard: http://${VMPublicIP}:3000" -ForegroundColor White
Write-Host "                  or https://dokploy.seemplifyai.com (after DNS propagation)" -ForegroundColor White
Write-Host ""
Write-Host "Remaining Steps (in Dokploy Dashboard):" -ForegroundColor Yellow
Write-Host "  1. Create admin account" -ForegroundColor White
Write-Host "  2. Add GitHub integration (token required)" -ForegroundColor White
Write-Host "  3. Create 'seemplify' project" -ForegroundColor White
Write-Host "  4. Deploy each application (see DOKPLOY-DEPLOYMENT-PLAN.md)" -ForegroundColor White
Write-Host "  5. Configure domains for each application" -ForegroundColor White
Write-Host "  6. Set environment variables for each application" -ForegroundColor White
Write-Host ""
Write-Host "Documentation:" -ForegroundColor Cyan
Write-Host "  Full deployment guide: DOKPLOY-DEPLOYMENT-PLAN.md" -ForegroundColor White
Write-Host ""
