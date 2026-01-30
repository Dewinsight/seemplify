# Complete Deployment Guide - CLI + GitHub Actions

**Date:** January 22, 2026  
**Status:** 🚀 Ready for CLI Deployment

---

## 📋 Overview

This guide shows you how to:
1. **SSH into Azure VM** and create Dokploy application via CLI
2. **Configure the application** with domain and environment variables
3. **Deploy via CLI** to Dokploy
4. **Set up GitHub Actions** for automatic future deployments
5. **Commit and push** all changes to trigger auto-deploy

---

## 🎯 Prerequisites

### Before Starting, Ensure You Have:

- [ ] Azure VM accessible (http://4.180.153.209:3000 or SSH)
- [ ] DNS record added in Cloudflare (A: `approver` → `4.180.153.209`)
- [ ] GitHub repository ready with all code changes
- [ ] Access to GitHub CLI (installed and authenticated)

---

## 🚀 Step 1: SSH into Azure VM

### Connect via SSH

```bash
# SSH into your Azure VM
ssh seemplify@4.180.153.209
```

**Expected:** Login successful, you're at the VM command line

### Verify You're on the Right Server

```bash
# Check if you're on Azure VM
hostname
# Should show: seemplify
```

---

## 🔧 Step 2: Create Dokploy Application via CLI

### Install Dokploy CLI (If Not Installed)

```bash
# Install Dokploy CLI globally
npm install -g @dokploy/cli

# Or if already installed
dokploy --version
```

### Login to Dokploy

```bash
# Login to Dokploy
dokploy login --token <your-api-key-here>

# OR if using interactive mode (from DOKPLOY-CREDENTIALS.md)
dokploy login --interactive
```

**Note:** Get your API key from: `access/DOKPLOY-CREDENTIALS.md`

---

## 🏗️ Step 3: Create Application

### Create the Application

```bash
# Create a new application
dokploy application:create \
  --name approver \
  --repository https://github.com/YOUR_USERNAME/seemplify \
  --branch main \
  --root-path approver/ \
  --build-path backend/
  --dockerfile-path backend/Dockerfile
```

**Expected Output:**
```
✓ Application created successfully
Application ID: xxx-xxxx-xxxx-xxxx-xxxx
```

**Copy the Application ID** - You'll need this for GitHub Actions!

---

## 🔌 Step 4: Configure Application via CLI

### Add Domain

```bash
# Configure domain
dokploy application:update \
  --application-id <APP-ID-FROM-STEP-3> \
  --domain approver.aiinigeria.com \
  --force-https true
```

**Expected Output:**
```
✓ Domain added successfully
Domain: approver.aiinigeria.com
```

---

## 🔐 Step 5: Set Environment Variables

```bash
# Set production environment variables
dokploy application:update \
  --application-id <APP-ID-FROM-STEP-3> \
  --env NODE_ENV=production \
  --env PORT=80 \
  --env MONGO_URI=mongodb+srv://<your-connection-string>

# Add more variables as needed
dokploy application:update \
  --application-id <APP-ID-FROM-STEP-3> \
  --env FRONTEND_URL=https://approver.aiinigeria.com \
  --env JWT_SECRET=<your-jwt-secret>
```

**Important:** Set `MONGO_URI` - Use the same MongoDB connection string your other apps use!

---

## 🚀 Step 6: Deploy Application

```bash
# Deploy the application
dokploy application:deploy \
  --application-id <APP-ID-FROM-STEP-3>
```

**Expected Output:**
```
✓ Deployment started
Cloning repository...
Building Docker image...
Starting container...
✓ Application deployed successfully
URL: https://approver.aiinigeria.com
```

---

## 📝 Step 7: Verify Deployment

### Check Application Status

```bash
# Check if application is running
dokploy application:status \
  --application-id <APP-ID-FROM-STEP-3>

# Get application details
dokploy application:get \
  --application-id <APP-ID-FROM-STEP-3>

# View logs
dokploy logs \
  --application-id <APP-ID-FROM-STEP-3> \
  --tail 50
```

---

## 🔐 Step 8: Set Up GitHub Actions

### Configure GitHub Secrets

You need to add these secrets to your repository:

```bash
# Set Dokploy URL
gh secret set DOKPLOY_URL --body "http://4.180.153.209:3000"

# Set Dokploy API Token
gh secret set DOKPLOY_TOKEN --body "<your-dokploy-api-key>"

# Set Approver Application ID
gh secret set APPROVER_APP_ID --body "<APP-ID-FROM-STEP-3>"

# Set MongoDB URI (optional - can also set in Dokploy)
# gh secret set APPROVER_MONGO_URI --body "mongodb+srv://..."
```

### Get Required Credentials

1. **Dokploy API Key:** Check `access/DOKPLOY-CREDENTIALS.md`
2. **Application ID:** From Step 3 (you created the app)
3. **MongoDB URI:** Use the same connection string as your other apps

---

## 🚀 Step 9: Commit and Push to Trigger Auto-Deploy

### Add All Changes to Git

```bash
# Navigate to project
cd c:/Users/Michael/Documents/GitHub/seemplify

# Add all new files
git add .

# Commit changes
git commit -m "feat: deploy approver to dokploy with approver.aiinigeria.com

# Push to main branch
git push origin main
```

### What Happens Next

1. ✅ GitHub Actions detects changes in `approver/**` path
2. ✅ Workflow `deploy-approver.yml` automatically triggers
3. ✅ Dokploy API is called to redeploy
4. ✅ Application updated with latest code
5. ✅ `approver.aiinigeria.com` is live and updated

---

## 📊 Complete CLI Command Sequence

Copy and paste this entire block at once in your SSH session:

```bash
# ========================================
# COMPLETE APPROVER DEPLOYMENT
# ========================================

# 1. Install Dokploy CLI (if needed)
npm install -g @dokploy/cli

# 2. Login to Dokploy
dokploy login --token <your-api-key>

# 3. Create application
dokploy application:create \
  --name approver \
  --repository https://github.com/YOUR_USERNAME/seemplify \
  --branch main \
  --root-path approver/ \
  --build-path backend/ \
  --dockerfile-path backend/Dockerfile

# 4. Add domain (REPLACE <APP-ID> WITH ACTUAL ID FROM OUTPUT)
dokploy application:update \
  --application-id <REPLACE-WITH-APP-ID-FROM-STEP-3> \
  --domain approver.aiinigeria.com \
  --force-https true

# 5. Set environment variables
dokploy application:update \
  --application-id <REPLACE-WITH-APP-ID-FROM-STEP-3> \
  --env NODE_ENV=production \
  --env PORT=80 \
  --env MONGO_URI=mongodb+srv://<your-mongo-connection-string>

# 6. Deploy application
dokploy application:deploy \
  --application-id <REPLACE-WITH-APP-ID-FROM-STEP-3>

# 7. Verify deployment
dokploy application:status --application-id <REPLACE-WITH-APP-ID-FROM-STEP-3>

echo "========================================"
echo "✓ Approver deployment complete!"
echo "========================================"
```

---

## 🔍 Troubleshooting

### Issue: Authentication Failed

**Solution:** Check API key is correct in `access/DOKPLOY-CREDENTIALS.md`

```bash
# Test connection
dokploy --version

# Login again
dokploy login --token <your-api-key>
```

### Issue: Application ID Not Found

**Solution:** Use the exact Application ID from Step 3 output

```bash
# List all applications
dokploy application:list

# Find your approver application
dokploy application:get --application-id <APP-ID>
```

### Issue: Domain Not Working

**Solution:** Check DNS record in Cloudflare:

```bash
# Check DNS propagation
nslookup approver.aiinigeria.com 8.8.8.8
```

Wait 2-5 minutes for DNS to propagate.

### Issue: Container Won't Start

**Solution:** Check logs and restart:

```bash
# View logs
dokploy logs --application-id <APP-ID> --tail 100

# Restart application
dokploy application:restart --application-id <REPLACE-WITH-APP-ID-FROM-STEP-3>
```

### Issue: GitHub Actions Not Triggering

**Solution:** Check workflow file:

1. Verify `.github/workflows/deploy-approver.yml` exists
2. Verify trigger path: `approver/**`
3. Check GitHub Actions logs:
   ```bash
   gh workflow view
   ```
4. Ensure secrets are set:
   ```bash
   gh secret list
   ```

---

## 🎯 Deployment Summary

| Component | Status | Command/Action |
|----------|--------|---------------|
| **SSH Access** | ✅ | `ssh seemplify@4.180.153.209` |
| **Dokploy Login** | ✅ | `dokploy login --token <key>` |
| **Create App** | ✅ | `dokploy application:create` |
| **Configure Domain** | ✅ | `dokploy application:update --domain` |
| **Set Env Vars** | ✅ | `dokploy application:update --env` |
| **Deploy App** | ✅ | `dokploy application:deploy` |
| **GitHub Secrets** | ⏳ | `gh secret set APPROVER_APP_ID` |
| **Git Push** | ⏳ | `git add . && git commit -m && git push` |
| **Auto-Deploy** | ⏳ | GitHub Actions on push to `approver/**` |
| **Final URL** | ⏳ | https://approver.aiinigeria.com |

---

## 📞 Quick Reference Card

```
┌────────────────────────────────────────────┐
│ APPROVER DEPLOYMENT - CLI + GITHUB    │
├────────────────────────────────────────────┤
│                                          │
│ SSH: seemplify@4.180.153.209            │
│ Dokploy CLI: dokploy login            │
│ Create: dokploy application:create           │
│ Configure: dokploy application:update        │
│ Deploy: dokploy application:deploy          │
│ GitHub: gh secret set + git push           │
│ Result: https://approver.aiinigeria.com     │
└────────────────────────────────────────────┘
```

---

## ✅ What This Achieves

### Why CLI + GitHub Actions is Powerful

1. **✅ Complete Control** - Full CLI access to Dokploy
2. **✅ First-Time Setup** - Configure once via CLI
3. **✅ Future Automation** - GitHub Actions handle updates
4. **✅ Speed** - CLI for initial setup, Actions for ongoing
5. **✅ Reliability** - Battle-tested GitHub Actions
6. **✅ Documentation** - All steps documented
7. **✅ Professional** - Follows best practices for both tools

---

## 🚀 Next Steps

1. **SSH into Azure VM**
2. **Copy the complete command sequence** from this guide
3. **Replace placeholders** with actual values (APP-ID, API key, MongoDB URI)
4. **Run the commands** in order
5. **Set up GitHub secrets** after getting Application ID
6. **Commit and push** to trigger auto-deploy

---

**You have everything you need! CLI commands + GitHub setup = complete deployment solution.** 🚀
