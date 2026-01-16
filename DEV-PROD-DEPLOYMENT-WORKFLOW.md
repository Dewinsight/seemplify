# ✅ Dev & Production Auto-Deployment Workflow

**Status:** FULLY CONFIGURED AND WORKING  
**Date:** 2026-01-14

---

## 🔄 How Auto-Deployment Works

### Development Workflow (dev branch → Dev Environment)

**When you push to `dev` branch:**

```bash
git checkout dev
# Make changes to any app (e.g., Identityprovider/**) 
git add .
git commit -m "feat: new feature"
git push origin dev
```

**What happens automatically:**

1. ✅ GitHub detects push to `dev` branch
2. ✅ Checks which files changed (e.g., `Identityprovider/**`)
3. ✅ Triggers corresponding dev workflow (e.g., `deploy-identity-provider-dev.yml`)
4. ✅ Workflow calls Dokploy API with `IDENTITY_PROVIDER_DEV_APP_ID`
5. ✅ Dokploy deploys to **dev environment**
6. ✅ App updates at `https://auth-dev.seemplifyai.com`

**Recent proof it's working:**
```
✅ Deploy Identity Provider (Dev) - completed success - 16:40:16
✅ Deploy Leave Backend (Dev) - completed success - 16:40:16  
✅ Deploy Recruiter Backend (Dev) - completed success - 16:31:44
```

---

### Production Workflow (main branch → Production Environment)

**When you merge dev → main:**

```bash
git checkout main
git merge dev
git push origin main
```

**What happens automatically:**

1. ✅ GitHub detects push to `main` branch
2. ✅ Checks which files changed
3. ✅ Triggers corresponding production workflow (e.g., `deploy-identity-provider.yml`)
4. ✅ Workflow calls Dokploy API with `IDENTITY_PROVIDER_APP_ID` (production)
5. ✅ Dokploy deploys to **production environment**
6. ✅ App updates at `https://auth.seemplifyai.com`

---

## 📋 Complete Workflow Configuration

### Dev Branch Workflows (9 workflows)

| Workflow File | Triggers On | Deploys To | App ID Secret |
|---------------|-------------|------------|---------------|
| `deploy-identity-provider-dev.yml` | `dev` branch + `Identityprovider/**` | auth-dev.seemplifyai.com | `IDENTITY_PROVIDER_DEV_APP_ID` |
| `deploy-recruiter-backend-dev.yml` | `dev` branch + `recruiter/backend/**` | api-dev.seemplifyai.com | `RECRUITER_BACKEND_DEV_APP_ID` |
| `deploy-recruiter-frontend-dev.yml` | `dev` branch + `recruiter/frontend/**` | app-dev.seemplifyai.com | `RECRUITER_FRONTEND_DEV_APP_ID` |
| `deploy-leave-backend-dev.yml` | `dev` branch + `leave-management/backend/**` | api-leave-dev.seemplifyai.com | `LEAVE_BACKEND_DEV_APP_ID` |
| `deploy-leave-frontend-dev.yml` | `dev` branch + `leave-management/frontend/**` | leave-dev.seemplifyai.com | `LEAVE_FRONTEND_DEV_APP_ID` |
| `deploy-performance-backend-dev.yml` | `dev` branch + `performance/backend/**` | api-performance-dev.seemplifyai.com | `PERFORMANCE_BACKEND_DEV_APP_ID` |
| `deploy-performance-frontend-dev.yml` | `dev` branch + `performance/frontend/**` | performance-dev.seemplifyai.com | `PERFORMANCE_FRONTEND_DEV_APP_ID` |
| `deploy-payroll-backend-dev.yml` | `dev` branch + `payroll/backend/**` | api-payroll-dev.seemplifyai.com | `PAYROLL_BACKEND_DEV_APP_ID` |
| `deploy-payroll-frontend-dev.yml` | `dev` branch + `payroll/frontend/**` | payroll-dev.seemplifyai.com | `PAYROLL_FRONTEND_DEV_APP_ID` |

### Production Branch Workflows (9 workflows)

