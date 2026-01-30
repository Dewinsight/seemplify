# URGENT FIX - Run This on Server

## The Problem
Deployment fails with: `cannot create .../approver/backend/approver/backend/.env: Directory nonexistent`

This is because `createEnvFile` is set to `true` in Dokploy database.

## The Fix (Choose One Method)

### Method 1: One-Line Command (Easiest)

SSH to server and run:
```bash
ssh seemplify@4.180.153.209
```

Then paste this ONE command:
```bash
docker exec $(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1) psql -U dokploy -d dokploy -c "UPDATE application SET \"createEnvFile\" = false WHERE \"applicationId\" IN ('72cc56e8-1123-4e22-beeb-04c8184405e4', '063229c9-ed49-49be-a331-92c8c47422bc');"
```

### Method 2: Clone Repo and Run Script

```bash
ssh seemplify@4.180.153.209
cd ~
git clone https://github.com/michaelegbo/seemplify.git || cd seemplify && git pull
cd seemplify
bash approver/fix-approver-env.sh
```

### Method 3: Python Script

```bash
ssh seemplify@4.180.153.209
cd ~
git clone https://github.com/michaelegbo/seemplify.git || cd seemplify && git pull
cd seemplify
python3 approver/fix-createenvfile.py
```

---

## After Running the Fix

1. **Go back to Dokploy UI:** http://4.180.153.209:3000
2. **Redeploy approver-backend:** Click "Deploy" button again
3. **Redeploy approver-frontend:** Click "Deploy" button again

The `.env` error should be gone and deployment should succeed!

---

**The fix takes 2 seconds. Then redeploy and it should work!** ✅
