#!/bin/bash
# Check Dokploy application configuration

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

echo "=== Application Details for recruiter-frontend ==="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
SELECT 
    a.\"applicationId\",
    a.name,
    a.\"appName\",
    a.\"sourceType\",
    a.repository,
    a.branch,
    a.\"buildPath\",
    a.\"autoDeploy\"
FROM application a 
WHERE a.name = 'recruiter-frontend';
"
