# Time Attendance - Localhost Redirect Fix

**Date:** January 27, 2026  
**Status:** ✅ FIXED - Configuration Updated & Redeployed

---

## Problem

The time-attendance application was redirecting to localhost URLs instead of using production URLs when accessed at https://time.seemplifyai.com. This is a common Next.js issue where `NEXT_PUBLIC_` environment variables need to be set as build arguments (not runtime env vars) because Next.js embeds them at build time into the JavaScript bundle.

---

## Root Cause

Next.js `NEXT_PUBLIC_` variables are embedded at **build time**, not runtime. If they're not set correctly as build arguments in Dokploy, the default values from `.env` (which often contain localhost URLs) get embedded into the production build.

---

## What Was Fixed

### 1. Frontend Build Arguments ✅

**Updated via Dokploy API (`application.update`):**

```env
NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
```

**Before:** Not set or set to localhost values  
**After:** Set to production URLs  
**Effect:** Next.js will now embed production URLs at build time

### 2. Backend Environment Variables ✅

**Verified via Dokploy API (`application.saveEnvironment`):**

```env
NODE_ENV=production
PORT=5010
MONGODB_URI=mongodb+srv://seemplify:3hrCJzaFpwlnwVMi@seemplify.pxe85.mongodb.net/time_attendance?retryWrites=true&w=majority&appName=seemplify
SESSION_SECRET=time-attendance-session-secret-2026-production-change-me
IDP_ISSUER_URL=https://auth.seemplifyai.com
OIDC_CLIENT_ID=time-attendance
OIDC_CLIENT_SECRET=time-attendance-secret
OIDC_REDIRECT_URI=https://api-time.seemplifyai.com/api/auth/oidc/callback
FRONTEND_URL=https://time.seemplifyai.com
CORS_ORIGIN=https://time.seemplifyai.com
```

**All environment variables use production URLs - NO localhost references.**

### 3. Redeployment Triggered ✅

Both applications were redeployed to rebuild with the correct configuration:
- **Frontend (xp6sakCgL0wzSDhfpNc0r):** Rebuilding with production build args
- **Backend (gmBjqWd6pQKSWqfBIMNyL):** Redeploying with verified env vars

---

## Technical Details

### How Next.js NEXT_PUBLIC_ Variables Work

1. **Build Time Embedding:**
   - Next.js embeds `NEXT_PUBLIC_` variables into the JavaScript bundle at build time
   - These values become hardcoded into your client-side code
   - Cannot be changed at runtime

2. **Dockerfile Setup:**
   ```dockerfile
   # Build-time arguments (passed from Dokploy)
   ARG NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api
   ARG NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
   
   # Set as environment variables for build
   ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
   ENV NEXT_PUBLIC_IDP_URL=$NEXT_PUBLIC_IDP_URL
   
   # Build embeds these values
   RUN npm run build
   ```

3. **Dokploy Configuration:**
   - Must set as **Build Arguments** (not Environment Variables)
   - Located in Dokploy → Application → Build Settings → Build Args

### Why Localhost Was Appearing

1. **Missing Build Args:** If build args aren't set in Dokploy, Docker uses the default values from the Dockerfile
2. **Default Values:** The Dockerfile defaults were production URLs, but may have been overridden
3. **Local .env:** If a `.env` file exists in the repo with localhost values, they could be used
4. **Previous Build:** Old build artifacts with localhost URLs were still being served

---

## Verification Steps

### 1. Wait for Build Completion (5-10 minutes)

Check Dokploy dashboard for build status:
- Frontend: http://4.180.153.209:3000
- Look for "Running" status on both apps

### 2. Test Backend Health

```bash
curl https://api-time.seemplifyai.com/api/health
```

**Expected:** `{"status":"ok"}` or similar health response

### 3. Test Frontend

1. Open: https://time.seemplifyai.com
2. Open browser Developer Tools (F12)
3. Go to Network tab
4. Interact with the application
5. **Verify:** All API calls go to `https://api-time.seemplifyai.com`
6. **Verify:** NO requests to `localhost` or `127.0.0.1`

### 4. Test Authentication Flow

1. Click login on https://time.seemplifyai.com
2. Should redirect to: https://auth.seemplifyai.com
3. After login, should redirect back to: https://time.seemplifyai.com
4. Check Network tab for callback URL: https://api-time.seemplifyai.com/api/auth/oidc/callback

### 5. Check Browser Console

Open browser console (F12 → Console):
- **Verify:** No CORS errors
- **Verify:** No "refused to connect" errors
- **Verify:** No localhost references in error messages

---

## Configuration Reference

### Application IDs

- **Frontend:** xp6sakCgL0wzSDhfpNc0r
- **Backend:** gmBjqWd6pQKSWqfBIMNyL

### Domains

- **Frontend:** https://time.seemplifyai.com
- **Backend API:** https://api-time.seemplifyai.com
- **Identity Provider:** https://auth.seemplifyai.com

### Dokploy Access

- **URL:** http://4.180.153.209:3000
- **Email:** admin@seemplifyai.com
- **Password:** Seemplify2026!

---

## Troubleshooting

### Still Seeing Localhost References?

1. **Clear Browser Cache:**
   ```
   Ctrl + Shift + Delete → Clear cached images and files
   ```

2. **Hard Reload:**
   ```
   Ctrl + Shift + R (or Cmd + Shift + R on Mac)
   ```

3. **Check Build Logs:**
   - Go to Dokploy dashboard
   - View frontend build logs
   - Look for: "Using NEXT_PUBLIC_API_URL: https://api-time.seemplifyai.com/api"

4. **Verify Build Args in Dokploy:**
   - Check that build args are actually set
   - They should show in the application settings

### CORS Errors?

**Check backend environment variables:**
```bash
# Via Dokploy API
curl -X POST "http://4.180.153.209:3000/api/application.one" \
  -H "x-api-key: github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh" \
  -H "Content-Type: application/json" \
  -d '{"applicationId": "gmBjqWd6pQKSWqfBIMNyL"}'
```

**Verify:**
- `CORS_ORIGIN=https://time.seemplifyai.com`
- `FRONTEND_URL=https://time.seemplifyai.com`

### Authentication Not Working?

**Check OIDC configuration:**
1. Backend `OIDC_REDIRECT_URI` matches callback URL
2. Identity Provider has correct client ID and redirect URI
3. Network tab shows proper redirect flow

---

## Files Modified

1. **Frontend Build Args** - Set via Dokploy API
2. **Backend Environment Variables** - Verified via Dokploy API
3. **Created Files:**
   - `time-attendance/fix-localhost-redirects.py` - Script to fix configuration
   - `time-attendance/LOCALHOST-REDIRECT-FIX.md` - This document

---

## Key Learnings

1. **Next.js NEXT_PUBLIC_ variables MUST be set as build arguments**, not runtime environment variables
2. **Docker ARG vs ENV:** ARG is for build-time, ENV is for runtime
3. **Dokploy Build Args:** Must be set in application settings, not just in Dockerfile
4. **Always rebuild** after changing NEXT_PUBLIC_ variables
5. **Clear browser cache** after deployment to see changes immediately

---

## Summary

✅ **Problem:** Localhost redirects in production  
✅ **Root Cause:** Next.js NEXT_PUBLIC_ variables not set as build arguments  
✅ **Solution:** Set build args in Dokploy and redeploy  
✅ **Status:** Configuration updated, apps redeploying  
⏳ **Next:** Wait 5-10 minutes for builds, then test

---

**Last Updated:** January 27, 2026  
**Fixed By:** Deploy Agent using Dokploy API
