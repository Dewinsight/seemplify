#!/bin/bash
echo "=== ALL Container Status ==="
docker ps -a --format 'table {{.Names}}\t{{.Status}}' | head -25

echo ""
echo "=== Detailed recruiter-backend logs ==="
CONTAINER=$(docker ps -a --format '{{.Names}}' | grep recruiter-backend | head -1)
if [ -n "$CONTAINER" ]; then
    echo "Container: $CONTAINER"
    docker logs $CONTAINER 2>&1
else
    echo "No recruiter-backend container found"
fi

echo ""
echo "=== Detailed identity-provider logs ==="
CONTAINER=$(docker ps -a --format '{{.Names}}' | grep identity-provider | head -1)
if [ -n "$CONTAINER" ]; then
    echo "Container: $CONTAINER"
    docker logs $CONTAINER 2>&1
else
    echo "No identity-provider container found"
fi
