# Dev Environment Setup - COMPLETE ✅

**Created:** January 14, 2026  
**Status:** ✅ Fully Configured

---

## 🎉 Summary

All 9 development applications have been created in Dokploy and are ready for deployment!

---

## 📦 Dev Applications Created

| Application | App ID | Dev Domain | Branch |
|-------------|--------|------------|--------|
| Identity Provider Dev | `dev-idp-001-seemplify` | https://auth-dev.seemplifyai.com | dev |
| Recruiter Backend Dev | `dev-rec-be-001-seemp` | https://api-dev.seemplifyai.com | dev |
| Recruiter Frontend Dev | `dev-rec-fe-001-seemp` | https://app-dev.seemplifyai.com | dev |
| Leave Backend Dev | `dev-lv-be-001-seemp` | https://api-leave-dev.seemplifyai.com | dev |
| Leave Frontend Dev | `dev-lv-fe-001-seemp` | https://leave-dev.seemplifyai.com | dev |
| Performance Backend Dev | `dev-pf-be-001-seemp` | https://api-performance-dev.seemplifyai.com | dev |
| Performance Frontend Dev | `dev-pf-fe-001-seemp` | https://performance-dev.seemplifyai.com | dev |
| Payroll Backend Dev | `dev-py-be-001-seemp` | https://api-payroll-dev.seemplifyai.com | dev |
| Payroll Frontend Dev | `dev-py-fe-001-seemp` | https://payroll-dev.seemplifyai.com | dev |

---

## 🌐 DNS Records Created

All Cloudflare DNS records have been configured:

| Subdomain | Points To | Proxied |
|-----------|-----------|---------|
| auth-dev.seemplifyai.com | 4.180.153.209 | ✅ |
| api-dev.seemplifyai.com | 4.180.153.209 | ✅ |
| app-dev.seemplifyai.com | 4.180.153.209 | ✅ |
| api-leave-dev.seemplifyai.com | 4.180.153.209 | ✅ |
| leave-dev.seemplifyai.com | 4.180.153.209 | ✅ |
| api-performance-dev.seemplifyai.com | 4.180.153.209 | ✅ |
| performance-dev.seemplifyai.com | 4.180.153.209 | ✅ |
| api-payroll-dev.seemplifyai.com | 4.180.153.209 | ✅ |
| payroll-dev.seemplifyai.com | 4.180.153.209 | ✅ |

---

## 🔑 GitHub Secrets Configured

All dev application IDs have been added as GitHub secrets:

| Secret Name | Value |
|------------|-------|
| `IDENTITY_PROVIDER_DEV_APP_ID` | dev-idp-001-seemplify |
| `RECRUITER_BACKEND_DEV_APP_ID` | dev-rec-be-001-seemp |
| `RECRUITER_FRONTEND_DEV_APP_ID` | dev-rec-fe-001-seemp |
| `LEAVE_BACKEND_DEV_APP_ID` | dev-lv-be-001-seemp |
| `LEAVE_FRONTEND_DEV_APP_ID` | dev-lv-fe-001-seemp |
| `PERFORMANCE_BACKEND_DEV_APP_ID` | dev-pf-be-001-seemp |
| `PERFORMANCE_FRONTEND_DEV_APP_ID` | dev-pf-fe-001-seemp |
| `PAYROLL_BACKEND_DEV_APP_ID` | dev-py-be-001-seemp |
| `PAYROLL_FRONTEND_DEV_APP_ID` | dev-py-fe-001-seemp |

---

## 🌿 Git Branch Strategy

| Branch | Environment | Auto-Deploy |
|--------|-------------|-------------|
| `main` | Production | ✅ Yes - to production apps |
| `dev` | Development | ✅ Yes - to dev apps |

---

## 🚀 How to Deploy to Dev

1. **Create feature branch from dev:**
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/my-feature
   ```

2. **Make changes and push:**
   ```bash
   git add .
   git commit -m "feat: my new feature"
   git push origin feature/my-feature
   ```

3. **Merge to dev branch:**
   - Create PR from `feature/my-feature` → `dev`
   - Merge the PR
   - GitHub Actions will auto-deploy to dev environment

4. **When ready for production:**
   - Create PR from `dev` → `main`
   - Merge the PR
   - GitHub Actions will auto-deploy to production

---

## 📊 Environment Comparison

| Aspect | Production | Development |
|--------|------------|-------------|
| Branch | `main` | `dev` |
| Domain Pattern | `*.seemplifyai.com` | `*-dev.seemplifyai.com` |
| Database Suffix | None | `-dev` (configure separately) |
| SSL | ✅ Let's Encrypt | ✅ Let's Encrypt |
| Dokploy Project | seemplify | seemplify |

---

## ⚠️ Remaining Steps

### 1. Configure Dev Environment Variables
For each dev app in Dokploy dashboard, update environment variables:
- Change `MONGO_URI` to use dev databases (e.g., `identity-dev` instead of `identity`)
- Update API URLs to use `-dev` domains
- Update any other environment-specific settings

### 2. Deploy Dev Apps
In Dokploy dashboard (http://4.180.153.209:3000):
1. Navigate to each dev application
2. Click "Deploy" to build and start the container
3. Verify the app is running at its dev URL

### 3. Test the Pipeline
1. Make a small change in the codebase
2. Push to `dev` branch
3. Verify GitHub Actions triggers
4. Confirm app redeploys in Dokploy

---

## 🔗 Quick Links

| Resource | URL |
|----------|-----|
| Dokploy Dashboard | http://4.180.153.209:3000 |
| Dev Auth | https://auth-dev.seemplifyai.com |
| Dev App | https://app-dev.seemplifyai.com |
| Dev Leave | https://leave-dev.seemplifyai.com |
| Dev Performance | https://performance-dev.seemplifyai.com |
| Dev Payroll | https://payroll-dev.seemplifyai.com |

---

## ✅ What Was Completed

1. ✅ Created 9 dev applications in Dokploy database
2. ✅ Added 9 dev domains in Dokploy database
3. ✅ Created 9 Cloudflare DNS A records
4. ✅ Created `dev` branch in GitHub
5. ✅ Added 9 GitHub secrets for dev app IDs
6. ✅ Restarted Dokploy service to load new apps

---

**The dev environment is now fully configured!** 🎉
