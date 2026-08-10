# 🔄 Dev vs Production - Complete Differences Guide

**Last Updated:** January 15, 2026  
**Purpose:** Understand what changes between environments and what stays the same

---

## 📊 COMPLETE ENVIRONMENT COMPARISON

### **All 9 Apps - Side by Side**

| App | Production URL | Dev URL | Production DB | Dev DB |
|-----|---------------|---------|---------------|--------|
| **Identity Provider** | `auth.seemplifyai.com` | `auth-dev.seemplifyai.com` | `identity` | `identity_dev` |
| **Recruiter Backend** | `api.seemplifyai.com` | `api-dev.seemplifyai.com` | `smart_hr_db` | `smart_hr_db_dev` |
| **Recruiter Frontend** | `app.seemplifyai.com` | `app-dev.seemplifyai.com` | N/A | N/A |
| **Leave Backend** | `api-leave.seemplifyai.com` | `api-leave-dev.seemplifyai.com` | `leave-management` | `leave-management_dev` |
| **Leave Frontend** | `leave.seemplifyai.com` | `leave-dev.seemplifyai.com` | N/A | N/A |
| **Performance Backend** | `api-performance.seemplifyai.com` | `api-performance-dev.seemplifyai.com` | `performance_db` | `performance_db_dev` |
| **Performance Frontend** | `performance.seemplifyai.com` | `performance-dev.seemplifyai.com` | N/A | N/A |
| **Payroll Backend** | `api-payroll.seemplifyai.com` | `api-payroll-dev.seemplifyai.com` | `payroll_db` | `payroll_db_dev` |
| **Payroll Frontend** | `payroll.seemplifyai.com` | `payroll-dev.seemplifyai.com` | N/A | N/A |

---

## ❌ WHAT'S DIFFERENT (Environment-Specific)

### **1. MongoDB Databases**
```env
# PRODUCTION - Uses clean database names
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/identity
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/smart_hr_db
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/leave-management
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/performance_db
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/payroll_db

# DEV - Same cluster, different databases with _dev suffix
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/identity_dev
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/smart_hr_db_dev
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/leave-management_dev
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/performance_db_dev
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/payroll_db_dev
```

**Impact:** Dev and production data are completely isolated.

---

### **2. Internal Application URLs**

**All internal app-to-app communication uses environment-specific URLs:**

```env
# PRODUCTION
IDP_ISSUER_URL=https://auth.seemplifyai.com
OIDC_REDIRECT_URI=https://api.seemplifyai.com/api/auth/oidc/callback
FRONTEND_URL=https://app.seemplifyai.com
SMARTHR_URL=https://app.seemplifyai.com
SMARTHR_API_URL=https://api.seemplifyai.com
SMARTHR_WEBHOOK_URL=https://api.seemplifyai.com/api/webhooks/idp
LEAVE_MANAGEMENT_URL=https://leave.seemplifyai.com
LEAVE_MANAGEMENT_API_URL=https://api-leave.seemplifyai.com
LEAVE_WEBHOOK_URL=https://api-leave.seemplifyai.com/api/webhooks/idp
PERFORMANCE_MANAGEMENT_URL=https://performance.seemplifyai.com
PERFORMANCE_MANAGEMENT_API_URL=https://api-performance.seemplifyai.com
PERFORMANCE_WEBHOOK_URL=https://api-performance.seemplifyai.com/api/webhooks/idp
PAYROLL_MANAGEMENT_URL=https://payroll.seemplifyai.com
PAYROLL_MANAGEMENT_API_URL=https://api-payroll.seemplifyai.com
PAYROLL_WEBHOOK_URL=https://api-payroll.seemplifyai.com/api/webhooks/idp

# DEV - Same variables, but with -dev in domains
IDP_ISSUER_URL=https://auth-dev.seemplifyai.com
OIDC_REDIRECT_URI=https://api-dev.seemplifyai.com/api/auth/oidc/callback
FRONTEND_URL=https://app-dev.seemplifyai.com
SMARTHR_URL=https://app-dev.seemplifyai.com
SMARTHR_API_URL=https://api-dev.seemplifyai.com
SMARTHR_WEBHOOK_URL=https://api-dev.seemplifyai.com/api/webhooks/idp
LEAVE_MANAGEMENT_URL=https://leave-dev.seemplifyai.com
LEAVE_MANAGEMENT_API_URL=https://api-leave-dev.seemplifyai.com
LEAVE_WEBHOOK_URL=https://api-leave-dev.seemplifyai.com/api/webhooks/idp
PERFORMANCE_MANAGEMENT_URL=https://performance-dev.seemplifyai.com
PERFORMANCE_MANAGEMENT_API_URL=https://api-performance-dev.seemplifyai.com
PERFORMANCE_WEBHOOK_URL=https://api-performance-dev.seemplifyai.com/api/webhooks/idp
PAYROLL_MANAGEMENT_URL=https://payroll-dev.seemplifyai.com
PAYROLL_MANAGEMENT_API_URL=https://api-payroll-dev.seemplifyai.com
PAYROLL_WEBHOOK_URL=https://api-payroll-dev.seemplifyai.com/api/webhooks/idp
```

