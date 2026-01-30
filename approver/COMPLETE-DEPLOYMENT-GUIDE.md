# Complete Approver Deployment Guide

## Status: NOT DEPLOYED YET

**Current Issue:** Dokploy API returns 401 Unauthorized, so deployment must be done via UI.

---

## ✅ Pre-Deployment Setup (Run on Server)

### 1. SSH to Server
```bash
ssh seemplify@4.180.153.209
```

### 2. Clone/Update Repository
```bash
cd ~
git clone https://github.com/michaelegbo/seemplify.git || cd seemplify && git pull
cd seemplify
```

### 3. Run Setup Script
```bash
# Fix createEnvFile and verify domains
bash approver/deploy-approver-on-server.sh
```

This will:
- ✅ Fix `createEnvFile` issue for both apps
- ✅ Verify/create domain entries
- ✅ Show current container status
- ✅ Provide deployment instructions

---

## 🚀 Deploy via Dokploy UI

### Deploy Backend

1. **Open Dokploy Dashboard:**
   - URL: http://4.180.153.209:3000
   - Login: `admin@seemplifyai.com` / `Seemplify2026!`

2. **Navigate to Backend:**
   - Click **"approver"** project
   - Click **"approver-backend"** application

3. **Deploy:**
   - Click **"Deploy"** button (or go to **Deployments** tab → **Deploy**)
   - Wait for build to complete (watch logs)
   - Verify container: `docker ps | grep approver-backend`

### Deploy Frontend

1. **Navigate to Frontend:**
   - In Dokploy UI: **approver** project → **approver-frontend**

2. **Deploy:**
   - Click **"Deploy"** button
   - Wait for build to complete
   - Verify container: `docker ps | grep approver-frontend`

---

## ✅ Post-Deployment Testing

### On Server (SSH)

```bash
# Run automated test script
bash approver/test-approver.sh

# Or test manually:
curl https://api.approver.aiinigeria.com/api/health
curl -I https://approver.aiinigeria.com
```

### Seed Admin User

```bash
curl -X POST https://api.approver.aiinigeria.com/api/auth/seed-admin
```

Expected: `{"message":"Default admin created: admin / password123"}`

### Test Login

```bash
curl -X POST https://api.approver.aiinigeria.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@approver.com","password":"password123"}'
```

---

## 🔍 Troubleshooting

**If deployment fails with ".env" error:**
- The setup script already fixed this, but if you see it:
  ```bash
  python3 approver/fix-createenvfile.py
  ```

**If DNS not resolving:**
- Wait 2-5 minutes after deployment
- Check Cloudflare DNS records are correct
- Test: `nslookup api.approver.aiinigeria.com`

**If containers not starting:**
- Check Dokploy logs in UI
- Verify environment variables are set
- Check: `docker logs <container-name>`

---

## 📋 Checklist

- [ ] Run `deploy-approver-on-server.sh` on server
- [ ] Deploy approver-backend via Dokploy UI
- [ ] Wait for backend build to complete
- [ ] Deploy approver-frontend via Dokploy UI
- [ ] Wait for frontend build to complete
- [ ] Test backend: `curl https://api.approver.aiinigeria.com/api/health`
- [ ] Test frontend: `curl -I https://approver.aiinigeria.com`
- [ ] Seed admin: `curl -X POST https://api.approver.aiinigeria.com/api/auth/seed-admin`
- [ ] Test login endpoint
- [ ] Verify in browser: https://approver.aiinigeria.com

---

**Ready to deploy! Follow the steps above.** 🚀
