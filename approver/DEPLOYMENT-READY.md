# ✅ Approver Deployment - Complete Plan & Scripts

**Date:** January 22, 2026  
**Status:** 🚀 Ready to Execute

---

## 📋 What's Been Created

### 1. Deployment Plan
**File:** `approver/APPROVER-PROJECT-DEPLOYMENT-PLAN.md`
- Complete step-by-step deployment plan
- Phase-by-phase breakdown
- Verification checklist

### 2. Setup Scripts

**`approver/setup-approver-project.sh`**
- Creates NEW project "approver" in Dokploy
- Creates application within that project
- Configures domain `approver.aiinigeria.com`
- Outputs application ID for GitHub secrets

**`approver/restore-production-code.sh`**
- Restores production code changes
- Updates `server.js` for production (static serving, SPA fallback)
- Updates `api/index.ts` for relative paths
- Updates `vite.config.ts` for environment variables

---

## 🚀 Quick Start Guide

### Step 1: Restore Production Code

```bash
bash approver/restore-production-code.sh
```

This will:
- ✅ Update `backend/server.js` with production config
- ✅ Update `frontend/src/api/index.ts` for relative paths
- ✅ Update `frontend/vite.config.ts` for env vars
- ✅ Create `.env.production` files

### Step 2: Create Dokploy Project & Application

```bash
# Upload script to server
scp approver/setup-approver-project.sh seemplify@4.180.153.209:/tmp/

# SSH and run script
ssh seemplify@4.180.153.209 "bash /tmp/setup-approver-project.sh"
```

This will:
- ✅ Create new project "approver"
- ✅ Create application "approver" within that project
- ✅ Configure domain `approver.aiinigeria.com`
- ✅ Output application ID

### Step 3: Set GitHub Secrets

```bash
# Use the application ID from Step 2 output
gh secret set APPROVER_APP_ID --body "<application-id-from-step-2>"
gh secret set DOKPLOY_URL --body "http://4.180.153.209:3000"
gh secret set DOKPLOY_TOKEN --body "sk_dokploy_b6178e414ec737424c7d0ecf20cddd51"
```

### Step 4: Configure Environment Variables

1. Go to: http://4.180.153.209:3000
2. Login: `admin@seemplifyai.com` / `Seemplify2026!`
3. Navigate to: **approver project** → **approver application** → **Settings** → **Environment**
4. Add:
   - `NODE_ENV=production`
   - `PORT=80`
   - `MONGO_URI=<your-mongodb-connection-string>`
   - `FRONTEND_URL=https://approver.aiinigeria.com`

### Step 5: Deploy

**Option A: Via Dokploy Dashboard**
1. Go to application page
2. Click **"Deploy"** button

**Option B: Via GitHub Actions**
1. Commit and push code:
   ```bash
   git add approver/
   git commit -m "Setup approver project and restore production code"
   git push origin main
   ```
2. GitHub Actions will automatically deploy

**Option C: Via API**
```bash
curl -X POST "http://4.180.153.209:3000/api/application.deploy" \
  -H "x-api-key: sk_dokploy_b6178e414ec737424c7d0ecf20cddd51" \
  -H "Content-Type: application/json" \
  -d '{"applicationId": "<application-id>"}'
```

---

## ✅ Verification

After deployment, verify:

```bash
# Check container is running
ssh seemplify@4.180.153.209 "docker ps | grep approver"

# Test health endpoint
curl https://approver.aiinigeria.com/api/health

# Test frontend
curl -I https://approver.aiinigeria.com
```

---

## 📊 Architecture

```
Dokploy (4.180.153.209)
├── Project: "seemplify" (existing)
│   └── Applications: identity-provider, recruiter-backend, etc.
│
└── Project: "approver" (NEW) ✨
    └── Application: "approver"
        ├── Domain: approver.aiinigeria.com ✅ (DNS configured)
        ├── SSL: Let's Encrypt (auto)
        ├── Build: approver/backend/Dockerfile
        ├── Port: 80 (Traefik → 443)
        └── GitHub Actions: Auto-deploy on push
```

---

## 📝 Files Created

| File | Purpose |
|------|---------|
| `approver/APPROVER-PROJECT-DEPLOYMENT-PLAN.md` | Complete deployment plan |
| `approver/setup-approver-project.sh` | Creates project + application + domain |
| `approver/restore-production-code.sh` | Restores production code changes |

---

## 🔐 Security & Credentials

- ✅ DNS already configured (user confirmed in Cloudflare)
- ✅ Separate project for isolation
- ✅ API keys stored in GitHub Secrets
- ✅ Environment variables stored in Dokploy
- ✅ SSL via Let's Encrypt (automatic)

---

## 🎯 Key Differences from Other Apps

| Aspect | Other Apps | Approver |
|--------|-----------|----------|
| **Project** | "seemplify" | **"approver"** (NEW) |
| **Domain** | `*.seemplifyai.com` | `approver.aiinigeria.com` |
| **Isolation** | Shared project | **Separate project** |

---

## 📞 Troubleshooting

### Script Fails
- Check PostgreSQL container is running: `docker ps | grep postgres`
- Verify SSH access: `ssh seemplify@4.180.153.209`

### Application Not Found in Dashboard
- Wait 1-2 minutes after running script
- Refresh Dokploy dashboard
- Check database directly via SSH

### Deployment Fails
- Check environment variables are set
- Verify repository URL is correct
- Check Dockerfile path: `approver/backend/Dockerfile`
- View logs in Dokploy dashboard

---

## 🚀 Next Steps

1. ✅ **Execute Step 1:** Restore production code
2. ✅ **Execute Step 2:** Create project and application
3. ✅ **Execute Step 3:** Set GitHub secrets
4. ✅ **Execute Step 4:** Configure environment variables
5. ✅ **Execute Step 5:** Deploy and verify

---

**Ready to deploy! 🚀**

All scripts are executable and ready to run.
