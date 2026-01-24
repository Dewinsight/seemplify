# Make Approver Visible in Dokploy UI

**Update (Jan 2026):** Option A was run successfully. The **approver** project is now in Dokploy. Refresh the UI at http://4.180.153.209:3000 — you should see project **approver** with app **approver**. Set `APPROVER_APP_ID` in GitHub to `9e7b7b2a-e8ba-4eac-8e2e-28216ee621cf`.

---

The approver **project** was never created in a way that shows in the Dokploy UI. Use one of these:

---

## Option A: Run the script on the server (creates project "approver")

**Run on the server** (where `dokploy-postgres` runs), not on your PC:

```bash
# 1) Copy the script to the server
scp approver/create-approver-in-dokploy.py seemplify@4.180.153.209:/tmp/

# 2) SSH in and run it
ssh seemplify@4.180.153.209 "python3 /tmp/create-approver-in-dokploy.py"
```

This creates:

- **Project** "approver" (with `organizationId` so it appears in the UI)
- **Environment** "production" under it
- **Application** "approver" (Git: `https://github.com/michaelegbo/seemplify.git`, branch `main`, build path `./approver/backend`, Dockerfile `./approver/backend/Dockerfile`)
- **Domain** `approver.aiinigeria.com`

After it finishes, **refresh the Dokploy UI** – you should see project **approver** with app **approver**.

Note the **Application ID** from the script output and set `APPROVER_APP_ID` in GitHub secrets to that value.

---

## Option B: Create the app manually in the Dokploy UI

Add the approver **application** under the existing **seemplify** project (you will see it under **seemplify > production > approver**):

1. Open **http://4.180.153.209:3000** and log in.
2. Open project **seemplify** → environment **production**.
3. **Add application** (or equivalent).
4. Use:

   | Field | Value |
   |-------|-------|
   | Name | `approver` |
   | Source | Git / Custom Git URL |
   | Git URL | `https://github.com/michaelegbo/seemplify.git` |
   | Branch | `main` |
   | Build path | `./approver/backend` or `approver/backend` |
   | Dockerfile | `./approver/backend/Dockerfile` or `approver/backend/Dockerfile` |
   | Port | `80` |

5. Add **domain** `approver.aiinigeria.com` with HTTPS (Let’s Encrypt).
6. In the app’s **Environment** section, set:
   - `NODE_ENV=production`
   - `PORT=80`
   - `MONGO_URI=<your-mongodb-connection-string>`
   - `FRONTEND_URL=https://approver.aiinigeria.com`
7. Copy the **Application ID** from the app’s URL or settings and set `APPROVER_APP_ID` in GitHub secrets.

---

## Option C: API script (only if your API key can create apps)

The script `approver/create-approver-via-dokploy-api.ps1` adds the **application** under **seemplify > production**. It needs an API key that is allowed to call `application.create` (not only `application.deploy`). On many setups that returns 401; if it works for you:

```powershell
$env:DOKPLOY_URL='http://4.180.153.209:3000'
$env:DOKPLOY_TOKEN='<your-api-key>'
.\approver\create-approver-via-dokploy-api.ps1
```

---

## After the app exists

1. Set **GitHub secret** `APPROVER_APP_ID` to the approver **application ID**.
2. In Dokploy, set the **environment variables** (including `MONGO_URI`).
3. Run a **deploy** (Deploy in Dokploy or push to `main` to trigger GitHub Actions).
