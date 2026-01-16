# GitHub Secrets Setup Guide for Dev Environment

**Created:** January 14, 2026  
**Purpose:** Configure GitHub repository secrets for automated dev deployments

---

## 🎯 Overview

This guide shows how to add GitHub secrets for the development environment. These secrets enable GitHub Actions workflows to automatically deploy to Dokploy when code is pushed to the `dev` branch.

---

## 📋 Prerequisites

Before starting:
- [ ] All 9 dev applications created in Dokploy
- [ ] Application IDs recorded from Dokploy
- [ ] GitHub CLI installed (`gh`) OR access to GitHub web interface

---

## 🔑 Required Secrets

You need to add 9 new secrets (one for each dev application):

| Secret Name | Purpose | Example Value |
|-------------|---------|---------------|
| `IDENTITY_PROVIDER_DEV_APP_ID` | Identity Provider dev app ID | `abc123def456` |
| `RECRUITER_BACKEND_DEV_APP_ID` | Recruiter Backend dev app ID | `ghi789jkl012` |
| `RECRUITER_FRONTEND_DEV_APP_ID` | Recruiter Frontend dev app ID | `mno345pqr678` |
| `LEAVE_BACKEND_DEV_APP_ID` | Leave Backend dev app ID | `stu901vwx234` |
| `LEAVE_FRONTEND_DEV_APP_ID` | Leave Frontend dev app ID | `yza567bcd890` |
| `PERFORMANCE_BACKEND_DEV_APP_ID` | Performance Backend dev app ID | `efg123hij456` |
| `PERFORMANCE_FRONTEND_DEV_APP_ID` | Performance Frontend dev app ID | `klm789nop012` |
| `PAYROLL_BACKEND_DEV_APP_ID` | Payroll Backend dev app ID | `qrs345tuv678` |
| `PAYROLL_FRONTEND_DEV_APP_ID` | Payroll Frontend dev app ID | `wxy901zab234` |

**Note:** The production secrets (`DOKPLOY_URL`, `DOKPLOY_TOKEN`, and production app IDs) remain unchanged.

---

## 📍 How to Find Application IDs in Dokploy

### Method 1: From Dokploy Dashboard UI

1. Log into Dokploy: http://4.180.153.209:3000
2. Click on the application (e.g., `recruiter-backend-dev`)
3. Look at the URL in your browser:
   ```
   http://4.180.153.209:3000/project/xxx/services/application/YOUR_APP_ID_HERE
   ```
4. Copy the Application ID from the URL

### Method 2: From Application Settings

1. Open the application in Dokploy
2. Go to **"Settings"** or **"Advanced"** tab
3. Look for **"Application ID"** field
4. Copy the ID

### Method 3: Using Dokploy API

```bash
curl -X GET "http://4.180.153.209:3000/api/application.all" \
  -H "x-api-key: YOUR_DOKPLOY_TOKEN" \
  | jq '.[] | select(.appName | contains("-dev")) | {appName, applicationId}'
```

---

## 🛠️ Method 1: Using GitHub CLI (Recommended)

### Install GitHub CLI (if not installed)

**Windows (PowerShell):**
```powershell
winget install --id GitHub.cli
```

**Or download from:** https://cli.github.com/

### Authenticate

```bash
gh auth login
```

Follow the prompts to authenticate with your GitHub account.

### Navigate to Your Repository

```bash
cd c:\Users\Michael\Documents\GitHub\seemplify
```

### Add Secrets (One by One)

Replace `YOUR_APP_ID` with the actual Application ID from Dokploy:

