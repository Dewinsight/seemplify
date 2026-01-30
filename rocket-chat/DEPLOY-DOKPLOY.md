# Deploy Rocket.Chat to Dokploy

Use this after you have Dokploy running (e.g. on `4.180.153.209:3000`). Credentials: `access/DOKPLOY-CREDENTIALS.md`.

## 1. Create application in Dokploy

1. Log in to Dokploy: `http://4.180.153.209:3000` (or your Dokploy URL).
2. Create or select a project (e.g. `seemplify`).
3. Create new application:
   - **Type:** Docker Compose (or Git + Compose).
   - **Name:** e.g. `rocket-chat`.
   - **Source:** Connect this repo; set path to `rocket-chat` (or upload `docker-compose.yml` and set env from `.env.example`).
4. Set environment variables (or use `.env`):
   - `ROOT_URL=https://chat.seemplifyai.com`
   - `RELEASE=8.0.1` (or desired version)
5. Deploy. Note the **Application ID** (from URL or settings).

## 2. DNS (Cloudflare)

- **Zone:** seemplifyai.com (Zone ID: `bbc142d2d661d64011e2e4becae7a5c3`).
- Add **A** record:
  - Name: `chat`
  - Content: `4.180.153.209` (or your server IP)
  - Proxy: optional (orange cloud)

Use `access/CLOUDFLARE-CREDENTIALS.md` for API token if automating.

## 3. GitHub Secrets (for deploy workflow)

Add to this repo’s GitHub Actions secrets:

| Secret | Value |
|--------|--------|
| `DOKPLOY_URL` | `http://4.180.153.209:3000` (or your Dokploy URL) |
| `DOKPLOY_TOKEN` | API key from `access/DOKPLOY-CREDENTIALS.md` |
| `ROCKET_CHAT_APP_ID` | Application ID from step 1 |

See `access/GITHUB-SECRETS-SETUP-GUIDE.md` for how to add secrets (CLI or GitHub UI).

## 4. Trigger deploy

- **Automatic:** Push to `main` with changes under `rocket-chat/`.
- **Manual:** Actions → **Deploy Rocket.Chat** → **Run workflow**.

After deploy, configure OAuth in Rocket.Chat (see main [README.md](./README.md#oidc-seemplify-identity-provider-members-automatically)).
