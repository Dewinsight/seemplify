#!/bin/bash
set -e

DOKPLOY_URL="http://localhost:3000"
POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

echo "=========================================="
echo "Deploying Approver to Dokploy"
echo "=========================================="

# Step 1: Create API Key
echo "Step 1: Creating API key..."
NEW_KEY=$(openssl rand -hex 32)
USER_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT id FROM \"user\" LIMIT 1;")
KEY_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)

docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "INSERT INTO apikey (id, name, key, user_id, enabled, created_at, updated_at) VALUES ('$KEY_ID', 'approver-deployment-key', '$NEW_KEY', '$USER_ID', true, NOW(), NOW());" > /dev/null 2>&1

echo "✅ API Key created: $NEW_KEY"

# Step 2: Get Project ID
echo ""
echo "Step 2: Getting project ID..."
PROJECT_RESPONSE=$(curl -s -X GET "$DOKPLOY_URL/api/project.all" -H "x-api-key: $NEW_KEY")
PROJECT_ID=$(echo "$PROJECT_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(echo "$PROJECT_RESPONSE" | grep -o '"projectId":"[^"]*' | head -1 | cut -d'"' -f4)
fi

if [ -z "$PROJECT_ID" ]; then
  echo "⚠️  Could not get project ID, trying default..."
  PROJECT_ID="jSrhrIiOyn0eH02aRSIFY"
fi

echo "✅ Project ID: $PROJECT_ID"

# Step 3: Create Application
echo ""
echo "Step 3: Creating application..."
CREATE_RESPONSE=$(curl -s -X POST "$DOKPLOY_URL/api/application.create" \
  -H "x-api-key: $NEW_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"approver\",
    \"appName\": \"approver\",
    \"description\": \"Approver Application\",
    \"projectId\": \"$PROJECT_ID\",
    \"sourceType\": \"github\",
    \"repository\": \"YOUR_GITHUB_USERNAME/seemplify\",
    \"branch\": \"main\",
    \"buildPath\": \"backend/\",
    \"dockerfile\": \"Dockerfile\"
  }")

echo "Response: $CREATE_RESPONSE"

APP_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$APP_ID" ]; then
  APP_ID=$(echo "$CREATE_RESPONSE" | grep -o '"applicationId":"[^"]*' | head -1 | cut -d'"' -f4)
fi

if [ -z "$APP_ID" ]; then
  echo "❌ Failed to create application. Response: $CREATE_RESPONSE"
  exit 1
fi

echo "✅ Application created! ID: $APP_ID"

# Step 4: Add Domain
echo ""
echo "Step 4: Adding domain approver.aiinigeria.com..."
DOMAIN_RESPONSE=$(curl -s -X POST "$DOKPLOY_URL/api/domain.create" \
  -H "x-api-key: $NEW_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"applicationId\": \"$APP_ID\",
    \"domain\": \"approver.aiinigeria.com\",
    \"https\": true
  }")

echo "Domain response: $DOMAIN_RESPONSE"
echo "✅ Domain added"

# Step 5: Deploy
echo ""
echo "Step 5: Deploying application..."
DEPLOY_RESPONSE=$(curl -s -X POST "$DOKPLOY_URL/api/application.deploy" \
  -H "x-api-key: $NEW_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"applicationId\": \"$APP_ID\"}")

echo "Deploy response: $DEPLOY_RESPONSE"
echo "✅ Deployment triggered!"

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "API Key: $NEW_KEY"
echo "Application ID: $APP_ID"
echo ""
echo "Next: Set GitHub secrets:"
echo "  gh secret set DOKPLOY_TOKEN --body \"$NEW_KEY\""
echo "  gh secret set APPROVER_APP_ID --body \"$APP_ID\""
echo "  gh secret set DOKPLOY_URL --body \"http://4.180.153.209:3000\""
echo ""