```bash
# Identity Provider Dev
gh secret set IDENTITY_PROVIDER_DEV_APP_ID --body "YOUR_APP_ID"

# Recruiter Backend Dev
gh secret set RECRUITER_BACKEND_DEV_APP_ID --body "YOUR_APP_ID"

# Recruiter Frontend Dev
gh secret set RECRUITER_FRONTEND_DEV_APP_ID --body "YOUR_APP_ID"

# Leave Backend Dev
gh secret set LEAVE_BACKEND_DEV_APP_ID --body "YOUR_APP_ID"

# Leave Frontend Dev
gh secret set LEAVE_FRONTEND_DEV_APP_ID --body "YOUR_APP_ID"

# Performance Backend Dev
gh secret set PERFORMANCE_BACKEND_DEV_APP_ID --body "YOUR_APP_ID"

# Performance Frontend Dev
gh secret set PERFORMANCE_FRONTEND_DEV_APP_ID --body "YOUR_APP_ID"

# Payroll Backend Dev
gh secret set PAYROLL_BACKEND_DEV_APP_ID --body "YOUR_APP_ID"

# Payroll Frontend Dev
gh secret set PAYROLL_FRONTEND_DEV_APP_ID --body "YOUR_APP_ID"
```

### Verify Secrets

```bash
gh secret list
```

You should see all 9 new `-DEV-` secrets listed along with existing secrets.

---

## 🌐 Method 2: Using GitHub Web Interface

### Step-by-Step

1. **Go to GitHub Repository**
   - Navigate to: https://github.com/YOUR_USERNAME/seemplify
   - (Replace with your actual repository URL)

2. **Access Settings**
   - Click on **"Settings"** tab (top right)
   - Requires admin access to the repository

3. **Navigate to Secrets**
   - In the left sidebar, click **"Secrets and variables"**
   - Click **"Actions"**

4. **Add New Secret**
   - Click **"New repository secret"** button
   
5. **Enter Secret Details**
   - **Name:** `IDENTITY_PROVIDER_DEV_APP_ID` (exact name)
   - **Value:** Paste the Application ID from Dokploy
   - Click **"Add secret"**

6. **Repeat for All 9 Secrets**
   - Add each secret one by one using the table above

---

## 📝 Bulk Setup Script (PowerShell)

Save this as `setup-github-secrets.ps1`:

```powershell
# GitHub Secrets Setup for Dev Environment
# Update the APP_ID values below with your actual Dokploy Application IDs

# Application IDs (UPDATE THESE!)
$secrets = @{
    "IDENTITY_PROVIDER_DEV_APP_ID" = "YOUR_IDENTITY_PROVIDER_DEV_APP_ID"
    "RECRUITER_BACKEND_DEV_APP_ID" = "YOUR_RECRUITER_BACKEND_DEV_APP_ID"
    "RECRUITER_FRONTEND_DEV_APP_ID" = "YOUR_RECRUITER_FRONTEND_DEV_APP_ID"
    "LEAVE_BACKEND_DEV_APP_ID" = "YOUR_LEAVE_BACKEND_DEV_APP_ID"
    "LEAVE_FRONTEND_DEV_APP_ID" = "YOUR_LEAVE_FRONTEND_DEV_APP_ID"
    "PERFORMANCE_BACKEND_DEV_APP_ID" = "YOUR_PERFORMANCE_BACKEND_DEV_APP_ID"
    "PERFORMANCE_FRONTEND_DEV_APP_ID" = "YOUR_PERFORMANCE_FRONTEND_DEV_APP_ID"
    "PAYROLL_BACKEND_DEV_APP_ID" = "YOUR_PAYROLL_BACKEND_DEV_APP_ID"
    "PAYROLL_FRONTEND_DEV_APP_ID" = "YOUR_PAYROLL_FRONTEND_DEV_APP_ID"
}

# Check if gh CLI is installed
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "❌ GitHub CLI (gh) is not installed." -ForegroundColor Red
    Write-Host "Install it from: https://cli.github.com/" -ForegroundColor Yellow
    exit 1
}

# Check if authenticated
$authStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Not authenticated with GitHub CLI." -ForegroundColor Red
    Write-Host "Run: gh auth login" -ForegroundColor Yellow
    exit 1
}

Write-Host "🔐 Setting up GitHub Secrets for Dev Environment..." -ForegroundColor Cyan
Write-Host ""

# Set each secret
$successCount = 0
foreach ($secretName in $secrets.Keys) {
    $secretValue = $secrets[$secretName]
    
    if ($secretValue -eq "YOUR_*") {
        Write-Host "⚠️  Skipping $secretName (placeholder value)" -ForegroundColor Yellow
        continue
    }
    
    Write-Host "Setting: $secretName" -ForegroundColor White
    gh secret set $secretName --body $secretValue
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ Success" -ForegroundColor Green
        $successCount++
    } else {
        Write-Host "  ❌ Failed" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "✅ Set $successCount secrets successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Verify with: gh secret list" -ForegroundColor Gray
```

