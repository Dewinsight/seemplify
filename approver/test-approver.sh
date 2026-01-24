#!/bin/bash
# Test script for approver backend and frontend
# Run this after deployment and DNS propagation

echo "=== Approver Deployment Tests ==="
echo ""

BACKEND_URL="https://api.approver.aiinigeria.com"
FRONTEND_URL="https://approver.aiinigeria.com"

# Test 1: Backend Health
echo "1. Testing backend health endpoint..."
HEALTH=$(curl -s -k "$BACKEND_URL/api/health" 2>&1)
if echo "$HEALTH" | grep -q "ok"; then
    echo "   ✅ Backend health check passed"
    echo "   Response: $HEALTH"
else
    echo "   ❌ Backend health check failed"
    echo "   Response: $HEALTH"
fi
echo ""

# Test 2: Backend Root
echo "2. Testing backend root endpoint..."
ROOT=$(curl -s -k "$BACKEND_URL/" 2>&1)
if echo "$ROOT" | grep -q "Approver Backend API"; then
    echo "   ✅ Backend root endpoint works"
    echo "   Response: $ROOT"
else
    echo "   ❌ Backend root endpoint failed"
    echo "   Response: $ROOT"
fi
echo ""

# Test 3: Seed Admin
echo "3. Seeding admin user..."
SEED=$(curl -s -X POST -k "$BACKEND_URL/api/auth/seed-admin" 2>&1)
if echo "$SEED" | grep -q "admin"; then
    echo "   ✅ Admin seeded successfully"
    echo "   Response: $SEED"
else
    echo "   ⚠️  Seed response: $SEED"
fi
echo ""

# Test 4: Login
echo "4. Testing login..."
LOGIN=$(curl -s -X POST -k "$BACKEND_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@approver.com","password":"password123"}' 2>&1)
if echo "$LOGIN" | grep -q "token"; then
    echo "   ✅ Login successful"
    TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    echo "   Token: ${TOKEN:0:20}..."
else
    echo "   ❌ Login failed"
    echo "   Response: $LOGIN"
fi
echo ""

# Test 5: Frontend
echo "5. Testing frontend..."
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -k "$FRONTEND_URL" 2>&1)
if [ "$FRONTEND_STATUS" = "200" ]; then
    echo "   ✅ Frontend is accessible (HTTP $FRONTEND_STATUS)"
else
    echo "   ❌ Frontend not accessible (HTTP $FRONTEND_STATUS)"
fi
echo ""

echo "=== Test Summary ==="
echo "Backend: $BACKEND_URL"
echo "Frontend: $FRONTEND_URL"
echo ""
echo "Next: Open $FRONTEND_URL in browser and login with:"
echo "  Email: admin@approver.com"
echo "  Password: password123"
