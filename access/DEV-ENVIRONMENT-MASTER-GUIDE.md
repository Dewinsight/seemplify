# Development Environment Setup - Master Implementation Guide

**Created:** January 14, 2026  
**Status:** Ready for Implementation  
**Estimated Time:** 4-6 hours

---

## 🎯 Overview

This is the master guide for setting up a complete development environment alongside your production infrastructure. Follow these steps in order for a successful deployment.

---

## 📋 What You're Building

**Before:** 
- 9 applications deployed to production
- Main branch → auto-deploys to production

**After:**
- 9 applications in production + 9 in development (18 total)
- Dev branch → auto-deploys to dev environment
- Main branch → auto-deploys to production  
- Complete environment isolation

---

## ✅ Prerequisites Checklist

Before starting, ensure you have:

- [ ] Access to Dokploy dashboard (http://4.180.153.209:3000)
- [ ] Access to MongoDB Atlas
- [ ] Access to Cloudflare DNS (or API token)
- [ ] GitHub repository admin access
- [ ] GitHub CLI installed (`gh`) or access to GitHub UI
- [ ] Git installed locally
- [ ] PowerShell (for running scripts)
- [ ] 4-6 hours of uninterrupted time

---

## 📊 Implementation Roadmap

```
Phase 1: Assessment (30 min)
    ↓
Phase 2: Infrastructure Setup (1 hour)
    ├─ MongoDB Databases
    └─ Cloudflare DNS
    ↓
Phase 3: Dokploy Apps (2-3 hours)
    ├─ Create pilot app
    └─ Create remaining 8 apps
    ↓
Phase 4: Git & CI/CD (1 hour)
    ├─ Create dev branch
    └─ Configure GitHub secrets
    ↓
Phase 5: Testing (1 hour)
    └─ End-to-end verification
```

---

## 🚀 Step-by-Step Implementation

### Phase 1: Assessment & Preparation (30 min)

#### Step 1.1: Review Current Setup

- [ ] Read `DEV-ENVIRONMENT-SETUP-PLAN.md` completely
- [ ] Understand the architecture and changes
- [ ] Review all documentation files in `/access`

#### Step 1.2: Check Azure VM Resources

```powershell
# SSH into Azure VM
ssh seemplify@4.180.153.209

# Check current resource usage
docker stats --no-stream

# Check disk space
df -h

# Check memory
free -h

# Exit SSH
exit
```

**Decision:** If VM is near capacity (>80% CPU/RAM), consider upgrading or optimizing before proceeding.

#### Step 1.3: Gather Information

Create a checklist document to track:
- [ ] MongoDB Atlas login credentials
- [ ] Cloudflare login or API token
- [ ] Dokploy admin password
- [ ] GitHub personal access token (if using API)

---

### Phase 2: Infrastructure Setup (1 hour)

#### Step 2.1: Create MongoDB Dev Databases (20 min)

**Option A: Automatic (Recommended)**

No action needed! Databases will be created automatically when applications first connect.

**Option B: Manual Creation**

Follow: `access/MONGODB-DEV-DATABASES-SETUP.md`

Databases to create:
- [ ] `identity-dev`
- [ ] `smart_hr_db-dev`
- [ ] `leave-management-dev`
- [ ] `performance_db-dev`
- [ ] `payroll_db-dev`

**Verification:**
```bash
# Via MongoDB Shell
mongosh "mongodb+srv://cluster0.8hdkzxw.mongodb.net/test" --username tonyegbo1

# List databases
show dbs

# Look for -dev databases
```

#### Step 2.2: Configure Cloudflare DNS (20 min)

**Method 1: Automated (Recommended)**

```powershell
# Navigate to repository root
cd c:\Users\Michael\Documents\GitHub\seemplify

# Run DNS setup script (dry run first)
.\scripts\setup-dev-dns.ps1 -DryRun

# Review the output, then run for real
.\scripts\setup-dev-dns.ps1
```

**Method 2: Manual**

Add these A records in Cloudflare:
- [ ] `auth-dev.seemplifyai.com` → `4.180.153.209`
- [ ] `api-dev.seemplifyai.com` → `4.180.153.209`
- [ ] `app-dev.seemplifyai.com` → `4.180.153.209`
- [ ] `api-leave-dev.seemplifyai.com` → `4.180.153.209`
- [ ] `leave-dev.seemplifyai.com` → `4.180.153.209`
- [ ] `api-performance-dev.seemplifyai.com` → `4.180.153.209`
- [ ] `performance-dev.seemplifyai.com` → `4.180.153.209`
- [ ] `api-payroll-dev.seemplifyai.com` → `4.180.153.209`
- [ ] `payroll-dev.seemplifyai.com` → `4.180.153.209`

**Verification:**
```powershell
# Test DNS resolution
nslookup auth-dev.seemplifyai.com
nslookup api-dev.seemplifyai.com
# ... test all domains
```

#### Step 2.3: Prepare Environment Variables (20 min)

Create a document with environment variables for each dev app. Use production env vars as a template, but update:
- MongoDB URIs to use `-dev` databases
- NODE_ENV to `development`
- Inter-service URLs to point to -dev domains
- Consider using separate JWT secrets for dev

**Template:** See `access/DOKPLOY-DEV-APPS-SETUP-GUIDE.md` for full environment variable lists

---

### Phase 3: Dokploy Applications Setup (2-3 hours)

Follow: `access/DOKPLOY-DEV-APPS-SETUP-GUIDE.md`

#### Step 3.1: Create Pilot Application (45 min)

Start with Identity Provider as it has fewer dependencies:

1. [ ] Open Dokploy: http://4.180.153.209:3000
2. [ ] Create new application: `identity-provider-dev`
3. [ ] Configure Git source: seemplify repository, `main` branch (temporarily)
4. [ ] Set build path: `Identityprovider/`
5. [ ] Configure domain: `auth-dev.seemplifyai.com`
6. [ ] Set environment variables (see guide)
7. [ ] Deploy application
8. [ ] Monitor deployment logs
9. [ ] Verify SSL certificate generated
10. [ ] Test: https://auth-dev.seemplifyai.com
11. [ ] **Record Application ID** (needed for GitHub Actions)

**Verification:**
- [ ] Application shows as "Running" in Dokploy
- [ ] Domain loads without SSL errors
- [ ] Application responds (even if showing errors - that's okay for now)
- [ ] Application ID recorded

**If successful, proceed to remaining apps. If issues, troubleshoot before continuing.**

#### Step 3.2: Create Remaining Applications (1.5-2 hours)

Create these applications in order (suggested):

1. [ ] **recruiter-backend-dev** (api-dev.seemplifyai.com)
   - Record App ID: _______________
   
2. [ ] **recruiter-frontend-dev** (app-dev.seemplifyai.com)
   - Record App ID: _______________
   - Update NEXT_PUBLIC_API_URL to https://api-dev.seemplifyai.com
   
3. [ ] **leave-backend-dev** (api-leave-dev.seemplifyai.com)
   - Record App ID: _______________
   
4. [ ] **leave-frontend-dev** (leave-dev.seemplifyai.com)
   - Record App ID: _______________
   
5. [ ] **performance-backend-dev** (api-performance-dev.seemplifyai.com)
   - Record App ID: _______________
   
6. [ ] **performance-frontend-dev** (performance-dev.seemplifyai.com)
   - Record App ID: _______________
   
7. [ ] **payroll-backend-dev** (api-payroll-dev.seemplifyai.com)
   - Record App ID: _______________
   
8. [ ] **payroll-frontend-dev** (payroll-dev.seemplifyai.com)
   - Record App ID: _______________

**For each application:**
- Follow the procedure in DOKPLOY-DEV-APPS-SETUP-GUIDE.md
- Verify deployment succeeds
- Test the domain loads
- Record the Application ID

**Checkpoint:** All 9 dev applications should be running and accessible.

---

### Phase 4: Git & CI/CD Setup (1 hour)

#### Step 4.1: Create Dev Branch (10 min)

**Option A: Automated**

```powershell
cd c:\Users\Michael\Documents\GitHub\seemplify
.\scripts\create-dev-branch.ps1
```

**Option B: Manual**

```bash
cd c:\Users\Michael\Documents\GitHub\seemplify
git checkout main
git pull origin main
git checkout -b dev
git push -u origin dev
```

**Verification:**
```bash
git branch -a
# Should see:
# * dev
#   main
#   remotes/origin/dev
#   remotes/origin/main
```

#### Step 4.2: Update Dokploy Apps to Use Dev Branch (15 min)

For each of the 9 dev applications in Dokploy:

1. [ ] Open application in Dokploy
2. [ ] Go to Git/Source settings
3. [ ] Change branch from `main` to `dev`
4. [ ] Save changes
5. [ ] (Optional) Redeploy to verify it works

**This ensures dev apps deploy from dev branch, not main.**

#### Step 4.3: Configure GitHub Secrets (20 min)

Follow: `access/GITHUB-SECRETS-SETUP-GUIDE.md`

**Option A: GitHub CLI**

```bash
gh secret set IDENTITY_PROVIDER_DEV_APP_ID --body "<app-id>"
gh secret set RECRUITER_BACKEND_DEV_APP_ID --body "<app-id>"
gh secret set RECRUITER_FRONTEND_DEV_APP_ID --body "<app-id>"
gh secret set LEAVE_BACKEND_DEV_APP_ID --body "<app-id>"
gh secret set LEAVE_FRONTEND_DEV_APP_ID --body "<app-id>"
gh secret set PERFORMANCE_BACKEND_DEV_APP_ID --body "<app-id>"
gh secret set PERFORMANCE_FRONTEND_DEV_APP_ID --body "<app-id>"
gh secret set PAYROLL_BACKEND_DEV_APP_ID --body "<app-id>"
gh secret set PAYROLL_FRONTEND_DEV_APP_ID --body "<app-id>"
```

**Option B: GitHub Web UI**

1. Go to repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add each of the 9 secrets above

**Verification:**
```bash
gh secret list | grep -i dev
```

#### Step 4.4: Verify GitHub Actions Workflows (15 min)

Workflows should already be committed (check `.github/workflows/` folder):

- [ ] `deploy-identity-provider-dev.yml`
- [ ] `deploy-recruiter-backend-dev.yml`
- [ ] `deploy-recruiter-frontend-dev.yml`
- [ ] `deploy-leave-backend-dev.yml`
- [ ] `deploy-leave-frontend-dev.yml`
- [ ] `deploy-performance-backend-dev.yml`
- [ ] `deploy-performance-frontend-dev.yml`
- [ ] `deploy-payroll-backend-dev.yml`
- [ ] `deploy-payroll-frontend-dev.yml`

If not present, commit and push them:

```bash
git add .github/workflows/*-dev.yml
git commit -m "feat: add dev environment GitHub Actions workflows"
git push origin dev
```

---

### Phase 5: Testing & Validation (1 hour)

#### Step 5.1: Test Automated Deployment (20 min)

**Test Dev Branch Deployment:**

1. Make a small, safe change in one application (e.g., add a comment)
   ```bash
   cd recruiter/backend
   # Add a comment to a file
   git add .
   git commit -m "test: verify dev deployment"
   git push origin dev
   ```

2. Watch GitHub Actions:
   - Go to repository → Actions tab
   - Verify "Deploy Recruiter Backend (Dev)" workflow triggers
   - Monitor the workflow run

3. Check Dokploy:
   - Open Dokploy dashboard
   - Verify `recruiter-backend-dev` shows deployment activity
   - Check logs for successful deployment

4. Verify application:
   - Visit https://api-dev.seemplifyai.com
   - Should see updated code (or at least no errors)

**Test Production Still Works:**

1. Make a small change to main branch
   ```bash
   git checkout main
   git pull origin main
   # Make a small change
   git add .
   git commit -m "test: verify prod deployment still works"
   git push origin main
   ```

2. Verify production workflow triggers
3. Verify production application updates
4. **Ensure dev and prod are isolated**

#### Step 5.2: Test All Dev Domains (15 min)

Visit each domain and verify it loads:

- [ ] https://auth-dev.seemplifyai.com
- [ ] https://api-dev.seemplifyai.com
- [ ] https://app-dev.seemplifyai.com
- [ ] https://api-leave-dev.seemplifyai.com
- [ ] https://leave-dev.seemplifyai.com
- [ ] https://api-performance-dev.seemplifyai.com
- [ ] https://performance-dev.seemplifyai.com
- [ ] https://api-payroll-dev.seemplifyai.com
- [ ] https://payroll-dev.seemplifyai.com

**All should:**
- Have valid SSL certificates (green padlock)
- Load without browser security warnings
- Show application (even if errors - that's okay)

#### Step 5.3: Test Database Isolation (10 min)

1. Create test data in dev database:
   ```javascript
   // Via MongoDB Compass or shell
   use smart_hr_db-dev
   db.test.insertOne({env: "development", createdAt: new Date()})
   ```

2. Check production database doesn't have it:
   ```javascript
   use smart_hr_db
   db.test.find({env: "development"})  // Should return nothing
   ```

3. Verify isolation works both ways

#### Step 5.4: Test Inter-Service Communication (15 min)

Test that dev services talk to other dev services, not production:

1. [ ] Dev frontend calls dev backend (check Network tab in browser)
2. [ ] Dev backend authenticates with dev identity provider
3. [ ] No cross-environment communication

**Use browser DevTools to verify API calls go to -dev domains.**

---

## 📝 Post-Implementation Tasks

### Documentation

- [ ] Update main README.md with dev environment info
- [ ] Create developer onboarding guide
- [ ] Document environment switcher script usage
- [ ] Share branching strategy with team

### Team Communication

- [ ] Notify team of new dev environment
- [ ] Provide access instructions
- [ ] Conduct training session on Git workflow
- [ ] Share URL references

### Monitoring

- [ ] Set up Azure VM resource monitoring
- [ ] Monitor MongoDB Atlas usage/costs
- [ ] Set up alerts for failed deployments
- [ ] Create dashboard for environment status

---

## ✅ Success Criteria

Your implementation is complete when:

1. ✅ All 9 dev applications deployed and running
2. ✅ All -dev domains accessible with valid SSL
3. ✅ Dev branch exists and is protected
4. ✅ GitHub Actions deploy dev branch to dev environment
5. ✅ GitHub Actions deploy main branch to production
6. ✅ Dev and production databases are isolated
7. ✅ Inter-service URLs point to correct environments
8. ✅ Test deployment works end-to-end
9. ✅ All documentation is complete
10. ✅ Team is aware and trained

---

## 🎯 Quick Reference

### Environments Summary

| Environment | Branch | Domains | Databases |
|-------------|--------|---------|-----------|
| **Development** | `dev` | `*-dev.seemplifyai.com` | `*-dev` |
| **Production** | `main` | `*.seemplifyai.com` | Production names |

### Common Tasks

**Switch local environment:**
```powershell
.\scripts\switch-env.ps1 dev   # Development
.\scripts\switch-env.ps1 prod  # Production
```

**Deploy to dev:**
```bash
git checkout dev
git pull origin dev
# Make changes
git add .
git commit -m "feat: my feature"
git push origin dev  # Auto-deploys
```

**Deploy to production:**
```bash
git checkout dev
# Ensure dev is tested and working
git checkout main
git pull origin main
git merge dev
git push origin main  # Auto-deploys
```

**Access Dokploy:**
- URL: http://4.180.153.209:3000
- Login: admin@seemplifyai.com / Seemplify2026!

---

## 🆘 Troubleshooting

### Deployment Fails

1. Check GitHub Actions logs
2. Check Dokploy deployment logs
3. Verify environment variables are set correctly
4. Verify Application ID is correct
5. Check if MongoDB can be reached

### Domain Not Loading

1. Verify DNS is propagated: `nslookup domain-dev.seemplifyai.com`
2. Check Dokploy Traefik logs
3. Verify SSL certificate was generated
4. Check if application is running in Dokploy

### Wrong Database Being Used

1. Check MONGO_URI environment variable in Dokploy
2. Verify it points to `-dev` database
3. Restart application after changing env vars
4. Check application logs for connection string

---

## 📚 Reference Documentation

| Document | Purpose |
|----------|---------|
| `DEV-ENVIRONMENT-SETUP-PLAN.md` | Complete technical plan |
| `DOKPLOY-DEV-APPS-SETUP-GUIDE.md` | Step-by-step Dokploy setup |
| `MONGODB-DEV-DATABASES-SETUP.md` | MongoDB database creation |
| `GITHUB-SECRETS-SETUP-GUIDE.md` | GitHub secrets configuration |
| `BRANCHING-STRATEGY-GUIDE.md` | Git workflow and branching |

---

## 🎉 Congratulations!

You now have a complete development environment running in parallel with production!

**What you've achieved:**
- ✅ Full dev/prod environment separation
- ✅ Automated deployments for both environments
- ✅ Database isolation
- ✅ Professional development workflow
- ✅ Safe testing before production

**Next steps:**
- Train your team on the new workflow
- Start using dev environment for all new features
- Monitor resource usage and optimize if needed
- Celebrate! This was a significant infrastructure improvement! 🎊

---

**Need Help?** Review the troubleshooting sections in each guide or check application logs in Dokploy.

**Good luck! 🚀**
