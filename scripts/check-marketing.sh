#!/bin/bash
echo "=== Marketing Site Container Status ==="
docker ps -a --format 'table {{.Names}}\t{{.Status}}' | grep -E "(marketing|NAME)"

echo ""
echo "=== Marketing Site Logs ==="
CONTAINER=$(docker ps -a --format '{{.Names}}' | grep marketing | head -1)
if [ -n "$CONTAINER" ]; then
    docker logs "$CONTAINER" 2>&1 | tail -50
else
    echo "No container found - build may still be in progress"
fi

echo ""
echo "=== Build folders ==="
ls -la /etc/dokploy/applications/ | grep marketing || echo "No marketing app folder yet"
