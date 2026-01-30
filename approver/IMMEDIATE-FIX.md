# IMMEDIATE FIX - Run this on the server

## Option 1: Quick One-Liner (Copy/Paste)

SSH to server and run:
```bash
ssh seemplify@4.180.153.209
```

Then paste this:
```bash
POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1) && docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "UPDATE application SET \"createEnvFile\" = false WHERE \"applicationId\" IN ('72cc56e8-1123-4e22-beeb-04c8184405e4', '063229c9-ed49-49be-a331-92c8c47422bc');" && echo "✅ Fixed! Now redeploy in Dokploy UI"
```

## Option 2: Use the Python Script

```bash
ssh seemplify@4.180.153.209
cd ~/seemplify || (git clone https://github.com/michaelegbo/seemplify.git && cd seemplify)
python3 approver/fix-createenvfile.py
```

## Option 3: Use the Bash Script

```bash
ssh seemplify@4.180.153.209
cd ~/seemplify || (git clone https://github.com/michaelegbo/seemplify.git && cd seemplify)
bash approver/fix-createenvfile.sh
```

---

**After running the fix, redeploy both apps in Dokploy UI!**
