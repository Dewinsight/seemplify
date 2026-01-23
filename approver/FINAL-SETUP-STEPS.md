# Approver Deployment - Final Setup Steps

**Date:** January 22, 2026  
**Status:** ✅ GitHub Secret Updated | 🟡 Environment Variables & Deployment Pending

---

## ✅ Completed

1. **GitHub Secret Updated**
   - `APPROVER_APP_ID` = `9e7b7b2a-e8ba-4eac-8e2e-28216ee621cf` ✅

---

## 🟡 Manual Steps Required

### Step 1: Set Environment Variables in Dokploy UI

1. Go to: **http://4.180.153.209:3000**
2. Login: `admin@seemplifyai.com` / `Seemplify2026!`
3. Navigate to: **approver project** → **approver application** → **Settings** → **Environment**
4. Add these variables:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `80` |
| `MONGO_URI` | `mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/approver?retryWrites=true&w=majority&appName=Cluster0` |
| `FRONTEND_URL` | `https://approver.aiinigeria.com` |

### Step 2: Trigger First Deployment

**Option A: Via Dokploy UI (Recommended)**
1. Go to the **approver** application page
2. Click **"Deploy"** button
3. Monitor deployment logs

**Option B: Via API**
```bash
curl -X POST "http://4.180.153.209:3000/api/application.deploy" \
  -H "x-api-key: sk_dokploy_b6178e414ec737424c7d0ecf20cddd51" \
  -H "Content-Type: application/json" \
  -d '{"applicationId": "9e7b7b2a-e8ba-4eac-8e2e-28216ee621cf"}'
```

**Option C: Via GitHub Actions**
- Push any change to `approver/` directory on `main` branch
- Or manually trigger: GitHub → Actions → "Deploy Approver to Dokploy" → Run workflow

---

## ✅ Verification

After deployment completes, verify:

1. **Container is running:**
   ```bash
   ssh seemplify@4.180.153.209 "docker ps | grep approver"
   ```

2. **Health endpoint:**
   ```bash
   curl https://approver.aiinigeria.com/api/health
   ```
   Expected: `{"status":"ok","timestamp":"...","environment":"production"}`

3. **Frontend loads:**
   ```bash
   curl -I https://approver.aiinigeria.com
   ```
   Expected: HTTP 200

4. **SSL certificate:**
   - Visit https://approver.aiinigeria.com in browser
   - Should show valid Let's Encrypt certificate

---

## 📋 Configuration Summary

| Item | Value |
|------|-------|
| **Project ID** | `BB7A1E2C296269808C42` |
| **Application ID** | `9e7b7b2a-e8ba-4eac-8e2e-28216ee621cf` |
| **Domain** | `approver.aiinigeria.com` |
| **GitHub Secret** | ✅ Updated |
| **Environment Variables** | ⏳ Set in Dokploy UI |
| **First Deployment** | ⏳ Trigger manually |

---

## 🚀 Traefik Configuration

The domain `approver.aiinigeria.com` is already configured in Dokploy's database:
- Domain ID: (auto-generated)
- Host: `approver.aiinigeria.com`
- HTTPS: Enabled
- Certificate: Let's Encrypt
- Application ID: `9e7b7b2a-e8ba-4eac-8e2e-28216ee621cf`

Traefik will automatically pick up this domain configuration when the application is deployed. No manual Traefik configuration needed.

---

**Next:** Set environment variables and trigger deployment! 🚀
