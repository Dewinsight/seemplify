# Time Attendance Deployment Plan

**Date:** January 27, 2026  
**Status:** Planning Complete - Ready for Implementation

---

## 📋 Overview

This document outlines the complete deployment plan for the Time Attendance application to Dokploy with:
- ✅ GitHub Actions auto-deployment
- ✅ Cloudflare DNS configuration
- ✅ Traefik routing setup
- ✅ Production environment configuration

---

## 🎯 Deployment Goals

1. Deploy time-attendance backend to Dokploy
2. Deploy time-attendance frontend to Dokploy
3. Configure domains in Cloudflare
4. Set up Traefik routing
5. Configure GitHub Actions for auto-deployment
6. Set up environment variables

---

## 📊 Application Details

### Domain Structure

Based on existing patterns (performance, leave, payroll):

| Application | Domain | Port | Type |
|-------------|--------|------|------|
| **Time Attendance Backend** | `api-time.seemplifyai.com` | 5010 | Backend API |
| **Time Attendance Frontend** | `time.seemplifyai.com` | 5011 | Frontend App |

**Alternative naming (if preferred):**
- Backend: `api-time-attendance.seemplifyai.com`
- Frontend: `time-attendance.seemplifyai.com`

### Application Structure

```
time-attendance/
├── backend/
│   ├── server.js (Express backend)
│   ├── package.json
│   ├── .env.example
│   └── (needs Dockerfile)
├── frontend/
│   ├── app/ (Next.js 14)
│   ├── package.json
│   ├── next.config.js
│   └── (needs Dockerfile)
```

---

## 🔍 Study Summary

### 1. GitHub Actions Workflow Pattern

**Template Structure:**
```yaml
name: Deploy [App Name]
on:
  push:
    branches: [main]
    paths:
      - 'time-attendance/backend/**'  # or frontend/**
      - '.github/workflows/deploy-time-attendance-backend.yml'
  workflow_dispatch:

env:
  APP_NAME: time-attendance-backend
  APP_PATH: time-attendance/backend

jobs:
  deploy:
    name: Deploy to Dokploy
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Trigger Dokploy Deployment
        run: |
          response=$(curl -s -w "%{http_code}" -o /tmp/response.txt -X POST "${{ secrets.DOKPLOY_URL }}/api/application.deploy" \
            -H "x-api-key: ${{ secrets.DOKPLOY_TOKEN }}" \
            -H "Content-Type: application/json" \
            -H "accept: application/json" \
            -d '{"applicationId": "${{ secrets.TIME_ATTENDANCE_BACKEND_APP_ID }}"}')
          
          if [ "$response" -eq 200 ]; then
            echo "✅ ${{ env.APP_NAME }} deployment triggered successfully (HTTP $response)"
            cat /tmp/response.txt 2>/dev/null || true
          else
            echo "❌ Deployment failed with HTTP status code: $response"
            cat /tmp/response.txt 2>/dev/null || true
            exit 1
          fi
```

### 2. Dockerfile Patterns

**Backend Dockerfile (Node.js/Express):**
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY . .

# Expose port
EXPOSE 5010

# Start the application
CMD ["npm", "start"]
```

**Frontend Dockerfile (Next.js):**
```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Build-time arguments for Next.js public env vars
ARG NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api
ARG NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com

# Set build-time environment variables
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_IDP_URL=$NEXT_PUBLIC_IDP_URL

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Remove any .env files
RUN rm -f .env .env.local .env.production .env.development 2>/dev/null || true

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 5011

CMD ["npm", "start"]
```

### 3. Dokploy Configuration

**Application Settings:**
- **Name:** `time-attendance-backend` / `time-attendance-frontend`
- **Repository:** `https://github.com/michaelegbo/seemplify`
- **Branch:** `main`
- **Root Path:** `time-attendance/backend` or `time-attendance/frontend`
- **Build Path:** `time-attendance/backend` or `time-attendance/frontend`
- **Dockerfile Path:** `Dockerfile` (in build path)

