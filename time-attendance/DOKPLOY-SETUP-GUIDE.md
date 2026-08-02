# Time Attendance Dokploy Setup Guide

This guide walks you through setting up the Time Attendance applications in Dokploy.

---

## 📋 Prerequisites

- ✅ Dockerfiles created (`backend/Dockerfile`, `frontend/Dockerfile`)
- ✅ GitHub Actions workflows created
- ✅ Cloudflare DNS records created (or use `setup-cloudflare-dns.ps1`)

---

## 🚀 Step-by-Step Setup

### Step 1: Access Dokploy Dashboard

1. Open browser: **http://4.180.153.209:3000**
2. Login:
   - **Email:** admin@seemplifyai.com
   - **Password:** Seemplify2026!

---

### Step 2: Create Backend Application

1. Click **"Create Application"** or **"New Application"**
2. Fill in the details:

| Field | Value |
|-------|-------|
| **Name** | `time-attendance-backend` |
| **Project** | Select existing project (or create new) |
| **Source Type** | `GitHub` |
| **Repository** | `michaelegbo/seemplify` |
| **Branch** | `main` |
| **Root Path** | `time-attendance/backend` |
| **Build Path** | `time-attendance/backend` |
| **Dockerfile Path** | `Dockerfile` (relative to build path) |

3. Click **"Create"** or **"Save"**

---

### Step 3: Configure Backend Domain

1. Go to **Application → time-attendance-backend → Settings → Domains**
2. Click **"Add Domain"**
3. Enter: `api-time.seemplifyai.com`
4. Enable **HTTPS** (Let's Encrypt)
5. Click **"Save"**

**Traefik will automatically:**
- Configure routing rule
- Generate SSL certificate
- Enable HTTPS redirect

---

### Step 4: Configure Backend Environment Variables

1. Go to **Application → time-attendance-backend → Settings → Environment**
2. Add the following variables:

```env
NODE_ENV=production
PORT=5010

# MongoDB (get from access/DATABASE-CREDENTIALS.md)
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/time_attendance?retryWrites=true&w=majority

# Session Secret (generate a strong random string)
SESSION_SECRET=<generate-strong-secret-64-chars>

# OIDC Configuration
IDP_ISSUER_URL=https://auth.seemplifyai.com
OIDC_CLIENT_ID=time-attendance
OIDC_CLIENT_SECRET=<get-from-idp-config>
OIDC_REDIRECT_URI=https://api-time.seemplifyai.com/api/auth/oidc/callback

# Frontend URL
FRONTEND_URL=https://time.seemplifyai.com
CORS_ORIGIN=https://time.seemplifyai.com
```

3. Click **"Save"**

---

### Step 5: Create Frontend Application

1. Click **"Create Application"** or **"New Application"**
2. Fill in the details:

| Field | Value |
|-------|-------|
| **Name** | `time-attendance-frontend` |
| **Project** | Same project as backend |
| **Source Type** | `GitHub` |
| **Repository** | `michaelegbo/seemplify` |
| **Branch** | `main` |
| **Root Path** | `time-attendance/frontend` |
| **Build Path** | `time-attendance/frontend` |
| **Dockerfile Path** | `Dockerfile` (relative to build path) |

3. Click **"Create"** or **"Save"**

---

### Step 6: Configure Frontend Domain

1. Go to **Application → time-attendance-frontend → Settings → Domains**
2. Click **"Add Domain"**
3. Enter: `time.seemplifyai.com`
4. Enable **HTTPS** (Let's Encrypt)
5. Click **"Save"**

---

### Step 7: Configure Frontend Build Arguments

1. Go to **Application → time-attendance-frontend → Settings → Build**
2. Add build arguments (for Next.js public env vars):

```env
NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
```

3. Click **"Save"**

**Note:** These are build-time arguments that get embedded in the Next.js build.

---

### Step 8: Get Application IDs

After creating both applications, you need to get their IDs for GitHub secrets:

1. **Backend ID:**
   - Go to **time-attendance-backend** application
   - Look at the URL: `http://4.180.153.209:3000/project/<project_id>/services/application/<BACKEND_APP_ID>`
   - Copy the `<BACKEND_APP_ID>`

2. **Frontend ID:**
   - Go to **time-attendance-frontend** application
   - Look at the URL: `http://4.180.153.209:3000/project/<project_id>/services/application/<FRONTEND_APP_ID>`
   - Copy the `<FRONTEND_APP_ID>`

3. **Set GitHub Secrets:**
   ```bash
   gh secret set TIME_ATTENDANCE_BACKEND_APP_ID --body "<BACKEND_APP_ID>"
   gh secret set TIME_ATTENDANCE_FRONTEND_APP_ID --body "<FRONTEND_APP_ID>"
   ```

---

### Step 9: Initial Deployment

1. **Deploy Backend:**
   - Go to **time-attendance-backend → Deploy**
   - Click **"Deploy"** or **"Redeploy"**
   - Wait for build to complete (~2-4 minutes)

2. **Deploy Frontend:**
   - Go to **time-attendance-frontend → Deploy**
   - Click **"Deploy"** or **"Redeploy"**
   - Wait for build to complete (~3-5 minutes)

---

### Step 10: Verify Deployment

1. **Check Backend:**
   ```bash
   curl https://api-time.seemplifyai.com/api/health
   ```
   Should return: `{"status":"ok"}` or similar

2. **Check Frontend:**
   - Open browser: **https://time.seemplifyai.com**
   - Should load the login page

3. **Check Logs:**
   - In Dokploy, go to each application → **Logs**
   - Verify no errors

---

## 🔐 Identity Provider Configuration

Before authentication works, you need to configure the OIDC client:

1. **Access Identity Provider:**
   - URL: https://auth.seemplifyai.com
   - Login as admin

2. **Add OIDC Client:**
   - Client ID: `time-attendance`
   - Client Secret: (generate and save for backend env vars)
   - Redirect URIs:
     - `https://time.seemplifyai.com/api/auth/callback`
     - `https://api-time.seemplifyai.com/api/auth/oidc/callback`

3. **Update Backend Environment:**
   - In Dokploy, update `OIDC_CLIENT_SECRET` with the secret from step 2
   - Redeploy backend

---

## ✅ Verification Checklist

- [ ] Backend application created in Dokploy
- [ ] Frontend application created in Dokploy
- [ ] Domains configured (`api-time.seemplifyai.com`, `time.seemplifyai.com`)
- [ ] Environment variables set
- [ ] Build arguments set for frontend
- [ ] Application IDs retrieved
- [ ] GitHub secrets configured
- [ ] Initial deployment successful
- [ ] Backend health endpoint responds
- [ ] Frontend loads in browser
- [ ] OIDC client configured in Identity Provider
- [ ] Authentication flow works

---

## 🚨 Troubleshooting

### Build Fails
- Check Dockerfile syntax
- Verify package.json exists
- Check build logs in Dokploy

### Domain Not Working
- Verify DNS records in Cloudflare
- Check Traefik configuration in Dokploy
- Wait for SSL certificate (5-10 minutes)

### Authentication Fails
- Verify OIDC client configuration
- Check redirect URIs match exactly
- Verify client secret in backend env vars

---

**Setup Complete!** 🎉
