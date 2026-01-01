#!/bin/bash
# Create a properly hashed API key for Dokploy

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)
USER_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT id FROM \"user\" LIMIT 1;")
APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"applicationId\" FROM application WHERE name = 'recruiter-frontend';")

# Generate a new random API key (this is what we'll use for API calls)
PLAIN_KEY=$(openssl rand -hex 32)

# Hash it with SHA-256 (this is what gets stored in the database)
HASHED_KEY=$(echo -n "$PLAIN_KEY" | sha256sum | awk '{print $1}')

KEY_ID=$(cat /proc/sys/kernel/random/uuid)

echo "Plain API Key (USE THIS): $PLAIN_KEY"
echo "Hashed Key (stored in DB): $HASHED_KEY"
echo ""

# Delete old key and insert new one with hash
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "DELETE FROM apikey WHERE name = 'github-actions';"
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "INSERT INTO apikey (id, name, key, user_id, enabled, created_at, updated_at) VALUES ('$KEY_ID', 'github-actions', '$HASHED_KEY', '$USER_ID', true, NOW(), NOW());"

echo "Key inserted into database"
echo ""

# Test with the PLAIN key (Dokploy will hash it and compare to stored hash)
echo "=== Testing deployment with plain key ==="
RESULT=$(curl -s -X POST "http://localhost:3000/api/trpc/application.deploy?batch=1" \
  -H "Authorization: Bearer $PLAIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"0\":{\"json\":{\"applicationId\":\"$APP_ID\"}}}")
echo "$RESULT"

if echo "$RESULT" | grep -q "UNAUTHORIZED"; then
  echo ""
  echo "=== Trying x-api-key header ==="
  RESULT2=$(curl -s -X POST "http://localhost:3000/api/trpc/application.deploy?batch=1" \
    -H "x-api-key: $PLAIN_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"0\":{\"json\":{\"applicationId\":\"$APP_ID\"}}}")
  echo "$RESULT2"
fi

echo ""
echo "========================================"
echo "YOUR NEW DOKPLOY_TOKEN: $PLAIN_KEY"
echo "========================================"
