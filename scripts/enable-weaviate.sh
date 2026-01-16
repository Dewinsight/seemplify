#!/bin/bash

echo "🚀 Enabling Weaviate in Production"
echo "===================================="
echo ""

# Get Postgres container
POSTGRES=$(docker ps --format '{{.Names}}' | grep postgres | head -1)
echo "📡 Using Postgres container: $POSTGRES"

# Get recruiter backend app ID
APP_ID=$(docker exec $POSTGRES psql -U dokploy -d dokploy -t -c "SELECT \"applicationId\" FROM application WHERE name = 'recruiter-backend';" | tr -d ' ')
echo "📋 Recruiter Backend App ID: $APP_ID"

# Get current environment variables
echo ""
echo "📋 Current environment variables:"
docker exec $POSTGRES psql -U dokploy -d dokploy -t -c "SELECT env FROM application WHERE \"applicationId\" = '$APP_ID';"

# Update environment - add Weaviate vars
echo ""
echo "✨ Adding Weaviate environment variables..."

# Build the new env string with Weaviate vars
NEW_ENV="WEAVIATE_HOST=weaviate:8080
WEAVIATE_SCHEME=http
WEAVIATE_API_KEY=lJAiU5kO0QcSLZYxfzpr1E9dD8NRHFMV
USE_WEAVIATE=true"

docker exec $POSTGRES psql -U dokploy -d dokploy -c "UPDATE application SET env = env || E'\n$NEW_ENV' WHERE \"applicationId\" = '$APP_ID';"

echo ""
echo "✅ Environment variables updated!"
echo ""
echo "📋 Updated environment:"
docker exec $POSTGRES psql -U dokploy -d dokploy -t -c "SELECT env FROM application WHERE \"applicationId\" = '$APP_ID';" | tail -10

echo ""
echo "=========================================="
echo "✅ Weaviate Environment Variables Added!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Redeploy recruiter-backend via Dokploy UI or API"
echo "  2. Monitor logs for 'Vector DB Mode: ✨ Weaviate'"
echo "  3. Test search functionality"
echo "  4. Monitor for 1 hour"
