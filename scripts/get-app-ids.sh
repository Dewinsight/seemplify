#!/bin/bash
POSTGRES=$(docker ps --format '{{.Names}}' | grep postgres | head -1)
echo "Postgres container: $POSTGRES"
docker exec $POSTGRES psql -U dokploy -d dokploy -t -c 'SELECT "applicationId", name FROM application ORDER BY name;'
