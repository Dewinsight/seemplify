#!/bin/bash
# Force deploy recruiter-frontend by directly using Dokploy's internal mechanisms

echo "=== Getting application details ==="
POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)
APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"applicationId\" FROM application WHERE name = 'recruiter-frontend';")
APP_NAME=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"appName\" FROM application WHERE name = 'recruiter-frontend';")
GIT_URL=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"customGitUrl\" FROM application WHERE name = 'recruiter-frontend';")
GIT_BRANCH=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"customGitBranch\" FROM application WHERE name = 'recruiter-frontend';")
BUILD_PATH=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"buildPath\" FROM application WHERE name = 'recruiter-frontend';")

echo "App ID: $APP_ID"
echo "App Name: $APP_NAME"
echo "Git URL: $GIT_URL"
echo "Git Branch: $GIT_BRANCH"
echo "Build Path: $BUILD_PATH"
echo ""

# Find Dokploy main container
DOKPLOY_CONTAINER=$(docker ps --filter "name=dokploy.1" --format "{{.Names}}" | grep -v postgres | grep -v traefik | head -1)
echo "Dokploy container: $DOKPLOY_CONTAINER"
echo ""

# Try to use Dokploy's CLI if available
echo "=== Attempting direct container restart approach ==="

# Stop existing service
FRONTEND_CONTAINER=$(docker ps --filter "name=recruiter-frontend" --format "{{.Names}}" | head -1)
echo "Current frontend container: $FRONTEND_CONTAINER"

# Get the swarm service name
SERVICE_NAME=$(docker service ls --format "{{.Name}}" | grep recruiter-frontend | head -1)
echo "Service name: $SERVICE_NAME"

if [ -n "$SERVICE_NAME" ]; then
    echo "Forcing service update to pull latest..."
    docker service update --force $SERVICE_NAME
fi

echo ""
echo "=== Done! ==="
echo "Check the container in a minute: docker ps | grep recruiter-frontend"
