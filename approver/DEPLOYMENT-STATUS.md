# Approver Deployment Status & Next Steps

**Date:** January 22, 2026  
**Status:** ✅ Configuration Complete | 🟡 Deployment Pending

---

## ✅ Completed

1. **Environment Variables Set**
   - ✅ approver-backend env vars configured in Dokploy DB
   - Variables: NODE_ENV, PORT, MONGO_URI, FRONTEND_URL, JWT_SECRET, Azure OpenAI config

2. **GitHub Secrets Verified**
   - ✅ DOKPLOY_URL
   - ✅ DOKPLOY_TOKEN  
   - ✅ APPROVER_BACKEND_APP_ID (`72cc56e8-1123-4e22-beeb-04c8184405e4`)
   - ✅ APPROVER_FRONTEND_APP_ID (`063229c9-ed49-49be-a331-92c8c47422bc`)

3. **GitHub Workflows**
   - ✅ `deploy-approver-backend.yml` - Auto-deploys on `approver/backend/**` changes
   - ✅ `deploy-approver-frontend.yml` - Auto-deploys on `approver/frontend/**` changes
   - ✅ `deploy-approver-both.yml` - Optional: Deploys both on `approver/**` changes
   - ✅ `deploy-approver.yml` - Disabled (old combined app)

4. **DNS Records**
   - ✅ `api.approver.aiinigeria.com` - Added (propagation may take 1-5 minutes)

---

## 🟡 Next Steps (Manual)

### 1. Deploy Backend via Dokploy UI

**Reason:** Dokploy API returns 401 Unauthorized, so manual deployment is required.

1. Go to: **http://4.180.153.209:3000**
2. Login: `admin@seemplifyai.com` / `Seemplify2026!`
3. Navigate to: **approver** project → **approver-backend**
4. Click **"Deploy"** button
5. Wait for build to complete (check logs)
6. Verify container: `docker ps | grep approver-backend`

### 2. Seed Admin User

After backend is deployed and healthy:

```bash
curl -X POST https://api.approver.aiinigeria.com/api/auth/seed-admin
```

Expected: `{"message":"Default admin created: admin / password123"}`

### 3. Deploy Frontend via Dokploy UI

1. In Dokploy UI: **approver** project → **approver-frontend**
2. Click **"Deploy"** button
3. Wait for build to complete
4. Verify container: `docker ps | grep approver-frontend`

### 4. Test Backend

```bash
# Health check
curl https://api.approver.aiinigeria.com/api/health

# Root endpoint
curl https://api.approver.aiinigeria.com/

# Login
curl -X POST https://api.approver.aiinigeria.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@approver.com","password":"password123"}'
```

### 5. Test Frontend in Browser

1. Open: **https://approver.aiinigeria.com**
2. Login with:
   - **Email:** `admin@approver.com`
   - **Password:** `password123`
3. Verify:
   - Login succeeds
   - Dashboard loads
   - Navigation works (Projects, Rules, Profile)
   - API calls in DevTools go to `https://api.approver.aiinigeria.com/api/...`

---

## 📋 Test Script

Run `approver/test-approver.sh` on the server after deployment:

```bash
chmod +x approver/test-approver.sh
./approver/test-approver.sh
```

---

## 🔍 Troubleshooting

**"cannot create .../approver/frontend/approver/frontend/.env: Directory nonexistent"** (or backend):
- Run on the server: `python3 approver/fix-createenvfile.py` (disables `createEnvFile` in Dokploy DB)
- Redeploy approver-backend and approver-frontend in Dokploy UI

**DNS not resolving:**
- Wait 1-5 minutes for DNS propagation
- Check Cloudflare DNS record: `api.approver` → `4.180.153.209`
- Test: `nslookup api.approver.aiinigeria.com`

**Backend 502/503:**
- Check Dokploy app logs
- Verify container is running: `docker ps | grep approver-backend`
- Verify env vars are set in Dokploy UI

**CORS errors:**
- Verify `FRONTEND_URL=https://approver.aiinigeria.com` in backend env
- Check backend logs for CORS issues

**Login fails:**
- Ensure seed-admin was called: `curl -X POST https://api.approver.aiinigeria.com/api/auth/seed-admin`
- Check MongoDB connection in backend logs
- Verify `MONGO_URI` points to correct database

---

## 📝 Files Created

- `approver/set-approver-env.py` - Sets backend env vars via Dokploy DB
- `approver/fix-createenvfile.py` - Disables createEnvFile for approver apps (fixes .env path error)
- `approver/deploy-approver-apps.py` - Deployment status checker
- `approver/test-approver.sh` - Automated test script
- `approver/DEPLOY-INSTRUCTIONS.md` - Deployment guide
- `.github/workflows/deploy-approver-both.yml` - Deploy both apps workflow

---

**Ready for deployment! Follow steps 1-5 above to complete setup.** 🚀
