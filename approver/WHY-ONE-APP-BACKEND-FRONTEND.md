# Why Approver Deploys Backend + Frontend as One App

## Intended design: one container, both backend and frontend

The approver app is meant to run **backend and frontend in a single Dokploy application**:

- **Backend:** Node/Express API under `/api`, MongoDB, `server.js`.
- **Frontend:** React (Vite) built to `frontend/dist` and served by `server.js` in production (static files + SPA fallback).

The `approver/Dockerfile` (at the `approver/` folder) builds both and produces one image. The `approver/backend/Dockerfile` is for a backend-only context and **cannot** see `approver/frontend/`.

---

## Why you might have seen “only one thing”

Previously, Dokploy was set to:

- **Build path / context:** `./approver/backend`
- **Dockerfile:** `./approver/backend/Dockerfile`

With that, the build context is only `approver/backend/`. The `backend/Dockerfile` does:

```dockerfile
COPY frontend/package*.json ./frontend/
...
COPY frontend/...
```

`frontend/` does **not** exist inside `approver/backend/`; it lives in `approver/frontend/`. So:

- Those `COPY frontend/...` steps fail, **or**
- The build fails and you never get a working image, **or**
- You only get a backend-only image if the Dockerfile was different/simpler.

In any case, with context `./approver/backend`, the frontend cannot be included. That’s why you saw only one “thing” (e.g. only API or only a broken frontend).

---

## Fix: build from `approver/` so both backend and frontend are in context

To include both in one image:

1. **Dockerfile at `approver/Dockerfile`**  
   - Expects build context = `approver/` (parent of `backend/` and `frontend/`).  
   - Uses `COPY backend/...` and `COPY frontend/...`, then builds the frontend and copies `frontend/dist` into the image.

2. **Dokploy must use the `approver/` context and that Dockerfile:**
   - **Build path / context:** `./approver`
   - **Dockerfile:** `./approver/Dockerfile`

Then a single build produces one image with:

- Backend (Node, `server.js`, `/api`, etc.)
- `frontend/dist` served by `server.js` for `/` and non-API routes.

---

## How to apply the fix in Dokploy

**Option A: Run the fix script on the server**

```bash
scp approver/fix-approver-build-context.py seemplify@4.180.153.209:/tmp/
ssh seemplify@4.180.153.209 "python3 /tmp/fix-approver-build-context.py"
```

This updates the `application` row so `buildPath`, `dockerfile`, and `dockerContextPath` point at `./approver` and `./approver/Dockerfile`.

**Option B: Change in Dokploy UI**

1. Open the **approver** application in Dokploy.
2. In **Settings** (or build config):
   - **Build path / Build context:** `./approver`
   - **Dockerfile path:** `./approver/Dockerfile`
3. Save and **Redeploy**.

After that, a new deploy will build both backend and frontend and serve them from one container.