**Impact:** Dev apps talk to dev apps, production apps talk to production apps. No cross-environment communication.

---

### **3. NODE_ENV Flag**

```env
# PRODUCTION
NODE_ENV=production

# DEV
NODE_ENV=development
```

**Impact:** Affects:
- Cookie security settings (`secure: process.env.NODE_ENV === 'production'`)
- Error verbosity (dev shows stack traces)
- OIDC token delivery method (dev uses query params, prod uses hash)
- Identity Provider hub apps (dev vs production app lists)

---

### **4. OIDC Cookie Secrets (Different for security)**

```env
# PRODUCTION
OIDC_COOKIE_SECRET=<rotated-production-secret-from-secret-manager>
IDP_WEBHOOK_MASTER_SECRET=<at-least-32-random-bytes-from-secret-manager>
# Product deployments receive a derived target-specific IDP_WEBHOOK_SECRET.

# DEV
OIDC_COOKIE_SECRET=<local-development-secret-at-least-32-characters>
IDP_WEBHOOK_MASTER_SECRET=<local-high-entropy-secret-at-least-32-bytes>
# Local manual setups may use a single IDP_WEBHOOK_SECRET; production may not.
```

**Impact:** Cookies/tokens from dev won't work in production and vice versa.
Webhook keys are isolated per receiving product, so one product cannot forge
authorization events for another.

---

### **5. Email Sender Names**

```env
# PRODUCTION
SENDER_NAME=SEEMPLIFY
BREVO_FROM_NAME=SEEMPLIFY

# DEV
SENDER_NAME=SEEMPLIFY DEV
BREVO_FROM_NAME=SEEMPLIFY DEV
```

**Impact:** Users can tell if emails come from dev vs production.

---

### **6. Frontend Build Arguments**

**Frontends use different Dockerfiles:**

**Production:** `Dockerfile`
```dockerfile
ARG NEXT_PUBLIC_API_URL=https://api-leave.seemplifyai.com/api
ARG NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
ARG NEXT_PUBLIC_APP_URL=https://leave.seemplifyai.com
```

**Dev:** `Dockerfile.dev`
```dockerfile
ARG NEXT_PUBLIC_API_URL=https://api-leave-dev.seemplifyai.com/api
ARG NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com
ARG NEXT_PUBLIC_APP_URL=https://leave-dev.seemplifyai.com
```

**Impact:** Frontend code is compiled with different API endpoints baked in.

---

## ✅ WHAT'S IDENTICAL (Shared Configuration)

### **1. External Service URLs**

**These use PRODUCTION URLs even in dev:**

```env
# SAME in both dev and production
OPENWEBUI_URL=https://ai.seemplifyai.com
OUTLINE_URL=https://docs.seemplifyai.com
LMS_URL=https://lms.seemplifyai.com
```

**Why:** These are shared services, not environment-specific. Dev users access the same AI Assistant, Docs, and LMS as production users.

---

### **2. All API Keys & Integration Credentials**

```env
# SAME in both dev and production
AZURE_OPENAI_API_KEY=Tj3NdagLJ2...
AZURE_OPENAI_ENDPOINT=https://ai-tranzfarai913527268236.cognitiveservices.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4.1
AZURE_OPENAI_API_VERSION=2025-01-01-preview

BREVO_API_KEY=<shared-api-key>
BREVO_FROM_EMAIL=no-reply@seemplifyai.com

NYLAS_API_KEY=<same-key>
NYLAS_API_URI=https://api.us.nylas.com
```

**Why:** Same Azure/Brevo/Nylas accounts used for both environments to save costs and simplify management.

---

### **3. OIDC Client Credentials**

