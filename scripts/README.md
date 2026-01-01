# Semplify Deployment Scripts

Scripts for deploying Semplify to an Azure VM with Dokploy.

## Quick Start

Run the full deployment wizard:

```powershell
.\deploy-full.ps1
```

This will guide you through the entire deployment process.

## Individual Scripts

### 1. create-vm.ps1

Creates the Azure VM and all required networking resources.

```powershell
.\create-vm.ps1
```

**Creates:**
- Resource Group (seemplify-vm-rg)
- Virtual Network (seemplify-vnet)
- Public IP (seemplify-vm-ip)
- Network Security Group (seemplify-vm-nsg)
- Network Interface (seemplify-vm-nic)
- Virtual Machine (seemplify-vm)

**VM Specs:**
- Size: Standard_D4s_v3 (4 vCPU, 16 GB RAM)
- Disk: 128 GB SSD
- OS: Ubuntu 22.04 LTS
- Location: UK South

### 2. setup-vm.sh

Run this script ON the VM after SSH.

```bash
# SSH into VM
ssh seemplify@<VM_IP>

# Make executable and run
chmod +x setup-vm.sh
./setup-vm.sh
```

**Installs:**
- Essential packages (curl, git, htop, etc.)
- UFW firewall configuration
- Fail2ban for security
- Docker and Docker Compose
- Dokploy

### 3. copy-setup-to-vm.ps1

Copies the setup-vm.sh script to the VM.

```powershell
.\copy-setup-to-vm.ps1
# Or with explicit IP
.\copy-setup-to-vm.ps1 -VMPublicIP "1.2.3.4"
```

### 4. ssh-vm.ps1

SSH into the Semplify VM.

```powershell
.\ssh-vm.ps1
# Or with explicit IP
.\ssh-vm.ps1 -VMPublicIP "1.2.3.4"
```

### 5. create-dns-records.ps1

Creates all required Cloudflare DNS records for seemplifyai.com.

```powershell
.\create-dns-records.ps1
# Or with explicit IP
.\create-dns-records.ps1 -VMPublicIP "1.2.3.4"
```

**Creates DNS records for:**
- seemplifyai.com (root)
- app.seemplifyai.com
- api.seemplifyai.com
- leave.seemplifyai.com
- api-leave.seemplifyai.com
- performance.seemplifyai.com
- api-performance.seemplifyai.com
- payroll.seemplifyai.com
- api-payroll.seemplifyai.com
- auth.seemplifyai.com
- dokploy.seemplifyai.com

### 6. delete-vm.ps1

⚠️ **DANGER:** Deletes the VM and ALL associated resources.

```powershell
.\delete-vm.ps1
```

## File: vm-ip.txt

After VM creation, the public IP is saved to `vm-ip.txt`.
Other scripts automatically read this file.

## Deployment Order

1. **Create VM:** `.\create-vm.ps1`
2. **Copy setup script:** `.\copy-setup-to-vm.ps1`
3. **SSH and run setup:** `.\ssh-vm.ps1` then `./setup-vm.sh`
4. **Create DNS records:** `.\create-dns-records.ps1`
5. **Configure Dokploy:** Open http://<VM_IP>:3000

## Full Documentation

See `DOKPLOY-DEPLOYMENT-PLAN.md` in the project root for complete deployment instructions including:

- Environment variables for each application
- Dokploy configuration
- SSL setup
- Database setup
- Troubleshooting
- Maintenance
