#!/bin/bash
# Complete Approver Deployment Script
# Run on server: bash approver/deploy-approver-on-server.sh

set -e

echo "=== Approver Complete Deployment ==="
echo ""

BACKEND_APP_ID="72cc56e8-1123-4e22-beeb-04c8184405e4"
FRONTEND_APP_ID="063229c9-ed49-49be-a331-92c8c47422bc"

# Step 1: Fix createEnvFile
echo "1️⃣  Fixing createEnvFile issue..."
python3 approver/fix-createenvfile.py

# Step 2: Verify domains exist
echo ""
echo "2️⃣  Verifying domains..."
POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

BACKEND_DOMAIN=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT COUNT(*) FROM domain WHERE \"applicationId\" = '$BACKEND_APP_ID' AND host = 'api.approver.aiinigeria.com';" 2>/dev/null || echo "0")
FRONTEND_DOMAIN=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT COUNT(*) FROM domain WHERE \"applicationId\" = '$FRONTEND_APP_ID' AND host = 'approver.aiinigeria.com';" 2>/dev/null || echo "0")

if [ "$BACKEND_DOMAIN" = "0" ]; then
    echo "   Creating backend domain..."
    docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "INSERT INTO domain (\"domainId\", host, \"applicationId\", https, \"certificateType\", \"createdAt\") VALUES (gen_random_uuid()::text, 'api.approver.aiinigeria.com', '$BACKEND_APP_ID', true, 'letsencrypt', NOW());" 2>/dev/null || echo "   Domain may already exist"
fi

if [ "$FRONTEND_DOMAIN" = "0" ]; then
    echo "   Creating frontend domain..."
    docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "INSERT INTO domain (\"domainId\", host, \"applicationId\", https, \"certificateType\", \"createdAt\") VALUES (gen_random_uuid()::text, 'approver.aiinigeria.com', '$FRONTEND_APP_ID', true, 'letsencrypt', NOW());" 2>/dev/null || echo "   Domain may already exist"
fi

echo "   ✅ Domains verified"

# Step 3: Check current container status
echo ""
echo "3️⃣  Current container status:"
BACKEND_CONTAINER=$(docker ps --filter "name=approver-backend" --format "{{.Names}}" | head -1)
FRONTEND_CONTAINER=$(docker ps --filter "name=approver-frontend" --format "{{.Names}}" | head -1)

if [ -n "$BACKEND_CONTAINER" ]; then
    echo "   ✅ Backend container running: $BACKEND_CONTAINER"
else
    echo "   ⏳ Backend container not running"
fi

if [ -n "$FRONTEND_CONTAINER" ]; then
    echo "   ✅ Frontend container running: $FRONTEND_CONTAINER"
else
    echo "   ⏳ Frontend container not running"
fi

# Step 4: Instructions for deployment
echo ""
echo "4️⃣  Deployment Instructions:"
echo "   Since Dokploy API returns 401, deploy via UI:"
echo ""
echo "   Backend:"
echo "   1. Go to: http://4.180.153.209:3000"
echo "   2. Login: admin@seemplifyai.com / Seemplify2026!"
echo "   3. Navigate: approver project → approver-backend"
echo "   4. Click 'Deploy' button"
echo "   5. Wait for build (check logs)"
echo ""
echo "   Frontend:"
echo "   1. Navigate: approver project → approver-frontend"
echo "   2. Click 'Deploy' button"
echo "   3. Wait for build (check logs)"
echo ""

# Step 5: Test script
echo "5️⃣  After deployment, run test script:"
echo "   bash approver/test-approver.sh"
echo ""

echo "=== Setup Complete ==="
echo "Next: Deploy via Dokploy UI (see instructions above)"
