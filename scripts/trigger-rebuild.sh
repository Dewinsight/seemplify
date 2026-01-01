#!/bin/bash
# Trigger a full rebuild of recruiter-frontend via Dokploy API

POSTGRES_CONTAINER="dokploy-postgres.1.5dxxym4hafxpxyrg230xzdozf"

# Get the recruiter-frontend application ID
echo "Getting recruiter-frontend application ID..."
APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"applicationId\" FROM \"application\" WHERE name = 'recruiter-frontend' LIMIT 1;" 2>/dev/null)

if [ -z "$APP_ID" ]; then
    echo "Trying lowercase table..."
    APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT applicationid FROM application WHERE name = 'recruiter-frontend' LIMIT 1;" 2>/dev/null)
fi

if [ -z "$APP_ID" ]; then
    echo "Trying to list all tables..."
    docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
    exit 1
fi

echo "Found application ID: $APP_ID"

# Now trigger the deployment
echo "Triggering deployment..."
# The Dokploy API typically runs on port 3000
curl -X POST "http://localhost:3000/api/trpc/application.deploy?batch=1" \
    -H "Content-Type: application/json" \
    -d "{\"0\":{\"json\":{\"applicationId\":\"$APP_ID\"}}}" \
    2>/dev/null

echo ""
echo "Deployment triggered! Check the Dokploy dashboard for progress."
