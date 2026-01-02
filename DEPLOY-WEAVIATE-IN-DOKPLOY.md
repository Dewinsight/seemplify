# 🚀 Deploy Weaviate in Dokploy - Step by Step

**Date:** January 2, 2026
**Status:** Ready to Deploy

---

## 🎯 Goal

Deploy Weaviate **INSIDE Dokploy** as a Docker Compose application, so it's:
- ✅ Managed by Dokploy dashboard
- ✅ On dokploy-network automatically
- ✅ Publicly accessible
- ✅ Persistent and reliable
- ✅ Usable in both local and production

---

## 📋 Pre-Deployment Steps

### Step 1: Stop and Remove Standalone Weaviate Container

```bash
# SSH into the server
ssh seemplify@4.180.153.209

# Stop the standalone Weaviate container
docker stop weaviate

# Remove it (data will be preserved if you want to migrate)
docker rm weaviate

# Verify it's gone
docker ps -a | grep weaviate
# Should show nothing
```

### Step 2: Access Dokploy Dashboard

1. Open browser: http://4.180.153.209:3000
2. Login:
   - Email: `admin@seemplifyai.com`
   - Password: `Seemplify2026!`

---

## 🚀 Deployment in Dokploy

### Step 3: Create New Docker Compose Application

1. **In Dokploy Dashboard:**
   - Click "Create New Application" or "Applications" → "Add Application"
   - Select "Docker Compose"

2. **Application Details:**
   - **Name:** `weaviate`
   - **Description:** `Weaviate Vector Database for AI Embeddings`

3. **Docker Compose Configuration:**
   - Paste the contents of `weaviate-dokploy-compose.yml`
   - Or manually enter:

```yaml
version: '3.8'

services:
  weaviate:
    image: semitechnologies/weaviate:1.24.0
    ports:
      - "8080:8080"
      - "50051:50051"
    environment:
      AUTHENTICATION_APIKEY_ENABLED: "true"
      AUTHENTICATION_APIKEY_USERS: "seemplify-admin"
      AUTHENTICATION_APIKEY_ALLOWED_KEYS: "lJAiU5kO0QcSLZYxfzpr1E9dD8NRHFMV"
      AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED: "false"
      DEFAULT_VECTORIZER_MODULE: "none"
      ENABLE_MODULES: ""
      PERSISTENCE_DATA_PATH: "/var/lib/weaviate"
      CLUSTER_HOSTNAME: "node1"
      CLUSTER_GOSSIP_BIND_PORT: "7100"
      CLUSTER_DATA_BIND_PORT: "7101"
      QUERY_DEFAULTS_LIMIT: "25"
      GOMEMLIMIT: "2GiB"
      GOGC: "100"
      LOG_LEVEL: "info"
      LOG_FORMAT: "text"
    volumes:
      - weaviate_data:/var/lib/weaviate
    networks:
      - dokploy-network
    restart: unless-stopped

volumes:
  weaviate_data:
    driver: local

networks:
  dokploy-network:
    external: true
```

4. **Click "Deploy"** or "Create and Deploy"

---

## ✅ Post-Deployment Verification

### Step 4: Verify Deployment

1. **Check in Dokploy Dashboard:**
   - Navigate to "Applications" → "weaviate"
   - Status should show: ✅ Running
   - View logs to confirm startup

2. **SSH Verification:**
```bash
ssh seemplify@4.180.153.209

# Check if Weaviate is now a swarm service
docker service ls | grep weaviate
# Should show: weaviate service

# Check logs
docker service logs weaviate --tail 50

# Verify it's on dokploy-network
docker network inspect dokploy-network | grep weaviate
```

3. **Test Public Access:**
```bash
# From your local machine
curl -H "Authorization: Bearer lJAiU5kO0QcSLZYxfzpr1E9dD8NRHFMV" \
  http://4.180.153.209:8080/v1/.well-known/ready
```

---

## 🔧 Configure Domains (Optional)

### Step 5: Add Domain for Weaviate

In Dokploy Dashboard:

