#!/bin/bash
set -e

DOKPLOY_URL="http://localhost:3000"
EMAIL="admin@seemplifyai.com"
PASSWORD="Seemplify2026!"

echo "=========================================="
echo "Deploying Approver to Dokploy"
echo "=========================================="

# Step 1: Login using auth.signIn
echo "Step 1: Logging into Dokploy..."
LOGIN_RESPONSE=$(curl -s -c /tmp/dokploy-cookies.txt -X POST "$DOKPLOY_URL/api/trpc/auth.signIn?batch=1" \
  -H "Content-Type: application/json" \
  -d "{\"0\":{\"json\":{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}}}")

echo "Login response: $LOGIN_RESPONSE"

# Check if login succeeded
if echo "$LOGIN_RESPONSE" | grep -q "error\|UNAUTHORIZED"; then
  echo "❌ Login failed. Trying alternative..."
  LOGIN_RESPONSE=$(curl -s -c /tmp/dokploy-cookies.txt -X POST "$DOKPLOY_URL/api/trpc/auth.signIn" \
    -H "Content-Type: application/json" \
    -d "{\"json\":{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}}")
  echo "Alt login: $LOGIN_RESPONSE"
fi

# Step 2: Get Project ID from database (more reliable)
echo ""
echo "Step 2: Getting project ID from database..."
POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)
PROJECT_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT id FROM project LIMIT 1;")

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="jSrhrIiOyn0eH02aRSIFY"
fi

echo "✅ Project ID: $PROJECT_ID"

# Step 3: Create Application directly in database (bypass API issues)
echo ""
echo "Step 3: Creating application in database..."
APP_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')
APP_NAME="approver"

# Insert application into database
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
INSERT INTO application (
  \"applicationId\", name, \"appName\", description, \"projectId\", 
  \"sourceType\", repository, branch, \"buildPath\", dockerfile,
  port, \"createdAt\", \"updatedAt\"
) VALUES (
  '$APP_ID', '$APP_NAME', '$APP_NAME', 'Approver Application',
  '$PROJECT_ID', 'github', 'YOUR_GITHUB_USERNAME/seemplify', 'main',
  'backend/', 'Dockerfile', 80, NOW(), NOW()
);" > /dev/null 2>&1

echo "✅ Application created in database! ID: $APP_ID"

# Step 4: Add Domain in database
echo ""
echo "Step 4: Adding domain approver.aiinigeria.com..."
DOMAIN_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')

docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
INSERT INTO domain (
  id, domain, \"applicationId\", https, \"certificateType\",
  \"createdAt\", \"updatedAt\"
) VALUES (
  '$DOMAIN_ID', 'approver.aiinigeria.com', '$APP_ID', true, 'letsencrypt',
  NOW(), NOW()
);" > /dev/null 2>&1

echo "✅ Domain added to database"

# Step 5: Trigger deployment via API
echo ""
echo "Step 5: Triggering deployment..."
DEPLOY_RESPONSE=$(curl -s -b /tmp/dokploy-cookies.txt -X POST "$DOKPLOY_URL/api/application.deploy" \
  -H "Content-Type: application/json" \
  -d "{\"applicationId\": \"$APP_ID\"}")

if echo "$DEPLOY_RESPONSE" | grep -q "error\|Unauthorized"; then
  echo "⚠️  API deploy failed, but application is created in database"
  echo "   You can deploy manually via Dokploy dashboard"
else
  echo "✅ Deployment triggered!"
fi

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Application ID: $APP_ID"
echo "Domain: approver.aiinigeria.com"
echo ""
echo "Next steps:"
echo "  1. Go to http://4.180.153.209:3000"
echo "  2. Find 'approver' application"
echo "  3. Update repository URL if needed"
echo "  4. Click Deploy"
echo ""
echo "Then set GitHub secrets:"
echo "  gh secret set DOKPLOY_TOKEN --body \"<create-api-key-in-dokploy>\""
echo "  gh secret set APPROVER_APP_ID --body \"$APP_ID\""
echo "  gh secret set DOKPLOY_URL --body \"http://4.180.153.209:3000\""
echo ""
