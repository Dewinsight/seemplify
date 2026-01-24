#!/bin/bash
# Trigger recruiter-backend deployment

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)
APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"applicationId\" FROM application WHERE name = 'recruiter-backend' LIMIT 1;")

echo "Application ID: $APP_ID"

# Get API key from database
API_KEY=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT key FROM apikey WHERE enabled = true LIMIT 1;")

if [ -z "$API_KEY" ]; then
  echo "No API key found. Please create one in Dokploy dashboard first."
  exit 1
fi

echo "Triggering deployment..."
curl -s -X POST "http://localhost:3000/api/application.deploy" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"applicationId\": \"$APP_ID\"}"

echo ""
echo "Deployment triggered!"
