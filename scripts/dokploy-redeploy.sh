#!/bin/bash
# Login to Dokploy and trigger recruiter-frontend redeploy

set -e

echo "=== Logging into Dokploy ==="
AUTH_RESPONSE=$(curl -s -X POST http://localhost:3000/api/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"json":{"email":"admin@seemplifyai.com","password":"Seemplify2026!"}}')

echo "Auth response: $AUTH_RESPONSE"

# Extract the token from cookies (Dokploy uses cookies for auth)
# Instead, let's use session-based auth

echo ""
echo "=== Getting application list ==="
APPS=$(curl -s http://localhost:3000/api/trpc/application.all \
  -H "Content-Type: application/json" \
  -b ~/.dokploy_cookies)

echo "Apps: $APPS" | head -c 500

# Get recruiter-frontend app ID from database
POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)
APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"applicationId\" FROM application WHERE name = 'recruiter-frontend';")

echo ""
echo "=== Recruiter Frontend App ID: $APP_ID ==="

# Try to deploy using the API
echo ""
echo "=== Triggering deployment ==="
DEPLOY_RESPONSE=$(curl -s -X POST "http://localhost:3000/api/trpc/application.deploy?batch=1" \
  -H "Content-Type: application/json" \
  -d "{\"0\":{\"json\":{\"applicationId\":\"$APP_ID\"}}}")

echo "Deploy response: $DEPLOY_RESPONSE"

echo ""
echo "=== Alternative: Manual Rebuild ==="
echo "You can also rebuild manually via the Dokploy dashboard:"
echo "1. Go to http://4.180.153.209:3000"
echo "2. Login with admin@seemplifyai.com / Seemplify2026!"
echo "3. Find recruiter-frontend"
echo "4. Click Deploy"
