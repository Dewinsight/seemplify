# Rocket.Chat for Seemplify

Rocket.Chat is pulled into the Seemplify project via this folder (Docker Compose from [RocketChat/rocketchat-compose](https://github.com/RocketChat/rocketchat-compose)). It is connected to the Seemplify Identity Provider (OIDC) so members show automatically when they log in with Seemplify.

<!-- Auto-deploy test - 2026-01-30 -->

## Quick start (local)

```bash
cp .env.example .env
# Edit .env: ROOT_URL=http://localhost:3000, HOST_PORT=3000
# Optional: set Brevo SMTP (same as IDP) – BREVO_SMTP_PASS from access/BREVO-CONFIGURATION.md, BREVO_FROM_* from Identityprovider/.env
docker compose up -d
# Open http://localhost:3000 and complete setup wizard (create first admin).
```

## Deploy to Dokploy

1. **Create app in Dokploy**
   - Project: e.g. `seemplify`  
   - Application type: **Docker Compose**  
   - Connect repo: this repo; path `rocket-chat` (or upload `docker-compose.yml` + `.env`)  
   - **Env:** Set `ROOT_URL`, and Brevo SMTP (same as IDP): copy `BREVO_SMTP_*` and `BREVO_FROM_*` from `Identityprovider/.env` and `access/BREVO-CONFIGURATION.md` (SMTP Key = `BREVO_SMTP_PASS`).  
   - Build/Deploy so Rocket.Chat and MongoDB start.

2. **DNS**
   - Add A record: `chat.seemplifyai.com` → `4.180.153.209` (or your Dokploy server).  
   - Use Cloudflare proxy if desired.

3. **GitHub Actions**
   - Workflow `deploy-rocket-chat.yml` triggers on push to `rocket-chat/**` or manual run.  
   - Secrets: `DOKPLOY_URL`, `DOKPLOY_TOKEN`, `ROCKET_CHAT_APP_ID` (Dokploy application ID).  
   - See [DEPLOY-DOKPLOY.md](./DEPLOY-DOKPLOY.md) and `access/GITHUB-SECRETS-SETUP-GUIDE.md`; add `ROCKET_CHAT_APP_ID` after creating the app in Dokploy.

## OIDC: Seemplify Identity Provider (members automatically)

Rocket.Chat does not pull a full member list from OIDC; **members appear when they log in**. First login creates the user in Rocket.Chat (name, username, email from OIDC). No extra sync job is required.

### 1. IDP (already done in this repo)

- **Identityprovider** has an OIDC client `rocket-chat` in `clients.json` with redirect URIs for `https://chat.seemplifyai.com/*` and dev.
- **Hub** lists Rocket.Chat in `hubApps.js` so the app appears on the Seemplify hub; users launch chat from there.

### 2. Rocket.Chat: Add Custom OAuth (one-time in admin UI)

After Rocket.Chat is running:

1. Log in as admin → **Administration** (⋮) → **Workspace** → **Settings** → **OAuth**.
2. **Add Custom OAuth** (e.g. name: `Seemplify`).
3. Refresh the OAuth page and select **Seemplify**.
4. Enable it and set:

| Field | Value |
|-------|--------|
| **URL** | `https://auth.seemplifyai.com` (or your IDP base URL) |
| **Token Path** | `/token` |
| **Identity Path** | `/me` (or `/userinfo` if your IDP uses that) |
| **Authorize Path** | `/auth` |
| **Scope** | `openid email profile offline_access` |
| **Token sent via** | Header |
| **Identity Token Sent Via** | Same as Token |
| **Id** | `rocket-chat` (must match `client_id` in Identityprovider `clients.json`) |
| **Secret** | (client secret for `rocket-chat` from `Identityprovider/clients.json`) |
| **Button Text** | `Login with Seemplify` |

5. **Valid Redirect URI** (on IDP side) is already set to `https://chat.seemplifyai.com/_oauth/seemplify` (or `/_oauth/<name>` where &lt;name&gt; is the Custom OAuth name you chose).
6. Save and **Refresh OAuth Services**.

Discovery URL (optional): if Rocket.Chat supports discovery, you can use `https://auth.seemplifyai.com/.well-known/openid-configuration` and only override what’s needed.

### 3. Optional: map IDP groups to Rocket.Chat channels

To auto-add users to channels by group (like Keycloak group mapping):

- In your IDP, ensure the OIDC userinfo includes a claim for groups (e.g. `groups` or `organizations`).
- In Rocket.Chat OAuth settings for Seemplify:
  - **Roles/Groups field for channel mapping**: claim name that contains groups (e.g. `groups`).
  - **Map Roles/Groups to channels**: Enable.
  - **OAuth Group Channel Map**: JSON mapping, e.g. `{"Managers": "managers-channel"}`.

Then users in that IDP group get added to the corresponding Rocket.Chat room on login.

## Summary

- **Install**: Rocket.Chat is “pulled in” via this `rocket-chat/` folder (Compose + config).
- **Publish**: Deploy with Dokploy (Compose app) and optional GitHub workflow; DNS `chat.seemplifyai.com`.
- **Identity Provider hub**: Rocket.Chat is added in `Identityprovider` (`clients.json` + `hubApps.js`).
- **Members from OIDC**: Users appear automatically on first “Login with Seemplify”; optional group→channel mapping for auto-rooms.
- **Email**: Brevo SMTP using the same credentials as the IDP (IDP env + `access/BREVO-CONFIGURATION.md`).
