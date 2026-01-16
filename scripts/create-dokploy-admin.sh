#!/bin/bash
# Create Dokploy Admin User Script

set -e

echo "Creating Dokploy admin user..."

# Get container IDs
DOKPLOY_CONTAINER=$(docker ps -qf name=dokploy.1)
POSTGRES_CONTAINER=$(docker ps -qf name=dokploy-postgres)

echo "Dokploy container: $DOKPLOY_CONTAINER"
echo "Postgres container: $POSTGRES_CONTAINER"

# Generate bcrypt hash inside the Dokploy container
echo "Generating password hash..."
HASH=$(docker exec $DOKPLOY_CONTAINER node -e "
const bcrypt = require('bcrypt');
bcrypt.hash('Seemplify2026!', 10).then(h => console.log(h));
")

echo "Hash generated: ${HASH:0:20}..."

# Generate UUIDs
USER_ID=$(cat /proc/sys/kernel/random/uuid)
ACCOUNT_ID=$(cat /proc/sys/kernel/random/uuid)
echo "User ID: $USER_ID"
echo "Account ID: $ACCOUNT_ID"

# Set expiration date (1 year from now)
EXPIRATION_DATE=$(date -d "+1 year" -Iseconds)
CURRENT_DATE=$(date -Iseconds)

# Check if admin already exists
EXISTING=$(docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -c "SELECT COUNT(*) FROM public.\"user\" WHERE email='admin@seemplifyai.com';")
EXISTING=$(echo $EXISTING | tr -d ' ')

if [ "$EXISTING" != "0" ]; then
    echo "Admin user already exists!"
    docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -c "SELECT id, email, role FROM public.\"user\" WHERE email='admin@seemplifyai.com';"
    exit 0
fi

# Insert admin user with all required fields
echo "Inserting admin user into database..."
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
INSERT INTO public.\"user\" (
    id, 
    email, 
    role, 
    \"isRegistered\", 
    \"createdAt\",
    \"expirationDate\",
    email_verified,
    updated_at
)
VALUES (
    '$USER_ID', 
    'admin@seemplifyai.com', 
    'admin', 
    true, 
    '$CURRENT_DATE',
    '$EXPIRATION_DATE',
    true,
    NOW()
);
"

# Create auth account entry (for better-auth credential login)
echo "Creating auth account..."
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "
INSERT INTO public.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
VALUES ('$ACCOUNT_ID', '$USER_ID', 'credential', '$USER_ID', '$HASH', NOW(), NOW());
"

# Verify
echo ""
echo "Verifying..."
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -c "SELECT id, email, role FROM public.\"user\";"
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -t -c "SELECT id, user_id, provider_id FROM public.account;"

echo ""
echo "=========================================="
echo "Admin user created successfully!"
echo "=========================================="
echo "Email: admin@seemplifyai.com"
echo "Password: Seemplify2026!"
echo "Login at: http://$(curl -s ifconfig.me):3000"
echo ""
