#!/bin/bash
# Quick fix for approver .env deployment error
# Run this on the server via SSH

echo "=== Fixing Approver createEnvFile Issue ==="
echo ""

# Get postgres container
POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

if [ -z "$POSTGRES_CONTAINER" ]; then
    echo "❌ Error: Dokploy postgres container not found"
    exit 1
fi

echo "Found postgres container: $POSTGRES_CONTAINER"
echo ""

BACKEND_APP_ID="72cc56e8-1123-4e22-beeb-04c8184405e4"
FRONTEND_APP_ID="063229c9-ed49-49be-a331-92c8c47422bc"

# Fix backend
echo "Fixing approver-backend..."
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "UPDATE application SET \"createEnvFile\" = false WHERE \"applicationId\" = '$BACKEND_APP_ID';" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ approver-backend: createEnvFile = false"
else
    echo "❌ Failed to update approver-backend"
fi

# Fix frontend
echo "Fixing approver-frontend..."
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "UPDATE application SET \"createEnvFile\" = false WHERE \"applicationId\" = '$FRONTEND_APP_ID';" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ approver-frontend: createEnvFile = false"
else
    echo "❌ Failed to update approver-frontend"
fi

echo ""
echo "=== Fix Complete ==="
echo "Now redeploy approver-backend and approver-frontend in Dokploy UI"
echo "The .env error should be resolved."
