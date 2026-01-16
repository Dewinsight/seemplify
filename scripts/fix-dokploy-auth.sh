#!/bin/bash
# Fix Dokploy authentication for deployments

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)
USER_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT id FROM \"user\" LIMIT 1;")
APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"applicationId\" FROM application WHERE name = 'recruiter-frontend';")

# Get existing key from database
EXISTING_KEY=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT key FROM apikey WHERE name = 'github-actions';")

echo "User ID: $USER_ID"
echo "App ID: $APP_ID"
echo "Existing key (hashed): $EXISTING_KEY"
echo ""

# Test with Bearer token format
echo "=== Testing with Bearer format ==="
curl -s -X POST "http://localhost:3000/api/trpc/application.deploy?batch=1" \
  -H "Authorization: Bearer $EXISTING_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"0\":{\"json\":{\"applicationId\":\"$APP_ID\"}}}"
echo ""

# Generate a new unhashed key and insert it
echo ""
echo "=== Creating new API key ==="
NEW_KEY=$(openssl rand -hex 32)
KEY_ID=$(cat /proc/sys/kernel/random/uuid)

# Delete old key and insert new one
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "DELETE FROM apikey WHERE name = 'github-actions';"
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "INSERT INTO apikey (id, name, key, user_id, enabled, created_at, updated_at) VALUES ('$KEY_ID', 'github-actions', '$NEW_KEY', '$USER_ID', true, NOW(), NOW());"

echo "New key created: $NEW_KEY"
echo ""

# Test with new key
echo "=== Testing new key with Bearer format ==="
RESULT=$(curl -s -X POST "http://localhost:3000/api/trpc/application.deploy?batch=1" \
  -H "Authorization: Bearer $NEW_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"0\":{\"json\":{\"applicationId\":\"$APP_ID\"}}}")
echo "$RESULT"

# Check if it worked
if echo "$RESULT" | grep -q "UNAUTHORIZED"; then
  echo ""
  echo "=== Still unauthorized, trying x-api-key header ==="
  curl -s -X POST "http://localhost:3000/api/trpc/application.deploy?batch=1" \
    -H "x-api-key: $NEW_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"0\":{\"json\":{\"applicationId\":\"$APP_ID\"}}}"
fi

echo ""
echo ""
echo "=============================="
echo "NEW DOKPLOY_TOKEN: $NEW_KEY"
echo "=============================="
echo "Run this on your local machine:"
echo "gh secret set DOKPLOY_TOKEN --body \"$NEW_KEY\""
