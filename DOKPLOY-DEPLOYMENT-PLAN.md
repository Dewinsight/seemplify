# Dokploy Deployment Plan for Semplify

Complete guide to deploying all Semplify applications to an Azure VM using Dokploy.

## ⚠️ IMPORTANT NOTES

- **Domain:** seemplifyai.com (Cloudflare managed)
- **DO NOT TOUCH:** paddie.io
- **Target:** New Azure VM with Dokploy
- **Apps to Deploy:** 5 backends + 4 frontends
- **Deployment Method:** GitHub Actions CI/CD (automatic on push)

---

## 🔐 DOKPLOY ADMIN ACCESS

| Item | Value |
|------|-------|
| **Dokploy Dashboard URL** | http://4.180.153.209:3000 |
| **Admin Email** | admin@seemplifyai.com |
| **Admin Password** | Seemplify2026! |
| **VM IP Address** | 4.180.153.209 |
| **VM SSH User** | seemplify |
| **Azure Region** | West Europe |

### Quick SSH Access
```powershell
ssh seemplify@4.180.153.209
```

---

## 🌐 LIVE PRODUCTION URLs

All applications are deployed and running with SSL certificates:

| Application | URL | Status |
|-------------|-----|--------|
| **Recruiter Frontend** | https://app.seemplifyai.com | ✅ Live |
| **Recruiter Backend API** | https://api.seemplifyai.com | ✅ Live |
| **Leave Frontend** | https://leave.seemplifyai.com | ✅ Live |
| **Leave Backend API** | https://api-leave.seemplifyai.com | ✅ Live |
| **Performance Frontend** | https://performance.seemplifyai.com | ✅ Live |
| **Performance Backend API** | https://api-performance.seemplifyai.com | ✅ Live |
| **Payroll Frontend** | https://payroll.seemplifyai.com | ✅ Live |
| **Payroll Backend API** | https://api-payroll.seemplifyai.com | ✅ Live |
| **Identity Provider / App Hub** | https://auth.seemplifyai.com | ✅ Live |

### MongoDB Databases (Atlas)
| Backend | Database Name |
|---------|---------------|
| identity-provider | `identity` |
| recruiter-backend | `smart_hr_db` |
| leave-backend | `leave-management` |
| performance-backend | `performance_db` |
| payroll-backend | `payroll_db` |

---

