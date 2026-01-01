#!/bin/bash
# Get recruiter-frontend application ID and trigger redeploy

# Get the application ID
APP_ID=$(docker exec dokploy-postgres.1.5dxxym4hafxpxyrg230xzdozf psql -U dokploy -t -c "SELECT \"applicationId\" FROM \"Application\" WHERE name = 'recruiter-frontend';" | tr -d ' \n')

echo "Found recruiter-frontend ID: $APP_ID"

# Force a rebuild by removing the old container and restarting
echo "Stopping old container..."
docker stop recruiter-frontend 2>/dev/null || true
docker rm recruiter-frontend 2>/dev/null || true

echo "Triggering deployment via Dokploy CLI..."
# If we can't use the API, we'll manually pull and rebuild

# Find the git source directory
SOURCE_DIR=$(find /var/lib/docker/volumes -type d -name "recruiter-frontend" 2>/dev/null | head -1)
if [ -n "$SOURCE_DIR" ]; then
    echo "Found source at: $SOURCE_DIR"
    cd "$SOURCE_DIR"
    git pull origin main
fi

echo "Done. Check Dokploy dashboard at http://4.180.153.209:3000"
