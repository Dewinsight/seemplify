#!/bin/bash
# Create organization and member for admin user

POSTGRES_CONTAINER=$(docker ps -qf name=dokploy-postgres)
USER_ID="b079dcea-db53-4a1b-978d-585481d8c2cb"
ORG_ID=$(cat /proc/sys/kernel/random/uuid)
MEMBER_ID=$(cat /proc/sys/kernel/random/uuid)

echo "Creating organization..."
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
INSERT INTO public.organization (id, name, slug, created_at, owner_id)
VALUES ('$ORG_ID', 'Seemplify', 'seemplify', NOW(), '$USER_ID');
"

echo "Creating member with full permissions..."
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
INSERT INTO public.member (
    id, 
    organization_id, 
    user_id, 
    role, 
    created_at,
    \"canCreateProjects\",
    \"canAccessToSSHKeys\",
    \"canCreateServices\",
    \"canDeleteProjects\",
    \"canDeleteServices\",
    \"canAccessToDocker\",
    \"canAccessToAPI\",
    \"canAccessToGitProviders\",
    \"canAccessToTraefikFiles\",
    \"canCreateEnvironments\",
    \"canDeleteEnvironments\",
    is_default
)
VALUES (
    '$MEMBER_ID', 
    '$ORG_ID', 
    '$USER_ID', 
    'owner', 
    NOW(),
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true
);
"

echo ""
echo "Verifying..."
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT id, name, owner_id FROM public.organization;"
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT id, user_id, role, \"canCreateProjects\" FROM public.member;"

echo ""
echo "Organization created: $ORG_ID"
