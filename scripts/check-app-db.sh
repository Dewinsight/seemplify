#!/bin/bash
POSTGRES=$(docker ps --format '{{.Names}}' | grep postgres | head -1)
docker exec $POSTGRES psql -U dokploy -d dokploy -t -c "SELECT \"applicationId\", name, \"sourceType\", repository, branch, \"buildPath\", \"applicationStatus\" FROM application WHERE name LIKE '%marketing%';"
