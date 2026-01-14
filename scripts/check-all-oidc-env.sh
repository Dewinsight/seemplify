#!/bin/bash

echo "=== Checking OIDC Configuration for All Dev Services ==="
echo ""

for svc in identity-provider-dev leave-backend-dev recruiter-backend-dev performance-backend-dev payroll-backend-dev; do
    echo "=== $svc ==="
    CONTAINER=$(docker ps -qf name=$svc | head -1)
    
    if [ -n "$CONTAINER" ]; then
        echo "OIDC_CLIENT_ID: $(docker exec $CONTAINER env 2>/dev/null | grep OIDC_CLIENT_ID || echo 'NOT SET')"
        echo "OIDC_CLIENT_SECRET: $(docker exec $CONTAINER env 2>/dev/null | grep OIDC_CLIENT_SECRET || echo 'NOT SET')"
        echo "IDP_ISSUER_URL: $(docker exec $CONTAINER env 2>/dev/null | grep IDP_ISSUER_URL || echo 'NOT SET')"
    else
        echo "Container not found"
    fi
    echo ""
done

echo "=== Identity Provider clients.json ==="
CONTAINER=$(docker ps -qf name=identity-provider-dev | head -1)
if [ -n "$CONTAINER" ]; then
    docker exec $CONTAINER cat /app/clients.json 2>/dev/null | grep -A1 '"client_id"'
fi
