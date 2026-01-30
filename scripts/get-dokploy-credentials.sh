#!/bin/bash
# Script to retrieve Dokploy credentials and tokens

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

if [ -z "$POSTGRES_CONTAINER" ]; then
    echo "❌ Dokploy PostgreSQL container not found"
    exit 1
fi

echo "=========================================="
echo "Dokploy API Keys (Enabled)"
echo "=========================================="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT id, name, key, enabled, created_at FROM apikey WHERE enabled = true ORDER BY created_at DESC;"

echo ""
echo "=========================================="
echo "All Applications with IDs"
echo "=========================================="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT \"applicationId\", name, \"appName\", \"sourceType\", repository, branch FROM application ORDER BY name;"

echo ""
echo "=========================================="
echo "Projects"
echo "=========================================="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT \"projectId\", name FROM project ORDER BY name;"
