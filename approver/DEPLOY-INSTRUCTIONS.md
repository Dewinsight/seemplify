# Approver Deployment Instructions

## Quick Deploy via Dokploy UI

Since the Dokploy API returns 401 Unauthorized, deploy via UI:

### 0. One-time: Fix "cannot create .env" error (if you see it)

If a deploy fails with:
```text
cannot create .../approver/frontend/approver/frontend/.env: Directory nonexistent
```
(or same for `approver/backend`), run on the **server** (e.g. via `ssh seemplify@4.180.153.209`):

```bash
cd /path/to/seemplify   # or clone repo first
python3 approver/fix-createenvfile.py
```

Then redeploy **approver-backend** and **approver-frontend** in the Dokploy UI.

### 1. Deploy Backend

1. Go to: **http://4.180.153.209:3000**
2. Login: `admin@seemplifyai.com` / `Seemplify2026!`
3. Navigate to: **approver** project → **approver-backend** application
4. Click **"Deploy"** button (or go to **Deployments** tab → **Deploy**)
5. Wait for build to complete (check logs)
6. Verify container is running: `docker ps | grep approver-backend`

### 2. Seed Admin User

After backend is deployed and healthy:

```bash
curl -X POST https://api.approver.aiinigeria.com/api/auth/seed-admin
```

Expected: `{"message":"Default admin created: admin / password123"}`

### 3. Deploy Frontend

1. In Dokploy UI, navigate to: **approver** project → **approver-frontend** application
2. Click **"Deploy"** button
3. Wait for build to complete
4. Verify container is running: `docker ps | grep approver-frontend`

---

## Verify Deployment

```bash
# Check containers
ssh seemplify@4.180.153.209 "docker ps | grep approver"

# Test backend
curl https://api.approver.aiinigeria.com/api/health

# Test frontend
curl -I https://approver.aiinigeria.com
```

---

## Alternative: Push to GitHub (Auto-Deploy)

If workflows are pushed to GitHub:

```bash
# Make a small change to trigger deployment
git add .
git commit -m "Trigger approver deployment"
git push origin main
```

This will trigger:
- `deploy-approver-backend.yml` on `approver/backend/**` changes
- `deploy-approver-frontend.yml` on `approver/frontend/**` changes