## 📋 Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Phase 1: Create Azure VM](#2-phase-1-create-azure-vm)
3. [Phase 2: Initial VM Setup](#3-phase-2-initial-vm-setup)
4. [Phase 3: Install Docker](#4-phase-3-install-docker)
5. [Phase 4: Install Dokploy](#5-phase-4-install-dokploy)
6. [Phase 5: Configure Dokploy](#6-phase-5-configure-dokploy)
7. [Phase 6: Connect GitHub Repository](#7-phase-6-connect-github-repository)
8. [Phase 7: Initial Application Setup in Dokploy](#8-phase-7-initial-application-setup-in-dokploy)
9. [Phase 8: GitHub Actions CI/CD Setup](#9-phase-8-github-actions-cicd-setup) ⭐ **NEW**
10. [Phase 9: Configure Domains in Cloudflare](#10-phase-9-configure-domains-in-cloudflare)
11. [Phase 10: Set Production Environment Variables](#11-phase-10-set-production-environment-variables)
12. [Phase 11: SSL/TLS Configuration](#12-phase-11-ssltls-configuration)
13. [Phase 12: Database Setup](#13-phase-12-database-setup)
14. [Phase 13: Verification & Testing](#14-phase-13-verification--testing)
15. [Scripts](#15-scripts)
16. [Troubleshooting](#16-troubleshooting)
17. [Maintenance](#17-maintenance)

---

## 1. Prerequisites

### Required Accounts & Access

| Requirement | Status | Notes |
|-------------|--------|-------|
| Azure CLI authenticated | ✅ | tonyegboo@gmail.com |
| GitHub CLI authenticated | ✅ | michaelegbo |
| Cloudflare API Token | ✅ | s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ |
| Cloudflare Zone ID (seemplifyai.com) | ✅ | bbc142d2d661d64011e2e4becae7a5c3 |
| SSH Key Pair | ⚠️ | Generate if not exists |

### Applications to Deploy

| Application | Type | Port | Directory |
|-------------|------|------|-----------|
| Identityprovider | Backend | 5008 | `/Identityprovider` |
| Leave Management Backend | Backend | 5002 | `/leave-management/backend` |
| Leave Management Frontend | Frontend | 5003 | `/leave-management/frontend` |
| Payroll Backend | Backend | 5006 | `/payroll/backend` |
| Payroll Frontend | Frontend | 5007 | `/payroll/frontend` |
| Performance Backend | Backend | 5004 | `/performance/backend` |
| Performance Frontend | Frontend | 5005 | `/performance/frontend` |
| Recruiter Backend | Backend | 5001 | `/recruiter/backend` |
| Recruiter Frontend | Frontend | 5000 | `/recruiter/frontend` |

### Planned Subdomain Structure

| Application | Subdomain | Full URL |
|-------------|-----------|----------|
| Recruiter Frontend | app | https://app.seemplifyai.com |
| Leave Management Frontend | leave | https://leave.seemplifyai.com |
| Performance Frontend | performance | https://performance.seemplifyai.com |
| Payroll Frontend | payroll | https://payroll.seemplifyai.com |
| Recruiter Backend | api | https://api.seemplifyai.com |
| Leave Management Backend | api-leave | https://api-leave.seemplifyai.com |
| Performance Backend | api-performance | https://api-performance.seemplifyai.com |
| Payroll Backend | api-payroll | https://api-payroll.seemplifyai.com |
| Identity Provider | auth | https://auth.seemplifyai.com |
| Dokploy Dashboard | dokploy | https://dokploy.seemplifyai.com |

---

## 2. Phase 1: Create Azure VM

### Step 1.1: Generate SSH Key (if not exists)

```powershell
# Run on your local machine (Windows PowerShell)
# Check if SSH key exists
if (!(Test-Path "$env:USERPROFILE\.ssh\id_rsa.pub")) {
    ssh-keygen -t rsa -b 4096 -C "seemplify-vm" -f "$env:USERPROFILE\.ssh\id_rsa"
}

# Display public key (you'll need this)
Get-Content "$env:USERPROFILE\.ssh\id_rsa.pub"
```

### Step 1.2: Create Resource Group

```bash
az group create \
  --name seemplify-vm-rg \
  --location uksouth \
  --tags project=seemplify environment=production
```

### Step 1.3: Create Virtual Network

```bash
az network vnet create \
  --resource-group seemplify-vm-rg \
  --name seemplify-vnet \
  --address-prefix 10.0.0.0/16 \
  --subnet-name seemplify-subnet \
  --subnet-prefix 10.0.1.0/24
```

### Step 1.4: Create Public IP Address

```bash
az network public-ip create \
  --resource-group seemplify-vm-rg \
  --name seemplify-vm-ip \
  --allocation-method Static \
  --sku Standard \
  --zone 1
```

### Step 1.5: Create Network Security Group

```bash
az network nsg create \
  --resource-group seemplify-vm-rg \
  --name seemplify-vm-nsg
```

### Step 1.6: Add NSG Rules

```bash
# Allow SSH (port 22)
az network nsg rule create \
  --resource-group seemplify-vm-rg \
  --nsg-name seemplify-vm-nsg \
  --name AllowSSH \
  --priority 1000 \
  --destination-port-ranges 22 \
  --access Allow \
  --protocol Tcp \
  --direction Inbound

# Allow HTTP (port 80)
az network nsg rule create \
  --resource-group seemplify-vm-rg \
  --nsg-name seemplify-vm-nsg \
  --name AllowHTTP \
  --priority 1010 \
  --destination-port-ranges 80 \
  --access Allow \
  --protocol Tcp \
  --direction Inbound

# Allow HTTPS (port 443)
az network nsg rule create \
  --resource-group seemplify-vm-rg \
  --nsg-name seemplify-vm-nsg \
  --name AllowHTTPS \
  --priority 1020 \
  --destination-port-ranges 443 \
  --access Allow \
  --protocol Tcp \
  --direction Inbound

# Allow Dokploy Dashboard (port 3000)
az network nsg rule create \
  --resource-group seemplify-vm-rg \
  --nsg-name seemplify-vm-nsg \
  --name AllowDokploy \
  --priority 1030 \
  --destination-port-ranges 3000 \
  --access Allow \
  --protocol Tcp \
  --direction Inbound
```

### Step 1.7: Create Network Interface

```bash
az network nic create \
  --resource-group seemplify-vm-rg \
  --name seemplify-vm-nic \
  --vnet-name seemplify-vnet \
  --subnet seemplify-subnet \
  --public-ip-address seemplify-vm-ip \
  --network-security-group seemplify-vm-nsg
```

### Step 1.8: Create the VM

```bash
az vm create \
  --resource-group seemplify-vm-rg \
  --name seemplify-vm \
  --nics seemplify-vm-nic \
  --image Ubuntu2204 \
  --size Standard_D4s_v3 \
  --admin-username seemplify \
  --ssh-key-values ~/.ssh/id_rsa.pub \
  --os-disk-size-gb 128 \
  --tags project=seemplify environment=production
```

**VM Specs (Standard_D4s_v3):**
- 4 vCPUs
- 16 GB RAM
- 128 GB SSD
- Cost: ~$140/month

### Step 1.9: Get VM Public IP

```bash
az network public-ip show \
  --resource-group seemplify-vm-rg \
  --name seemplify-vm-ip \
  --query ipAddress \
  --output tsv
```

**Save this IP address - you'll need it for DNS configuration.**

---

## 3. Phase 2: Initial VM Setup

### Step 2.1: SSH into VM

```bash
ssh seemplify@<VM_PUBLIC_IP>
```

### Step 2.2: Update System

```bash
sudo apt update && sudo apt upgrade -y
```

### Step 2.3: Install Essential Packages

```bash
sudo apt install -y \
  curl \
  wget \
  git \
  vim \
  htop \
  ufw \
  fail2ban \
  unzip \
  software-properties-common \
  apt-transport-https \
  ca-certificates \
  gnupg \
  lsb-release
```

### Step 2.4: Configure Firewall (UFW)

```bash
# Enable UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow Dokploy Dashboard
sudo ufw allow 3000/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

### Step 2.5: Configure Fail2Ban (Security)

```bash
# Start and enable fail2ban
sudo systemctl start fail2ban
sudo systemctl enable fail2ban

# Check status
sudo systemctl status fail2ban
```

### Step 2.6: Set Timezone

```bash
sudo timedatectl set-timezone Europe/London
```

### Step 2.7: Create Swap File (Optional but recommended)

```bash
# Create 4GB swap file
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify
free -h
```

---

## 4. Phase 3: Install Docker

### Step 3.1: Remove Old Docker Versions (if any)

```bash
sudo apt remove docker docker-engine docker.io containerd runc 2>/dev/null
```

### Step 3.2: Install Docker using Official Script

```bash
# Download and run Docker install script
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add current user to docker group
sudo usermod -aG docker $USER

# Apply group changes (or logout/login)
newgrp docker
```

### Step 3.3: Verify Docker Installation

```bash
# Check Docker version
docker --version

# Check Docker Compose version
docker compose version

# Test Docker
docker run hello-world
```

### Step 3.4: Configure Docker to Start on Boot

```bash
sudo systemctl enable docker
sudo systemctl start docker
```

### Step 3.5: Configure Docker Daemon (Optional - for performance)

```bash
sudo nano /etc/docker/daemon.json
```

Add this content:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
```

Restart Docker:

```bash
sudo systemctl restart docker
```

---

## 5. Phase 4: Install Dokploy

### Step 4.1: Install Dokploy

```bash
# Install Dokploy using official installer
curl -sSL https://dokploy.com/install.sh | sh
```

**Alternative method (manual):**

```bash
# Create directory
mkdir -p /opt/dokploy
cd /opt/dokploy

# Download docker-compose.yml
curl -sSL https://raw.githubusercontent.com/Dokploy/dokploy/main/docker-compose.yml -o docker-compose.yml

# Start Dokploy
docker compose up -d
```

### Step 4.2: Verify Dokploy is Running

```bash
# Check running containers
docker ps

# Check Dokploy logs
docker logs dokploy
```

### Step 4.3: Access Dokploy Dashboard

Open in browser:

```
http://<VM_PUBLIC_IP>:3000
```

### Step 4.4: Complete Initial Setup

1. Open `http://<VM_PUBLIC_IP>:3000` in browser
2. Create admin account:
   - **Email:** admin@seemplifyai.com (or your email)
   - **Password:** (create strong password)
3. Save credentials securely

---

## 6. Phase 5: Configure Dokploy

### Step 5.1: Configure Server Settings

In Dokploy Dashboard:

1. Go to **Settings** → **Server**
2. Set **Server Name:** `seemplify-production`
3. Configure **Domain:** `seemplifyai.com`

### Step 5.2: Configure Traefik (Reverse Proxy)

Dokploy uses Traefik for routing. In Dashboard:

1. Go to **Settings** → **Traefik**
2. Enable **HTTPS redirect**
3. Configure **Let's Encrypt email:** your-email@example.com

### Step 5.3: Create Project

1. Go to **Projects** → **Create Project**
2. **Project Name:** `seemplify`
3. **Description:** `Semplify HR Management Platform`

---

## 7. Phase 6: Connect GitHub Repository

### Step 6.1: Generate GitHub Personal Access Token

1. Go to: https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Set scopes:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `read:packages`
4. Copy the token

### Step 6.2: Add GitHub to Dokploy

In Dokploy Dashboard:

1. Go to **Settings** → **Git Providers**
2. Click **Add Provider**
3. Select **GitHub**
4. Enter your GitHub token
5. Test connection

### Step 6.3: Verify Repository Access

1. Go to **Projects** → **seemplify**
2. Click **Add Application**
3. Select **GitHub** as source
4. You should see `michaelegbo/seemplify` repository

---

## 8. Phase 7: Initial Application Setup in Dokploy

> **Note:** This phase sets up the applications in Dokploy. After this, GitHub Actions will handle automatic deployments on every push to `main`.

### Step 7.1: Deploy Recruiter Backend

1. Go to **Projects** → **seemplify** → **Add Application**
2. Configure:
   - **Name:** `recruiter-backend`
   - **Source:** GitHub
   - **Repository:** `michaelegbo/seemplify`
   - **Branch:** `main`
   - **Build Path:** `/recruiter/backend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Port:** `5001`
3. Click **Deploy**

### Step 7.2: Deploy Recruiter Frontend

1. **Add Application**
2. Configure:
   - **Name:** `recruiter-frontend`
   - **Source:** GitHub
   - **Repository:** `michaelegbo/seemplify`
   - **Branch:** `main`
   - **Build Path:** `/recruiter/frontend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Port:** `3000` (Next.js default)
3. Click **Deploy**

### Step 7.3: Deploy Leave Management Backend

1. **Add Application**
2. Configure:
   - **Name:** `leave-backend`
   - **Source:** GitHub
   - **Repository:** `michaelegbo/seemplify`
   - **Branch:** `main`
   - **Build Path:** `/leave-management/backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Port:** `5002`
3. Click **Deploy**

### Step 7.4: Deploy Leave Management Frontend

1. **Add Application**
2. Configure:
   - **Name:** `leave-frontend`
   - **Source:** GitHub
   - **Repository:** `michaelegbo/seemplify`
   - **Branch:** `main`
   - **Build Path:** `/leave-management/frontend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Port:** `3000`
3. Click **Deploy**

### Step 7.5: Deploy Performance Backend

1. **Add Application**
2. Configure:
   - **Name:** `performance-backend`
   - **Source:** GitHub
   - **Repository:** `michaelegbo/seemplify`
   - **Branch:** `main`
   - **Build Path:** `/performance/backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Port:** `5004`
3. Click **Deploy**

### Step 7.6: Deploy Performance Frontend

1. **Add Application**
2. Configure:
   - **Name:** `performance-frontend`
   - **Source:** GitHub
   - **Repository:** `michaelegbo/seemplify`
   - **Branch:** `main`
   - **Build Path:** `/performance/frontend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Port:** `3000`
3. Click **Deploy**

### Step 7.7: Deploy Payroll Backend

1. **Add Application**
2. Configure:
   - **Name:** `payroll-backend`
   - **Source:** GitHub
   - **Repository:** `michaelegbo/seemplify`
   - **Branch:** `main`
   - **Build Path:** `/payroll/backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Port:** `5006`
3. Click **Deploy**

### Step 7.8: Deploy Payroll Frontend

1. **Add Application**
2. Configure:
   - **Name:** `payroll-frontend`
   - **Source:** GitHub
   - **Repository:** `michaelegbo/seemplify`
   - **Branch:** `main`
   - **Build Path:** `/payroll/frontend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Port:** `3000`
3. Click **Deploy**

### Step 7.9: Deploy Identity Provider

1. **Add Application**
2. Configure:
   - **Name:** `identity-provider`
   - **Source:** GitHub
   - **Repository:** `michaelegbo/seemplify`
   - **Branch:** `main`
   - **Build Path:** `/Identityprovider`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Port:** `5008`
3. Click **Deploy**

---

## 9. Phase 8: GitHub Actions CI/CD Setup ⭐

This is the key phase - setting up automatic deployments via GitHub Actions.

### How It Works

```
Push to main → GitHub Actions triggers → Dokploy API called → App rebuilds & deploys
```

**Workflow Files Created:**

| Workflow | Triggers On | File |
|----------|-------------|------|
| Deploy Recruiter Backend | `recruiter/backend/**` changes | `.github/workflows/deploy-recruiter-backend.yml` |
| Deploy Recruiter Frontend | `recruiter/frontend/**` changes | `.github/workflows/deploy-recruiter-frontend.yml` |
| Deploy Leave Backend | `leave-management/backend/**` changes | `.github/workflows/deploy-leave-backend.yml` |
| Deploy Leave Frontend | `leave-management/frontend/**` changes | `.github/workflows/deploy-leave-frontend.yml` |
| Deploy Performance Backend | `performance/backend/**` changes | `.github/workflows/deploy-performance-backend.yml` |
| Deploy Performance Frontend | `performance/frontend/**` changes | `.github/workflows/deploy-performance-frontend.yml` |
| Deploy Payroll Backend | `payroll/backend/**` changes | `.github/workflows/deploy-payroll-backend.yml` |
| Deploy Payroll Frontend | `payroll/frontend/**` changes | `.github/workflows/deploy-payroll-frontend.yml` |
| Deploy Identity Provider | `Identityprovider/**` changes | `.github/workflows/deploy-identity-provider.yml` |
| Deploy All Apps | Manual trigger only | `.github/workflows/deploy-all.yml` |

### Step 8.1: Get Dokploy API Token

1. Open Dokploy Dashboard: `https://dokploy.seemplifyai.com` (or `http://<VM_IP>:3000`)
2. Go to **Settings** → **API** → **Tokens**
3. Click **Create Token**
4. Name: `github-actions`
5. Copy the token (you'll need it for GitHub secrets)

### Step 8.2: Get Application IDs from Dokploy

For each application you created in Phase 7, get its ID:

1. Go to **Projects** → **seemplify**
2. Click on each application
3. Look at the URL: `https://dokploy.seemplifyai.com/project/<project_id>/services/application/<APP_ID>`
4. Copy the `<APP_ID>` for each application

**Record all Application IDs:**

| Application | App ID |
|-------------|--------|
| recruiter-backend | `<copy from URL>` |
| recruiter-frontend | `<copy from URL>` |
| leave-backend | `<copy from URL>` |
| leave-frontend | `<copy from URL>` |
| performance-backend | `<copy from URL>` |
| performance-frontend | `<copy from URL>` |
| payroll-backend | `<copy from URL>` |
| payroll-frontend | `<copy from URL>` |
| identity-provider | `<copy from URL>` |

### Step 8.3: Add GitHub Repository Secrets

Go to: **GitHub Repo** → **Settings** → **Secrets and variables** → **Actions**

Click **New repository secret** for each:

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `DOKPLOY_URL` | `https://dokploy.seemplifyai.com` | Dokploy dashboard URL |
| `DOKPLOY_TOKEN` | `<your-api-token>` | API token from Step 8.1 |
| `RECRUITER_BACKEND_APP_ID` | `<app-id>` | From Dokploy URL |
| `RECRUITER_FRONTEND_APP_ID` | `<app-id>` | From Dokploy URL |
| `LEAVE_BACKEND_APP_ID` | `<app-id>` | From Dokploy URL |
| `LEAVE_FRONTEND_APP_ID` | `<app-id>` | From Dokploy URL |
| `PERFORMANCE_BACKEND_APP_ID` | `<app-id>` | From Dokploy URL |
| `PERFORMANCE_FRONTEND_APP_ID` | `<app-id>` | From Dokploy URL |
| `PAYROLL_BACKEND_APP_ID` | `<app-id>` | From Dokploy URL |
| `PAYROLL_FRONTEND_APP_ID` | `<app-id>` | From Dokploy URL |
| `IDENTITY_PROVIDER_APP_ID` | `<app-id>` | From Dokploy URL |

### Step 8.4: Add Secrets via GitHub CLI (Alternative)

```bash
# Set Dokploy URL
gh secret set DOKPLOY_URL --body "https://dokploy.seemplifyai.com"

# Set Dokploy API Token
gh secret set DOKPLOY_TOKEN --body "<your-api-token>"

# Set Application IDs
gh secret set RECRUITER_BACKEND_APP_ID --body "<app-id>"
gh secret set RECRUITER_FRONTEND_APP_ID --body "<app-id>"
gh secret set LEAVE_BACKEND_APP_ID --body "<app-id>"
gh secret set LEAVE_FRONTEND_APP_ID --body "<app-id>"
gh secret set PERFORMANCE_BACKEND_APP_ID --body "<app-id>"
gh secret set PERFORMANCE_FRONTEND_APP_ID --body "<app-id>"
gh secret set PAYROLL_BACKEND_APP_ID --body "<app-id>"
gh secret set PAYROLL_FRONTEND_APP_ID --body "<app-id>"
gh secret set IDENTITY_PROVIDER_APP_ID --body "<app-id>"
```

### Step 8.5: Test Automatic Deployment

1. Make a small change to any application (e.g., add a comment)
2. Commit and push to `main`:

```bash
git add .
git commit -m "test: trigger CI/CD deployment"
git push
```

3. Go to **GitHub** → **Actions** tab
4. Watch the workflow run
5. Check Dokploy dashboard for deployment status

### Step 8.6: Manual Deployment (All Apps)

To deploy all applications at once:

1. Go to **GitHub** → **Actions**
2. Select **Deploy All Applications**
3. Click **Run workflow**
4. Type `deploy-all` to confirm
5. Click **Run workflow**

### Step 8.7: Verify GitHub Actions Setup

```bash
# Check workflow files exist
ls -la .github/workflows/

# List all workflows
gh workflow list

# View recent workflow runs
gh run list --limit 10
```

### CI/CD Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        DEVELOPER                                 │
│  1. Edit code in recruiter/frontend/                            │
│  2. git commit -m "feat: add new feature"                       │
│  3. git push origin main                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      GITHUB ACTIONS                              │
│  • Detects change in recruiter/frontend/**                      │
│  • Triggers deploy-recruiter-frontend.yml                       │
│  • Calls Dokploy API: POST /api/application.redeploy            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         DOKPLOY                                  │
│  • Receives redeploy request                                    │
│  • Pulls latest code from GitHub                                │
│  • Builds application (npm install, npm run build)              │
│  • Deploys to Docker container                                  │
│  • Updates Traefik routing                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LIVE APPLICATION                            │
│  • https://app.seemplifyai.com now shows new feature            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. Phase 9: Configure Domains in Cloudflare

### Step 8.1: Get VM Public IP

```bash
az network public-ip show \
  --resource-group seemplify-vm-rg \
  --name seemplify-vm-ip \
  --query ipAddress \
  --output tsv
```

### Step 8.2: Create DNS Records

**Using Cloudflare API:**

```bash
# Set variables
CLOUDFLARE_API_TOKEN="s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
CLOUDFLARE_ZONE_ID="bbc142d2d661d64011e2e4becae7a5c3"
VM_IP="<YOUR_VM_PUBLIC_IP>"

# Create A record for root domain
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "@",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'

# Create A record for app.seemplifyai.com (Recruiter Frontend)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "app",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'

# Create A record for api.seemplifyai.com (Recruiter Backend)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "api",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'

# Create A record for leave.seemplifyai.com
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "leave",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'

# Create A record for api-leave.seemplifyai.com
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "api-leave",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'

# Create A record for performance.seemplifyai.com
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "performance",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'

# Create A record for api-performance.seemplifyai.com
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "api-performance",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'

# Create A record for payroll.seemplifyai.com
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "payroll",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'

# Create A record for api-payroll.seemplifyai.com
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "api-payroll",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'

# Create A record for auth.seemplifyai.com (Identity Provider)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "auth",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'

# Create A record for dokploy.seemplifyai.com (Dokploy Dashboard)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "dokploy",
    "content": "'$VM_IP'",
    "ttl": 1,
    "proxied": true
  }'
```

### Step 8.3: Configure Domains in Dokploy

For each application in Dokploy:

1. Go to **Application** → **Domains**
2. Click **Add Domain**
3. Enter the subdomain (e.g., `app.seemplifyai.com`)
4. Enable **HTTPS**
5. Click **Save**

**Domain Mapping:**

| Application | Domain |
|-------------|--------|
| recruiter-frontend | app.seemplifyai.com |
| recruiter-backend | api.seemplifyai.com |
| leave-frontend | leave.seemplifyai.com |
| leave-backend | api-leave.seemplifyai.com |
| performance-frontend | performance.seemplifyai.com |
| performance-backend | api-performance.seemplifyai.com |
| payroll-frontend | payroll.seemplifyai.com |
| payroll-backend | api-payroll.seemplifyai.com |
| identity-provider | auth.seemplifyai.com |

---

## 11. Phase 10: Set Production Environment Variables

### Step 9.1: Recruiter Backend Environment Variables

In Dokploy → **recruiter-backend** → **Environment Variables**:

```env
NODE_ENV=production
PORT=5001

# Database
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/seemplify_recruiter?retryWrites=true&w=majority

# Authentication
JWT_SECRET=<generate-strong-secret-64-chars>
JWT_EXPIRES_IN=7d
SESSION_SECRET=<generate-strong-secret-64-chars>

# Azure OpenAI
AZURE_OPENAI_API_KEY=<your-azure-openai-key>
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4

# Email (Sendinblue/Brevo)
SENDINBLUE_API_KEY=<your-sendinblue-key>
EMAIL_FROM=noreply@seemplifyai.com

# Frontend URL (for CORS)
FRONTEND_URL=https://app.seemplifyai.com
CORS_ORIGIN=https://app.seemplifyai.com

# Identity Provider
IDP_URL=https://auth.seemplifyai.com
IDP_CLIENT_ID=<your-client-id>
IDP_CLIENT_SECRET=<your-client-secret>
```

### Step 9.2: Recruiter Frontend Environment Variables

In Dokploy → **recruiter-frontend** → **Environment Variables**:

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.seemplifyai.com
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
NEXTAUTH_URL=https://app.seemplifyai.com
NEXTAUTH_SECRET=<generate-strong-secret-64-chars>
```

### Step 9.3: Leave Management Backend Environment Variables

```env
NODE_ENV=production
PORT=5002

# Database
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/seemplify_leave?retryWrites=true&w=majority

# Authentication
JWT_SECRET=<generate-strong-secret-64-chars>
SESSION_SECRET=<generate-strong-secret-64-chars>

# Frontend URL
FRONTEND_URL=https://leave.seemplifyai.com
CORS_ORIGIN=https://leave.seemplifyai.com

# Identity Provider
IDP_URL=https://auth.seemplifyai.com
```

### Step 9.4: Leave Management Frontend Environment Variables

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api-leave.seemplifyai.com
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
NEXTAUTH_URL=https://leave.seemplifyai.com
NEXTAUTH_SECRET=<generate-strong-secret-64-chars>
```

### Step 9.5: Performance Backend Environment Variables

```env
NODE_ENV=production
PORT=5004

# Database
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/seemplify_performance?retryWrites=true&w=majority

# Authentication
JWT_SECRET=<generate-strong-secret-64-chars>
SESSION_SECRET=<generate-strong-secret-64-chars>

# Azure OpenAI (for AI features)
AZURE_OPENAI_API_KEY=<your-azure-openai-key>
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com

# Frontend URL
FRONTEND_URL=https://performance.seemplifyai.com
CORS_ORIGIN=https://performance.seemplifyai.com

# Identity Provider
IDP_URL=https://auth.seemplifyai.com
```

### Step 9.6: Performance Frontend Environment Variables

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api-performance.seemplifyai.com
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
NEXTAUTH_URL=https://performance.seemplifyai.com
NEXTAUTH_SECRET=<generate-strong-secret-64-chars>
```

### Step 9.7: Payroll Backend Environment Variables

```env
NODE_ENV=production
PORT=5006

# Database
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/seemplify_payroll?retryWrites=true&w=majority

# Authentication
JWT_SECRET=<generate-strong-secret-64-chars>
SESSION_SECRET=<generate-strong-secret-64-chars>

# Frontend URL
FRONTEND_URL=https://payroll.seemplifyai.com
CORS_ORIGIN=https://payroll.seemplifyai.com

# Identity Provider
IDP_URL=https://auth.seemplifyai.com

# Integration with other services
LEAVE_API_URL=https://api-leave.seemplifyai.com
PERFORMANCE_API_URL=https://api-performance.seemplifyai.com
```

### Step 9.8: Payroll Frontend Environment Variables

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api-payroll.seemplifyai.com
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
NEXTAUTH_URL=https://payroll.seemplifyai.com
NEXTAUTH_SECRET=<generate-strong-secret-64-chars>
```

### Step 9.9: Identity Provider Environment Variables

```env
NODE_ENV=production
PORT=5008

# Database
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/seemplify_idp?retryWrites=true&w=majority

# Authentication
JWT_SECRET=<generate-strong-secret-64-chars>
SESSION_SECRET=<generate-strong-secret-64-chars>

# OAuth Configuration
OAUTH_CLIENT_ID=<your-client-id>
OAUTH_CLIENT_SECRET=<your-client-secret>

# Allowed Redirect URIs
ALLOWED_REDIRECT_URIS=https://app.seemplifyai.com/api/auth/callback,https://leave.seemplifyai.com/api/auth/callback,https://performance.seemplifyai.com/api/auth/callback,https://payroll.seemplifyai.com/api/auth/callback

# Email Configuration
SENDINBLUE_API_KEY=<your-sendinblue-key>
EMAIL_FROM=noreply@seemplifyai.com
```

### Step 9.10: Generate Strong Secrets

Use this command to generate secure secrets:

```bash
# Generate 64-character random string
openssl rand -hex 32
```

---

## 12. Phase 11: SSL/TLS Configuration

### Step 10.1: Configure Cloudflare SSL

1. Go to Cloudflare Dashboard → **SSL/TLS**
2. Set **SSL/TLS encryption mode** to **Full (strict)**
3. Enable **Always Use HTTPS**
4. Enable **Automatic HTTPS Rewrites**

### Step 10.2: Configure Let's Encrypt in Dokploy

Dokploy uses Traefik with Let's Encrypt for SSL certificates.

1. Go to **Settings** → **Traefik**
2. Configure **ACME Email:** your-email@example.com
3. Enable **Auto SSL**

### Step 10.3: Verify SSL Certificates

After deploying and configuring domains, verify SSL:

```bash
# Check SSL certificate
curl -vI https://app.seemplifyai.com 2>&1 | grep "SSL certificate"

# Or use openssl
openssl s_client -connect app.seemplifyai.com:443 -servername app.seemplifyai.com
```

---

## 13. Phase 12: Database Setup

### Option A: MongoDB Atlas (Recommended)

1. Go to https://cloud.mongodb.com
2. Create free cluster or upgrade existing
3. Create database users
4. Whitelist VM IP address
5. Get connection strings for each database

### Option B: Self-Hosted MongoDB on VM

```bash
# SSH into VM
ssh seemplify@<VM_IP>

# Install MongoDB
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
   sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg \
   --dearmor

echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt update
sudo apt install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod

# Create databases and users
mongosh

use seemplify_recruiter
db.createUser({user: "recruiter", pwd: "<password>", roles: ["readWrite"]})

use seemplify_leave
db.createUser({user: "leave", pwd: "<password>", roles: ["readWrite"]})

use seemplify_performance
db.createUser({user: "performance", pwd: "<password>", roles: ["readWrite"]})

use seemplify_payroll
db.createUser({user: "payroll", pwd: "<password>", roles: ["readWrite"]})

use seemplify_idp
db.createUser({user: "idp", pwd: "<password>", roles: ["readWrite"]})
```

---

## 14. Phase 13: Verification & Testing

### Step 12.1: Check All Containers Running

```bash
# SSH into VM
ssh seemplify@<VM_IP>

# List all containers
docker ps

# Check container logs
docker logs <container_name>
```

### Step 12.2: Test Each Endpoint

```bash
# Test Recruiter Frontend
curl -I https://app.seemplifyai.com

# Test Recruiter Backend
curl https://api.seemplifyai.com/health

# Test Leave Frontend
curl -I https://leave.seemplifyai.com

# Test Leave Backend
curl https://api-leave.seemplifyai.com/health

# Test Performance Frontend
curl -I https://performance.seemplifyai.com

# Test Performance Backend
curl https://api-performance.seemplifyai.com/health

# Test Payroll Frontend
curl -I https://payroll.seemplifyai.com

# Test Payroll Backend
curl https://api-payroll.seemplifyai.com/health

# Test Identity Provider
curl https://auth.seemplifyai.com/health
```

### Step 12.3: Check Application Logs

In Dokploy Dashboard:

1. Go to each application
2. Click **Logs**
3. Check for errors

### Step 12.4: Monitor Resources

```bash
# SSH into VM
ssh seemplify@<VM_IP>

# Check system resources
htop

# Check disk usage
df -h

# Check Docker stats
docker stats
```

---

## 15. Scripts

### Script 1: SSH into VM (Windows PowerShell)

Save as `ssh-seemplify.ps1`:

```powershell
# SSH into Semplify VM
# Usage: .\ssh-seemplify.ps1

$VM_IP = "<YOUR_VM_PUBLIC_IP>"
$VM_USER = "seemplify"

Write-Host "Connecting to Semplify VM at $VM_IP..." -ForegroundColor Cyan
ssh $VM_USER@$VM_IP
```

### Script 2: Create Azure VM (Windows PowerShell)

Save as `create-vm.ps1`:

```powershell
# Create Azure VM for Semplify
# Usage: .\create-vm.ps1

Write-Host "Creating Semplify Azure VM..." -ForegroundColor Cyan

# Variables
$RESOURCE_GROUP = "seemplify-vm-rg"
$LOCATION = "uksouth"
$VM_NAME = "seemplify-vm"
$VM_SIZE = "Standard_D4s_v3"
$ADMIN_USER = "seemplify"

# Create Resource Group
Write-Host "Creating Resource Group..." -ForegroundColor Yellow
az group create --name $RESOURCE_GROUP --location $LOCATION --tags project=seemplify environment=production

# Create VNET
Write-Host "Creating Virtual Network..." -ForegroundColor Yellow
az network vnet create `
  --resource-group $RESOURCE_GROUP `
  --name seemplify-vnet `
  --address-prefix 10.0.0.0/16 `
  --subnet-name seemplify-subnet `
  --subnet-prefix 10.0.1.0/24

# Create Public IP
Write-Host "Creating Public IP..." -ForegroundColor Yellow
az network public-ip create `
  --resource-group $RESOURCE_GROUP `
  --name seemplify-vm-ip `
  --allocation-method Static `
  --sku Standard

# Create NSG
Write-Host "Creating Network Security Group..." -ForegroundColor Yellow
az network nsg create `
  --resource-group $RESOURCE_GROUP `
  --name seemplify-vm-nsg

# Add NSG Rules
Write-Host "Adding NSG Rules..." -ForegroundColor Yellow
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name seemplify-vm-nsg --name AllowSSH --priority 1000 --destination-port-ranges 22 --access Allow --protocol Tcp --direction Inbound
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name seemplify-vm-nsg --name AllowHTTP --priority 1010 --destination-port-ranges 80 --access Allow --protocol Tcp --direction Inbound
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name seemplify-vm-nsg --name AllowHTTPS --priority 1020 --destination-port-ranges 443 --access Allow --protocol Tcp --direction Inbound
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name seemplify-vm-nsg --name AllowDokploy --priority 1030 --destination-port-ranges 3000 --access Allow --protocol Tcp --direction Inbound

# Create NIC
Write-Host "Creating Network Interface..." -ForegroundColor Yellow
az network nic create `
  --resource-group $RESOURCE_GROUP `
  --name seemplify-vm-nic `
  --vnet-name seemplify-vnet `
  --subnet seemplify-subnet `
  --public-ip-address seemplify-vm-ip `
  --network-security-group seemplify-vm-nsg

# Create VM
Write-Host "Creating Virtual Machine (this may take a few minutes)..." -ForegroundColor Yellow
az vm create `
  --resource-group $RESOURCE_GROUP `
  --name $VM_NAME `
  --nics seemplify-vm-nic `
  --image Ubuntu2204 `
  --size $VM_SIZE `
  --admin-username $ADMIN_USER `
  --ssh-key-values ~/.ssh/id_rsa.pub `
  --os-disk-size-gb 128 `
  --tags project=seemplify environment=production

# Get Public IP
Write-Host "Getting VM Public IP..." -ForegroundColor Yellow
$VM_IP = az network public-ip show --resource-group $RESOURCE_GROUP --name seemplify-vm-ip --query ipAddress --output tsv

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "VM Created Successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "VM Public IP: $VM_IP" -ForegroundColor Cyan
Write-Host "SSH Command:  ssh $ADMIN_USER@$VM_IP" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. SSH into VM: ssh $ADMIN_USER@$VM_IP" -ForegroundColor White
Write-Host "2. Run setup script: ./setup-vm.sh" -ForegroundColor White
Write-Host ""
```

### Script 3: VM Setup Script (Run on VM)

Save as `setup-vm.sh` and run on VM:

```bash
#!/bin/bash

# Semplify VM Setup Script
# Run this script after SSH into the VM

set -e

echo "=========================================="
echo "  Semplify VM Setup Script"
echo "=========================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Updating system...${NC}"
sudo apt update && sudo apt upgrade -y

echo -e "${YELLOW}Step 2: Installing essential packages...${NC}"
sudo apt install -y \
  curl \
  wget \
  git \
  vim \
  htop \
  ufw \
  fail2ban \
  unzip \
  software-properties-common \
  apt-transport-https \
  ca-certificates \
  gnupg \
  lsb-release

echo -e "${YELLOW}Step 3: Configuring firewall...${NC}"
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp
sudo ufw --force enable

echo -e "${YELLOW}Step 4: Configuring fail2ban...${NC}"
sudo systemctl start fail2ban
sudo systemctl enable fail2ban

echo -e "${YELLOW}Step 5: Setting timezone...${NC}"
sudo timedatectl set-timezone Europe/London

echo -e "${YELLOW}Step 6: Creating swap file...${NC}"
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

echo -e "${YELLOW}Step 7: Installing Docker...${NC}"
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

echo -e "${YELLOW}Step 8: Configuring Docker daemon...${NC}"
sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
EOF

sudo systemctl restart docker
sudo systemctl enable docker

echo -e "${YELLOW}Step 9: Installing Dokploy...${NC}"
curl -sSL https://dokploy.com/install.sh | sh

echo ""
echo -e "${GREEN}=========================================="
echo -e "  Setup Complete!"
echo -e "==========================================${NC}"
echo ""
echo -e "Dokploy Dashboard: http://$(curl -s ifconfig.me):3000"
echo ""
echo -e "${YELLOW}IMPORTANT: Log out and log back in for Docker group to take effect${NC}"
echo ""
echo "Next Steps:"
echo "1. Open Dokploy dashboard in browser"
echo "2. Create admin account"
echo "3. Add GitHub repository"
echo "4. Deploy applications"
echo ""
```

### Script 4: Create DNS Records (Windows PowerShell)

Save as `create-dns-records.ps1`:

```powershell
# Create Cloudflare DNS Records for Semplify
# Usage: .\create-dns-records.ps1 -VMPublicIP "1.2.3.4"

param(
    [Parameter(Mandatory=$true)]
    [string]$VMPublicIP
)

$CLOUDFLARE_API_TOKEN = "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
$CLOUDFLARE_ZONE_ID = "bbc142d2d661d64011e2e4becae7a5c3"

$subdomains = @(
    "@",
    "app",
    "api",
    "leave",
    "api-leave",
    "performance",
    "api-performance",
    "payroll",
    "api-payroll",
    "auth",
    "dokploy"
)

$headers = @{
    "Authorization" = "Bearer $CLOUDFLARE_API_TOKEN"
    "Content-Type" = "application/json"
}

foreach ($subdomain in $subdomains) {
    $body = @{
        type = "A"
        name = $subdomain
        content = $VMPublicIP
        ttl = 1
        proxied = $true
    } | ConvertTo-Json

    Write-Host "Creating DNS record for $subdomain.seemplifyai.com..." -ForegroundColor Yellow
    
    try {
        $response = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" `
            -Method Post `
            -Headers $headers `
            -Body $body `
            -ContentType "application/json"
        
        if ($response.success) {
            Write-Host "  Created: $subdomain.seemplifyai.com -> $VMPublicIP" -ForegroundColor Green
        } else {
            Write-Host "  Failed: $($response.errors[0].message)" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "DNS Records Creation Complete!" -ForegroundColor Cyan
```

---

## 16. Troubleshooting

### Problem: Can't SSH into VM

```bash
# Check if SSH key is correct
ssh -vvv seemplify@<VM_IP>

# Check NSG rules in Azure Portal
# Make sure port 22 is allowed
```

### Problem: Docker not working

```bash
# Check Docker status
sudo systemctl status docker

# Restart Docker
sudo systemctl restart docker

# Check Docker logs
sudo journalctl -u docker
```

### Problem: Dokploy not accessible

```bash
# Check if Dokploy is running
docker ps | grep dokploy

# Check Dokploy logs
docker logs dokploy

# Restart Dokploy
cd /opt/dokploy
docker compose restart
```

### Problem: Application not deploying

1. Check Dokploy logs in dashboard
2. Check build logs
3. Verify environment variables
4. Check port configuration

### Problem: SSL certificate not working

```bash
# Check Traefik logs
docker logs traefik

# Verify DNS propagation
dig app.seemplifyai.com

# Check Cloudflare SSL settings
```

### Problem: Database connection failed

```bash
# Test MongoDB connection
mongosh "mongodb+srv://<cluster>.mongodb.net/test"

# Check if VM IP is whitelisted in MongoDB Atlas
```

---

## 17. Maintenance

### Daily Tasks

- Monitor Dokploy dashboard for errors
- Check application logs

### Weekly Tasks

- Review Docker container logs
- Check disk usage
- Review security alerts

### Monthly Tasks

- Update system packages
- Review and rotate secrets
- Backup databases
- Review costs

### Update Commands

```bash
# SSH into VM
ssh seemplify@<VM_IP>

# Update system
sudo apt update && sudo apt upgrade -y

# Update Docker images
docker pull dokploy/dokploy:latest

# Restart Dokploy
cd /opt/dokploy
docker compose pull
docker compose up -d

# Clean up unused Docker resources
docker system prune -af
```

### Backup Commands

```bash
# Backup Dokploy configuration
docker exec dokploy tar -czvf /backup/dokploy-backup.tar.gz /data

# Copy backup to local machine
scp seemplify@<VM_IP>:/opt/dokploy/backup/dokploy-backup.tar.gz ./
```

---

## 📝 Checklist

### Pre-Deployment

- [ ] SSH key pair generated
- [ ] Azure CLI authenticated
- [ ] GitHub token created
- [ ] Cloudflare API token ready
- [ ] MongoDB Atlas setup (or plan for self-hosted)
- [ ] Environment variable values prepared

### VM Creation

- [ ] Resource group created
- [ ] Virtual network created
- [ ] Public IP created
- [ ] Network security group created
- [ ] NSG rules added (22, 80, 443, 3000)
- [ ] VM created
- [ ] VM Public IP noted

### VM Setup

- [ ] SSH into VM successful
- [ ] System updated
- [ ] Essential packages installed
- [ ] Firewall configured
- [ ] Fail2ban configured
- [ ] Swap file created
- [ ] Docker installed
- [ ] Docker configured to start on boot

### Dokploy Setup

- [ ] Dokploy installed
- [ ] Dokploy dashboard accessible
- [ ] Admin account created
- [ ] GitHub connected
- [ ] Project created

### Application Deployment

- [ ] Recruiter Backend deployed
- [ ] Recruiter Frontend deployed
- [ ] Leave Management Backend deployed
- [ ] Leave Management Frontend deployed
- [ ] Performance Backend deployed
- [ ] Performance Frontend deployed
- [ ] Payroll Backend deployed
- [ ] Payroll Frontend deployed
- [ ] Identity Provider deployed

### DNS Configuration

- [ ] A records created for all subdomains
- [ ] Domains configured in Dokploy
- [ ] SSL certificates issued

### Environment Variables

- [ ] All backend .env configured
- [ ] All frontend .env configured
- [ ] Secrets generated and stored securely

### Testing

- [ ] All frontends accessible
- [ ] All backends responding
- [ ] SSL working on all domains
- [ ] Database connections working
- [ ] Cross-service communication working

### Post-Deployment

- [ ] Monitoring setup
- [ ] Backup schedule configured
- [ ] Documentation updated
- [ ] Team notified

---

**Document Version:** 1.0.0  
**Created:** January 2026  
**Last Updated:** January 2026
