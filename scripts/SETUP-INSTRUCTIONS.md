# Automated Dokploy Dev Apps Setup

I've created automation scripts to create all 9 dev applications in Dokploy. Here's how to use them:

## Option 1: Using Python Script (Recommended)

### Step 1: Get Dokploy API Token

1. Open Dokploy: **http://4.180.153.209:3000**
2. Login:
   - Email: `admin@seemplifyai.com`
   - Password: `Seemplify2026!`
3. Navigate to: **Settings → API Keys**
4. Click: **"Create API Key"** or **"Generate API Key"**
5. Name it: `Dev Environment Setup`
6. **Copy the token** (you won't see it again!)

### Step 2: Update GitHub Repository Owner

Edit `scripts/create-dokploy-dev-apps.py`:

```python
GITHUB_REPO_OWNER = "YOUR_GITHUB_USERNAME"  # Change this to your GitHub username
```

### Step 3: Run the Script

```powershell
cd c:\Users\Michael\Documents\GitHub\seemplify
python scripts/create-dokploy-dev-apps.py
```

The script will:
- ✅ Create all 9 dev applications in Dokploy
- ✅ Configure domains (*-dev.seemplifyai.com)
- ✅ Set up environment variables (databases, URLs, etc.)
- ✅ Output all Application IDs for GitHub secrets

### Step 4: Use the Application IDs

The script will output something like:

```
IDENTITY_PROVIDER_DEV_APP_ID=abc123def456
RECRUITER_BACKEND_DEV_APP_ID=ghi789jkl012
...
```

Copy these and use them to configure GitHub secrets!

---

## Option 2: Manual Creation (If script doesn't work)

Follow the comprehensive guide:
- **File:** `access/DOKPLOY-DEV-APPS-SETUP-GUIDE.md`
- **Time:** 2-3 hours
- **Process:** Create each app one by one in Dokploy UI

---

## What the Script Creates

| # | Application | Domain | Database |
|---|------------|--------|----------|
| 1 | identity-provider-dev | auth-dev.seemplifyai.com | identity-dev |
| 2 | recruiter-backend-dev | api-dev.seemplifyai.com | smart_hr_db-dev |
| 3 | recruiter-frontend-dev | app-dev.seemplifyai.com | - |
| 4 | leave-backend-dev | api-leave-dev.seemplifyai.com | leave-management-dev |
| 5 | leave-frontend-dev | leave-dev.seemplifyai.com | - |
| 6 | performance-backend-dev | api-performance-dev.seemplifyai.com | performance_db-dev |
| 7 | performance-frontend-dev | performance-dev.seemplifyai.com | - |
| 8 | payroll-backend-dev | api-payroll-dev.seemplifyai.com | payroll_db-dev |
| 9 | payroll-frontend-dev | payroll-dev.seemplifyai.com | - |

---

## After Running the Script

1. **Configure GitHub Secrets** using the Application IDs
2. **Create dev branch**: `.\scripts\create-dev-branch.ps1`
3. **Update Dokploy apps** to use `dev` branch instead of `main`
4. **Test deployment** by pushing to dev branch

---

## Troubleshooting

### "API token invalid"
- Token might have expired
- Create a new token in Dokploy dashboard

### "Project not found"
- Ensure you have a project created in Dokploy
- Script uses the first project it finds

### "GitHub repository not found"
- Update `GITHUB_REPO_OWNER` in the script
- Ensure the repository is accessible to Dokploy

---

## Need Help?

Check the comprehensive guides in `access/` folder:
- `DEV-ENVIRONMENT-MASTER-GUIDE.md` - Complete implementation guide
- `DOKPLOY-DEV-APPS-SETUP-GUIDE.md` - Manual setup instructions
- `GITHUB-SECRETS-SETUP-GUIDE.md` - GitHub configuration

---

**This automation saves you 2-3 hours of manual work!** 🎉
