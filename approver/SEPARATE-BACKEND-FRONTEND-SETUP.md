# Approver Separate Backend + Frontend Deployment

**Date:** January 22, 2026  
**Status:** ✅ Separate Apps Created | 🟡 Environment Variables & Deployment Pending

---

## ✅ What Changed

**Before:** One combined app (backend served frontend)  
**Now:** Two separate apps (like recruiter-backend + recruiter-frontend)

### Architecture

- **approver-backend** (API only)
  - Domain: `api.approver.aiinigeria.com`
  - Application ID: `72cc56e8-1123-4e22-beeb-04c8184405e4`
  - Build: `./approver/backend/Dockerfile`
  - Port: `80`
  - **No frontend serving** - API endpoints only

- **approver-frontend** (React/Vite static build)
  - Domain: `approver.aiinigeria.com`
  - Application ID: `063229c9-ed49-49be-a331-92c8c47422bc`
  - Build: `./approver/frontend/Dockerfile` (nginx)
  - Port: `80`
  - **Calls backend API** at `https://api.approver.aiinigeria.com/api`

---

## ✅ Completed

1. **Created separate Dokploy applications**
   - ✅ approver-backend app created
   - ✅ approver-frontend app created
   - ✅ Domains configured:
     - `api.approver.aiinigeria.com` → backend
     - `approver.aiinigeria.com` → frontend

2. **Code Changes**
   - ✅ `approver/backend/Dockerfile` - API only (no frontend)
   - ✅ `approver/backend/server.js` - Removed static serving
   - ✅ `approver/frontend/Dockerfile` - nginx for static files
   - ✅ `approver/frontend/src/api/index.ts` - Uses backend URL
   - ✅ `approver/frontend/vite.config.ts` - Supports VITE_API_BASE_URL

3. **GitHub Actions**
   - ✅ `.github/workflows/deploy-approver-backend.yml` - Deploys backend
   - ✅ `.github/workflows/deploy-approver-frontend.yml` - Deploys frontend
   - ⚠️ **Update GitHub secrets** (see below)

---

## 🟡 Next Steps

### 1. Update GitHub Secrets

Set these secrets in GitHub (Settings → Secrets and variables → Actions):

```bash
gh secret set APPROVER_BACKEND_APP_ID --body "72cc56e8-1123-4e22-beeb-04c8184405e4"
gh secret set APPROVER_FRONTEND_APP_ID --body "063229c9-ed49-49be-a331-92c8c47422bc"
```

**Note:** The old `APPROVER_APP_ID` secret can be removed (it was for the combined app).

### 2. Add DNS Record for Backend API

Add an **A record** in Cloudflare (or your DNS provider):

- **Name:** `api.approver`
- **Type:** A
- **Value:** `4.180.153.209`
- **TTL:** Auto

This creates `api.approver.aiinigeria.com` pointing to the server.

### 3. Set Environment Variables in Dokploy

**approver-backend** (API):
- Go to: approver project → approver-backend → Settings → Environment
- Add:
  - `NODE_ENV=production`
  - `PORT=80`
  - `MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/approver?retryWrites=true&w=majority&appName=Cluster0`
  - `FRONTEND_URL=https://approver.aiinigeria.com` (for CORS)

**approver-frontend** (Static):
- Go to: approver project → approver-frontend → Settings → Environment
- Add (if needed):
  - `VITE_API_BASE_URL=https://api.approver.aiinigeria.com/api` (build-time, set in Dockerfile ARG)

### 4. Deploy Both Applications

**Via Dokploy UI:**
1. Deploy **approver-backend** first
2. Then deploy **approver-frontend**

**Via GitHub Actions:**
- Push changes to `approver/backend/` → auto-deploys backend
- Push changes to `approver/frontend/` → auto-deploys frontend

---

## 📋 Configuration Summary

| Component | Application ID | Domain | Status |
|-----------|----------------|--------|--------|
| **approver-backend** | `72cc56e8-1123-4e22-beeb-04c8184405e4` | `api.approver.aiinigeria.com` | ✅ Created |
| **approver-frontend** | `063229c9-ed49-49be-a331-92c8c47422bc` | `approver.aiinigeria.com` | ✅ Created |
| **Old combined app** | `9e7b7b2a-e8ba-4eac-8e2e-28216ee621cf` | (can be deleted) | ⚠️ Old |

---

## 🔄 Traefik Configuration

Traefik will automatically route:
- `api.approver.aiinigeria.com` → approver-backend container
- `approver.aiinigeria.com` → approver-frontend container

Both domains are configured in Dokploy's database with HTTPS (Let's Encrypt). No manual Traefik config needed.

---

## ✅ Verification

After deployment:

1. **Backend API:**
   ```bash
   curl https://api.approver.aiinigeria.com/api/health
   ```
   Expected: `{"status":"ok",...}`

2. **Frontend:**
   ```bash
   curl -I https://approver.aiinigeria.com
   ```
   Expected: HTTP 200, served by nginx

3. **Frontend → Backend API:**
   - Open https://approver.aiinigeria.com in browser
   - Check browser console - API calls should go to `https://api.approver.aiinigeria.com/api`

---

**Next:** Add DNS record for `api.approver.aiinigeria.com`, set env vars, and deploy! 🚀