**Domain Configuration:**
- Backend: `api-time.seemplifyai.com`
- Frontend: `time.seemplifyai.com`
- HTTPS: Enabled (Let's Encrypt via Traefik)

### 4. Environment Variables

**Backend Environment Variables:**
```env
NODE_ENV=production
PORT=5010

# MongoDB
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/time_attendance?retryWrites=true&w=majority

# Session
SESSION_SECRET=<generate-strong-secret-64-chars>

# OIDC Configuration
IDP_ISSUER_URL=https://auth.seemplifyai.com
OIDC_CLIENT_ID=time-attendance
OIDC_CLIENT_SECRET=<from-idp-config>
OIDC_REDIRECT_URI=https://time.seemplifyai.com/api/auth/callback

# Frontend URL
FRONTEND_URL=https://time.seemplifyai.com
CORS_ORIGIN=https://time.seemplifyai.com
```

**Frontend Environment Variables (Build Args):**
```env
NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
```

### 5. Cloudflare DNS Configuration

**DNS Records to Create:**
```bash
# Backend API
Type: A
Name: api-time
Content: 4.180.153.209
TTL: Auto
Proxy: Proxied (Orange Cloud)

# Frontend App
Type: A
Name: time
Content: 4.180.153.209
TTL: Auto
Proxy: Proxied (Orange Cloud)
```

### 6. Traefik Configuration

Traefik is automatically configured by Dokploy when domains are added. Dokploy will:
- Create Traefik router rules
- Configure SSL certificates (Let's Encrypt)
- Set up HTTP to HTTPS redirect
- Configure load balancing

---

## 📝 Implementation Steps

### Phase 1: Create Dockerfiles

1. **Create `time-attendance/backend/Dockerfile`**
   - Based on performance backend pattern
   - Port 5010
   - Production dependencies only

2. **Create `time-attendance/frontend/Dockerfile`**
   - Multi-stage build (builder + runner)
   - Next.js build with production env vars
   - Port 5011

### Phase 2: Create GitHub Actions Workflows

1. **Create `.github/workflows/deploy-time-attendance-backend.yml`**
   - Watch `time-attendance/backend/**`
   - Trigger Dokploy deployment
   - Use secret: `TIME_ATTENDANCE_BACKEND_APP_ID`

2. **Create `.github/workflows/deploy-time-attendance-frontend.yml`**
   - Watch `time-attendance/frontend/**`
   - Trigger Dokploy deployment
   - Use secret: `TIME_ATTENDANCE_FRONTEND_APP_ID`

### Phase 3: Configure Dokploy Applications

1. **Create Backend Application:**
   - Name: `time-attendance-backend`
   - Build Path: `time-attendance/backend`
   - Domain: `api-time.seemplifyai.com`
   - Environment variables (as listed above)

2. **Create Frontend Application:**
   - Name: `time-attendance-frontend`
   - Build Path: `time-attendance/frontend`
   - Domain: `time.seemplifyai.com`
   - Build args for Next.js public env vars

### Phase 4: Configure Cloudflare DNS

1. **Create DNS Records:**
   - `api-time.seemplifyai.com` → `4.180.153.209` (A record, proxied)
   - `time.seemplifyai.com` → `4.180.153.209` (A record, proxied)

### Phase 5: Configure GitHub Secrets

1. **Get Application IDs from Dokploy:**
   - After creating apps in Dokploy, get their IDs from URLs
   - Format: `https://dokploy.seemplifyai.com/project/<project_id>/services/application/<APP_ID>`

2. **Set GitHub Secrets:**
   ```bash
   gh secret set TIME_ATTENDANCE_BACKEND_APP_ID --body "<backend-app-id>"
   gh secret set TIME_ATTENDANCE_FRONTEND_APP_ID --body "<frontend-app-id>"
   ```

### Phase 6: Configure Identity Provider

1. **Add OIDC Client in Identity Provider:**
   - Client ID: `time-attendance`
   - Redirect URIs:
     - `https://time.seemplifyai.com/api/auth/callback`
     - `https://api-time.seemplifyai.com/api/auth/oidc/callback`
   - Get client secret for backend env vars

### Phase 7: Initial Deployment

1. **Deploy Backend:**
   - Trigger deployment from Dokploy UI or GitHub Actions
   - Verify health endpoint: `https://api-time.seemplifyai.com/api/health`

2. **Deploy Frontend:**
   - Trigger deployment from Dokploy UI or GitHub Actions
   - Verify app loads: `https://time.seemplifyai.com`

### Phase 8: Verify Auto-Deployment

1. **Test GitHub Actions:**
   - Make a small change to backend
   - Push to main branch
   - Verify workflow triggers and deploys

2. **Test Frontend:**
   - Make a small change to frontend
   - Push to main branch
   - Verify workflow triggers and deploys

---

## 🔐 Required Credentials

### Dokploy
- **URL:** http://4.180.153.209:3000
- **Email:** admin@seemplifyai.com
- **Password:** Seemplify2026!
- **API Token:** (Get from Dokploy Settings → API Keys)

### Cloudflare
- **Zone ID:** bbc142d2d661d64011e2e4becae7a5c3
- **API Token:** (Read from `access/CLOUDFLARE-CREDENTIALS.md` or use existing)

### MongoDB
- **Connection String:** (From `access/DATABASE-CREDENTIALS.md`)
- **Database Name:** `time_attendance`

### Identity Provider
- **Issuer URL:** https://auth.seemplifyai.com
- **Client ID:** `time-attendance`
- **Client Secret:** (Generate in Identity Provider)

---

## ✅ Checklist

### Pre-Deployment
- [ ] Create backend Dockerfile
- [ ] Create frontend Dockerfile
- [ ] Test Docker builds locally
- [ ] Verify environment variables are documented

### Dokploy Setup
- [ ] Create backend application in Dokploy
- [ ] Create frontend application in Dokploy
- [ ] Configure domains in Dokploy
- [ ] Set environment variables in Dokploy
- [ ] Get application IDs from Dokploy

### GitHub Actions
- [ ] Create backend workflow file
- [ ] Create frontend workflow file
- [ ] Set GitHub secrets (APP_IDs)
- [ ] Test workflow syntax

### Cloudflare
- [ ] Create DNS record for `api-time.seemplifyai.com`
- [ ] Create DNS record for `time.seemplifyai.com`
- [ ] Verify DNS propagation

### Identity Provider
- [ ] Add OIDC client for time-attendance
- [ ] Configure redirect URIs
- [ ] Get client secret

### Deployment
- [ ] Deploy backend to Dokploy
- [ ] Verify backend health endpoint
- [ ] Deploy frontend to Dokploy
- [ ] Verify frontend loads
- [ ] Test OIDC authentication flow

### Verification
- [ ] Test auto-deployment (push to GitHub)
- [ ] Verify SSL certificates are issued
- [ ] Test all API endpoints
- [ ] Test frontend functionality
- [ ] Verify logs in Dokploy

---

## 🚨 Troubleshooting

### Common Issues

1. **Docker Build Fails:**
   - Check Dockerfile syntax
   - Verify package.json exists
   - Check build logs in Dokploy

2. **Domain Not Resolving:**
   - Verify DNS records in Cloudflare
   - Check DNS propagation (can take up to 24 hours)
   - Verify Traefik configuration in Dokploy

3. **SSL Certificate Not Issued:**
   - Wait 5-10 minutes for Let's Encrypt
   - Check Traefik logs in Dokploy
   - Verify domain DNS is correct

4. **OIDC Authentication Fails:**
   - Verify redirect URIs match exactly
   - Check client ID and secret
   - Verify IDP issuer URL is correct

5. **GitHub Actions Fails:**
   - Check secrets are set correctly
   - Verify APP_IDs are correct
   - Check Dokploy API token is valid

---

## 📚 References

- **Performance App Deployment:** `.github/workflows/deploy-performance-backend.yml`
- **Dokploy Deployment Guide:** `approver/DOKPLOY-DEPLOYMENT-GUIDE.md`
- **GitHub Actions Setup:** `GITHUB-ACTIONS-AUTO-DEPLOY.md`
- **Deploy Server Skill:** `.cursor/skills/deploy-server/SKILL.md`

---

## 🎯 Next Steps

1. ✅ Study complete
2. ⏳ Create Dockerfiles
3. ⏳ Create GitHub Actions workflows
4. ⏳ Configure Dokploy applications
5. ⏳ Configure Cloudflare DNS
6. ⏳ Set up GitHub secrets
7. ⏳ Deploy and verify

---

**Plan Complete! Ready for implementation.**
