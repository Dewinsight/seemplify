#!/bin/bash
echo "=== Running Containers ==="
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E "(recruiter|leave|performance|payroll|identity)"

echo ""
echo "=== Recruiter Backend Logs ==="
CONTAINER=$(docker ps -a --format '{{.Names}}' | grep recruiter-backend | head -1)
docker logs $CONTAINER 2>&1 | tail -30

echo ""
echo "=== Identity Provider Logs ==="
CONTAINER=$(docker ps -a --format '{{.Names}}' | grep identity-provider | head -1)
docker logs $CONTAINER 2>&1 | tail -30
