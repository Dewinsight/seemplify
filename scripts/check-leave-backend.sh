#!/bin/bash
echo "=== leave-backend containers ==="
docker ps -a --format 'table {{.Names}}\t{{.Status}}' | grep leave-backend | head -5

echo ""
echo "=== leave-backend logs ==="
CONTAINER=$(docker ps -a --format '{{.Names}}' | grep leave-backend | head -1)
echo "Container: $CONTAINER"
docker logs "$CONTAINER" 2>&1 | tail -50
