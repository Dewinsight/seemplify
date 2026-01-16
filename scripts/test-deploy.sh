#!/bin/bash
# Test Dokploy deployment with API key

TOKEN="bbbd4d8232d0995cdea5d0dcf66b13353ca0670876fd263e7565e3829f85f43f"

# Get recruiter-frontend app ID
POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)
APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"applicationId\" FROM application WHERE name = 'recruiter-frontend';")

echo "App ID: $APP_ID"
echo "Token: $TOKEN"
echo ""
echo "=== Testing deployment API ==="

curl -v -X POST "http://localhost:3000/api/trpc/application.deploy?batch=1" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $TOKEN" \
  -d "{\"0\":{\"json\":{\"applicationId\":\"$APP_ID\"}}}"

echo ""
echo "=== Deployment triggered! ==="
