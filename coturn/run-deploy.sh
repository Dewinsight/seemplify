#!/bin/bash
set -e
cd ~/seemplify/coturn
sed -i 's/npm ci --only=production/npm install --omit=dev/' turn-api/Dockerfile 2>/dev/null || true
if [ ! -f .env ] || ! grep -q '^TURN_AUTH_SECRET=.' .env; then
  SECRET=$(openssl rand -hex 32)
  echo "TURN_AUTH_SECRET=$SECRET" > .env
  echo "COTURN_EXTERNAL_IP=4.180.153.209" >> .env
  echo "TURN_HOST=turn.seemplifyai.com" >> .env
  echo "TURN_PORT=3478" >> .env
  echo "TURN_TTL=86400" >> .env
fi
docker network inspect dokploy-network >/dev/null 2>&1 || docker network create dokploy-network
docker compose -f docker-compose.ports.yml build turn-api
docker compose -f docker-compose.ports.yml up -d
docker ps --format 'table {{.Names}}\t{{.Status}}' | head -20
