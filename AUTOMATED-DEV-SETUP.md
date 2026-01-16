# Automated Dev Environment Setup - Ready to Run!

**Status:** ✅ Complete automation scripts ready  
**Time to Setup:** 15-30 minutes (instead of 3-5 hours!)

---

## 🎉 What's Been Automated

I've created **complete automation** to set up your dev environment in Dokploy via API!

### ✅ Scripts Created

1. **`scripts/create-dokploy-dev-apps.py`** - Python script to create all 9 apps
2. **`scripts/quick-setup-dev-apps.ps1`** - PowerShell wrapper for easy execution
3. **`scripts/SETUP-INSTRUCTIONS.md`** - Detailed instructions

---

## 🚀 Quick Start (Automated Setup)

### Prerequisites

- ✅ Python 3.x installed
- ✅ Dokploy API token (get from dashboard)
- ✅ Your GitHub username

### Step 1: Get Dokploy API Token (2 min)

1. Open: **http://4.180.153.209:3000**
2. Login: `admin@seemplifyai.com` / `Seemplify2026!`
3. Go to: **Settings → API Keys**
4. Click: **Create API Key**
5. Name it: `Dev Environment Setup`
6. **Copy the token** (you'll paste it in the next step)

### Step 2: Run Automated Setup (10-15 min)

```powershell
cd c:\Users\Michael\Documents\GitHub\seemplify

# Run the automated setup
.\scripts\quick-setup-dev-apps.ps1
```

**The script will:**
- ✅ Ask for your Dokploy API token
- ✅ Ask for your GitHub username
- ✅ Create all 9 dev applications in Dokploy
- ✅ Configure domains (*-dev.seemplifyai.com)
- ✅ Set up environment variables (databases, API URLs)
- ✅ Output all Application IDs for GitHub secrets

### Step 3: Configure GitHub Secrets (5 min)

The script will output Application IDs like this:

```
IDENTITY_PROVIDER_DEV_APP_ID=abc123def456
RECRUITER_BACKEND_DEV_APP_ID=ghi789jkl012
...
```

Copy each line and run:

```bash
gh secret set IDENTITY_PROVIDER_DEV_APP_ID --body "abc123def456"
gh secret set RECRUITER_BACKEND_DEV_APP_ID --body "ghi789jkl012"
# ... etc for all 9 apps
```

### Step 4: Create Dev Branch (2 min)

```powershell
.\scripts\create-dev-branch.ps1
```

### Step 5: Update Dokploy Apps to Use Dev Branch (5 min)

In Dokploy dashboard, for each of the 9 dev apps:
1. Open app → Git settings
2. Change branch from `main` to `dev`
3. Save

### Step 6: Test! (5 min)

```bash
# Make a test change
cd recruiter/backend
echo "// Test dev deployment" >> index.js
git add .
git commit -m "test: dev deployment"
git push origin dev

# Watch GitHub Actions and Dokploy!
```

---

## 📊 What Gets Created

| App Name | Domain | Database | Type |
|----------|--------|----------|------|
| identity-provider-dev | auth-dev.seemplifyai.com | identity-dev | Backend |
| recruiter-backend-dev | api-dev.seemplifyai.com | smart_hr_db-dev | Backend |
| recruiter-frontend-dev | app-dev.seemplifyai.com | - | Frontend |
| leave-backend-dev | api-leave-dev.seemplifyai.com | leave-management-dev | Backend |
| leave-frontend-dev | leave-dev.seemplifyai.com | - | Frontend |
| performance-backend-dev | api-performance-dev.seemplifyai.com | performance_db-dev | Backend |
| performance-frontend-dev | performance-dev.seemplifyai.com | - | Frontend |
| payroll-backend-dev | api-payroll-dev.seemplifyai.com | payroll_db-dev | Backend |
| payroll-frontend-dev | payroll-dev.seemplifyai.com | - | Frontend |

**Total:** 9 applications with full configuration

---

## 🎯 Time Savings

| Task | Manual | Automated | Savings |
|------|--------|-----------|---------|
| Create apps in Dokploy | 2-3 hours | 10-15 min | **~2.5 hours** |
| Configure env vars | 30 min | Automatic | **30 min** |
| Set domains | 20 min | Automatic | **20 min** |
| **TOTAL** | **3-4 hours** | **15-30 min** | **~3 hours saved!** |

---

## 🔧 Alternative: Manual Python Script

If you prefer to run the Python script directly:

```powershell
# Install dependencies
pip install requests

# Run script
python scripts/create-dokploy-dev-apps.py

# When prompted, enter:
# - Your Dokploy API token
# - Confirm GitHub repo (y)
```

---

## 📚 Documentation Reference

If you need more details or want to understand what's happening:

| Guide | Purpose |
|-------|---------|
| `scripts/SETUP-INSTRUCTIONS.md` | Detailed automation instructions |
| `access/DOKPLOY-DEV-APPS-SETUP-GUIDE.md` | Manual setup guide (if automation fails) |
| `access/DEV-ENVIRONMENT-MASTER-GUIDE.md` | Complete implementation guide |
| `DEV-ENVIRONMENT-QUICK-START.md` | Quick start guide |

---

## ⚠️ Troubleshooting

### "Python not found"
```powershell
# Install Python from Microsoft Store or python.org
winget install Python.Python.3.11
```

### "requests module not found"
```powershell
pip install requests
```

### "API token invalid"
- Token might have expired
- Create a new one in Dokploy dashboard
- Make sure you copied the entire token

### "Project not found"
- Ensure you have a project in Dokploy
- Script uses the first project it finds
- Create one if needed in Dokploy dashboard

---

## ✅ After Setup Checklist

- [ ] All 9 dev apps created in Dokploy
- [ ] Application IDs copied
- [ ] GitHub secrets configured (9 new secrets)
- [ ] Dev branch created and pushed
- [ ] Each app in Dokploy set to use `dev` branch
- [ ] Test deployment successful

---

## 🎉 You're Done!

Once the automated script completes:

1. ✅ 9 dev applications running in Dokploy
2. ✅ All domains configured with SSL
3. ✅ Environment variables set correctly
4. ✅ Ready for automated deployments

**Push to `dev` branch → Auto-deploys to `*-dev.seemplifyai.com`**  
**Push to `main` branch → Auto-deploys to `*.seemplifyai.com`**

---

## 🚀 Ready to Start?

```powershell
# Run this command to begin:
.\scripts\quick-setup-dev-apps.ps1
```

**Questions?** Check `scripts/SETUP-INSTRUCTIONS.md` for detailed help.

**This automation will save you hours of manual work!** 🎉
