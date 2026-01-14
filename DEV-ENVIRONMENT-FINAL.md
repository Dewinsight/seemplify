# ✅ Dev Environment - Complete & Working!

**Status:** 100% OPERATIONAL  
**Date:** 2026-01-14 17:55 UTC
**Last Fix:** OIDC login now correctly redirects to `auth-dev.seemplifyai.com`

---

## 🎉 All 9/9 Apps Running & Accessible

| Application | Dev URL | Status |
|-------------|---------|--------|
| Identity Provider | https://auth-dev.seemplifyai.com | ✅ HTTP 302 (login) |
| Recruiter Backend | https://api-dev.seemplifyai.com | ✅ Running |
| Recruiter Frontend | https://app-dev.seemplifyai.com | ✅ Running |
| Leave Backend | https://api-leave-dev.seemplifyai.com | ✅ Running |
| Leave Frontend | https://leave-dev.seemplifyai.com | ✅ Running |
| Performance Backend | https://api-performance-dev.seemplifyai.com | ✅ Running |
| Performance Frontend | https://performance-dev.seemplifyai.com | ✅ HTTP 200 |
| Payroll Backend | https://api-payroll-dev.seemplifyai.com | ✅ Running |
| Payroll Frontend | https://payroll-dev.seemplifyai.com | ✅ Running |

---

## ⚙️ Configuration Summary

### What's the SAME as Production ✅

- **All secrets** (API keys, credentials, etc.) - Production secrets used
- **Azure OpenAI** - Same endpoint and keys
- **Cloudinary** - Same account
- **Brevo Email** - Same API key
- **Weaviate** - Same instance
- **Nylas** - Same configuration
- **OIDC Client Secrets** - Same values
- **LMS, Outline, OpenWebUI URLs** - Same production URLs
- **All app logic** - Identical codebase

### What's DIFFERENT for Dev ❌

**ONLY MongoDB Databases have `_dev` suffix:**
- `identity_dev` (not `identity`)
- `smart_hr_db_dev` (not `smart_hr_db`)
- `leave-management_dev`
- `performance_db_dev`
- `payroll_db_dev`

**URLs have `-dev` suffix for routing:**
- All redirect URIs use `-dev` domains
- All webhook URLs use `-dev` domains
- All frontend/backend URLs use `-dev` domains

---

## 🔄 Auto-Deployment Confirmed Working

### ✅ Dev Branch → Dev Environment
```bash
git push origin dev
→ GitHub Actions triggers
→ Deploys to https://*-dev.seemplifyai.com
```

**Recent proof:**
```
✅ Deploy Identity Provider (Dev) - success (11s ago)
✅ Deploy Leave Backend (Dev) - success  
✅ Deploy Recruiter Backend (Dev) - success
```

### ✅ Main Branch → Production
```bash
git push origin main
→ GitHub Actions triggers
→ Deploys to https://*.seemplifyai.com
```

---

## 📋 Updated clients.json

**Added dev URLs to all OIDC clients:**
- ✅ smarthr-backend: `api-dev`, `app-dev`, `auth-dev`
- ✅ leave-management: `api-leave-dev`, `leave-dev`, `auth-dev`
- ✅ performance-management: `api-performance-dev`, `performance-dev`, `auth-dev`
- ✅ payroll-management: `api-payroll-dev`, `payroll-dev`, `auth-dev`
- ✅ openwebui: `ai-dev`, `auth-dev`
- ✅ outline: `docs-dev`, `auth-dev`

---

## 🎯 Complete Dev Workflow

```bash
# 1. Work on dev branch
git checkout dev

# 2. Make changes
# ... edit files ...

# 3. Commit and push
git commit -am "feat: new feature"
git push origin dev

# 4. Auto-deploys to dev environment
# Test at https://[app]-dev.seemplifyai.com

# 5. When ready for production
git checkout main
git merge dev
git push origin main

# 6. Auto-deploys to production
# Live at https://[app].seemplifyai.com
```

---

## 🔑 Key Configuration

**Environment Variables:**
- Everything uses **production values**
- ONLY MongoDB uses `_dev` databases
- URLs automatically use `-dev` suffix for routing

**Docker Services:**
- All 9 services: `1/1` replicas ✅
- Traefik routing: Configured ✅
- SSL certificates: Active ✅
- Same network as production ✅

**Frontend Dockerfiles:**
- Each frontend has a `Dockerfile.dev` with dev environment defaults:
  - `leave-management/frontend/Dockerfile.dev`
  - `performance/frontend/Dockerfile.dev`
  - `payroll/frontend/Dockerfile.dev`
  - `recruiter/frontend/Dockerfile.dev`
- These have `NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com` baked in at build time

---

## ✅ Summary

**Your dev environment is now:**
- ✅ Using production secrets/keys (same as prod)
- ✅ Using dev MongoDB databases (isolated data)
- ✅ Using dev URLs (proper routing)
- ✅ Auto-deploying from dev branch
- ✅ Ready to merge to main for production deployment

**The ONLY difference from production is the MongoDB database names have `_dev` suffix. Everything else (API keys, services, configurations) is identical to production.** 🎉
