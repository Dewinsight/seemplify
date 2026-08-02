# Approver Deployment Plan - New Project Setup

**Date:** January 22, 2026  
**Status:** 🚀 Ready to Execute

---

## 📋 Overview

This plan sets up a **NEW project called "approver"** in Dokploy (separate from the existing "seemplify" project) and deploys the approver application to `approver.aiinigeria.com`.

**DNS Status:** ✅ Already configured in Cloudflare (A record: `approver` → `4.180.153.209`)

---

## 🎯 Objectives

1. ✅ Create new Dokploy project: **"approver"**
2. ✅ Create application within that project
3. ✅ Configure domain: `approver.aiinigeria.com`
4. ✅ Set up GitHub Actions for auto-deployment
5. ✅ Configure environment variables
6. ✅ Deploy application

---

## 📝 Step-by-Step Plan

### Phase 1: Restore Production Code Changes

**Files to Update:**

1. **`approver/backend/server.js`**
   - Add production mode detection
   - Add static file serving for `frontend/dist`
   - Add SPA fallback route
   - Add `/api/health` endpoint
   - Update CORS for production

2. **`approver/frontend/src/api/index.ts`**
   - Use relative path `/api` in production
   - Keep `http://localhost:5000/api` for development

3. **`approver/frontend/vite.config.ts`**
   - Add environment variable handling
   - Expose `import.meta.env.PROD` to frontend

---

### Phase 2: Create Dokploy Project & Application

**Via SSH + Database:**

1. **SSH into Dokploy server:**
   ```bash
   ssh seemplify@4.180.153.209
   ```

2. **Create new project "approver":**
   - Generate projectId
   - Insert into `project` table
   - Set name: "approver"

3. **Create application:**
   - Generate applicationId
   - Link to "approver" project
   - Set repository: GitHub repo URL
   - Set build path: `approver/backend/`
   - Set Dockerfile: `approver/backend/Dockerfile`

4. **Configure domain:**
   - Domain: `approver.aiinigeria.com`
   - HTTPS: true
   - Certificate: Let's Encrypt (auto)

**Script:** `approver/setup-approver-project.sh` (will be created)

---

### Phase 3: Configure GitHub Actions

**Update Secrets:**

```bash
# Set GitHub secrets
gh secret set DOKPLOY_URL --body "http://4.180.153.209:3000"
gh secret set DOKPLOY_TOKEN --body "sk_dokploy_b6178e414ec737424c7d0ecf20cddd51"
gh secret set APPROVER_APP_ID --body "<application-id-from-step-2>"
```

**Workflow:** Already exists at `.github/workflows/deploy-approver.yml`

---

### Phase 4: Configure Environment Variables

**In Dokploy Dashboard:**

1. Go to: http://4.180.153.209:3000
2. Navigate to: **approver project** → **approver application** → **Settings** → **Environment**
3. Add variables:

| Variable | Value | Purpose |
|----------|-------|---------|
| `NODE_ENV` | `production` | Production mode |
| `PORT` | `80` | Server port |
| `MONGO_URI` | `mongodb+srv://...` | MongoDB connection string |
| `FRONTEND_URL` | `https://approver.aiinigeria.com` | Frontend URL for CORS |

---

### Phase 5: Deploy

**Option 1: Via Dokploy Dashboard**
1. Go to application page
2. Click **"Deploy"** button
3. Wait for build to complete

**Option 2: Via GitHub Actions**
1. Push code to `main` branch
2. Workflow triggers automatically
3. Monitor deployment in GitHub Actions

**Option 3: Via API**
```bash
curl -X POST "http://4.180.153.209:3000/api/application.deploy" \
  -H "x-api-key: sk_dokploy_b6178e414ec737424c7d0ecf20cddd51" \
  -H "Content-Type: application/json" \
  -d '{"applicationId": "<application-id>"}'
```

---

## 🔧 Scripts to Create

1. **`approver/setup-approver-project.sh`**
   - Creates new project "approver"
   - Creates application
   - Configures domain
   - Outputs application ID for GitHub secrets

2. **`approver/restore-production-code.sh`**
   - Restores production code changes
   - Updates server.js, api/index.ts, vite.config.ts

---

## ✅ Verification Checklist

After deployment, verify:

- [ ] Project "approver" exists in Dokploy
- [ ] Application "approver" exists and is linked to project
- [ ] Domain `approver.aiinigeria.com` is configured
- [ ] SSL certificate is generated (Let's Encrypt)
- [ ] Container is running: `docker ps | grep approver`
- [ ] Health endpoint works: `curl https://approver.aiinigeria.com/api/health`
- [ ] Frontend loads: `curl https://approver.aiinigeria.com`
- [ ] GitHub Actions workflow is configured
- [ ] Environment variables are set
- [ ] MongoDB connection works

---

## 🚀 Quick Start

**Execute the setup:**

```bash
# 1. Restore production code
bash approver/restore-production-code.sh

# 2. SSH and create project/application
scp approver/setup-approver-project.sh seemplify@4.180.153.209:/tmp/
ssh seemplify@4.180.153.209 "bash /tmp/setup-approver-project.sh"

# 3. Set GitHub secrets (use application ID from step 2)
gh secret set APPROVER_APP_ID --body "<application-id>"

# 4. Configure environment variables in Dokploy dashboard

# 5. Deploy via dashboard or push code
```

---

## 📊 Architecture

```
Dokploy (4.180.153.209)
├── Project: "seemplify" (existing)
│   └── Applications: identity-provider, recruiter-backend, etc.
│
└── Project: "approver" (NEW)
    └── Application: "approver"
        ├── Domain: approver.aiinigeria.com
        ├── SSL: Let's Encrypt (auto)
        ├── Build: approver/backend/Dockerfile
        └── Port: 80 (Traefik → 443)
```

---

## 🔐 Security Notes

- ✅ DNS already configured (user confirmed)
- ✅ Separate project for isolation
- ✅ Environment variables stored in Dokploy (not in code)
- ✅ API keys stored in GitHub Secrets
- ✅ SSL via Let's Encrypt (automatic)

---

## 📝 Next Steps

1. **Execute Phase 1:** Restore production code
2. **Execute Phase 2:** Create project and application
3. **Execute Phase 3:** Configure GitHub Actions
4. **Execute Phase 4:** Set environment variables
5. **Execute Phase 5:** Deploy and verify

---

**Ready to execute! 🚀**
