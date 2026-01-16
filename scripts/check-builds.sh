#!/bin/bash
echo "=== All Docker Containers ==="
docker ps -a --format 'table {{.Names}}\t{{.Status}}'

echo ""
echo "=== Docker Images ==="
docker images | head -20

echo ""
echo "=== Recent Dokploy Logs (errors/deployments) ==="
DOKPLOY_CONTAINER=$(docker ps -qf name=dokploy.1)
docker logs $DOKPLOY_CONTAINER 2>&1 | tail -200 | grep -i -E "(error|fail|deploy|build|clone|git)" | tail -50
