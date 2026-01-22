#!/bin/bash
# Deploy Approver Application to Dokploy
# This script creates the application, configures it, and sets up GitHub Actions

set -e

DOKPLOY_URL="http://localhost:3000"
DOKPLOY_EMAIL="admin@seemplifyai.com"
DOKPLOY_PASSWORD="Seemplify2026!"
REPO_URL="https://github.com/YOUR_USERNAME/seemplify"
APP_NAME="approver"
DOMAIN="approver.aiinigeria.com"

echo "=========================================="
echo "Deploying Approver to Dokploy"
echo "=========================================="

# Step 1: Login and get session token
echo "Step 1: Logging into Dokploy..."
LOGIN_RESPONSE=$(curl -s -X POST "$DOKPLOY_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DOKPLOY_EMAIL\",\"password\":\"$DOKPLOY_PASSWORD\"}")

echo "Login response: $LOGIN_RESPONSE"

# Extract token (adjust based on actual response format)
# For now, we'll need to create an API key via UI first
echo ""
echo "⚠️  NOTE: You need to create an API key first via Dokploy UI:"
echo "   1. Go to http://4.180.153.209:3000"
echo "   2. Login with admin@seemplifyai.com / Seemplify2026!"
echo "   3. Go to Settings → API Keys"
echo "   4. Create new API key named 'GitHub Actions'"
echo "   5. Copy the API key"
echo ""
read -p "Enter your Dokploy API key: " API_KEY

if [ -z "$API_KEY" ]; then
  echo "❌ API key is required. Exiting."
  exit 1
fi

# Step 2: Create Application
echo ""
echo "Step 2: Creating application..."
CREATE_APP_RESPONSE=$(curl -s -X POST "$DOKPLOY_URL/api/application.create" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$APP_NAME\",
    \"repository\": \"$REPO_URL\",
    \"branch\": \"main\",
    \"rootPath\": \"approver/\",
    \"buildPath\": \"backend/\",
    \"dockerfilePath\": \"backend/Dockerfile\",
    \"port\": 80
  }")

echo "Create app response: $CREATE_APP_RESPONSE"

# Extract Application ID from response
APP_ID=$(echo "$CREATE_APP_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)

if [ -z "$APP_ID" ]; then
  echo "❌ Failed to create application. Response: $CREATE_APP_RESPONSE"
  exit 1
fi

echo "✅ Application created! ID: $APP_ID"

# Step 3: Add Domain
echo ""
echo "Step 3: Adding domain $DOMAIN..."
curl -s -X POST "$DOKPLOY_URL/api/application.update" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"applicationId\": \"$APP_ID\",
    \"domain\": \"$DOMAIN\",
    \"forceHttps\": true
  }" > /dev/null

echo "✅ Domain added: $DOMAIN"

# Step 4: Set Environment Variables
echo ""
echo "Step 4: Setting environment variables..."
curl -s -X POST "$DOKPLOY_URL/api/application.update" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"applicationId\": \"$APP_ID\",
    \"env\": {
      \"NODE_ENV\": \"production\",
      \"PORT\": \"80\",
      \"FRONTEND_URL\": \"https://$DOMAIN\"
    }
  }" > /dev/null

echo "✅ Environment variables set"

# Step 5: Deploy Application
echo ""
echo "Step 5: Deploying application..."
DEPLOY_RESPONSE=$(curl -s -X POST "$DOKPLOY_URL/api/application.deploy" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"applicationId\": \"$APP_ID\"}")

echo "Deploy response: $DEPLOY_RESPONSE"
echo "✅ Deployment triggered!"

# Step 6: Output GitHub Secrets Commands
echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Application ID: $APP_ID"
echo "Domain: https://$DOMAIN"
echo ""
echo "Next: Set up GitHub secrets with these commands:"
echo ""
echo "gh secret set DOKPLOY_URL --body \"http://4.180.153.209:3000\""
echo "gh secret set DOKPLOY_TOKEN --body \"$API_KEY\""
echo "gh secret set APPROVER_APP_ID --body \"$APP_ID\""
echo ""
echo "Then commit and push to trigger auto-deploy:"
echo "  git add ."
echo "  git commit -m 'feat: deploy approver to dokploy'"
echo "  git push origin main"
echo ""
