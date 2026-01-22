#!/bin/bash
# Setup Approver Project and Application in Dokploy
# Creates a NEW project called "approver" (separate from "seemplify")
# Then creates the application within that project

set -e

POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

if [ -z "$POSTGRES_CONTAINER" ]; then
  echo "❌ Error: Dokploy PostgreSQL container not found!"
  exit 1
fi

echo "=========================================="
echo "Setting up Approver Project in Dokploy"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Step 1: Check project table structure
echo -e "${BLUE}Step 1: Checking project table structure...${NC}"
PROJECT_COLUMNS=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "
  SELECT column_name 
  FROM information_schema.columns 
  WHERE table_name = 'project' 
  ORDER BY ordinal_position;
" | tr '\n' ',' | sed 's/,$//')

echo "Project table columns: $PROJECT_COLUMNS"
echo ""

# Step 2: Check if "approver" project exists
echo -e "${BLUE}Step 2: Checking if 'approver' project exists...${NC}"
PROJECT_EXISTS=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "
  SELECT COUNT(*) FROM project WHERE name = 'approver';
")

if [ "$PROJECT_EXISTS" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  Project 'approver' already exists!${NC}"
  APPROVER_PROJECT_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "
    SELECT \"projectId\" FROM project WHERE name = 'approver' LIMIT 1;
  ")
  echo -e "${GREEN}Using existing project ID: $APPROVER_PROJECT_ID${NC}"
else
  # Step 3: Create new project "approver"
  echo -e "${BLUE}Step 3: Creating new project 'approver'...${NC}"
  
  # Generate project ID (Dokploy uses short IDs like "jSrhrIiOyn0eH02aRSIFY")
  APPROVER_PROJECT_ID=$(openssl rand -hex 10 | tr '[:lower:]' '[:upper:]' | head -c 20)
  
  # Get environment ID (needed for project)
  ENV_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "
    SELECT \"environmentId\" FROM environment LIMIT 1;
  " | head -1)
  
  if [ -z "$ENV_ID" ]; then
    echo "⚠️  No environment found, using default"
    ENV_ID="LRloZifVPbZcVc-D9jUd4"  # Default from existing apps
  fi
  
  echo "Creating project with ID: $APPROVER_PROJECT_ID"
  echo "Environment ID: $ENV_ID"
  
  # Insert project
  docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
    INSERT INTO project (
      \"projectId\", name, description, \"createdAt\", \"updatedAt\"
    ) VALUES (
      '$APPROVER_PROJECT_ID', 'approver', 'Approver Application Project', NOW(), NOW()
    );
  " > /dev/null 2>&1
  
  echo -e "${GREEN}✅ Project 'approver' created!${NC}"
fi

echo ""
echo "=========================================="
echo "Creating Approver Application"
echo "=========================================="
echo ""

# Step 4: Check if application exists
echo -e "${BLUE}Step 4: Checking if 'approver' application exists...${NC}"
APP_EXISTS=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "
  SELECT COUNT(*) FROM application WHERE name = 'approver';
")

if [ "$APP_EXISTS" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  Application 'approver' already exists!${NC}"
  APPROVER_APP_ID=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "
    SELECT \"applicationId\" FROM application WHERE name = 'approver' LIMIT 1;
  ")
  echo -e "${GREEN}Using existing application ID: $APPROVER_APP_ID${NC}"
else
  # Step 5: Create application
  echo -e "${BLUE}Step 5: Creating 'approver' application...${NC}"
  
  # Generate application ID (UUID format)
  APPROVER_APP_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')
  
  # Get GitHub repo URL (you may need to update this)
  GITHUB_REPO="${GITHUB_REPO:-michaelegbo/seemplify}"
  
  echo "Application ID: $APPROVER_APP_ID"
  echo "Project ID: $APPROVER_PROJECT_ID"
  echo "Repository: $GITHUB_REPO"
  
  # Insert application
  docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
    INSERT INTO application (
      \"applicationId\", name, \"appName\", description, \"projectId\",
      \"sourceType\", repository, branch, \"buildPath\", dockerfile,
      port, \"createdAt\", \"updatedAt\", enabled
    ) VALUES (
      '$APPROVER_APP_ID', 'approver', 'approver-app', 'Approver Application',
      '$APPROVER_PROJECT_ID', 'github', 'https://github.com/$GITHUB_REPO.git', 'main',
      'approver/backend/', 'approver/backend/Dockerfile', 80, NOW(), NOW(), true
    );
  " > /dev/null 2>&1
  
  echo -e "${GREEN}✅ Application 'approver' created!${NC}"
fi

echo ""
echo "=========================================="
echo "Configuring Domain"
echo "=========================================="
echo ""

# Step 6: Configure domain
echo -e "${BLUE}Step 6: Configuring domain 'approver.aiinigeria.com'...${NC}"
DOMAIN_EXISTS=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -A -c "
  SELECT COUNT(*) FROM domain WHERE domain = 'approver.aiinigeria.com';
")

if [ "$DOMAIN_EXISTS" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  Domain 'approver.aiinigeria.com' already exists!${NC}"
else
  DOMAIN_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr '[:upper:]' '[:lower:]')
  
  docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
    INSERT INTO domain (
      id, domain, \"applicationId\", https, \"certificateType\",
      \"createdAt\", \"updatedAt\"
    ) VALUES (
      '$DOMAIN_ID', 'approver.aiinigeria.com', '$APPROVER_APP_ID', true, 'letsencrypt',
      NOW(), NOW()
    );
  " > /dev/null 2>&1
  
  echo -e "${GREEN}✅ Domain 'approver.aiinigeria.com' configured!${NC}"
fi

echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo -e "${GREEN}Project ID:${NC} $APPROVER_PROJECT_ID"
echo -e "${GREEN}Application ID:${NC} $APPROVER_APP_ID"
echo ""
echo "Next steps:"
echo "1. Set GitHub secret:"
echo "   gh secret set APPROVER_APP_ID --body \"$APPROVER_APP_ID\""
echo ""
echo "2. Go to Dokploy dashboard:"
echo "   http://4.180.153.209:3000"
echo "   Login: admin@seemplifyai.com / Seemplify2026!"
echo ""
echo "3. Find project 'approver' → application 'approver'"
echo ""
echo "4. Update repository URL if needed"
echo ""
echo "5. Set environment variables:"
echo "   - NODE_ENV=production"
echo "   - PORT=80"
echo "   - MONGO_URI=<your-mongodb-connection-string>"
echo "   - FRONTEND_URL=https://approver.aiinigeria.com"
echo ""
echo "6. Click 'Deploy' button"
echo ""
