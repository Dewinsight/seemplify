#!/bin/bash
# Update recruiter build paths in Dokploy PostgreSQL - run on server via SSH
POSTGRES=$(docker ps --format '{{.Names}}' | grep -i dokploy-postgres | head -1)
echo "Using Postgres: $POSTGRES"

echo "=== Current recruiter config ==="
docker exec $POSTGRES psql -U dokploy -d dokploy -t -c "
SELECT \"applicationId\", name, \"buildPath\", \"dockerContextPath\", dockerfile, \"buildType\"
FROM application WHERE name LIKE '%recruiter%';
"

echo ""
echo "=== Updating build paths ==="

# recruiter-backend prod
docker exec $POSTGRES psql -U dokploy -d dokploy -c "
UPDATE application SET
  \"buildPath\" = './recruiter/new/backend',
  \"dockerContextPath\" = './recruiter/new/backend',
  dockerfile = './recruiter/new/backend/Dockerfile'
WHERE \"applicationId\" = 'tPMolDg5OEdQUBZ4MKMFh';
" && echo "Updated recruiter-backend"

# recruiter-frontend prod
docker exec $POSTGRES psql -U dokploy -d dokploy -c "
UPDATE application SET
  \"buildPath\" = './recruiter/new/frontend',
  \"dockerContextPath\" = './recruiter/new/frontend',
  dockerfile = './recruiter/new/frontend/Dockerfile'
WHERE \"applicationId\" = 'k_p-9M7ZWEhSSf_0JusGs';
" && echo "Updated recruiter-frontend"

# recruiter-backend-dev
docker exec $POSTGRES psql -U dokploy -d dokploy -c "
UPDATE application SET
  \"buildPath\" = './recruiter/new/backend',
  \"dockerContextPath\" = './recruiter/new/backend',
  dockerfile = './recruiter/new/backend/Dockerfile'
WHERE \"applicationId\" = 'dev-rec-be-001-seemp';
" && echo "Updated recruiter-backend-dev"

# recruiter-frontend-dev (use Dockerfile.dev)
docker exec $POSTGRES psql -U dokploy -d dokploy -c "
UPDATE application SET
  \"buildPath\" = './recruiter/new/frontend',
  \"dockerContextPath\" = './recruiter/new/frontend',
  dockerfile = './recruiter/new/frontend/Dockerfile.dev'
WHERE \"applicationId\" = 'dev-rec-fe-001-seemp';
" && echo "Updated recruiter-frontend-dev"

echo ""
echo "=== Verify ==="
docker exec $POSTGRES psql -U dokploy -d dokploy -t -c "
SELECT name, \"buildPath\", \"dockerContextPath\" FROM application WHERE name LIKE '%recruiter%';
"

echo ""
echo "Done. Trigger deploy via API or push to repo."
