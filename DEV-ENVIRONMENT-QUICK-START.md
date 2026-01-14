# Development Environment - Quick Start Guide

**Created:** January 14, 2026  
**Status:** ✅ All Preparation Complete - Ready for Your Implementation  
**Your Next Steps:** Start with step 1 below

---

## 🎉 What's Been Prepared for You

### ✅ COMPLETE - Automated Setup
- ✅ **9 GitHub Actions Workflows** - Created and committed
- ✅ **8 Comprehensive Guides** - All documentation ready
- ✅ **3 Helper Scripts** - Automation tools created
- ✅ **Complete Architecture Plan** - Every detail mapped out

### ⏳ PENDING - Your Manual Steps
The following require your direct action (3-5 hours total):

1. ⏳ Create 9 dev apps in Dokploy
2. ⏳ Set up Cloudflare DNS records
3. ⏳ Create dev branch in Git
4. ⏳ Configure GitHub secrets
5. ⏳ Test everything

---

## 🚀 Your Implementation Checklist

### Step 1: Run DNS Setup (10 min)

```powershell
cd c:\Users\Michael\Documents\GitHub\seemplify
.\scripts\setup-dev-dns.ps1
```

**What this does:**
- Creates 9 DNS records in Cloudflare
- All `*-dev.seemplifyai.com` domains point to your Azure VM
- SSL certificates will auto-generate when apps deploy

**Verification:**
```powershell
nslookup auth-dev.seemplifyai.com
# Should return: 4.180.153.209
```

---

### Step 2: Create Dokploy Dev Apps (2-3 hours)

**📖 Follow:** `access/DOKPLOY-DEV-APPS-SETUP-GUIDE.md`

**Quick summary:**
1. Open Dokploy: http://4.180.153.209:3000
2. Login: admin@seemplifyai.com / Seemplify2026!
3. Create these 9 applications:

| App Name | Domain | Database |
|----------|--------|----------|
| identity-provider-dev | auth-dev.seemplifyai.com | identity-dev |
| recruiter-backend-dev | api-dev.seemplifyai.com | smart_hr_db-dev |
| recruiter-frontend-dev | app-dev.seemplifyai.com | (uses backend) |
| leave-backend-dev | api-leave-dev.seemplifyai.com | leave-management-dev |
| leave-frontend-dev | leave-dev.seemplifyai.com | (uses backend) |
| performance-backend-dev | api-performance-dev.seemplifyai.com | performance_db-dev |
| performance-frontend-dev | performance-dev.seemplifyai.com | (uses backend) |
| payroll-backend-dev | api-payroll-dev.seemplifyai.com | payroll_db-dev |
| payroll-frontend-dev | payroll-dev.seemplifyai.com | (uses backend) |

**For each app:**
- Set build path (e.g., `recruiter/backend/`)
- Configure environment variables (use guide for templates)
- Set domain
- Deploy
- ⚠️ **CRITICAL:** Record the Application ID (needed for GitHub Actions)

**Application IDs Record:**
```
identity-provider-dev:     __________________
recruiter-backend-dev:      __________________
recruiter-frontend-dev:     __________________
leave-backend-dev:          __________________
leave-frontend-dev:         __________________
performance-backend-dev:    __________________
performance-frontend-dev:   __________________
payroll-backend-dev:        __________________
payroll-frontend-dev:       __________________
```

---

### Step 3: Create Dev Branch (5 min)

```powershell
.\scripts\create-dev-branch.ps1
```

**What this does:**
- Creates `dev` branch from `main`
- Pushes it to GitHub
- Sets up tracking

**Manual alternative:**
```bash
git checkout main
git pull origin main
git checkout -b dev
git push -u origin dev
```

---

### Step 4: Configure GitHub Secrets (15 min)

**📖 Follow:** `access/GITHUB-SECRETS-SETUP-GUIDE.md`

**Using the Application IDs from Step 2, run:**

```bash
gh secret set IDENTITY_PROVIDER_DEV_APP_ID --body "YOUR_APP_ID_HERE"
gh secret set RECRUITER_BACKEND_DEV_APP_ID --body "YOUR_APP_ID_HERE"
gh secret set RECRUITER_FRONTEND_DEV_APP_ID --body "YOUR_APP_ID_HERE"
gh secret set LEAVE_BACKEND_DEV_APP_ID --body "YOUR_APP_ID_HERE"
gh secret set LEAVE_FRONTEND_DEV_APP_ID --body "YOUR_APP_ID_HERE"
gh secret set PERFORMANCE_BACKEND_DEV_APP_ID --body "YOUR_APP_ID_HERE"
gh secret set PERFORMANCE_FRONTEND_DEV_APP_ID --body "YOUR_APP_ID_HERE"
gh secret set PAYROLL_BACKEND_DEV_APP_ID --body "YOUR_APP_ID_HERE"
gh secret set PAYROLL_FRONTEND_DEV_APP_ID --body "YOUR_APP_ID_HERE"
```

**Verify:**
```bash
gh secret list | grep -i dev
```

---

### Step 5: Update Dokploy Apps to Use Dev Branch (10 min)

**For each of the 9 dev apps in Dokploy:**
1. Open app in Dokploy dashboard
2. Go to Git/Source settings
3. Change branch from `main` to `dev`
4. Save

