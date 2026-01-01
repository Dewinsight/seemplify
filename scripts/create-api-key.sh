#!/bin/bash
# Create API key for GitHub Actions

POSTGRES_CONTAINER=$(docker ps -qf name=dokploy-postgres)

echo "=== Creating API Key ==="

# Generate a secure token
API_KEY=$(openssl rand -hex 32)
KEY_ID=$(cat /proc/sys/kernel/random/uuid)
USER_ID="b079dcea-db53-4a1b-978d-585481d8c2cb"

# Insert with correct column names
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
INSERT INTO public.apikey (id, name, key, user_id, enabled, created_at, updated_at)
VALUES ('$KEY_ID', 'github-actions', '$API_KEY', '$USER_ID', true, NOW(), NOW())
ON CONFLICT DO NOTHING;
"

echo ""
echo "=== API Key Created ==="
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT id, name, key FROM public.apikey WHERE name='github-actions';"

echo ""
echo "Key: $API_KEY"
echo ""
echo "Save this key for GitHub Actions secrets!"
