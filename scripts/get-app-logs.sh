#!/bin/bash
echo "=== Running Containers ==="
docker ps --format 'table {{.Names}}\t{{.Status}}'

echo ""
echo "=== leave-backend logs ==="
CONTAINER=$(docker ps -a --format '{{.Names}}' | grep leave-backend | head -1)
if [ -n "$CONTAINER" ]; then
    docker logs $CONTAINER 2>&1 | tail -30
fi

echo ""
echo "=== identity-provider logs ==="
CONTAINER=$(docker ps -a --format '{{.Names}}' | grep identity-provider | grep -v Created | head -1)
if [ -n "$CONTAINER" ]; then
    docker logs $CONTAINER 2>&1 | tail -30
fi

echo ""
echo "=== recruiter-backend logs ==="
CONTAINER=$(docker ps -a --format '{{.Names}}' | grep recruiter-backend | grep -v Created | head -1)
if [ -n "$CONTAINER" ]; then
    docker logs $CONTAINER 2>&1 | tail -30
fi
