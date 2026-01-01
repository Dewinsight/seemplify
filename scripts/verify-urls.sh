#!/bin/bash
echo "=== Checking Recruiter Frontend for URLs ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep recruiter-frontend | head -1)
echo "Container: $CONTAINER"

echo ""
echo "Azure URL count:"
docker exec $CONTAINER sh -c 'grep -r azurewebsites .next/ 2>/dev/null | wc -l'

echo ""
echo "seemplifyai URL count:"
docker exec $CONTAINER sh -c 'grep -r seemplifyai .next/ 2>/dev/null | wc -l'

echo ""
echo "api.seemplifyai.com URL count:"
docker exec $CONTAINER sh -c 'grep -r api.seemplifyai .next/ 2>/dev/null | wc -l'

echo ""
echo "=== Checking Identity Provider clients.json ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep identity-provider | head -1)
docker exec $CONTAINER cat /app/clients.json 2>/dev/null | grep -E "(redirect_uri|allowed_origins)" | head -10