**Why:** This ensures dev apps deploy from dev branch, not main.

---

### Step 6: Test Deployment (30 min)

**Test dev environment:**
```bash
cd recruiter/backend
echo "// Test dev deployment" >> index.js
git add .
git commit -m "test: verify dev deployment works"
git push origin dev
```

**Watch for:**
1. GitHub Actions workflow triggers
2. "Deploy Recruiter Backend (Dev)" runs successfully
3. Dokploy shows deployment activity for `recruiter-backend-dev`
4. https://api-dev.seemplifyai.com updates

**Test production still works:**
```bash
git checkout main
echo "// Test prod still works" >> index.js
git add .
git commit -m "test: verify production deployment"
git push origin main
```

**Verify:**
- Production workflow triggers
- Production app updates
- No cross-contamination

---

## 📚 Complete Documentation Reference

All guides are in the `access/` folder:

| Guide | Use When |
|-------|----------|
| **DEV-ENVIRONMENT-README.md** | Overview and orientation |
| **DEV-ENVIRONMENT-MASTER-GUIDE.md** | Detailed step-by-step implementation |
| **DOKPLOY-DEV-APPS-SETUP-GUIDE.md** | Creating Dokploy applications |
| **MONGODB-DEV-DATABASES-SETUP.md** | Database setup (optional - auto-creates) |
| **GITHUB-SECRETS-SETUP-GUIDE.md** | Configuring GitHub secrets |
| **BRANCHING-STRATEGY-GUIDE.md** | Git workflow and best practices |
| **DEV-ENVIRONMENT-IMPLEMENTATION-SUMMARY.md** | What's done vs. what's pending |
| **DEV-ENVIRONMENT-SETUP-PLAN.md** | Complete technical architecture |

---

## 🎯 After Setup is Complete

### Daily Workflow

**Developing a new feature:**
```bash
# 1. Create feature branch from dev
git checkout dev
git pull origin dev
git checkout -b feature/my-awesome-feature

# 2. Develop and test locally
# ... make changes ...

# 3. Push to dev for testing
git checkout dev
git merge feature/my-awesome-feature
git push origin dev
# ➡️ Auto-deploys to *-dev.seemplifyai.com

# 4. Test in dev environment
# Visit https://app-dev.seemplifyai.com

# 5. When ready, deploy to production
git checkout main
git merge dev
git push origin main
# ➡️ Auto-deploys to *.seemplifyai.com
```

### Switch Local Environment

```powershell
# Use development databases and URLs
.\scripts\switch-env.ps1 dev

# Use production databases and URLs (⚠️ be careful!)
.\scripts\switch-env.ps1 prod
```

---

## 🎓 Key Concepts

### Environment Isolation

| Aspect | Development | Production |
|--------|-------------|------------|
| Git Branch | `dev` | `main` |
| Domains | `*-dev.seemplifyai.com` | `*.seemplifyai.com` |
| Databases | `*-dev` | Original names |
| Auto-Deploy | ✅ Yes | ✅ Yes |
| Purpose | Testing & integration | Live customers |

### Deployment Flow

```
Developer → Feature Branch → Dev Branch → Dev Environment (test)
                                    ↓
                              Main Branch → Production (live)
```

---

## ✅ Success Criteria

You're done when:

- [ ] All 9 dev apps running in Dokploy
- [ ] All `*-dev.seemplifyai.com` domains load with valid SSL
- [ ] Push to dev branch auto-deploys to dev environment
- [ ] Push to main branch auto-deploys to production
- [ ] Dev and production databases are separate
- [ ] You can develop fearlessly without breaking production!

---

## 🆘 Troubleshooting

### Deployment Not Triggering

**Check:**
1. GitHub Actions workflow exists
2. Pushed to correct branch (`dev` or `main`)
3. File changes match workflow path patterns
4. GitHub secrets are set correctly

**View:** GitHub → Actions tab → Workflow runs

### Domain Not Loading

**Check:**
1. DNS propagated: `nslookup domain-dev.seemplifyai.com`
2. Application running in Dokploy
3. SSL certificate generated (may take 2-5 minutes)
4. Traefik routing configured (automatic)

### Database Connection Issues

**Check:**
1. MongoDB URI in environment variables
2. Database name includes `-dev` suffix
3. Network access in MongoDB Atlas (allow Azure VM IP)
4. Connection string format correct

---

## 💡 Pro Tips

1. **Always test in dev first** - Never push directly to main
2. **Use feature branches** - Keep dev clean and deployable
3. **Monitor resource usage** - 18 apps need more resources than 9
4. **Keep dev synced with main** - Periodically merge main → dev
5. **Document changes** - Update guides if you customize anything

---

## 🎉 You're Ready!

Everything is prepared. Your next action is Step 1: Run the DNS setup script.

**Estimated time to complete:** 3-5 hours

**Best approach:** Set aside an afternoon, follow the steps, test thoroughly.

**You've got comprehensive documentation, automation scripts, and a clear plan.**

**Let's build this! 🚀**

---

**Questions?** Check the comprehensive guides in `access/` folder.

**Ready?** Start with: `.\scripts\setup-dev-dns.ps1`
