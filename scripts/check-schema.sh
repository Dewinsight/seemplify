#!/bin/bash
# Check user table schema
POSTGRES_CONTAINER=$(docker ps -qf name=dokploy-postgres)
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user' ORDER BY ordinal_position;"
