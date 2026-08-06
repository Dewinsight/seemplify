# Recruiter Dokploy Build Fix Summary

**Date:** February 27, 2026

## What Was Fixed

### 1. Backend: `lstat .../recruiter/backend/recruiter: no such file or directory`
- **Cause:** `smarthr-ecosystem: "file:.."` in `recruiter/backend/package.json` created a symlink to parent dir, confusing Docker build.
- **Fix:** Removed `smarthr-ecosystem` dependency from `recruiter/backend/package.json`.
- **Action:** Run `npm install` in recruiter/backend (already done).

### 2. Frontend: `cannot create .../recruiter/frontend/recruiter/frontend/.env: Directory nonexistent`
- **Cause:** Dokploy `createEnvFile=true` writes .env to a doubled path.
- **Fix:** Set `createEnvFile = false` for recruiter-backend and recruiter-frontend in Dokploy DB.
- **Action:** Applied via `scripts/fix-recruiter-createenvfile.sql` on server.

### 3. Build Paths
- **Status:** Already correct: `./recruiter/backend` and `./recruiter/frontend` (same format as leave-backend).
- **Verified:** `scripts/fix-recruiter-paths-v2.sql` was run.

## Environment Variables (Dokploy)

**recruiter-backend** and **recruiter-backend-dev** need:

| Variable | Required | Notes |
|----------|----------|-------|
| `PINECONE_API_KEY` | Yes | From recruiter/backend/.env or Pinecone console |
| `PINECONE_PROJECT_ID` | Yes | From recruiter/backend/.env or Pinecone console |

Add these in Dokploy UI: Application → Settings → Environment Variables.

## Redeploy

1. Commit and push the package.json change:
   ```bash
   git add recruiter/backend/package.json recruiter/backend/package-lock.json
   git commit -m "fix: remove smarthr-ecosystem to fix Docker build"
   git push origin main
   ```

2. Trigger deploy via Dokploy UI or GitHub Actions (auto on push).

3. Or manually:
   ```bash
   curl -X POST "http://4.180.153.209:3000/api/application.deploy" \
     -H "x-api-key: <DOKPLOY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"applicationId": "tPMolDg5OEdQUBZ4MKMFh"}'   # backend
   
   curl -X POST "http://4.180.153.209:3000/api/application.deploy" \
     -H "x-api-key: <DOKPLOY_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"applicationId": "k_p-9M7ZWEhSSf_0JusGs"}'   # frontend
   ```

## Files Changed

- `recruiter/backend/package.json` – removed smarthr-ecosystem
- `recruiter/backend/package-lock.json` – updated by npm install
- `scripts/fix-recruiter-createenvfile.sql` – new (run on server)
- `access/DOKPLOY-DEV-APPS-SETUP-GUIDE.md` – added Pinecone env vars note
