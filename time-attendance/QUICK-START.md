# Time Attendance Deployment - Quick Start Guide

**Status:** Ready to Deploy! 🚀

---

## 🎯 Quick Deployment Steps

### 1. Set Up Cloudflare DNS (2 minutes)

**Option A: PowerShell Script**
```powershell
cd time-attendance
$env:CLOUDFLARE_API_TOKEN = "your-token-here"  # Get from Cloudflare Dashboard
.\setup-cloudflare-dns.ps1
```

**Option B: Manual**
- Go to Cloudflare Dashboard → DNS → Records
- Add: `api-time` → `4.180.153.209` (A, Proxied)
- Add: `time` → `4.180.153.209` (A, Proxied)

---

### 2. Create Dokploy Applications (5 minutes)

**Option A: PowerShell Script (Recommended)**
```powershell
cd time-attendance
$env:DOKPLOY_TOKEN = "your-api-token-here"  # Get from Dokploy Settings → API Keys
.\create-dokploy-apps.ps1
```

**Option B: Manual via Dokploy UI**
- Follow: `DOKPLOY-SETUP-GUIDE.md`

---

### 3. Configure Environment Variables (5 minutes)

In Dokploy UI, for **time-attendance-backend**:

```env
NODE_ENV=production
PORT=5010
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/time_attendance?retryWrites=true&w=majority
SESSION_SECRET=<generate-strong-secret>
IDP_ISSUER_URL=https://auth.seemplifyai.com
OIDC_CLIENT_ID=time-attendance
OIDC_CLIENT_SECRET=<get-from-idp>
OIDC_REDIRECT_URI=https://api-time.seemplifyai.com/api/auth/oidc/callback
FRONTEND_URL=https://time.seemplifyai.com
CORS_ORIGIN=https://time.seemplifyai.com
```

For **time-attendance-frontend** (Build Arguments):

```env
NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
```

---

### 4. Set GitHub Secrets (2 minutes)

After running the script, you'll get the app IDs. Set them:

```bash
gh secret set TIME_ATTENDANCE_BACKEND_APP_ID --body "<backend-app-id>"
gh secret set TIME_ATTENDANCE_FRONTEND_APP_ID --body "<frontend-app-id>"
```

---

### 5. Configure Identity Provider (3 minutes)

1. Go to: https://auth.seemplifyai.com
2. Add OIDC client:
   - Client ID: `time-attendance`
   - Redirect URIs:
     - `https://time.seemplifyai.com/api/auth/callback`
     - `https://api-time.seemplifyai.com/api/auth/oidc/callback`
3. Copy client secret → Add to backend env vars in Dokploy

---

### 6. Deploy! (10 minutes)

In Dokploy UI:
1. Go to **time-attendance-backend** → Click **Deploy**
2. Go to **time-attendance-frontend** → Click **Deploy**
3. Wait for builds (~5-10 minutes)

---

### 7. Verify (2 minutes)

```bash
# Check backend
curl https://api-time.seemplifyai.com/api/health

# Check frontend
# Open: https://time.seemplifyai.com
```

---

## 📋 Files Created

✅ **Dockerfiles:**
- `time-attendance/backend/Dockerfile`
- `time-attendance/frontend/Dockerfile`

✅ **GitHub Actions:**
- `.github/workflows/deploy-time-attendance-backend.yml`
- `.github/workflows/deploy-time-attendance-frontend.yml`

✅ **Scripts:**
- `time-attendance/setup-cloudflare-dns.ps1`
- `time-attendance/create-dokploy-apps.ps1`

✅ **Documentation:**
- `time-attendance/TIME-ATTENDANCE-DEPLOYMENT-PLAN.md` (detailed plan)
- `time-attendance/DOKPLOY-SETUP-GUIDE.md` (step-by-step)
- `time-attendance/DEPLOYMENT-READY.md` (summary)
- `time-attendance/QUICK-START.md` (this file)

---

## 🎯 Domain Structure

| App | Domain | Port |
|-----|--------|------|
| Backend | `api-time.seemplifyai.com` | 5010 |
| Frontend | `time.seemplifyai.com` | 5011 |

---

## ⚡ Total Time: ~30 minutes

1. DNS Setup: 2 min
2. Dokploy Apps: 5 min
3. Env Vars: 5 min
4. GitHub Secrets: 2 min
5. IDP Config: 3 min
6. Deploy: 10 min
7. Verify: 2 min

---

## 🚨 Troubleshooting

**DNS not working?**
- Wait 5-10 minutes for propagation
- Check Cloudflare dashboard

**Build fails?**
- Check Dockerfile syntax
- Verify package.json exists
- Check Dokploy logs

**SSL not issued?**
- Wait 5-10 minutes
- Verify DNS is correct

---

**Ready to go!** Follow the steps above and you'll be live in ~30 minutes! 🎉
