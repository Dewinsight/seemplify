#!/bin/bash
# Deploy all dev applications in Dokploy
# Run this on the Azure VM

DOKPLOY_URL="http://localhost:3000"

# Dev Application IDs
APP_IDS=(
    "dev-idp-001-seemplify"
    "dev-rec-be-001-seemp"
    "dev-rec-fe-001-seemp"
    "dev-lv-be-001-seemp"
    "dev-lv-fe-001-seemp"
    "dev-pf-be-001-seemp"
    "dev-pf-fe-001-seemp"
    "dev-py-be-001-seemp"
    "dev-py-fe-001-seemp"
)

APP_NAMES=(
    "identity-provider-dev"
    "recruiter-backend-dev"
    "recruiter-frontend-dev"
    "leave-backend-dev"
    "leave-frontend-dev"
    "performance-backend-dev"
    "performance-frontend-dev"
    "payroll-backend-dev"
    "payroll-frontend-dev"
)

# Login and get session cookie
echo "🔐 Logging into Dokploy..."
LOGIN_RESPONSE=$(curl -s -c /tmp/dokploy_session.txt \
    -X POST "${DOKPLOY_URL}/api/trpc/auth.signIn" \
    -H "Content-Type: application/json" \
    -d '{"json":{"email":"admin@seemplifyai.com","password":"Seemplify2026!"}}')

echo "Login response: $LOGIN_RESPONSE"

# Check if login was successful
if echo "$LOGIN_RESPONSE" | grep -q "error"; then
    echo "❌ Login failed. Trying alternative endpoint..."
    
    # Try the signIn mutation via different path
    LOGIN_RESPONSE=$(curl -s -c /tmp/dokploy_session.txt \
        -X POST "${DOKPLOY_URL}/api/trpc/auth.signIn?batch=1" \
        -H "Content-Type: application/json" \
        -d '{"0":{"json":{"email":"admin@seemplifyai.com","password":"Seemplify2026!"}}}')
    echo "Alt Login response: $LOGIN_RESPONSE"
fi

echo ""
echo "🚀 Deploying dev applications..."
echo ""

# Deploy each application
for i in "${!APP_IDS[@]}"; do
    APP_ID="${APP_IDS[$i]}"
    APP_NAME="${APP_NAMES[$i]}"
    
    echo "📦 Deploying ${APP_NAME} (${APP_ID})..."
    
    RESPONSE=$(curl -s -b /tmp/dokploy_session.txt \
        -X POST "${DOKPLOY_URL}/api/application.deploy" \
        -H "Content-Type: application/json" \
        -d "{\"applicationId\": \"${APP_ID}\"}")
    
    if echo "$RESPONSE" | grep -q "error\|Unauthorized"; then
        # Try tRPC format
        RESPONSE=$(curl -s -b /tmp/dokploy_session.txt \
            -X POST "${DOKPLOY_URL}/api/trpc/application.deploy" \
            -H "Content-Type: application/json" \
            -d "{\"json\":{\"applicationId\": \"${APP_ID}\"}}")
    fi
    
    echo "   Response: $RESPONSE"
    echo ""
done

echo "✅ Deployment triggers complete!"
echo ""
echo "Check Dokploy dashboard at http://4.180.153.209:3000 for deployment status"
