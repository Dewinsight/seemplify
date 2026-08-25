# Coturn + TURN Credentials API

STUN/TURN server and REST API for WebRTC (Mediasoup, etc.) on Seemplify.

- **Coturn**: TURN/STUN on UDP and TCP 3478, relay ports 49152–49252.
- **turn-api**: `GET /api/turn-credentials` returns time-limited credentials (TURN REST API style).

## Quick start

1. Copy `.env.example` to `.env` and set `TURN_AUTH_SECRET` (e.g. `openssl rand -hex 32`) and `COTURN_EXTERNAL_IP` (server public IP). On a NAT-mapped host, also set `COTURN_RELAY_IP` to its routable local interface address; on a directly addressed VPS it defaults to the public IP.
2. Create DNS: **turn.seemplifyai.com** → A record to server IP with **proxied off** (see `DEPLOY-COTURN-SEEMPLIFY.md` or `setup-cloudflare-dns.ps1`).
3. Open the Hostinger firewall and UFW for UDP 3478, TCP 3478, and UDP 49152–49252.
4. Deploy: use `docker-compose.yml` in Dokploy (Docker Compose app) or run `docker compose up -d` from this directory.

Full steps: **DEPLOY-COTURN-SEEMPLIFY.md**.

## API

- `GET /api/turn-credentials` — returns `{ urls, username, credential, ttl }` for WebRTC ICE config.
- `GET /api/health` — health check.

## Files

| File | Purpose |
|------|--------|
| `docker-compose.yml` | Coturn (host network) + turn-api with Traefik labels. |
| `docker-compose.ports.yml` | Same stack with port mapping instead of host network. |
| `turnserver.conf` | Coturn config. |
| `entrypoint.sh` | Injects auth secret and external IP into config. |
| `turn-api/` | Node.js credentials API. |
| `DEPLOY-COTURN-SEEMPLIFY.md` | Full deploy guide (Traefik, Cloudflare, Dokploy, firewall). |
