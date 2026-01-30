#!/bin/bash
# Fix Dokploy API key authentication issue
# This script creates a new API key and tests it

POSTGRES_CONTAINER="dokploy-postgres.1.5dxxym4hafxpxyrg230xzdozf"
DOKPLOY_URL="http://localhost:3000"

echo "=== Fixing Dokploy API Key ==="
echo ""

# Get user ID
USER_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT id FROM \"user\" LIMIT 1;")
echo "User ID: $USER_ID"

# Generate a new secure API key
NEW_KEY=$(openssl rand -hex 32)
KEY_ID=$(cat /proc/sys/kernel/random/uuid)

echo ""
echo "=== Creating New API Key ==="
echo "Key Name: github-actions-fixed"
echo "Key ID: $KEY_ID"
echo "New Key: $NEW_KEY"
echo ""

# Delete old github-actions key and create new one
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "DELETE FROM apikey WHERE name = 'github-actions-fixed';" 2>/dev/null || true

docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
INSERT INTO apikey (id, name, key, user_id, enabled, created_at, updated_at)
VALUES ('$KEY_ID', 'github-actions-fixed', '$NEW_KEY', '$USER_ID', true, NOW(), NOW());
"

echo "✅ New API key created in database"
echo ""

# Test the new key
echo "=== Testing New API Key ==="
APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"applicationId\" FROM application WHERE name LIKE '%recruiter-frontend%' LIMIT 1;")

if [ -z "$APP_ID" ]; then
    echo "⚠️  Could not find application ID for testing"
else
    echo "Testing with Application ID: $APP_ID"
    
    # Test with x-api-key header
    RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$DOKPLOY_URL/api/application.deploy" \
      -H "x-api-key: $NEW_KEY" \
      -H "Content-Type: application/json" \
      -H "accept: application/json" \
      -d "{\"applicationId\": \"$APP_ID\"}")
    
    HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE")
    
    echo "HTTP Status: $HTTP_CODE"
    echo "Response: $BODY"
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        echo ""
        echo "✅ SUCCESS! API key is working"
        echo ""
        echo "=========================================="
        echo "NEW API KEY FOR GITHUB SECRETS:"
        echo "=========================================="
        echo "$NEW_KEY"
        echo "=========================================="
    else
        echo ""
        echo "❌ API key test failed. HTTP Code: $HTTP_CODE"
        echo "Response: $BODY"
    fi
fi

echo ""
echo "=== Next Steps ==="
echo "1. Update GitHub secret DOKPLOY_TOKEN with the new key above"
echo "2. Test deployment via GitHub Actions"
echo ""
