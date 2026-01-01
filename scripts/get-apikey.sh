#!/bin/bash
# Get Dokploy API key

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

echo "=== API Keys in Dokploy ==="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT * FROM apikey;"

echo ""
echo "=== API Key columns ==="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "\d apikey"
