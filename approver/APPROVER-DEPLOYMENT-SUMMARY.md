# Approver App - Deployment to approver.aiinigeria.com

**Date:** January 22, 2026  
**Status:** ✅ Code Changes Complete - Ready for Dokploy Deployment

---

## 📋 Overview

Your `approver/` application has been configured to deploy as **approver.aiinigeria.com** on Dokploy, while all your other apps remain on `*.seemplifyai.com`.

---

## ✅ Changes Made

### 1. Backend Updates

#### Created Files

**`backend/.env.production`**
```env
NODE_ENV=production
PORT=80
FRONTEND_URL=https://approver.aiinigeria.com
```

**`backend/Dockerfile`**
- Multi-stage build for optimization
- Builds frontend during Docker build
- Serves static files from `frontend/dist/`
- SPA fallback route for non-API requests
- Health check endpoint at `/api/health`
- Production-ready configuration

#### Modified Files

**`backend/server.js`**
- Updated CORS to allow all origins in production (`origin: true`)
- Added static file serving for production mode
- Added SPA fallback route (serves index.html for non-API routes)
- Added `/api/health` endpoint for monitoring
- Uses `.env.production` file

---

### 2. Frontend Updates

#### Created Files

**`frontend/.env.production`**
```env
VITE_PROD=true
VITE_API_BASE_URL=/api
```

#### Modified Files

**`frontend/src/api/index.ts`**
```typescript
import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.PROD ? '' : 'http://localhost:5000/api'
});

export default api;
```
- Uses relative path `/api` in production (built with `VITE_PROD=true`)
- Uses `http://localhost:5000/api` in development

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
- Makes `import.meta.env.PROD` available at build time
- Loads environment based on `NODE_ENV`

---

### 3. Documentation

**`DOKPLOY-DEPLOYMENT-GUIDE.md`**
Complete step-by-step deployment instructions for Dokploy

---

## 🚀 How to Deploy to Dokploy

### Prerequisites

- [x] DNS record added in Cloudflare (A: `approver` → `4.180.153.209`)
- [x] All code changes committed to Git
- [x] Access to Dokploy dashboard

### Deployment Steps

#### Step 1: Create Application in Dokploy

1. Open **http://4.180.153.209:3000**
2. Login to Dokploy
3. Click **"Create Application"**
4. Fill in configuration:

| Field | Value |
|-------|-------|
| **Name** | `approver` |
| **Repository** | `https://github.com/YOUR_USERNAME/seemplify` |
| **Branch** | `main` (or your current branch) |
| **Root Path** | `approver/` |
| **Build Path** | `backend/` |
| **Dockerfile Path** | `backend/Dockerfile` |

5. Click **"Create Application"**

#### Step 2: Configure Domain

1. After deployment, go to **Application → Settings → Domains**
2. Click **"Add Domain"**
3. Enter: `approver.aiinigeria.com`
4. Click **"Save"**

