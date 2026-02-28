# Dokploy Development Environment Setup Guide

**Created:** January 14, 2026  
**Purpose:** Step-by-step guide to create all dev applications in Dokploy

---

## 🎯 Overview

This guide walks through creating 9 development applications in Dokploy, mirroring the production setup but using:
- `-dev` suffix for all application names
- `-dev` databases in MongoDB Atlas
- `-dev` domains in DNS
- Development environment variables

---

## 📋 Prerequisites

Before starting, ensure you have:

- [ ] Access to Dokploy dashboard (http://4.180.153.209:3000)
- [ ] MongoDB Atlas dev databases created
- [ ] Cloudflare DNS records for -dev domains created
- [ ] List of all environment variables for each application

**Dokploy Credentials:**
```
URL:      http://4.180.153.209:3000
Email:    admin@seemplifyai.com
Password: Seemplify2026!
```

---

## 🏗️ Applications to Create

| # | Application Name | Domain | Database | Build Path |
|---|-----------------|--------|----------|------------|
| 1 | identity-provider-dev | auth-dev.seemplifyai.com | identity-dev | Identityprovider/ |
| 2 | recruiter-backend-dev | api-dev.seemplifyai.com | smart_hr_db-dev | recruiter/backend/ |
| 3 | recruiter-frontend-dev | app-dev.seemplifyai.com | - | recruiter/frontend/ |
| 4 | leave-backend-dev | api-leave-dev.seemplifyai.com | leave-management-dev | leave-management/backend/ |
| 5 | leave-frontend-dev | leave-dev.seemplifyai.com | - | leave-management/frontend/ |
| 6 | performance-backend-dev | api-performance-dev.seemplifyai.com | performance_db-dev | performance/backend/ |
| 7 | performance-frontend-dev | performance-dev.seemplifyai.com | - | performance/frontend/ |
| 8 | payroll-backend-dev | api-payroll-dev.seemplifyai.com | payroll_db-dev | payroll/backend/ |
| 9 | payroll-frontend-dev | payroll-dev.seemplifyai.com | - | payroll/frontend/ |

---

## 📝 General Setup Procedure for Each App

### Step 1: Access Dokploy

1. Open browser and navigate to: http://4.180.153.209:3000
2. Login with credentials above
3. Click on your project (if using projects)

### Step 2: Create New Application

1. Click **"Create Application"** or **"New"** button
2. Select **"Application"** type
3. Choose **"GitHub"** as source

### Step 3: Configure Git Repository

1. **Repository:** Select your seemplify repository
2. **Branch:** Initially set to `main` (we'll create `dev` branch later)
3. **Build Path:** Set according to the table above (e.g., `recruiter/backend/`)

### Step 4: Set Application Name

1. **Name:** Use the exact name from the table (e.g., `recruiter-backend-dev`)
2. This name will be used in Docker and for identification

### Step 5: Configure Build Settings

1. **Dockerfile:** Auto-detected (usually)
2. **Build Context:** Set to the build path
3. **Build Arguments:** Leave empty unless specific args needed

### Step 6: Set Domain

1. Click **"Domains"** tab
2. Add domain from the table (e.g., `api-dev.seemplifyai.com`)
3. Enable **"Generate SSL Certificate"** (Let's Encrypt)
4. Enable **"Force HTTPS"** (redirect HTTP to HTTPS)

### Step 7: Configure Environment Variables

*See environment variable sections below for each application*

**General variables for all backends:**
```env
NODE_ENV=development
PORT=<application-port>
```

### Step 8: Deploy

1. Click **"Deploy"** button
2. Monitor deployment logs
3. Wait for successful deployment
4. Verify application is running

### Step 9: Record Application ID

**IMPORTANT:** After creating each app, note its Application ID:

1. In Dokploy, open the application
2. Look for the ID in the URL or application settings
3. Record it in the table at the end of this document

---

## 🔧 Application-Specific Configurations

### 1. Identity Provider Dev

**Application Name:** `identity-provider-dev`  
**Domain:** `auth-dev.seemplifyai.com`  
**Build Path:** `Identityprovider/`  
**Database:** `identity-dev`

**Environment Variables:**
```env
NODE_ENV=development
PORT=5008
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/identity-dev?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=dev_super_secret_key_change_this
JWT_ACCESS_TTL=10m

# Add other identity provider specific env vars
```

---

### 2. Recruiter Backend Dev

**Application Name:** `recruiter-backend-dev`  
**Domain:** `api-dev.seemplifyai.com`  
**Build Path:** `recruiter/backend/`  
**Database:** `smart_hr_db-dev`

**Environment Variables:**
```env
NODE_ENV=development
PORT=5001
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/smart_hr_db-dev?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=dev_super_secret_key_change_this
JWT_ACCESS_TTL=10m

# Identity Provider URLs (DEV!)
OIDC_ISSUER=https://auth-dev.seemplifyai.com
IDP_API_BASE_URL=https://auth-dev.seemplifyai.com
IDP_HUB_URL=https://auth-dev.seemplifyai.com
OIDC_CLIENT_ID=smarthr-backend
OIDC_CLIENT_SECRET=smarthr-secret

# Azure OpenAI (use same as production or separate dev keys)
azure_openai_key=<your_key>
azure_openai_url=<your_url>
azure_openai_model=gpt-4.1
azure_openai_embedding_url=<your_embedding_url>
azure_openai_embedding_model=text-embedding-3-large
azure_openai_embedding_key=<your_key>

# Cloudinary (can use same as prod or separate)
CLOUDINARY_CLOUD_NAME=<your_cloud_name>
CLOUDINARY_API_KEY=<your_api_key>
CLOUDINARY_API_SECRET=<your_api_secret>

# Nylas (use dev credentials if available)
NYLAS_CLIENT_ID=<your_client_id>
NYLAS_API_KEY=<your_api_key>
NYLAS_API_URI=https://api.us.nylas.com
NYLAS_CLIENT_SECRET=<your_secret>
NYLAS_REGION=us
NYLAS_WEBHOOK_SECRET=<your_webhook_secret>

# Feature flags
ENABLE_GPT_MATCHING=true
USE_NYLAS_FOR_INTERVIEW_EMAILS=true

# Brevo (use dev account if available)
BREVO_API_KEY=<your_brevo_key>

# Pinecone (vector DB - required for recruiter backend)
PINECONE_API_KEY=<your_pinecone_api_key>
PINECONE_PROJECT_ID=<your_pinecone_project_id>
```

---

### 3. Recruiter Frontend Dev

**Application Name:** `recruiter-frontend-dev`  
**Domain:** `app-dev.seemplifyai.com`  
**Build Path:** `recruiter/frontend/`  
**Database:** None (frontend)

**Environment Variables:**
```env
NODE_ENV=development
PORT=5000

# Point to DEV backend and identity provider
NEXT_PUBLIC_API_URL=https://api-dev.seemplifyai.com
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com

# Add other frontend env vars
```

---

### 4. Leave Backend Dev

**Application Name:** `leave-backend-dev`  
**Domain:** `api-leave-dev.seemplifyai.com`  
**Build Path:** `leave-management/backend/`  
**Database:** `leave-management-dev`

**Environment Variables:**
```env
NODE_ENV=development
PORT=5002
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/leave-management-dev?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=dev_super_secret_key_change_this

# Identity Provider URLs (DEV!)
OIDC_ISSUER=https://auth-dev.seemplifyai.com
IDP_API_BASE_URL=https://auth-dev.seemplifyai.com
OIDC_CLIENT_ID=leave-backend
OIDC_CLIENT_SECRET=leave-secret
```

---

### 5. Leave Frontend Dev

**Application Name:** `leave-frontend-dev`  
**Domain:** `leave-dev.seemplifyai.com`  
**Build Path:** `leave-management/frontend/`  
**Database:** None (frontend)

**Environment Variables:**
```env
NODE_ENV=development
PORT=5003
NEXT_PUBLIC_API_URL=https://api-leave-dev.seemplifyai.com
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com
```

---

### 6. Performance Backend Dev

**Application Name:** `performance-backend-dev`  
**Domain:** `api-performance-dev.seemplifyai.com`  
**Build Path:** `performance/backend/`  
**Database:** `performance_db-dev`

**Environment Variables:**
```env
NODE_ENV=development
PORT=5004
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/performance_db-dev?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=dev_super_secret_key_change_this

# Identity Provider URLs (DEV!)
OIDC_ISSUER=https://auth-dev.seemplifyai.com
IDP_API_BASE_URL=https://auth-dev.seemplifyai.com
OIDC_CLIENT_ID=performance-backend
OIDC_CLIENT_SECRET=performance-secret
```

---

### 7. Performance Frontend Dev

**Application Name:** `performance-frontend-dev`  
**Domain:** `performance-dev.seemplifyai.com`  
**Build Path:** `performance/frontend/`  
**Database:** None (frontend)

**Environment Variables:**
```env
NODE_ENV=development
PORT=5005
NEXT_PUBLIC_API_URL=https://api-performance-dev.seemplifyai.com
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com
```

---

### 8. Payroll Backend Dev

**Application Name:** `payroll-backend-dev`  
**Domain:** `api-payroll-dev.seemplifyai.com`  
**Build Path:** `payroll/backend/`  
**Database:** `payroll_db-dev`

**Environment Variables:**
```env
NODE_ENV=development
PORT=5006
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/payroll_db-dev?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=dev_super_secret_key_change_this

# Identity Provider URLs (DEV!)
OIDC_ISSUER=https://auth-dev.seemplifyai.com
IDP_API_BASE_URL=https://auth-dev.seemplifyai.com
OIDC_CLIENT_ID=payroll-backend
OIDC_CLIENT_SECRET=payroll-secret
```

---

### 9. Payroll Frontend Dev

**Application Name:** `payroll-frontend-dev`  
**Domain:** `payroll-dev.seemplifyai.com`  
**Build Path:** `payroll/frontend/`  
**Database:** None (frontend)

**Environment Variables:**
```env
NODE_ENV=development
PORT=5007
NEXT_PUBLIC_API_URL=https://api-payroll-dev.seemplifyai.com
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com
```

---

## 📊 Application IDs Record Sheet

**IMPORTANT:** Record each Application ID after creation (needed for GitHub Actions)

| Application Name | Application ID | Status |
|-----------------|----------------|--------|
| identity-provider-dev | _______________ | ⬜ |
| recruiter-backend-dev | _______________ | ⬜ |
| recruiter-frontend-dev | _______________ | ⬜ |
| leave-backend-dev | _______________ | ⬜ |
| leave-frontend-dev | _______________ | ⬜ |
| performance-backend-dev | _______________ | ⬜ |
| performance-frontend-dev | _______________ | ⬜ |
| payroll-backend-dev | _______________ | ⬜ |
| payroll-frontend-dev | _______________ | ⬜ |

---

## ✅ Verification Checklist

After creating all applications:

- [ ] All 9 applications created in Dokploy
- [ ] All domains configured with SSL
- [ ] All environment variables set correctly
- [ ] All applications deployed successfully
- [ ] All application IDs recorded
- [ ] Test each domain (https://auth-dev.seemplifyai.com, etc.)
- [ ] Verify no errors in deployment logs

---

## 🔄 Updating to Use Dev Branch Later

Once the `dev` branch is created in GitHub:

1. Go to each application in Dokploy
2. Navigate to **"Git"** or **"Source"** settings
3. Change **"Branch"** from `main` to `dev`
4. Save changes

This ensures dev apps deploy from dev branch, not main.

---

## 🆘 Troubleshooting

### Application Won't Start

**Check:**
- Environment variables are set correctly
- MongoDB connection string is correct
- Domain DNS is propagated (use nslookup)
- Build logs for errors

### SSL Certificate Not Generated

**Solutions:**
- Wait 2-5 minutes for Let's Encrypt
- Verify DNS is propagated
- Check Traefik logs in Dokploy
- Ensure domain is accessible (not blocked by firewall)

### Inter-Service Communication Fails

**Check:**
- Frontend env vars point to correct -dev backend URLs
- Backend env vars point to correct -dev identity provider
- All services are running (check Dokploy dashboard)

---

## 📝 Next Steps

After completing this setup:

1. **Record all Application IDs** (see table above)
2. **Create GitHub secrets** using these IDs
3. **Create dev branch** in GitHub repository
4. **Update Dokploy apps** to use dev branch
5. **Test deployments** via GitHub Actions

See `GITHUB-SECRETS-SETUP-GUIDE.md` for next steps.

---

**Note:** This setup creates a complete parallel development environment. Take your time and verify each step.