**To use:**

1. Update the Application IDs in the script
2. Save as `scripts/setup-github-secrets.ps1`
3. Run:
   ```powershell
   .\scripts\setup-github-secrets.ps1
   ```

---

## ✅ Verification

### Check Secrets Exist

```bash
gh secret list | grep -i dev
```

You should see all 9 `-DEV-` secrets.

### Test Workflow Manually

1. Go to GitHub repository → **"Actions"** tab
2. Select one of the dev workflows (e.g., "Deploy Recruiter Backend (Dev)")
3. Click **"Run workflow"**
4. Select `dev` branch
5. Click **"Run workflow"**
6. Monitor the workflow run

**Expected:** Workflow should trigger Dokploy deployment successfully.

---

## 🔍 Troubleshooting

### Secret Not Found Error

**Error:** `secret RECRUITER_BACKEND_DEV_APP_ID not found`

**Solution:**
- Verify secret name is exactly correct (case-sensitive)
- Check secret was added to correct repository
- Re-add the secret

### Authentication Failed

**Error:** `401 Unauthorized` when workflow runs

**Solution:**
- Verify `DOKPLOY_TOKEN` secret is still valid
- Check Dokploy API key hasn't expired
- Regenerate API key in Dokploy if needed

### Wrong Application ID

**Error:** Deployment triggers but deploys wrong application

**Solution:**
- Verify you copied the correct Application ID
- Check Application ID in Dokploy matches the secret
- Update secret with correct ID

---

## 📊 Secrets Overview

### Existing Secrets (Production)

These remain unchanged:

- `DOKPLOY_URL` - http://4.180.153.209:3000
- `DOKPLOY_TOKEN` - API token for Dokploy
- `IDENTITY_PROVIDER_APP_ID` - Production app ID
- `RECRUITER_BACKEND_APP_ID` - Production app ID
- `RECRUITER_FRONTEND_APP_ID` - Production app ID
- `LEAVE_BACKEND_APP_ID` - Production app ID
- `LEAVE_FRONTEND_APP_ID` - Production app ID
- `PERFORMANCE_BACKEND_APP_ID` - Production app ID
- `PERFORMANCE_FRONTEND_APP_ID` - Production app ID
- `PAYROLL_BACKEND_APP_ID` - Production app ID
- `PAYROLL_FRONTEND_APP_ID` - Production app ID

### New Secrets (Development)

These are added:

- All 9 `-DEV-` app ID secrets (see table at top)

**Total Secrets:** 20+ (11 production + 9 development + shared credentials)

---

## 📝 Record Sheet

Use this to track your progress:

| Secret Name | Application ID | Set? |
|-------------|----------------|------|
| IDENTITY_PROVIDER_DEV_APP_ID | ________________ | ⬜ |
| RECRUITER_BACKEND_DEV_APP_ID | ________________ | ⬜ |
| RECRUITER_FRONTEND_DEV_APP_ID | ________________ | ⬜ |
| LEAVE_BACKEND_DEV_APP_ID | ________________ | ⬜ |
| LEAVE_FRONTEND_DEV_APP_ID | ________________ | ⬜ |
| PERFORMANCE_BACKEND_DEV_APP_ID | ________________ | ⬜ |
| PERFORMANCE_FRONTEND_DEV_APP_ID | ________________ | ⬜ |
| PAYROLL_BACKEND_DEV_APP_ID | ________________ | ⬜ |
| PAYROLL_FRONTEND_DEV_APP_ID | ________________ | ⬜ |

---

## ✅ Next Steps

After completing this setup:

1. ✅ All GitHub secrets configured
2. Create `dev` branch in repository
3. Test automated deployment from dev branch
4. Update local environment configurations
5. Document workflow for team

See `BRANCHING-STRATEGY-GUIDE.md` for Git workflow setup.

---

**Security Note:** Keep these Application IDs confidential. They allow deployment access to your Dokploy applications.
