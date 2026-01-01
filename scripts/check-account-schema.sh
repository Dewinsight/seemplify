#!/bin/bash
# Check account table schema
POSTGRES_CONTAINER=$(docker ps -qf name=dokploy-postgres)
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'account' ORDER BY ordinal_position;"