```env
# SAME in both dev and production
OIDC_CLIENT_ID=smarthr-backend
OIDC_CLIENT_SECRET=smarthr-secret

OIDC_CLIENT_ID=leave-management
OIDC_CLIENT_SECRET=leave-management-secret

OIDC_CLIENT_ID=performance-management
OIDC_CLIENT_SECRET=performance-management-secret

OIDC_CLIENT_ID=payroll-management
OIDC_CLIENT_SECRET=payroll-management-secret
```

**Why:** These are defined in `Identityprovider/clients.json` which is shared. The IDP handles both dev and prod redirect URIs for each client.

---

### **4. Application Source Code**

**100% identical:**
- All routes, controllers, models
- All business logic
- All AI prompts and features
- All UI components
- All validation rules

**The ONLY differences are environment variables!**

---

## 🎯 ISOLATION GUARANTEES

### **Database Isolation:**
```
Production:                    Dev:
Users in smart_hr_db    ≠     Users in smart_hr_db_dev
Jobs in smart_hr_db     ≠     Jobs in smart_hr_db_dev
```
→ **Dev changes don't affect production data**

### **Domain Isolation:**
```
app.seemplifyai.com    →  Production Traefik rules
app-dev.seemplifyai.com →  Dev Traefik rules
```
→ **Separate SSL certs, separate routing**

### **Docker Isolation:**
```
Production Docker Swarm Services:
- recruiter-backend-abc123
- leave-backend-def456

Dev Docker Swarm Services:  
- recruiter-backend-dev-ghi789
- leave-backend-dev-jkl012
```
→ **Separate containers, separate resources**

---

## 🔄 WORKFLOW EXAMPLE (All Apps)

### **Scenario: Add a new feature to Leave Management**

**Step 1: Develop on dev branch**
```bash
git checkout dev
# Edit leave-management/backend/routes/newFeature.js
git add leave-management/
git commit -m "feat: add new feature"
git push origin dev
```

**What happens:**
- ✅ `deploy-leave-backend-dev.yml` triggers (watches `dev` branch)
- ✅ Deploys to `leave-backend-dev` Dokploy app
- ✅ Uses `MONGO_URI=.../leave-management_dev`
- ✅ Updates `https://api-leave-dev.seemplifyai.com`
- ❌ **Production leave-backend UNTOUCHED**
- ❌ **Production database UNTOUCHED**

**Step 2: Test on dev**
```bash
# Visit https://leave-dev.seemplifyai.com
# Test the new feature
# Data goes to leave-management_dev database
```

**Step 3: Deploy to production**
```bash
git checkout main
git merge dev
git push origin main
```

**What happens:**
- ✅ `deploy-leave-backend.yml` triggers (watches `main` branch)
- ✅ Deploys to `leave-backend` Dokploy app (different app!)
- ✅ Uses `MONGO_URI=.../leave-management` (different database!)
- ✅ Updates `https://api-leave.seemplifyai.com`
- ❌ **Dev environment UNTOUCHED**

---

## 🛡️ PROTECTION MECHANISMS

### **1. Dokploy App Separation**
- 18 total apps in Dokploy (9 prod + 9 dev)
- Each has its own configuration
- Can't accidentally deploy to wrong app (different APP_IDs in GitHub secrets)

### **2. GitHub Workflow Separation**
- 18 workflow files
- Dev workflows: `branches: [dev]`
- Prod workflows: `branches: [main]`
- Impossible to trigger wrong workflow from wrong branch

### **3. Runtime Environment Detection**
```javascript
// Code automatically adapts based on:
process.env.NODE_ENV          // 'production' or 'development'
process.env.MONGO_URI         // Different per app in Dokploy
window.location.hostname      // 'app-dev' vs 'app'
```

### **4. Build-Time Configuration**
- Dev frontends built with `Dockerfile.dev` (dev URLs)
- Prod frontends built with `Dockerfile` (prod URLs)
- Configured per-app in Dokploy database

---

## 🎯 KEY TAKEAWAY

**When you push code:**
- **To `dev` branch** → Only dev credentials used, only dev apps deploy
- **To `main` branch** → Only production credentials used, only production apps deploy

**The same code runs in both environments, but:**
- ❌ Different databases (data isolation)
- ❌ Different domains (network isolation)
- ❌ Different cookie secrets (security isolation)
- ❌ Different NODE_ENV (behavior isolation)
- ✅ Same API keys (cost sharing)
- ✅ Same external services (feature parity)
- ✅ Same business logic (identical functionality)

---

**Your production is protected by 4 layers of isolation! 🛡️**
