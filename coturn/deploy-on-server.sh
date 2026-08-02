#!/bin/bash
set -e
# Run on server: UFW for TURN, then deploy coturn + turn-api

# UFW (TURN ports)
sudo ufw allow 3478/udp 2>/dev/null || true
sudo ufw allow 3478/tcp 2>/dev/null || true
sudo ufw allow 49152:49252/udp 2>/dev/null || true
sudo ufw reload 2>/dev/null || true

# Repo path (adjust if seemplify is elsewhere)
SEEMPLIFY="${SEEMPLIFY:-$HOME/seemplify}"
COTURN="$SEEMPLIFY/coturn"
if [ ! -d "$COTURN" ]; then
  echo "Clone seemplify repo first or set SEEMPLIFY"
  exit 1
fi
cd "$COTURN"

# Generate secret if .env missing or empty TURN_AUTH_SECRET
if [ ! -f .env ] || ! grep -q '^TURN_AUTH_SECRET=.\+' .env; then
  SECRET=$(openssl rand -hex 32)
  echo "TURN_AUTH_SECRET=$SECRET" > .env
  echo "COTURN_EXTERNAL_IP=4.180.153.209" >> .env
  echo "TURN_HOST=turn.seemplifyai.com" >> .env
  echo "TURN_PORT=3478" >> .env
  echo "TURN_TTL=86400" >> .env
fi
# Ensure external IP set
grep -q '^COTURN_EXTERNAL_IP=' .env || echo "COTURN_EXTERNAL_IP=4.180.153.209" >> .env

# Ensure dokploy-network exists (create if we're not in Dokploy)
docker network inspect dokploy-network >/dev/null 2>&1 || docker network create dokploy-network 2>/dev/null || true

# Build and up (use ports compose to avoid host network if host mode fails)
docker compose -f docker-compose.ports.yml build --no-cache turn-api 2>/dev/null || docker compose build --no-cache turn-api 2>/dev/null || true
docker compose -f docker-compose.ports.yml up -d 2>/dev/null || docker compose up -d
echo "Deploy done. Check: docker ps | grep -E coturn|turn-api"
