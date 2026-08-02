#!/bin/bash
set -e

DOKPLOY_URL="http://localhost:3000"
EMAIL="admin@seemplifyai.com"
PASSWORD="Seemplify2026!"

echo "=========================================="
echo "Deploying Approver to Dokploy (Session Auth)"
echo "=========================================="

# Step 1: Login and get session cookie
echo "Step 1: Logging into Dokploy..."
LOGIN_RESPONSE=$(curl -s -c /tmp/dokploy-cookies.txt -X POST "$DOKPLOY_URL/api/trpc/auth.login" \
  -H "Content-Type: application/json" \
  -d "{\"json\":{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}}")

echo "Login response: $LOGIN_RESPONSE"

# Step 2: Get Project ID
echo ""
echo "Step 2: Getting project ID..."
PROJECT_RESPONSE=$(curl -s -b /tmp/dokploy-cookies.txt "$DOKPLOY_URL/api/trpc/project.all")
PROJECT_ID=$(echo "$PROJECT_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="jSrhrIiOyn0eH02aRSIFY"
fi

echo "✅ Project ID: $PROJECT_ID"

# Step 3: Create Application using tRPC
echo ""
echo "Step 3: Creating application..."
CREATE_RESPONSE=$(curl -s -b /tmp/dokploy-cookies.txt -X POST "$DOKPLOY_URL/api/trpc/application.create?batch=1" \
  -H "Content-Type: application/json" \
  -d "{
    \"0\": {
      \"json\": {
        \"name\": \"approver\",
        \"appName\": \"approver\",
        \"description\": \"Approver Application\",
        \"projectId\": \"$PROJECT_ID\",
        \"sourceType\": \"github\",
        \"repository\": \"YOUR_GITHUB_USERNAME/seemplify\",
        \"branch\": \"main\",
        \"buildPath\": \"backend/\",
        \"dockerfile\": \"Dockerfile\"
      }
    }
  }")

echo "Create response: $CREATE_RESPONSE"

APP_ID=$(echo "$CREATE_RESPONSE" | grep -o '"applicationId":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$APP_ID" ]; then
  APP_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
fi

if [ -z "$APP_ID" ]; then
  echo "❌ Failed to create application. Response: $CREATE_RESPONSE"
  exit 1
fi

echo "✅ Application created! ID: $APP_ID"

# Step 4: Add Domain
echo ""
echo "Step 4: Adding domain approver.aiinigeria.com..."
DOMAIN_RESPONSE=$(curl -s -b /tmp/dokploy-cookies.txt -X POST "$DOKPLOY_URL/api/trpc/domain.create?batch=1" \
  -H "Content-Type: application/json" \
  -d "{
    \"0\": {
      \"json\": {
        \"applicationId\": \"$APP_ID\",
        \"domain\": \"approver.aiinigeria.com\",
        \"https\": true
      }
    }
  }")

echo "Domain response: $DOMAIN_RESPONSE"
echo "✅ Domain added"

# Step 5: Deploy
echo ""
echo "Step 5: Deploying application..."
DEPLOY_RESPONSE=$(curl -s -b /tmp/dokploy-cookies.txt -X POST "$DOKPLOY_URL/api/trpc/application.deploy?batch=1" \
  -H "Content-Type: application/json" \
  -d "{\"0\":{\"json\":{\"applicationId\":\"$APP_ID\"}}}")

echo "Deploy response: $DEPLOY_RESPONSE"
echo "✅ Deployment triggered!"

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Application ID: $APP_ID"
echo ""
echo "Next: Set GitHub secrets (you'll need to create an API key first):"
echo "  1. Go to http://4.180.153.209:3000"
echo "  2. Settings → API Keys → Create new key"
echo "  3. Then run:"
echo "     gh secret set DOKPLOY_TOKEN --body \"<your-api-key>\""
echo "     gh secret set APPROVER_APP_ID --body \"$APP_ID\""
echo "     gh secret set DOKPLOY_URL --body \"http://4.180.153.209:3000\""
echo ""