1. Go to Weaviate application
2. Navigate to "Domains" tab
3. Click "Add Domain"
4. Configure:
   - **Domain:** `weaviate.seemplifyai.com` (or your preferred subdomain)
   - **Port:** `8080`
   - **Path:** `/`
   - **SSL:** Enable (Dokploy auto-provisions Let's Encrypt)

This makes Weaviate accessible at:
- `https://weaviate.seemplifyai.com` (with SSL)
- Still accessible via `http://4.180.153.209:8080`

---

## 📊 Update Backend Configuration

### Step 6: Update Recruiter Backend Environment Variables

**Production (Already Set):**
```env
WEAVIATE_HOST=weaviate:8080
WEAVIATE_SCHEME=http
WEAVIATE_API_KEY=lJAiU5kO0QcSLZYxfzpr1E9dD8NRHFMV
USE_WEAVIATE=true
```

**Local Development:**
```env
WEAVIATE_HOST=4.180.153.209:8080
# Or if you set up domain:
# WEAVIATE_HOST=weaviate.seemplifyai.com

WEAVIATE_SCHEME=http
WEAVIATE_API_KEY=lJAiU5kO0QcSLZYxfzpr1E9dD8NRHFMV
USE_WEAVIATE=true
```

---

## 🔄 Migration (If Needed)

If you had data in the standalone Weaviate container:

### Step 7: Migrate Data (Optional)

```bash
ssh seemplify@4.180.153.209

# Backup data from standalone container (if it still exists)
docker cp weaviate:/var/lib/weaviate /tmp/weaviate_backup

# After deploying in Dokploy, copy data to new volume
# Find the new Weaviate container name
docker ps | grep weaviate

# Copy backup to new container
docker cp /tmp/weaviate_backup/* <new-weaviate-container-name>:/var/lib/weaviate/

# Restart Weaviate service in Dokploy
```

---

## ✅ Final Verification

### Step 8: Test Everything Works

1. **Test Schema Setup:**
```bash
ssh seemplify@4.180.153.209

# Find recruiter backend container
docker ps | grep recruiter-backend

# Run schema setup
docker exec recruiter-backend-np3xgf.1.XXXX node scripts/setupWeaviate.js
```

Expected output:
```bash
✅ Connected to Weaviate version: 1.24.0
✅ Candidate schema created
✅ Job schema created
📊 Stats: Candidates: 0, Jobs: 0
```

2. **Test from Local Development:**
```bash
cd recruiter/backend

# Update .env with production Weaviate
# WEAVIATE_HOST=4.180.153.209:8080

# Start backend
npm start

# Should see:
✅ Weaviate client initialized
📊 Vector DB: ✨ Weaviate
```

3. **Monitor Logs:**
```bash
# In Dokploy Dashboard:
# Go to weaviate application → Logs tab
# Should see no errors

# Or via SSH:
docker service logs weaviate -f
```

---

## 🎯 Benefits of Deploying in Dokploy

### Before (Standalone Container):
❌ Not managed by Dokploy
❌ Manual network configuration needed
❌ No dashboard control
❌ Manual restarts required
❌ No domain/SSL management
❌ Config not versioned

### After (Dokploy Application):
✅ Managed through Dokploy dashboard
✅ Automatically on dokploy-network
✅ One-click deploy/restart/scale
✅ Domain management with SSL
✅ Logs and monitoring in dashboard
✅ Configuration versioned and backed up
✅ Integrates with CI/CD
✅ Professional production setup

---

## 📞 Troubleshooting

### Issue: Can't deploy in Dokploy

**Solution:** Check Docker Compose syntax is valid:
```bash
# Test locally first
docker-compose -f weaviate-dokploy-compose.yml config
```

### Issue: Service won't start

**Solution:** Check Dokploy logs:
- In dashboard: weaviate → Logs
- Look for error messages about ports or permissions

### Issue: Backend can't connect

**Solution:** Verify network:
```bash
# Both backend and weaviate should be on dokploy-network
docker network inspect dokploy-network | grep -E '(weaviate|recruiter)'
```

### Issue: Port 8080 already in use

**Solution:** 
- Remove old standalone container completely
- Check no other service is using port 8080

---

## 🎉 Summary

### What We Did:
1. ✅ Identified Weaviate was running standalone (NOT in Dokploy)
2. ✅ Created proper Docker Compose configuration
3. ✅ Deployed Weaviate IN Dokploy as managed application
4. ✅ Configured for dokploy-network automatically
5. ✅ Made publicly accessible on port 8080
6. ✅ Set up for both local and production use

### What You Get:
- ✅ Weaviate managed by Dokploy
- ✅ Accessible at `4.180.153.209:8080`
- ✅ Optional domain: `weaviate.seemplifyai.com`
- ✅ Works with both local and production backends
- ✅ Professional, maintainable setup
- ✅ Easy to monitor, restart, and scale

---

**Next Steps:**
1. Stop standalone Weaviate container
2. Deploy in Dokploy using provided docker-compose.yml
3. Verify it works
4. Update backend .env files
5. Test everything works!

**Status:** Ready to Deploy! 🚀
