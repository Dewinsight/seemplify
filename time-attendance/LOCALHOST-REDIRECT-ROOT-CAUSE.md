# Time-Attendance Localhost Redirect - Root Cause Analysis

## Problem
The time-attendance app at https://time.seemplifyai.com was redirecting to localhost URLs even after multiple attempted fixes.

## Root Cause
**TWO separate `.env` files with localhost URLs were being copied into Docker builds:**

### 1. Frontend `.env.local`
- Located at: `time-attendance/frontend/.env.local`
- Contained:
  ```
  NEXT_PUBLIC_API_URL=http://localhost:5010/api
  NEXT_PUBLIC_IDP_URL=http://localhost:4000
  ```
- **Impact**: Next.js bakes `NEXT_PUBLIC_*` variables into JavaScript bundles at build time, so even though the Dockerfile set production ARGs, the `.env.local` file took precedence.

### 2. Backend `.env`
- Located at: `time-attendance/backend/.env`
- Contained:
  ```
  FRONTEND_URL=http://localhost:5011
  IDP_ISSUER_URL=http://localhost:4000
  OIDC_REDIRECT_URI=http://localhost:5010/api/auth/oidc/callback
  ```
- **Impact**: The `OIDC_REDIRECT_URI` with localhost caused authentication redirects to fail with chrome-error pages.

## Why Previous Fixes Didn't Work
1. **Dockerfile ENV variables were overridden**: Even though the Dockerfiles set correct production URLs, the `.env` files took precedence.
2. **No `.dockerignore` files**: Both frontend and backend lacked `.dockerignore` files, so `.env` files were copied into Docker builds.
3. **Dockerfile cleanup too late**: Frontend Dockerfile tried to remove `.env` files on line 23, but AFTER they were copied on line 20, possibly after Next.js had already loaded them.

## The Fix

### Frontend Fix (Commit: e5d76b2)
1. Created `time-attendance/frontend/.dockerignore`:
   ```
   node_modules
   .next
   .env.local
   .env.development
   .env.test
   npm-debug.log
   .DS_Store
   *.log
   .git
   .gitignore
   README.md
   ```

2. Deleted `time-attendance/frontend/.env.local` from repo

3. Result: Frontend now uses only Dockerfile ARGs:
   - `NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api`
   - `NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com`

### Backend Fix (Commit: 9bda3f1)
1. Created `time-attendance/backend/.dockerignore`:
   ```
   node_modules
   .env
   .env.local
   .env.development
   .env.test
   npm-debug.log
   .DS_Store
   *.log
   .git
   .gitignore
   README.md
   test
   tests
   *.test.js
   coverage
   ```

2. Deleted `time-attendance/backend/.env` from repo

3. **CRITICAL**: Backend now REQUIRES environment variables to be set in Dokploy:
   - `NODE_ENV=production`
   - `PORT=5010`
   - `MONGODB_URI=mongodb+srv://...` (from credentials)
   - `SESSION_SECRET=<secure-random-string>`
   - `FRONTEND_URL=https://time.seemplifyai.com`
   - `IDP_ISSUER_URL=https://auth.seemplifyai.com`
   - `OIDC_CLIENT_ID=time-attendance`
   - `OIDC_CLIENT_SECRET=time-attendance-secret`
   - `OIDC_REDIRECT_URI=https://api-time.seemplifyai.com/api/auth/oidc/callback`

## Verification Steps

### 1. Frontend Test (PASSED ✅)
```bash
# Test 1: Navigate to https://time.seemplifyai.com
# Expected: Page loads without localhost redirect
# Result: ✅ Page loads correctly

# Test 2: Check browser console
# Expected: No localhost URLs in console messages or network requests
# Result: ✅ Clean console, no localhost references
```

### 2. Backend Test (PENDING ⏳)
```bash
# Test 1: Click "Login with Identity Provider"
# Expected: Redirects to auth.seemplifyai.com
# Current: Gets chrome-error page (backend env vars not set)

# Test 2: Complete authentication flow
# Expected: Successfully redirects back to time.seemplifyai.com
# Status: BLOCKED by missing Dokploy env vars
```

## Next Steps (REQUIRED)

### Configure Dokploy Backend Environment Variables
The backend deployment will fail or not work correctly until environment variables are set in Dokploy.

**How to set:**
1. Login to Dokploy at http://4.180.153.209:3000
2. Navigate to time-attendance-backend app
3. Go to Environment Variables section
4. Add all required variables listed above
5. Trigger a redeploy

**Alternative:** Use Dokploy API or dokploy.json to set environment variables programmatically.

## GitHub Actions Deployments

### Frontend Deployment
- Workflow: `.github/workflows/deploy-time-attendance-frontend.yml`
- Status: ✅ Completed successfully
- Run ID: 21406860082
- Triggered by: Commit e5d76b2

### Backend Deployment
- Workflow: `.github/workflows/deploy-time-attendance-backend.yml`
- Status: ⏳ In Progress
- Run ID: 21406994561
- Triggered by: Commit 9bda3f1

## Lessons Learned

1. **Always create `.dockerignore` files** to explicitly exclude dev configuration files
2. **Never commit `.env` files** - they should only exist locally for development
3. **Next.js environment variables** are baked in at build time, so build-time configuration is critical
4. **Test with hard refresh** (Ctrl+F5) to ensure browser cache is cleared
5. **Check BOTH frontend AND backend** configuration when debugging full-stack apps
6. **Use browser dev tools** to inspect actual network requests and console logs

## Files Modified

### Created:
- `time-attendance/frontend/.dockerignore`
- `time-attendance/backend/.dockerignore`
- `time-attendance/LOCALHOST-REDIRECT-ROOT-CAUSE.md` (this file)

### Deleted:
- `time-attendance/frontend/.env.local`
- `time-attendance/backend/.env`

### Commits:
- Frontend: e5d76b2 - "Fix time-attendance localhost redirect by excluding .env.local from Docker builds"
- Backend: 9bda3f1 - "Fix time-attendance backend localhost URLs by excluding .env from Docker builds"

---

**Date**: 2026-01-27
**Issue**: Localhost redirect at https://time.seemplifyai.com
**Resolution**: Remove .env files from Docker builds via .dockerignore
**Status**: Frontend ✅ Fixed | Backend ⏳ Pending Dokploy env var configuration
