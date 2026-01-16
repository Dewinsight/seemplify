#!/bin/bash
# Check NOT NULL constraints on user table
POSTGRES_CONTAINER=$(docker ps -qf name=dokploy-postgres)
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
SELECT column_name, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'user' 
AND is_nullable = 'NO'
ORDER BY ordinal_position;"
