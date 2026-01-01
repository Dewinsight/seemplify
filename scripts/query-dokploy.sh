#!/bin/bash
# Query Dokploy database and redeploy recruiter-frontend

POSTGRES_CONTAINER="dokploy-postgres.1.5dxxym4hafxpxyrg230xzdozf"

# List tables
echo "=== Tables in Dokploy DB ==="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"

# Get application info
echo ""
echo "=== Applications ==="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT * FROM application LIMIT 10;" 2>/dev/null || \
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
