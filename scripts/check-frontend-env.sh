#!/bin/bash
CONTAINER=$(docker ps --format '{{.Names}}' | grep recruiter-frontend | head -1)
echo "Container: $CONTAINER"
echo ""
echo "=== Check env vars in container ==="
docker exec $CONTAINER printenv | grep -E "(NEXT_PUBLIC|API|IDP)" || echo "No matching env vars"

echo ""
echo "=== Check for seemplifyai in built JS ==="
docker exec $CONTAINER sh -c 'grep -r "seemplifyai" .next/static 2>/dev/null | head -5' || echo "Not found"

echo ""
echo "=== Check for localhost in built JS ==="
docker exec $CONTAINER sh -c 'grep -r "localhost:5001" .next/static 2>/dev/null | head -5' || echo "Not found"
