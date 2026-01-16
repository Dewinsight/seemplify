#!/bin/bash
echo "=== Traefik dynamic config files ==="
ls -la /etc/dokploy/traefik/dynamic/

echo ""
echo "=== Application routing config ==="
cat /etc/dokploy/traefik/dynamic/*.yml 2>/dev/null || echo "No yml files"
cat /etc/dokploy/traefik/dynamic/*.yaml 2>/dev/null || echo "No yaml files"

echo ""
echo "=== recruiter-frontend container network ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep recruiter-frontend | head -1)
echo "Container: $CONTAINER"
docker inspect "$CONTAINER" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null

echo ""
echo "=== Test curl to recruiter-frontend directly ==="
docker exec dokploy-traefik wget -q -O - --timeout=5 http://recruiter-frontend-bshr54:3000 2>&1 | head -5 || echo "Direct access failed"
