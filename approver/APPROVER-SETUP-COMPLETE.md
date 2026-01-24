# ✅ Approver Setup Complete

**Date:** January 22, 2026  
**Status:** 🚀 Ready for Deployment

---

## 📋 What's Been Done

### ✅ Code Configuration

1. **Backend Production Setup**
   - [x] Created `backend/.env.production`
   - [x] Created `backend/Dockerfile` (multi-stage build)
   - [x] Updated `backend/server.js` (production mode, static serving, SPA fallback)

2. **Frontend Production Setup**
   - [x] Created `frontend/.env.production`
   - [x] Updated `frontend/src/api/index.ts` (relative API paths)
   - [x] Updated `frontend/vite.config.ts` (build-time environment)

3. **Deployment Documentation**
   - [x] `DOKPLOY-DEPLOYMENT-GUIDE.md` (step-by-step Dokploy guide)
   - [x] `APPROVER-DEPLOYMENT-SUMMARY.md` (complete overview)

4. **GitHub Actions Workflow**
   - [x] `.github/workflows/deploy-approver.yml` (uses official GitHub Action)

5. **DNS Record**
   - [x] A record added in Cloudflare (you manually confirmed)

---

## 🎯 Architecture Overview

```
Dokploy (4.180.153.209)
├── Traefik (Reverse Proxy)
│   ├── SSL: Let's Encrypt (auto-generated)
│   └── Routing: approver.aiinigeria.com → approver container
│
└── Approver Container
    ├── Port 80 (exposed by Traefik)
    ├── Backend: Express.js
    │   ├── API: /api/*
    │   ├── MongoDB Atlas
    │   └── Static Frontend: / (serves frontend/dist)
    └── Health Check: /api/health
```

**Isolation:** The `approver/` app is completely independent from your other apps which use `*.seemplifyai.com` domains.

---

## 🌐 Access URLs

| Service | URL |
|----------|-----|
| **Frontend** | https://approver.aiinigeria.com/ |
| **API Health** | https://approver.aiinigeria.com/api/health |
| **Auth API** | https://approver.aiinigeria.com/api/auth/login |
| **Projects API** | https://approver.aiinigeria.com/api/projects |
| **Analyze API** | https://approver.aiinigeria.com/api/analyze |

---

## 🚀 What to Do Next

### Step 1: Create Application in Dokploy

1. Open: http://4.180.153.209:3000
2. Login with Dokploy credentials (see `access/DOKPLOY-CREDENTIALS.md`)
3. Click **"Create Application"**
4. Fill in:

| Field | Value |
|-------|-------|
| **Name** | `approver` |
| **Repository** | `https://github.com/YOUR_USERNAME/seemplify` |
| **Branch** | `main` (or your current branch) |
| **Root Path** | `approver/` |
| **Build Path** | `backend/` (where Dockerfile is) |
| **Dockerfile Path** | `backend/Dockerfile` |

5. Click **"Create Application"**

### Step 2: Configure Domain

1. After deployment, go to **Application → Settings → Domains**
2. Click **"Add Domain"**
3. Enter: `approver.aiinigeria.com`
4. Click **"Save"**

