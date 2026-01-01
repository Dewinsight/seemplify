#!/bin/bash
POSTGRES_CONTAINER=$(docker ps -qf name=dokploy-postgres)
echo "=== USER TABLE ==="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT id, email, role, \"isRegistered\" FROM public.\"user\";"

echo ""
echo "=== MEMBER TABLE (if exists) ==="  
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT * FROM public.member LIMIT 5;" 2>/dev/null || echo "No members"

echo ""
echo "=== ORGANIZATION TABLE ==="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT * FROM public.organization LIMIT 5;" 2>/dev/null || echo "No orgs"
