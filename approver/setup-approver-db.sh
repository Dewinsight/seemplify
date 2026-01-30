#!/bin/bash
# Create Approver application entry in Dokploy database
# This creates the basic structure, then you complete via web UI

set -e

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

echo "=========================================="
echo "Setting up Approver in Dokploy Database"
echo "=========================================="

# Get project ID
echo "Getting project ID..."
PROJECT_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"projectId\" FROM project LIMIT 1;")

if [ -z "$PROJECT_ID" ]; then
  echo "Using default project ID"
  PROJECT_ID="jSrhrIiOyn0eH02aRSIFY"
fi

echo "Project ID: $PROJECT_ID"

# Generate Application ID
APP_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')
APP_NAME="approver"

echo ""
echo "Creating application entry..."
echo "Application ID: $APP_ID"

# Check if application already exists
EXISTS=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT COUNT(*) FROM application WHERE name = '$APP_NAME';")

if [ "$EXISTS" -gt 0 ]; then
  echo "⚠️  Application '$APP_NAME' already exists!"
  APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT \"applicationId\" FROM application WHERE name = '$APP_NAME' LIMIT 1;")
  echo "Using existing ID: $APP_ID"
else
  # Create application
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
  
  echo "✅ Application created!"
fi

# Add domain if not exists
echo ""
echo "Adding domain..."
DOMAIN_EXISTS=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "SELECT COUNT(*) FROM domain WHERE domain = 'approver.aiinigeria.com';")

if [ "$DOMAIN_EXISTS" -eq 0 ]; then
  DOMAIN_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')
  docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
  INSERT INTO domain (
    id, domain, \"applicationId\", https, \"certificateType\",
    \"createdAt\", \"updatedAt\"
  ) VALUES (
    '$DOMAIN_ID', 'approver.aiinigeria.com', '$APP_ID', true, 'letsencrypt',
    NOW(), NOW()
  );" > /dev/null 2>&1
  echo "✅ Domain added!"
else
  echo "⚠️  Domain already exists"
fi

echo ""
echo "=========================================="
echo "✅ Database Setup Complete!"
echo "=========================================="
echo ""
echo "Application ID: $APP_ID"
echo ""
echo "Next: Complete setup via Dokploy web UI:"
echo "  1. Go to http://4.180.153.209:3000"
echo "  2. Login: admin@seemplifyai.com / Seemplify2026!"
echo "  3. Find 'approver' application"
echo "  4. Update repository URL to your GitHub repo"
echo "  5. Click Deploy"
echo ""
echo "Then set GitHub secrets:"
echo "  gh secret set APPROVER_APP_ID --body \"$APP_ID\""
echo "  gh secret set DOKPLOY_URL --body \"http://4.180.153.209:3000\""
echo "  gh secret set DOKPLOY_TOKEN --body \"<create-api-key-in-dokploy>\""
echo ""