Traefik will automatically:
- Configure routing: `Host(approver.aiinigeria.com)`
- Generate SSL certificate (Let's Encrypt)
- Enable HTTPS

### Step 3: Set Environment Variables

1. Go to **Application → Settings → Environment**
2. Add these variables:

| Variable | Value | Purpose |
|----------|-------|---------|
| `NODE_ENV` | `production` | Production mode |
| `PORT` | `80` | Server port (matches Dockerfile) |
| `MONGO_URI` | Your MongoDB connection string | Database connection |

3. Click **"Save"**
4. Go to **Application → Redeploy**

---

## 📊 Configuration Files Created

### Backend Files

**`backend/.env.production`** (NOT in Git - local only)
```env
NODE_ENV=production
PORT=80
FRONTEND_URL=https://approver.aiinigeria.com
```

**`backend/Dockerfile`**
```dockerfile
# Multi-stage Dockerfile for Approver Backend + Frontend
FROM node:18-alpine AS builder
# Build frontend
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/vite.config.ts ./frontend/
COPY frontend/tsconfig*.json ./frontend/
COPY frontend/src ./frontend/src
COPY frontend/index.html ./frontend/
COPY frontend/public ./frontend/public
RUN cd frontend && npm run build

# Production stage
FROM node:18-alpine
WORKDIR /app
# Copy production dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.js ./
COPY --from=builder /app/controllers ./controllers
COPY --from=builder /app/middleware ./middleware
COPY --from=builder /app/models ./models
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/services ./services
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package*.json ./
# Copy built frontend
COPY --from=builder /app/frontend/dist ./frontend/dist

EXPOSE 80
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "server.js"]
```

### Frontend Files

**`frontend/.env.production`** (NOT in Git - local only)
```env
VITE_PROD=true
VITE_API_BASE_URL=/api
```

**`frontend/src/api/index.ts`**
```typescript
import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.PROD ? '' : 'http://localhost:5000/api'
});

export default api;
```

**`frontend/vite.config.ts`**
```typescript
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const env = loadEnv({ mode: process.env.NODE_ENV || 'development' });

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.PROD': JSON.stringify(env.PROD === 'true'),
  },
});
```

---

## 🔄 Automatic Deployment via GitHub Actions

### Workflow File

**`.github/workflows/deploy-approver.yml`**
- Triggers on push to `approver/**` path
- Uses official Dokploy GitHub Action
- Automatically deploys when code is pushed to main branch

### How to Trigger Deployment

**Automatic (on push):**
```bash
# Make changes to approver/ code
git add approver/
git commit -m "feat: my change"
git push origin main

# GitHub Actions automatically detects change
# Triggers workflow
# Calls Dokploy API
# Application redeploys
```

**Manual (workflow_dispatch):**
1. Go to GitHub → Actions
2. Click **"Deploy Approver to Dokploy"**
3. Type `yes` and click **"Run workflow"**

---

## 🔍 GitHub Secrets Required

Add these secrets to your GitHub repository:

| Secret Name | Purpose | How to Add |
|-------------|---------|--------------|
| `DOKPLOY_TOKEN` | Dokploy API authentication | `gh secret set DOKPLOY_TOKEN` |
| `DOKPLOY_URL` | Dokploy dashboard URL | `gh secret set DOKPLOY_URL` |
| `APPROVER_APP_ID` | Application ID from Dokploy | `gh secret set APPROVER_APP_ID` |

### Get APPROVER_APP_ID:

1. Deploy the application in Dokploy (Step 1 above)
2. Once deployed, the Application ID will appear in the dashboard
3. Copy the Application ID
4. Run: `gh secret set APPROVER_APP_ID --body "your-app-id-here"`

---

## ✅ Verification Checklist

After deployment, verify everything works:

- [ ] Access https://approver.aiinigeria.com (frontend loads)
- [ ] Health check works: https://approver.aiinigeria.com/api/health
- [ ] Can login: https://approver.aiinigeria.com/api/auth/login
- [ ] SSL certificate is valid (no browser warnings)
- [ ] API calls work (check browser console)
- [ ] Database connection works (check logs)

---

## 🎯 Key Differences from Other Apps

| Aspect | Other Apps | Approver |
|---------|------------|-----------|
| **Domain** | *.seemplifyai.com | approver.aiinigeria.com |
| **DNS** | Cloudflare | Cloudflare (you added A record) |
| **Traefik Host** | Same pattern | Different host |
| **Frontend Build** | Separate containers | Backend serves static files |
| **Isolation** | Shared Dokploy | Independent deployment |
| **Deployment** | GitHub Actions (curl) | GitHub Actions (official) |
| **Cost** | $0 | $0 |

---

## 📞 Important Notes

### 1. Environment Files Are Local Only

The `.env.production` files are **NOT tracked by Git** (they're in `.gitignore`). This is intentional so you don't commit secrets.

### 2. MongoDB Connection

You'll need to set `MONGO_URI` in Dokploy's environment variables (Step 3 above). Use the same connection string your other apps use.

### 3. Backend Port in Docker

- **Development**: Port 5000 (for local testing)
- **Dokploy/Production**: Port 80 (Traefik handles external 443 → internal 80)

The backend automatically uses port 80 in production via `PORT` environment variable.

### 4. Frontend API Calls

In development: Uses `http://localhost:5000/api`  
In production: Uses `/api` (relative path → https://approver.aiinigeria.com/api)

This is the same pattern your other apps follow.

### 5. Dockerfile Multi-Stage Build

The Dockerfile uses a multi-stage build:
- **Stage 1 (builder)**: Installs dependencies and builds frontend
- **Stage 2 (production)**: Copies only production files
- **Result**: Smaller final image size

---

## 🚦 Troubleshooting

### Issue: "Site Not Found" or 404

**Check:**
1. Dockerfile includes static file serving code
2. Health check endpoint exists
3. Application is running in Dokploy

**Solution:**
- Verify `server.js` has the SPA fallback route
- Check Traefik logs in Dokploy

### Issue: CORS Errors

**Symptoms:**
- Frontend can't call backend API
- Network errors in browser console

**Check:**
1. Backend CORS configured as `origin: true` in production
2. `FRONTEND_URL` matches `approver.aiinigeria.com`

**Solution:**
- Redeploy application in Dokploy after updating environment variables

### Issue: SSL Certificate Pending

**Symptoms:**
- "Connection not secure" warning in browser
- Certificate not yet generated

**Solution:**
- Wait 2-5 minutes (Let's Encrypt takes time)
- Check Traefik logs in Dokploy
- Verify domain is added correctly

---

## 📞 Documentation Reference

For detailed deployment instructions, see:
- `DOKPLOY-DEPLOYMENT-GUIDE.md` - Step-by-step Dokploy deployment
- `APPROVER-DEPLOYMENT-SUMMARY.md` - Complete technical overview

For workflow analysis vs recruiter approach:
- `access/APPROVER-WORKFLOW-ANALYSIS.md` - Why GitHub Action was chosen

---

## ✅ Summary

### What's Ready

- ✅ **Backend configured** for production deployment
- ✅ **Frontend configured** for production domain
- ✅ **Dockerfile created** with multi-stage build
- ✅ **GitHub Actions workflow** created (auto-deploys on push)
- ✅ **Deployment guides** documented
- ✅ **DNS record** ready (you added to Cloudflare)

### What's Next

You need to:
1. **Deploy** to Dokploy following the guide above
2. **Add** environment variables in Dokploy (MONGO_URI, etc.)
3. **Add** GitHub secrets (APPROVER_APP_ID, etc.)
4. **Test** and verify everything works
5. **Monitor** logs in GitHub Actions and Dokploy

---

**All other apps remain unchanged** and continue to use `*.seemplifyai.com` domains.  
The `approver/` app will be completely independent at `approver.aiinigeria.com`.

---

**Configuration complete! Ready for deployment. 🚀**
