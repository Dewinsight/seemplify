#!/bin/bash
# Create a new Dokploy API key directly in the database

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

# Generate a new random key (this will be the actual key to use)
NEW_KEY=$(openssl rand -hex 32)

# Get user ID
USER_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT id FROM \"user\" LIMIT 1;")

echo "User ID: $USER_ID"
echo "New API Key (SAVE THIS): $NEW_KEY"

# Generate a new UUID for the key ID
KEY_ID=$(cat /proc/sys/kernel/random/uuid)

# Insert the new key (Dokploy stores keys unhashed for API keys)
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "INSERT INTO apikey (id, name, key, user_id, enabled, created_at, updated_at) VALUES ('$KEY_ID', 'deployment-key', '$NEW_KEY', '$USER_ID', true, NOW(), NOW());"

echo ""
echo "=== Testing new key ==="
APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"applicationId\" FROM application WHERE name = 'recruiter-frontend';")

curl -s -X POST "http://localhost:3000/api/trpc/application.deploy?batch=1" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $NEW_KEY" \
  -d "{\"0\":{\"json\":{\"applicationId\":\"$APP_ID\"}}}"

echo ""
echo ""
echo "=== NEW API KEY ==="
echo "$NEW_KEY"
echo "================="
