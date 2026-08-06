# Deploy Coturn (STUN/TURN) + TURN Credentials API on Seemplify

This guide covers deploying Coturn and the TURN credentials API via Docker, Traefik, Cloudflare, and Dokploy on the Seemplify server (UDP/WebRTC/Mediasoup support).

---

## Overview

| Component        | Purpose |
|-----------------|--------|
| **Coturn**      | STUN/TURN server for WebRTC (Mediasoup, etc.). Listens on UDP/TCP 3478 and relay ports. |
| **turn-api**    | HTTP API that returns time-limited TURN credentials (`GET /api/turn-credentials`). |
| **Domain**      | `turn.seemplifyai.com` — API over HTTPS (Traefik); TURN traffic **DNS-only** (no proxy). |

---

## 1. Prerequisites

- Server: `4.180.153.209` (Seemplify VM)
- Dokploy: `http://4.180.153.209:3000`
- Cloudflare zone: `seemplifyai.com` (Zone ID in `access/CLOUDFLARE-CREDENTIALS.md` or `CLOUD-INFRASTRUCTURE.md`)
- Traefik and `dokploy-network` already set up

---

## 2. Firewall (UDP / TURN)

TURN needs **UDP** and **TCP** open. Ensure:

### Azure NSG (Inbound)

- **UDP 3478** — TURN
- **TCP 3478** — TURN over TCP
- **UDP 49152–49252** — TURN relay (range in `turnserver.conf`)

Example (Azure CLI):

```bash
az network nsg rule create --resource-group <RG> --nsg-name seemplify-vm-nsg \
  --name AllowTURN --priority 1040 --destination-port-ranges 3478 \
  --access Allow --protocol Udp --direction Inbound

az network nsg rule create --resource-group <RG> --nsg-name seemplify-vm-nsg \
  --name AllowTURNTCP --priority 1050 --destination-port-ranges 3478 \
  --access Allow --protocol Tcp --direction Inbound

# Relay range (adjust min/max if you change turnserver.conf)
az network nsg rule create --resource-group <RG> --nsg-name seemplify-vm-nsg \
  --name AllowTURNRelay --priority 1060 --destination-port-ranges 49152-49252 \
  --access Allow --protocol Udp --direction Inbound
```

### UFW on server

```bash
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 49152:49252/udp
sudo ufw reload
```

---

## 3. Cloudflare DNS

TURN **must not** be proxied (Cloudflare does not proxy UDP).

Create **one A record** for the TURN hostname, **proxied = false**:

| Type | Name | Content        | Proxy | TTL  |
|------|------|----------------|-------|------|
| A    | turn | 4.180.153.209  | **Off** (DNS only) | 3600 |

- **turn.seemplifyai.com** → used for:
  - **HTTPS**: Traefik routes to `turn-api` (credentials).
  - **UDP/TCP 3478**: Clients use the same hostname; DNS resolves to server IP so TURN works.

Using Cloudflare API (token from `access/CLOUDFLARE-CREDENTIALS.md`):

```bash
ZONE_ID="bbc142d2d661d64011e2e4becae7a5c3"
# Create A record, proxied=false for TURN
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "turn",
    "content": "4.180.153.209",
    "ttl": 3600,
    "proxied": false
  }'
```

---

## 4. Environment variables

In `coturn/` create `.env` (do not commit):

```env
TURN_AUTH_SECRET=<openssl rand -hex 32>
COTURN_EXTERNAL_IP=4.180.153.209
TURN_HOST=turn.seemplifyai.com
TURN_PORT=3478
TURN_TTL=86400
```

Use the **same** `TURN_AUTH_SECRET` in both Coturn (via entrypoint) and turn-api.

---

## 5. Deploy in Dokploy

### Option A: Docker Compose app in Dokploy

1. **Create application**
   - Dashboard → Create → **Docker Compose**.
   - Name: `coturn` (or `coturn-seemplify`).

2. **Compose**
   - Use the contents of `coturn/docker-compose.yml`.
   - Ensure build context for `turn-api` is `coturn/turn-api` (or set build path to `coturn` and context `./turn-api`).

3. **Environment**
   - Add the same variables as in `.env` (or paste from `.env` in Dokploy env UI).

4. **Domains (turn-api)**
   - Add domain: `turn.seemplifyai.com`.
   - Enable HTTPS (Let’s Encrypt). Traefik will use the labels on `turn-api` if Dokploy applies them.

5. **Deploy**
   - Deploy the stack. Coturn runs with `network_mode: host`; turn-api runs on `dokploy-network` and is exposed by Traefik.

### Option B: Server SSH + docker compose

```bash
ssh seemplify@4.180.153.209
cd /path/to/seemplify/coturn
cp .env.example .env
# Edit .env: TURN_AUTH_SECRET, COTURN_EXTERNAL_IP
docker compose up -d
```

---

## 6. Traefik

If Dokploy attaches the compose labels to the `turn-api` service, Traefik will:

- Route `Host(`turn.seemplifyai.com`)` (HTTP and HTTPS) to `turn-api:3000`.
- Issue TLS via Let’s Encrypt (certResolver: letsencrypt).

If you manage Traefik with static config, you can use `traefik-coturn-api.yml` as reference (adjust server URL if needed).

---

## 7. Verify

### TURN API (credentials)

```bash
curl -s https://turn.seemplifyai.com/api/turn-credentials | jq
```

Expected shape: `{ "urls", "username", "credential", "ttl" }`.

### Health

```bash
curl -s https://turn.seemplifyai.com/api/health
# {"status":"ok","service":"turn-api"}
```

### Coturn (from server)

```bash
ssh seemplify@4.180.153.209
docker logs coturn --tail 20
# Optional: test with turnutils_stunclient turn.seemplifyai.com
```

---

## 8. Client usage (WebRTC / Mediasoup)

1. **Fetch credentials**: `GET https://turn.seemplifyai.com/api/turn-credentials`.
2. **ICE servers**:
   - `urls`: e.g. `turn:turn.seemplifyai.com:3478?transport=udp`, `turn:turn.seemplifyai.com:3478?transport=tcp`.
   - `username` / `credential`: from the API (time-limited).
3. Use these in your WebRTC/Mediasoup ICE config.

---

## 9. Files in this repo

| File | Purpose |
|------|--------|
| `docker-compose.yml` | Coturn (host network) + turn-api (Traefik labels). |
| `turnserver.conf` | Coturn config (realm, ports, use-auth-secret, relay range). |
| `entrypoint.sh` | Injects `TURN_AUTH_SECRET` and `COTURN_EXTERNAL_IP` into config. |
| `turn-api/` | Node app for `/api/turn-credentials` and `/api/health`. |
| `.env.example` | Template for `.env`. |
| `traefik-coturn-api.yml` | Optional static Traefik config for turn-api. |

---

## 10. Troubleshooting

- **TURN not working from clients**: Ensure DNS for `turn.seemplifyai.com` is **not proxied** (Cloudflare), and Azure NSG + UFW allow UDP 3478 and UDP 49152–49252.
- **Credentials rejected**: Ensure `TURN_AUTH_SECRET` is identical for Coturn and turn-api, and Coturn is started after entrypoint injects the secret.
- **API 502**: Check that turn-api is on `dokploy-network`, Traefik can reach it, and domain in Traefik matches `turn.seemplifyai.com`.
