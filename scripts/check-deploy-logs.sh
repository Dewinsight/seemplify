#!/bin/bash
# Get full Dokploy deployment logs
DOKPLOY_CONTAINER=$(docker ps -qf name=dokploy.1)

echo "=== Last 300 lines of Dokploy logs ==="
docker logs $DOKPLOY_CONTAINER 2>&1 | tail -300

echo ""
echo "=== Check if any app containers exist ==="
docker ps -a | grep -E "(recruiter|leave|performance|payroll|identity)" || echo "No app containers found"

echo ""
echo "=== Check Docker images ==="
docker images | grep -E "(recruiter|leave|performance|payroll|identity)" || echo "No app images found"
