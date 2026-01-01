# Cloud Infrastructure & CLI Tools Documentation

Complete documentation for cloud services, CLI tools, and infrastructure credentials for Semplify project.

## 📋 Table of Contents

- [Azure CLI (az)](#azure-cli-az)
- [GitHub CLI (gh)](#github-cli-gh)
- [Cloudflare CLI (wrangler)](#cloudflare-cli-wrangler)
- [Cloudflare Configuration](#cloudflare-configuration)
- [Azure Resources](#azure-resources)
- [GitHub Repository](#github-repository)
- [Common Workflows](#common-workflows)

---

## 🔵 Azure CLI (az)

### Installation Status

✅ **Installed:** Version 2.65.0  
✅ **Authenticated:** Yes  
✅ **Active Account:** tonyegboo@gmail.com  
✅ **Subscription:** Azure subscription 1  
✅ **Tenant:** Default Directory (tonyegboogmail.onmicrosoft.com)  
⚠️ **Updates Available:** 2 updates

### Current Configuration

| Property | Value |
|-----------|--------|
| Environment | AzureCloud |
| Home Tenant ID | bb0b9dc4-36ea-422e-8613-d756caeb2d93 |
| Subscription ID | 377ec0a1-1a46-48df-bdfc-9a9664282180 |
| User | tonyegboo@gmail.com |
| State | Enabled |
| Default Domain | tonyegboogmail.onmicrosoft.com |

### Installed Extensions

| Extension | Version | Purpose |
|-----------|---------|---------|
| account | 0.2.5 | Account management |
| azure-devops | 1.0.2 | Azure DevOps integration |
| costmanagement | 1.0.0 | Cost monitoring |

### Common Commands

#### Authentication
```bash
# Login
az login

# Check current account
az account show

# List all subscriptions
az account list

# Set default subscription
az account set --subscription "Azure subscription 1"
```

#### Resource Management
```bash
# List all resources
az resource list --output table

# List web apps
az webapp list --output table

# Get resource details
az resource show --resource-group <rg-name> --name <resource-name>

# Delete resource
az resource delete --resource-group <rg-name> --name <resource-name>
```

#### Deployment
```bash
# Deploy to Azure Web App
az webapp up --name <app-name> --resource-group <rg-name>

# Create deployment slot
az webapp deployment slot create --name <app-name> --slot <slot-name>

# View deployment logs
az webapp log tail --name <app-name> --resource-group <rg-name>
```

#### Cost Management
```bash
# Query costs
az cost management query --dataset "ActualCost" --timeframe "MonthToDate"

# List cost alerts
az monitor metrics alert list --resource-group <rg-name>
```

#### Update CLI
```bash
az upgrade
```

### Azure Resources

| Resource Name | Location | Type | Resource Group | Status |
|---------------|-----------|-------|----------------|--------|
| seemplify | UK South | App Service (Linux) | seemplify | ✅ Succeeded |
| smarthr-identity | UK South | App Service (Linux) | smarthr-identity-rg | ✅ Succeeded |
| performance-backend | UK South | App Service (Linux) | smarthr-identity-rg | ✅ Succeeded |
| payroll-backend-smarthr | UK South | App Service (Linux) | smarthr-identity-rg | ✅ Succeeded |
| leave-management-backend | West Europe | App Service (Linux) | smarthr-identity-rg | ✅ Succeeded |
| leave-management-backend-b1 | East US | App Service (Linux) | seemplify | ✅ Succeeded |

### Resource Groups

| Resource Group | Region | Purpose |
|---------------|--------|---------|
| seemplify | UK South, East US | Main Semplify resources |
| smarthr-identity-rg | UK South, West Europe | SmartHR identity services |

---

## 🟢 GitHub CLI (gh)

### Installation Status

✅ **Installed:** Version 2.61.0  
✅ **Authenticated:** Yes  
✅ **Account:** michaelegbo  
✅ **Logged in to:** github.com  
✅ **Active:** True  
✅ **Protocol:** HTTPS  

### Token Scopes

- `gist` - Create and manage gists
- `read:org` - Read organization data
- `repo` - Full repository access
- `workflow` - GitHub Actions workflow management

### Repository Details

| Property | Value |
|-----------|--------|
| Name | seemplify |
| Full Name | michaelegbo/seemplify |
| Owner ID | MDQ6VXNlcjI2NzM5MjM5 |
| URL | https://github.com/michaelegbo/seemplify |

### Common Commands

#### Authentication
```bash
# Login
gh auth login

# Check authentication status
gh auth status

# Logout
gh auth logout
```

#### Repository Management
```bash
# View repository details
gh repo view

# List repositories
gh repo list

# Create repository
gh repo create <repo-name>

# Clone repository
gh repo clone michaelegbo/seemplify
```

#### Issues & Pull Requests
```bash
# List issues
gh issue list

# Create issue
gh issue create --title "Title" --body "Description"

# View pull requests
gh pr list

# Create pull request
gh pr create --title "Title" --body "Description"
```

#### Workflows
```bash
# List workflow runs
gh run list

# View workflow status
gh run view <run-id>

# Trigger workflow
gh workflow run <workflow-name>
```

#### Gists
```bash
# List gists
gh gist list

# Create gist
gh gist create <file>
```

---

## 🟠 Cloudflare CLI (wrangler)

### Installation Status

✅ **Installed:** Version 4.51.0  
⚠️ **Authenticated:** No (Needs authentication)  
⚠️ **Update Available:** Version 4.54.0

### Installation & Authentication

#### Install (if needed)
```bash
npm install -g wrangler
```

#### Login
```bash
wrangler login
```

#### Update CLI
```bash
npm update -g wrangler
```

### Common Commands

#### Authentication
```bash
# Login
wrangler login

# Check authentication status
wrangler whoami

# Logout
wrangler logout
```

#### Account Management
```bash
# List accounts
wrangler accounts list

# Switch accounts
wrangler accounts switch <account-id>
```

#### Worker Management
```bash
# Create new worker
wrangler init my-worker

# Deploy worker
wrangler publish

# Deploy with configuration
wrangler publish --name my-worker --env production

# View worker logs
wrangler tail
```

#### KV Storage
```bash
# List KV namespaces
wrangler kv:namespace list

# Create key-value pair
wrangler kv:key put --namespace-id=<namespace-id> "KEY" "VALUE"

# Read key-value pair
wrangler kv:key get --namespace-id=<namespace-id> "KEY"
```

#### DNS & Zones
```bash
# List zones
wrangler zones list

# List DNS records
wrangler dns list --zone=<zone-id>

# Create DNS record
wrangler dns create --zone=<zone-id> --name="subdomain" --type="A" --content="1.2.3.4"
```

---

## 🌩 Cloudflare Configuration

### Domain Configuration

| Property | Value |
|-----------|--------|
| **Domain** | seemplifyai.com |
| **Account ID** | 7d0fccec5afa3c1f455f7ff6a48b4e8f |
| **Zone ID** | 89215efb800fcc1bdc2cb1ca528eae59 |

### API Token

| Property | Value |
|-----------|--------|
| **Token** | `s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ` |
| **Scopes** | DNS:Edit, Zone:Zone (configure as needed) |
| **Type** | API Token (Bearer authentication) |

### Environment Variables

```bash
# Cloudflare API Token
export CLOUDFLARE_API_TOKEN=s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ

# Cloudflare Zone ID (DNS management)
export CLOUDFLARE_ZONE_ID=89215efb800fcc1bdc2cb1ca528eae59

# Cloudflare Account ID
export CLOUDFLARE_ACCOUNT_ID=7d0fccec5afa3c1f455f7ff6a48b4e8f

# Cloudflare Domain
export CLOUDFLARE_DOMAIN=seemplifyai.com
```

### Usage with Wrangler

Create a `wrangler.toml` configuration file:

```toml
name = "seemplify-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "seemplify-assets"
```

#### Deploy with Environment Variables

```bash
# Using wrangler.toml
wrangler publish --env production

# Using command-line variables
wrangler publish --var API_TOKEN:s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ

# Using environment file
wrangler publish --env-file .env
```

### DNS Configuration Examples

#### Create A Record
```bash
# Point domain to IP address
wrangler dns create --zone=$CLOUDFLARE_ZONE_ID \
  --name="api" \
  --type="A" \
  --content="1.2.3.4" \
  --ttl=3600 \
  --proxied=true
```

#### Create CNAME Record
```bash
# Point subdomain to another domain
wrangler dns create --zone=$CLOUDFLARE_ZONE_ID \
  --name="www" \
  --type="CNAME" \
  --content="seemplifyai.com" \
  --proxied=true
```

#### Create TXT Record (Verification)
```bash
# Domain verification
wrangler dns create --zone=$CLOUDFLARE_ZONE_ID \
  --name="_github-challenge-seemplify" \
  --type="TXT" \
  --content="verification-code-here"
```

### API Usage (curl)

```bash
# List DNS records using Cloudflare API
curl -X GET "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json"

# Create DNS record
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "api",
    "content": "1.2.3.4",
    "ttl": 3600,
    "proxied": true
  }'
```

---

## 🚀 Common Workflows

### Deploy Frontend to Netlify with Custom Domain

```bash
# 1. Build frontend
cd <frontend-directory>
npm run build

# 2. Deploy with Netlify CLI
netlify deploy --prod --dir=build

# 3. Add custom domain via Cloudflare
# In Cloudflare Dashboard:
# - Create CNAME record pointing to Netlify URL
# - Enable SSL/TLS
```

### Deploy Backend to Azure

```bash
# 1. Using Azure CLI
cd <backend-directory>
az webapp up --name <app-name> --resource-group <rg-name>

# 2. Configure environment variables
az webapp config appsettings set \
  --name <app-name> \
  --resource-group <rg-name> \
  --settings MONGODB_URI=<connection-string> JWT_SECRET=<secret>
```

### Create GitHub Actions Workflow

```bash
# 1. Create workflow file
mkdir -p .github/workflows
cat > .github/workflows/deploy.yml <<EOF
name: Deploy to Production
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to Azure
        uses: azure/webapps-deploy@v2
        with:
          app-name: 'your-app-name'
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
EOF

# 2. Push to GitHub
git add .github/workflows/deploy.yml
git commit -m "ci: add deployment workflow"
git push
```

### Monitor All Cloud Resources

```bash
# Azure resources
az resource list --output table

# GitHub repository status
gh repo view

# Cloudflare DNS status
wrangler dns list --zone=$CLOUDFLARE_ZONE_ID

# Check running services
gh run list
```

### Backup & Restore

```bash
# Azure Web App backup
az webapp config backup list --name <app-name> --resource-group <rg-name>

# Restore backup
az webapp config backup restore \
  --name <app-name> \
  --resource-group <rg-name> \
  --backup-id <backup-id>
```

---

## 🔒 Security Best Practices

### Azure CLI
```bash
# Use service principals for automation
az ad sp create-for-rbac --name "seemplify-deployer"

# Store credentials in Azure Key Vault
az keyvault secret set --vault-name <vault> --name <secret> --value <value>
```

### GitHub CLI
```bash
# Use SSH for more secure Git operations
gh auth login --with-ssh

# Limit token scopes
gh auth login --scopes repo,workflow
```

### Cloudflare
```bash
# Rotate API tokens regularly
# Generate new token with limited scope

# Use environment variables for secrets
# Never hardcode tokens in scripts

# Enable 2FA on Cloudflare account
```

### Credential Management

✅ **DO NOT commit:**
- `.env` files
- API tokens
- Connection strings
- Secrets
- Private keys

✅ **DO commit:**
- `.env.example` files (template with placeholders)
- Documentation
- Configuration examples

---

## 📝 Environment Variables Reference

### Semplify Environment Variables

| Variable | Description | Example |
|-----------|-------------|----------|
| `AZURE_WEBAPP_NAME` | Azure Web App name | `seemplify-backend` |
| `AZURE_RESOURCE_GROUP` | Azure resource group | `seemplify-rg` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token | `s3BUpfG8...` |
| `CLOUDFLARE_ZONE_ID` | Cloudflare zone ID | `89215efb8...` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | `7d0fccec5...` |
| `CLOUDFLARE_DOMAIN` | Primary domain | `seemplifyai.com` |

### Loading Environment Variables

Create a `.env` file in the project root:

```bash
# Cloudflare
CLOUDFLARE_API_TOKEN=s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ
CLOUDFLARE_ZONE_ID=89215efb800fcc1bdc2cb1ca528eae59
CLOUDFLARE_ACCOUNT_ID=7d0fccec5afa3c1f455f7ff6a48b4e8f
CLOUDFLARE_DOMAIN=seemplifyai.com

# Azure
AZURE_SUBSCRIPTION_ID=377ec0a1-1a46-48df-bdfc-9a9664282180
AZURE_TENANT_ID=bb0b9dc4-36ea-422e-8613-d756caeb2d93
```

Load in shell:

```bash
# Load from .env file
export $(cat .env | grep -v '^#' | xargs)

# Or use dotenv in Node.js
require('dotenv').config()
```

---

## 🔍 Troubleshooting

### Azure CLI Issues

**Command not found:**
```bash
# Install Azure CLI
# Windows (PowerShell)
Invoke-WebRequest -Uri https://aka.ms/installazurecliwindows -OutFile .\AzureCLI.msi; Start-Process msiexec.exe -Wait -ArgumentList '/I AzureCLI.msi /quiet'

# macOS
brew update && brew install azure-cli

# Linux
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

**Authentication failed:**
```bash
# Clear cached credentials
az logout

# Re-login
az login --tenant <tenant-id>

# Check subscription
az account list
```

### GitHub CLI Issues

**Authentication expired:**
```bash
# Re-authenticate
gh auth login --web

# Or refresh token
gh auth refresh
```

**Repository not found:**
```bash
# Check current directory
git remote -v

# Verify repository name
gh repo view
```

### Cloudflare CLI Issues

**Not logged in:**
```bash
# Authenticate with browser
wrangler login

# Or use API token directly
export CLOUDFLARE_API_TOKEN=your-token
```

**Invalid token:**
```bash
# Generate new API token in Cloudflare Dashboard
# Visit: https://dash.cloudflare.com/profile/api-tokens

# scopes needed: Account - Cloudflare Workers - Edit
#            Zone - DNS - Edit
#            Zone - Zone - Read
```

**Worker deployment failed:**
```bash
# Check configuration
wrangler whoami
wrangler zones list

# View logs
wrangler tail

# Deploy with detailed error output
wrangler publish --log-level=debug
```

---

## 📚 Additional Resources

### Documentation Links

- **Azure CLI**: https://docs.microsoft.com/cli/azure/
- **GitHub CLI**: https://cli.github.com/manual/
- **Cloudflare Wrangler**: https://developers.cloudflare.com/workers/wrangler/
- **Cloudflare API**: https://developers.cloudflare.com/api/

### Useful Commands Quick Reference

```bash
# Azure
az account show                    # Show current Azure account
az resource list                    # List all resources
az webapp list                     # List web apps
az cost management query            # Query costs
az upgrade                         # Update CLI

# GitHub
gh auth status                      # Check login status
gh repo view                        # View repository
gh issue list                      # List issues
gh run list                        # List workflow runs

# Cloudflare
wrangler whoami                    # Check auth status
wrangler publish                   # Deploy worker
wrangler dns list                   # List DNS records
wrangler tail                      # View logs
```

---

## 🎯 Quick Start Guide

### 1. Set Up Environment
```bash
# Clone repository
git clone https://github.com/michaelegbo/seemplify.git
cd seemplify

# Install dependencies
npm run install:all

# Create .env file with credentials
cp .env.example .env
# Edit .env with your cloud credentials
```

### 2. Configure Cloudflare DNS
```bash
# Set environment variables
export CLOUDFLARE_API_TOKEN=s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ
export CLOUDFLARE_ZONE_ID=89215efb800fcc1bdc2cb1ca528eae59
export CLOUDFLARE_DOMAIN=seemplifyai.com

# Verify DNS configuration
wrangler dns list --zone=$CLOUDFLARE_ZONE_ID
```

### 3. Deploy Applications
```bash
# Deploy frontend to production
cd recruiter/frontend
npm run build
netlify deploy --prod

# Deploy backend to Azure
cd recruiter/backend
az webapp up --name seemplify-recruiter-backend \
  --resource-group seemplify-rg
```

### 4. Verify Deployment
```bash
# Check Azure web app status
az webapp show --name seemplify-recruiter-backend \
  --resource-group seemplify-rg

# Test GitHub Actions
gh run list

# Check Cloudflare DNS
curl -I https://api.seemplifyai.com
```

---

## 📞 Support & Help

| Service | Documentation | Support |
|----------|---------------|-----------|
| Azure CLI | https://docs.microsoft.com/cli/azure/ | Azure Support Portal |
| GitHub CLI | https://cli.github.com/ | GitHub Community |
| Cloudflare | https://developers.cloudflare.com/ | Cloudflare Support |

---

**Document Version:** 1.0.0  
**Last Updated:** January 2026  
**Maintained by:** Semplify Team

---

## 📊 Summary

| Tool | Status | Version | Authenticated | Primary Use |
|------|--------|---------|--------------|-------------|
| Azure CLI | ✅ Active | 2.65.0 | ✅ Yes | Resource management, deployment |
| GitHub CLI | ✅ Active | 2.61.0 | ✅ Yes | Repo management, CI/CD |
| Cloudflare CLI | ⚠️ Needs auth | 4.51.0 | ❌ No | Workers, DNS, Edge functions |

### Cloud Infrastructure Overview

- **Azure:** 6 web apps across 2 resource groups (UK South, West Europe, East US)
- **GitHub:** 1 repository (michaelegbo/seemplify) with workflow access
- **Cloudflare:** 1 domain (seemplifyai.com) with API access

### Next Steps

1. ✅ Update Azure CLI: `az upgrade`
2. ✅ Update Cloudflare CLI: `npm update -g wrangler`
3. ✅ Authenticate with Cloudflare: `wrangler login`
4. ✅ Configure DNS records for all applications
5. ✅ Set up CI/CD pipelines with GitHub Actions
6. ✅ Monitor costs and usage across all platforms
