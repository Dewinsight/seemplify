# Deploy Approver to Dokploy - approver.aiinigeria.com

**Date:** January 22, 2026  
**Status:** Ready for Deployment

---

## ✅ Prerequisites Completed

- [x] Dockerfile created (backend + frontend bundled)
- [x] Backend server.js updated for production
- [x] Frontend API calls updated for relative paths
- [x] Environment files created
- [x] DNS record added in Cloudflare (A record)

---

## 🎯 What's Been Configured

### Backend Changes

**New File:** `backend/.env.production`
```env
NODE_ENV=production
PORT=80
FRONTEND_URL=https://approver.aiinigeria.com
```

**Updated:** `backend/server.js`
- Modified CORS to allow all origins in production
- Added static file serving for `frontend/dist`
- Added SPA fallback route for non-API requests
- Added `/api/health` endpoint for monitoring

### Frontend Changes

**New File:** `frontend/.env.production`
```env
VITE_PROD=true
VITE_API_BASE_URL=/api
```

**Updated:** `frontend/src/api/index.ts`
- Changed from `http://localhost:5000/api` to conditional
- Uses relative path (`/api`) in production
- Uses `http://localhost:5000/api` in development

**Updated:** `frontend/vite.config.ts`
- Added `VITE_PROD` build-time variable
- Loads environment from `NODE_ENV`

### Docker Configuration

**New File:** `backend/Dockerfile`
- Multi-stage build (reduces image size)
- Builds frontend during Docker build
- Copies production dependencies only
- Serves on port 80 (standard HTTP)
- Includes health check endpoint
- Production-ready with NODE_ENV=production

---

## 🚀 Step-by-Step Deployment to Dokploy

### Step 1: Access Dokploy Dashboard

1. Open your browser and go to:
   ```
   http://4.180.153.209:3000
   ```

2. Login with your Dokploy credentials

---

### Step 2: Create Application

1. Click **"Create Application"**
2. Fill in the details:

| Field | Value |
|-------|-------|
| **Name** | `approver` |
| **Repository** | `https://github.com/YOUR_USERNAME/seemplify` |
| **Branch** | `main` (or `dev` if using dev branch) |
| **Root Path** | `approver/` |
| **Build Path** | `backend/` (where Dockerfile is) |
| **Dockerfile Path** | `backend/Dockerfile` |

3. Click **"Create Application"**

4. Dokploy will:
   - Clone your repository
   - Build Docker image
   - Deploy container

---

### Step 3: Configure Domain

1. Once the app is deployed, go to **Application → Settings**
2. Navigate to **Domains** section
3. Click **"Add Domain"**
4. Enter: `approver.aiinigeria.com`
5. Click **"Save"**

**Traefik will automatically:**
- Configure routing rule: `Host(approver.aiinigeria.com)`
- Generate SSL certificate (Let's Encrypt)
- Enable HTTPS
- Route all traffic to your app

---

### Step 4: Set Environment Variables

1. In Dokploy, go to **Application → Settings → Environment**
2. Add the following variables:

| Variable | Value | Purpose |
|----------|-------|---------|
| `NODE_ENV` | `production` | Production mode |
| `MONGO_URI` | `mongodb+srv://...` | MongoDB connection |
| `PORT` | `80` | Server port (matches Dockerfile) |

3. Click **"Save”**
4. Redeploy the application (Settings → Redeploy)

---

### Step 5: Verify Deployment

#### Check DNS Resolution
```bash
# From your local machine
nslookup approver.aiinigeria.com 8.8.8.8
```

Expected output:
```
Server:  8.8.8.8
Address: 4.180.153.209
```

#### Test HTTP/HTTPS Access
```bash
# Test if app responds
curl https://approver.aiinigeria.com
```

#### Test Health Endpoint
```bash
# Test API health check
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

## 🔍 Troubleshooting

### Issue: "Site Not Found" or 404

**Check:**
1. Dockerfile includes static file serving
2. Health check passing in Dockerfile
3. Domain properly added in Dokploy
4. Container running (check logs)

**Solution:**
- Verify `backend/server.js` has the SPA fallback route
- Check Dokploy logs for errors

### Issue: CORS Errors

**Symptoms:**
- Frontend can't call backend API
- Network errors in browser console

**Check:**
1. Backend CORS configured as `origin: true` in production
2. `FRONTEND_URL` matches `approver.aiinigeria.com`

**Solution:**
- Restart container after updating `.env.production`

### Issue: SSL Certificate Pending

**Symptoms:**
- "Connection not secure" warning in browser
- Certificate not yet generated

**Solution:**
- Wait 2-5 minutes (Let's Encrypt takes time)
- Check Traefik logs in Dokploy

---

## 📊 Deployment Summary

| Component | Status | URL |
|----------|--------|-----|
| **Frontend** | ✅ Configured | https://approver.aiinigeria.com/ |
| **Backend API** | ✅ Configured | https://approver.aiinigeria.com/api/ |
| **Health Check** | ✅ Configured | https://approver.aiinigeria.com/api/health |
| **Domain** | ✅ Configured | approver.aiinigeria.com |
| **SSL** | ✅ Auto-generated | Let's Encrypt (via Traefik) |
| **DNS** | ✅ Configured | Cloudflare A record → 4.180.153.209 |

---

## ✅ What Works After Deployment

### Frontend Access
```
https://approver.aiinigeria.com/
→ Serves React application
```

### API Endpoints
```
https://approver.aiinigeria.com/api/auth/login
https://approver.aiinigeria.com/api/projects
https://approver.aiinigeria.com/api/analyze
https://approver.aiinigeria.com/api/health
```

### MongoDB Connection
- Backend connects to MongoDB Atlas (via MONGO_URI env var)
- Same database as current setup
- No database migration needed

---

## 🎯 Key Differences from Other Apps

| Aspect | Other Apps | Approver |
|---------|------------|-----------|
| **Domain** | *.seemplifyai.com | approver.aiinigeria.com |
| **DNS** | Cloudflare A records | Cloudflare A record |
| **Traefik Route** | Same host | Different host |
| **Isolation** | Shared Dokploy | Independent deployment |

**All other apps remain unchanged** and continue to use `*.seemplifyai.com` domains.

---

## 🚀 Next Steps After Deployment

1. **Test the app** thoroughly
2. **Check browser console** for any errors
3. **Verify API calls** work correctly
4. **Test authentication flow**
5. **Monitor logs** in Dokploy

---

**Deployment Guide Complete! Ready to deploy to Dokploy.**
