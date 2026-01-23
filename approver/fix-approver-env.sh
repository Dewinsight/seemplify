#!/bin/bash
# Fix createEnvFile for approver apps - Run this on server
# Usage: bash fix-approver-env.sh

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

if [ -z "$POSTGRES_CONTAINER" ]; then
    echo "Error: Postgres container not found"
    exit 1
fi

echo "Fixing createEnvFile for approver apps..."
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "UPDATE application SET \"createEnvFile\" = false WHERE \"applicationId\" IN ('72cc56e8-1123-4e22-beeb-04c8184405e4', '063229c9-ed49-49be-a331-92c8c47422bc');"

echo "✅ Fixed! Now redeploy in Dokploy UI"
