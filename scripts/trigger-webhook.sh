#!/bin/bash
# Trigger Dokploy deployment using the application's refresh token (webhook)

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

# Get the refresh token for recruiter-frontend
REFRESH_TOKEN=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"refreshToken\" FROM application WHERE name = 'recruiter-frontend';")

echo "Refresh Token: $REFRESH_TOKEN"
echo ""

# Dokploy uses refresh tokens for webhook-based deployments
echo "=== Triggering deployment via webhook ==="
curl -v -X POST "http://localhost:3000/api/deploy?refreshToken=$REFRESH_TOKEN" \
  -H "Content-Type: application/json"

echo ""
echo ""

# Also try the alternative webhook format
echo "=== Trying alternative webhook format ==="
curl -v -X POST "http://localhost:3000/api/webhook?refreshToken=$REFRESH_TOKEN" \
  -H "Content-Type: application/json"

echo ""
echo "=== Check Dokploy dashboard for deployment status ==="
