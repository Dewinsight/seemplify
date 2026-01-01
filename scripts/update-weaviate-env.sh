#!/bin/bash

echo "🔄 Updating Weaviate environment in Dokploy"
echo "============================================"
echo ""

POSTGRES=$(docker ps --format '{{.Names}}' | grep postgres | head -1)
echo "📡 Using Postgres container: $POSTGRES"

# Get recruiter backend app ID
APP_ID=$(docker exec $POSTGRES psql -U dokploy -d dokploy -t -c "SELECT \"applicationId\" FROM application WHERE name = 'recruiter-backend';" | tr -d ' ')
echo "📋 Recruiter Backend App ID: $APP_ID"

# Remove Pinecone environment variables and USE_WEAVIATE flag
echo ""
echo "🗑️  Removing Pinecone environment variables..."

docker exec $POSTGRES psql -U dokploy -d dokploy -c "
UPDATE application 
SET env = regexp_replace(
  regexp_replace(
    regexp_replace(env, E'PINECONE_API_KEY=[^\\n]*\\n?', '', 'g'),
    E'PINECONE_PROJECT_ID=[^\\n]*\\n?', '', 'g'
  ),
  E'USE_WEAVIATE=[^\\n]*\\n?', '', 'g'
)
WHERE \"applicationId\" = '$APP_ID';
"

echo "✅ Pinecone environment variables removed"
echo ""
echo "📋 Updated environment (last 10 lines):"
docker exec $POSTGRES psql -U dokploy -d dokploy -t -c "SELECT env FROM application WHERE \"applicationId\" = '$APP_ID';" | tail -10

echo ""
echo "=========================================="
echo "✅ Environment Updated!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Redeploy recruiter-backend via Dokploy"
echo "  2. Verify logs show 'Vector DB: ✨ Weaviate'"
echo "  3. Test search functionality"
