#!/bin/bash
echo "=== Traefik Configuration ==="
docker exec dokploy-traefik cat /etc/traefik/dynamic/applications.yml 2>/dev/null | head -100

echo ""
echo "=== Traefik Logs (last 50 lines) ==="
docker logs dokploy-traefik 2>&1 | tail -50
