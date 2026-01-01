# Create Azure VM for Semplify
# Usage: .\create-vm.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Semplify Azure VM Creation Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Variables
$RESOURCE_GROUP = "seemplify-vm-rg"
$LOCATION = "uksouth"
$VM_NAME = "seemplify-vm"
$VM_SIZE = "Standard_D4s_v3"
$ADMIN_USER = "seemplify"
$VNET_NAME = "seemplify-vnet"
$SUBNET_NAME = "seemplify-subnet"
$PUBLIC_IP_NAME = "seemplify-vm-ip"
$NSG_NAME = "seemplify-vm-nsg"
$NIC_NAME = "seemplify-vm-nic"

# Check if SSH key exists
$SSH_KEY_PATH = "$env:USERPROFILE\.ssh\id_rsa.pub"
if (!(Test-Path $SSH_KEY_PATH)) {
    Write-Host "SSH key not found. Creating new SSH key pair..." -ForegroundColor Yellow
    ssh-keygen -t rsa -b 4096 -C "seemplify-vm" -f "$env:USERPROFILE\.ssh\id_rsa" -N '""'
}

Write-Host "Using SSH key: $SSH_KEY_PATH" -ForegroundColor Gray
Write-Host ""

# Step 1: Create Resource Group
Write-Host "[1/8] Creating Resource Group..." -ForegroundColor Yellow
az group create --name $RESOURCE_GROUP --location $LOCATION --tags project=seemplify environment=production
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to create resource group" -ForegroundColor Red; exit 1 }
Write-Host "  Resource Group created: $RESOURCE_GROUP" -ForegroundColor Green

# Step 2: Create VNET
Write-Host "[2/8] Creating Virtual Network..." -ForegroundColor Yellow
az network vnet create `
  --resource-group $RESOURCE_GROUP `
  --name $VNET_NAME `
  --address-prefix 10.0.0.0/16 `
  --subnet-name $SUBNET_NAME `
  --subnet-prefix 10.0.1.0/24
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to create VNET" -ForegroundColor Red; exit 1 }
Write-Host "  VNET created: $VNET_NAME" -ForegroundColor Green

# Step 3: Create Public IP
Write-Host "[3/8] Creating Public IP..." -ForegroundColor Yellow
az network public-ip create `
  --resource-group $RESOURCE_GROUP `
  --name $PUBLIC_IP_NAME `
  --allocation-method Static `
  --sku Standard
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to create public IP" -ForegroundColor Red; exit 1 }
Write-Host "  Public IP created: $PUBLIC_IP_NAME" -ForegroundColor Green

# Step 4: Create NSG
Write-Host "[4/8] Creating Network Security Group..." -ForegroundColor Yellow
az network nsg create `
  --resource-group $RESOURCE_GROUP `
  --name $NSG_NAME
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to create NSG" -ForegroundColor Red; exit 1 }
Write-Host "  NSG created: $NSG_NAME" -ForegroundColor Green

# Step 5: Add NSG Rules
Write-Host "[5/8] Adding NSG Rules..." -ForegroundColor Yellow

# Allow SSH
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name $NSG_NAME --name AllowSSH --priority 1000 --destination-port-ranges 22 --access Allow --protocol Tcp --direction Inbound --output none
Write-Host "  Rule added: AllowSSH (port 22)" -ForegroundColor Gray

# Allow HTTP
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name $NSG_NAME --name AllowHTTP --priority 1010 --destination-port-ranges 80 --access Allow --protocol Tcp --direction Inbound --output none
Write-Host "  Rule added: AllowHTTP (port 80)" -ForegroundColor Gray

# Allow HTTPS
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name $NSG_NAME --name AllowHTTPS --priority 1020 --destination-port-ranges 443 --access Allow --protocol Tcp --direction Inbound --output none
Write-Host "  Rule added: AllowHTTPS (port 443)" -ForegroundColor Gray

# Allow Dokploy Dashboard
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name $NSG_NAME --name AllowDokploy --priority 1030 --destination-port-ranges 3000 --access Allow --protocol Tcp --direction Inbound --output none
Write-Host "  Rule added: AllowDokploy (port 3000)" -ForegroundColor Gray

Write-Host "  All NSG rules added" -ForegroundColor Green

# Step 6: Create NIC
Write-Host "[6/8] Creating Network Interface..." -ForegroundColor Yellow
az network nic create `
  --resource-group $RESOURCE_GROUP `
  --name $NIC_NAME `
  --vnet-name $VNET_NAME `
  --subnet $SUBNET_NAME `
  --public-ip-address $PUBLIC_IP_NAME `
  --network-security-group $NSG_NAME
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to create NIC" -ForegroundColor Red; exit 1 }
Write-Host "  NIC created: $NIC_NAME" -ForegroundColor Green

# Step 7: Create VM
Write-Host "[7/8] Creating Virtual Machine (this may take 2-5 minutes)..." -ForegroundColor Yellow
az vm create `
  --resource-group $RESOURCE_GROUP `
  --name $VM_NAME `
  --nics $NIC_NAME `
  --image Ubuntu2204 `
  --size $VM_SIZE `
  --admin-username $ADMIN_USER `
  --ssh-key-values $SSH_KEY_PATH `
  --os-disk-size-gb 128 `
  --tags project=seemplify environment=production
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to create VM" -ForegroundColor Red; exit 1 }
Write-Host "  VM created: $VM_NAME" -ForegroundColor Green

# Step 8: Get Public IP
Write-Host "[8/8] Getting VM Public IP..." -ForegroundColor Yellow
$VM_IP = az network public-ip show --resource-group $RESOURCE_GROUP --name $PUBLIC_IP_NAME --query ipAddress --output tsv
Write-Host "  Public IP: $VM_IP" -ForegroundColor Green

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  VM Created Successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "VM Details:" -ForegroundColor Cyan
Write-Host "  Name:        $VM_NAME" -ForegroundColor White
Write-Host "  Size:        $VM_SIZE (4 vCPU, 16 GB RAM)" -ForegroundColor White
Write-Host "  Location:    $LOCATION" -ForegroundColor White
Write-Host "  Public IP:   $VM_IP" -ForegroundColor White
Write-Host "  Admin User:  $ADMIN_USER" -ForegroundColor White
Write-Host ""
Write-Host "SSH Command:" -ForegroundColor Cyan
Write-Host "  ssh $ADMIN_USER@$VM_IP" -ForegroundColor Yellow
Write-Host ""
Write-Host "Dokploy Dashboard (after setup):" -ForegroundColor Cyan
Write-Host "  http://${VM_IP}:3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. SSH into VM: ssh $ADMIN_USER@$VM_IP" -ForegroundColor White
Write-Host "  2. Copy setup-vm.sh to VM" -ForegroundColor White
Write-Host "  3. Run setup script: chmod +x setup-vm.sh && ./setup-vm.sh" -ForegroundColor White
Write-Host ""

# Save VM IP to file for other scripts
$VM_IP | Out-File -FilePath ".\scripts\vm-ip.txt" -NoNewline
Write-Host "VM IP saved to: .\scripts\vm-ip.txt" -ForegroundColor Gray
