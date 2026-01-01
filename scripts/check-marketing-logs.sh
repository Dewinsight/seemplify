#!/bin/bash
echo "=== Build Logs Directory ==="
ls -la /etc/dokploy/logs/marketing-site-web-ssx3uh/ 2>/dev/null || echo "No logs dir"

echo ""
echo "=== Latest Build Log ==="
LOG=$(ls -t /etc/dokploy/logs/marketing-site-web-ssx3uh/*.log 2>/dev/null | head -1)
if [ -n "$LOG" ]; then
    cat "$LOG" | tail -100
else
    echo "No logs found"
fi

echo ""
echo "=== Docker Images ==="
docker images | grep marketing

echo ""
echo "=== Application Status ==="
POSTGRES=$(docker ps --format '{{.Names}}' | grep postgres | head -1)
docker exec $POSTGRES psql -U dokploy -d dokploy -t -c "SELECT \"applicationStatus\" FROM application WHERE name = 'marketing-site';"