| Workflow File | Triggers On | Deploys To | App ID Secret |
|---------------|-------------|------------|---------------|
| `deploy-identity-provider.yml` | `main` branch + `Identityprovider/**` | auth.seemplifyai.com | `IDENTITY_PROVIDER_APP_ID` |
| `deploy-recruiter-backend.yml` | `main` branch + `recruiter/backend/**` | api.seemplifyai.com | `RECRUITER_BACKEND_APP_ID` |
| `deploy-recruiter-frontend.yml` | `main` branch + `recruiter/frontend/**` | app.seemplifyai.com | `RECRUITER_FRONTEND_APP_ID` |
| `deploy-leave-backend.yml` | `main` branch + `leave-management/backend/**` | api-leave.seemplifyai.com | `LEAVE_BACKEND_APP_ID` |
| `deploy-leave-frontend.yml` | `main` branch + `leave-management/frontend/**` | leave.seemplifyai.com | `LEAVE_FRONTEND_APP_ID` |
| `deploy-performance-backend.yml` | `main` branch + `performance/backend/**` | api-performance.seemplifyai.com | `PERFORMANCE_BACKEND_APP_ID` |
| `deploy-performance-frontend.yml` | `main` branch + `performance/frontend/**` | performance.seemplifyai.com | `PERFORMANCE_FRONTEND_APP_ID` |
| `deploy-payroll-backend.yml` | `main` branch + `payroll/backend/**` | api-payroll.seemplifyai.com | `PAYROLL_BACKEND_APP_ID` |
| `deploy-payroll-frontend.yml` | `main` branch + `payroll/frontend/**` | payroll.seemplifyai.com | `PAYROLL_FRONTEND_APP_ID` |

---

## 🎯 Development → Production Flow

### Step 1: Develop on Dev Branch
```bash
git checkout dev
git pull origin dev

# Make your changes
code .

git add .
git commit -m "feat: new feature"
git push origin dev
```
→ **Auto-deploys to DEV environment** (e.g., https://auth-dev.seemplifyai.com)

### Step 2: Test on Dev Environment
- Visit your dev URLs
- Test the feature
- Make sure everything works

### Step 3: Merge to Main (Deploy to Production)
```bash
git checkout main
git pull origin main
git merge dev
git push origin main
```
→ **Auto-deploys to PRODUCTION environment** (e.g., https://auth.seemplifyai.com)

---

## 🔑 Key Points

### ✅ YES - Auto-Deploy from Dev Branch
- Pushing to `dev` branch **automatically deploys** to dev environment
- Each app has its own dev workflow watching for changes
- Confirmed working (see recent successful runs above)

### ✅ YES - Auto-Deploy from Main Branch
- Merging `dev → main` **automatically deploys** to production
- Each app has its own production workflow
- Has been working for production deployments

### ✅ Same Databases as Local Dev
- Dev environment now uses same databases as local development:
  - `identity_dev`
  - `smart_hr_db_dev`
  - `leave-management_dev`
  - `performance_db_dev`
  - `payroll_db_dev`

---

## 📊 Environment Comparison

| Aspect | Local Dev | Deployed Dev | Production |
|--------|-----------|--------------|------------|
| **Branch** | `dev` | `dev` | `main` |
| **Git Auto-Deploy** | ❌ No | ✅ **Yes** | ✅ **Yes** |
| **URLs** | `localhost:*` | `*-dev.seemplifyai.com` | `*.seemplifyai.com` |
| **Databases** | `*_dev` | `*_dev` (SAME) ✅ | Production DBs |
| **IDP URL** | `localhost:4000` | `auth-dev.seemplifyai.com` | `auth.seemplifyai.com` |
| **SSL** | ❌ No | ✅ Let's Encrypt | ✅ Let's Encrypt |

---

## 🚀 Example: Full Development Cycle

```bash
# 1. Start on dev branch
git checkout dev

# 2. Add new feature to recruiter backend
code recruiter/backend/routes/newFeature.js

# 3. Commit and push
git add .
git commit -m "feat: add new feature to recruiter"
git push origin dev

# 4. GitHub Actions automatically deploys to:
#    → https://api-dev.seemplifyai.com ✅

# 5. Test the feature on dev
#    Visit https://app-dev.seemplifyai.com

# 6. Feature works! Merge to production
git checkout main
git pull origin main
git merge dev
git push origin main

# 7. GitHub Actions automatically deploys to:
#    → https://api.seemplifyai.com ✅ (PRODUCTION)
```

---

## ✅ Verification

**Test auto-deploy right now:**
```bash
git checkout dev
echo "# Test auto-deploy" >> README.md
git add README.md
git commit -m "test: verify dev auto-deploy"
git push origin dev

# Watch it deploy
gh run watch
```

---

**YES - Both are configured for auto-deployment:**
- ✅ **Dev branch → Dev environment** (auto-deploys)
- ✅ **Main branch → Production environment** (auto-deploys)

**Your complete CI/CD pipeline is working!** 🎉