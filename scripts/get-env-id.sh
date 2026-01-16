#!/bin/bash
POSTGRES=$(docker ps --format '{{.Names}}' | grep postgres | head -1)
docker exec $POSTGRES psql -U dokploy -d dokploy -t -c 'SELECT "environmentId", name FROM environment LIMIT 5;'
