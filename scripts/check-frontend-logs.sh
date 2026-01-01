#!/bin/bash
echo "=== recruiter-frontend logs ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep recruiter-frontend | head -1)
echo "Container: $CONTAINER"
docker logs "$CONTAINER" 2>&1 | tail -30

echo ""
echo "=== payroll-frontend logs ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep payroll-frontend | head -1)
echo "Container: $CONTAINER"
docker logs "$CONTAINER" 2>&1 | tail -30

echo ""
echo "=== performance-frontend logs ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep performance-frontend | head -1)
echo "Container: $CONTAINER"
docker logs "$CONTAINER" 2>&1 | tail -30