Traefik will automatically:
- Configure routing: `Host(approver.aiinigeria.com)`
- Generate SSL certificate (Let's Encrypt)
- Enable HTTPS

#### Step 3: Set Environment Variables

1. Go to **Application → Settings → Environment**
2. Add these variables:

| Variable | Value | Purpose |
|----------|-------|---------|
| `NODE_ENV` | `production` | Production mode |
| `MONGO_URI` | `mongodb+srv://...` | Your MongoDB connection string |
| `PORT` | `80` | Server port |

3. Click **"Save"**
4. Go to **Application → Redeploy**

---

## ✅ After Deployment

### Access Points

| Service | URL |
|----------|-----|
| **Frontend** | https://approver.aiinigeria.com/ |
| **API Health** | https://approver.aiinigeria.com/api/health |
| **Login API** | https://approver.aiinigeria.com/api/auth/login |
| **Projects API** | https://approver.aiinigeria.com/api/projects |
| **Analyze API** | https://approver.aiinigeria.com/api/analyze |

### Architecture

```
Dokploy (on 4.180.153.209)
├── Traefik (Reverse Proxy)
│   ├── SSL: Let's Encrypt (auto-generated)
│   └── Routing: approver.aiinigeria.com → approver container
│
└── Approver Container
    ├── Port 80 (exposed by Traefik)
    ├── Backend: Express.js (serves API + frontend)
    └── MongoDB Atlas: Connected via MONGO_URI
```

---

## 🔍 Verification Commands

### Check DNS Resolution
```bash
nslookup approver.aiinigeria.com 8.8.8.8
```

Expected output: Points to `4.180.153.209`

### Test HTTPS Access
```bash
curl -I https://approver.aiinigeria.com
```

Should show `HTTP/2 200` and SSL certificate info

### Test Health Endpoint
```bash
curl https://approver.aiinigeria.com/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-01-22T..."
}
```

---

## 📊 How This Differs from Other Apps

| Aspect | Other Apps | Approver |
|---------|------------|-----------|
| **Domain** | `*.seemplifyai.com` | `approver.aiinigeria.com` |
| **DNS Provider** | Cloudflare | Cloudflare |
| **Traefik Host** | `Host(app.seemplifyai.com)` | `Host(approver.aiinigeria.com)` |
| **Frontend Build** | Relative to `/api` | Relative to `/api` (same pattern) |
| **Backend Serving** | Separate containers | Backend serves static files |
| **Isolation** | Shared Dokploy | Independent deployment |
| **SSL** | Let's Encrypt (auto) | Let's Encrypt (auto) |

---

## 🎯 Key Benefits

### For Approver App

✅ **Separate Domain**: `approver.aiinigeria.com` - dedicated branding  
✅ **Production-Ready**: Dockerfile with health checks and optimization  
✅ **Auto SSL**: Let's Encrypt via Traefik  
✅ **Unified Deployment**: Backend and frontend in one container  
✅ **Professional API Calls**: Production uses relative paths  

### For Your Infrastructure

✅ **Isolation**: Approver is completely independent from other apps  
✅ **Zero Impact**: Other apps remain unchanged  
✅ **Scalable**: Can be managed separately in Dokploy  
✅ **Cost**: $0 (you own aiinigeria.com)  

---

## ⚠️ Important Notes

### 1. Environment Variables

The `.env.production` files are **NOT tracked by Git** (they're in `.gitignore`).  
You'll need to add `MONGO_URI` in Dokploy's environment variables settings.

### 2. Frontend Build

When building locally for testing:
```bash
cd frontend
npm run build
```
This creates `frontend/dist/` folder with production assets.

### 3. API Calls in Production

In production, the frontend makes requests to:
- `https://approver.aiinigeria.com/api/auth/login`
- `https://approver.aiinigeria.com/api/projects`
- etc.

This is the same pattern your other apps use.

### 4. Backend Port

- **Development**: Port 5000
- **Dokploy/Production**: Port 80 (Traefik handles external 443 → internal 80)

### 5. Health Check

The `/api/health` endpoint is critical for:
- Docker health checks
- Load balancer monitoring
- Troubleshooting deployment issues

---

## 🚦 Next Steps

### Immediate

1. **Deploy to Dokploy** following `DOKPLOY-DEPLOYMENT-GUIDE.md`
2. **Verify DNS** propagation (2-5 minutes)
3. **Test health endpoint**
4. **Test frontend and backend**
5. **Check browser console** for errors

### Optional Enhancements

- [ ] Add rate limiting to `/api` routes
- [ ] Implement request logging
- [ ] Add API versioning
- [ ] Configure error tracking (Sentry)

---

## 📞 Troubleshooting

### Issue: Frontend Can't Reach Backend

**Symptom**: API calls fail with network errors

**Check**:
1. `/api/health` endpoint works
2. CORS configured as `origin: true` in production
3. `VITE_PROD=true` is set in environment

**Solution**: Redeploy with correct environment variables

### Issue: SSL Certificate Pending

**Symptom**: "Connection not secure" warning in browser

**Check**:
1. Wait 2-5 minutes (Let's Encrypt takes time)
2. Check Traefik logs in Dokploy
3. Verify domain is added correctly

**Solution**: Wait for certificate generation, then reload page

### Issue: SPA Routes 404

**Symptom**: Refreshing page shows 404 error

**Check**:
1. `server.js` has SPA fallback route
2. Fallback only applies to non-API routes
3. Frontend files are in `frontend/dist/`

**Solution**: Verify backend/server.js has the fallback logic

---

## ✅ Summary

### What's Ready

- ✅ Backend configured for production deployment
- ✅ Frontend configured for production domain
- ✅ Dockerfile created with multi-stage build
- ✅ Environment files created
- ✅ Deployment guide documented
- ✅ DNS record documented (you added to Cloudflare)

### What's Next

You need to:
1. **Deploy** to Dokploy using `DOKPLOY-DEPLOYMENT-GUIDE.md`
2. **Configure** domain `approver.aiinigeria.com` in Dokploy
3. **Add** environment variables (MONGO_URI, etc.)
4. **Test** and verify everything works

---

**All other apps remain unchanged** and continue to use `*.seemplifyai.com` domains.  
The `approver/` app will be completely independent at `approver.aiinigeria.com`.

---

**Ready for deployment! 🚀**
