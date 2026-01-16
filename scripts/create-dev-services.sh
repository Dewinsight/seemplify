#!/bin/bash
# Create Docker Swarm services for all dev applications
# Run this on the Azure VM

# Get the Dokploy network ID
NETWORK=$(docker network ls --filter name=dokploy --format "{{.ID}}" | head -1)

echo "Using network: $NETWORK"
echo ""
echo "Creating dev services..."
echo ""

# 1. Identity Provider Dev
docker service create \
  --name identity-provider-dev-a1b2c3 \
  --replicas 1 \
  --network $NETWORK \
  --env NODE_ENV=development \
  --env PORT=3000 \
  --env MONGO_URI="mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/identity-dev?retryWrites=true&w=majority" \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.identity-provider-dev.rule=Host(\`auth-dev.seemplifyai.com\`)" \
  --label "traefik.http.routers.identity-provider-dev.entrypoints=websecure" \
  --label "traefik.http.routers.identity-provider-dev.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.identity-provider-dev.loadbalancer.server.port=3000" \
  identity-provider-dev-a1b2c3:latest

echo "✅ identity-provider-dev created"

# 2. Recruiter Backend Dev
docker service create \
  --name recruiter-backend-dev-d4e5f6 \
  --replicas 1 \
  --network $NETWORK \
  --env NODE_ENV=development \
  --env PORT=5001 \
  --env MONGO_URI="mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/recruiter-dev?retryWrites=true&w=majority" \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.recruiter-backend-dev.rule=Host(\`api-dev.seemplifyai.com\`)" \
  --label "traefik.http.routers.recruiter-backend-dev.entrypoints=websecure" \
  --label "traefik.http.routers.recruiter-backend-dev.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.recruiter-backend-dev.loadbalancer.server.port=5001" \
  recruiter-backend-dev-d4e5f6:latest

echo "✅ recruiter-backend-dev created"

# 3. Recruiter Frontend Dev
docker service create \
  --name recruiter-frontend-dev-g7h8i9 \
  --replicas 1 \
  --network $NETWORK \
  --env NODE_ENV=development \
  --env NEXT_PUBLIC_API_URL=https://api-dev.seemplifyai.com \
  --env NEXT_PUBLIC_AUTH_URL=https://auth-dev.seemplifyai.com \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.recruiter-frontend-dev.rule=Host(\`app-dev.seemplifyai.com\`)" \
  --label "traefik.http.routers.recruiter-frontend-dev.entrypoints=websecure" \
  --label "traefik.http.routers.recruiter-frontend-dev.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.recruiter-frontend-dev.loadbalancer.server.port=3000" \
  recruiter-frontend-dev-g7h8i9:latest

echo "✅ recruiter-frontend-dev created"

# 4. Leave Backend Dev
docker service create \
  --name leave-backend-dev-j1k2l3 \
  --replicas 1 \
  --network $NETWORK \
  --env NODE_ENV=development \
  --env PORT=5002 \
  --env MONGO_URI="mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/leave-dev?retryWrites=true&w=majority" \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.leave-backend-dev.rule=Host(\`api-leave-dev.seemplifyai.com\`)" \
  --label "traefik.http.routers.leave-backend-dev.entrypoints=websecure" \
  --label "traefik.http.routers.leave-backend-dev.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.leave-backend-dev.loadbalancer.server.port=5002" \
  leave-backend-dev-j1k2l3:latest

echo "✅ leave-backend-dev created"

# 5. Leave Frontend Dev
docker service create \
  --name leave-frontend-dev-m4n5o6 \
  --replicas 1 \
  --network $NETWORK \
  --env NODE_ENV=development \
  --env NEXT_PUBLIC_API_URL=https://api-leave-dev.seemplifyai.com \
  --env NEXT_PUBLIC_AUTH_URL=https://auth-dev.seemplifyai.com \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.leave-frontend-dev.rule=Host(\`leave-dev.seemplifyai.com\`)" \
  --label "traefik.http.routers.leave-frontend-dev.entrypoints=websecure" \
  --label "traefik.http.routers.leave-frontend-dev.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.leave-frontend-dev.loadbalancer.server.port=3000" \
  leave-frontend-dev-m4n5o6:latest

echo "✅ leave-frontend-dev created"

# 6. Performance Backend Dev
docker service create \
  --name performance-backend-dev-p7q8r9 \
  --replicas 1 \
  --network $NETWORK \
  --env NODE_ENV=development \
  --env PORT=5004 \
  --env MONGO_URI="mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/performance-dev?retryWrites=true&w=majority" \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.performance-backend-dev.rule=Host(\`api-performance-dev.seemplifyai.com\`)" \
  --label "traefik.http.routers.performance-backend-dev.entrypoints=websecure" \
  --label "traefik.http.routers.performance-backend-dev.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.performance-backend-dev.loadbalancer.server.port=5004" \
  performance-backend-dev-p7q8r9:latest

echo "✅ performance-backend-dev created"

# 7. Performance Frontend Dev
docker service create \
  --name performance-frontend-dev-s1t2u3 \
  --replicas 1 \
  --network $NETWORK \
  --env NODE_ENV=development \
  --env NEXT_PUBLIC_API_URL=https://api-performance-dev.seemplifyai.com \
  --env NEXT_PUBLIC_AUTH_URL=https://auth-dev.seemplifyai.com \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.performance-frontend-dev.rule=Host(\`performance-dev.seemplifyai.com\`)" \
  --label "traefik.http.routers.performance-frontend-dev.entrypoints=websecure" \
  --label "traefik.http.routers.performance-frontend-dev.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.performance-frontend-dev.loadbalancer.server.port=3000" \
  performance-frontend-dev-s1t2u3:latest

echo "✅ performance-frontend-dev created"

# 8. Payroll Backend Dev
docker service create \
  --name payroll-backend-dev-v4w5x6 \
  --replicas 1 \
  --network $NETWORK \
  --env NODE_ENV=development \
  --env PORT=5006 \
  --env MONGO_URI="mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/payroll-dev?retryWrites=true&w=majority" \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.payroll-backend-dev.rule=Host(\`api-payroll-dev.seemplifyai.com\`)" \
  --label "traefik.http.routers.payroll-backend-dev.entrypoints=websecure" \
  --label "traefik.http.routers.payroll-backend-dev.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.payroll-backend-dev.loadbalancer.server.port=5006" \
  payroll-backend-dev-v4w5x6:latest

echo "✅ payroll-backend-dev created"

# 9. Payroll Frontend Dev
docker service create \
  --name payroll-frontend-dev-y7z8a9 \
  --replicas 1 \
  --network $NETWORK \
  --env NODE_ENV=development \
  --env NEXT_PUBLIC_API_URL=https://api-payroll-dev.seemplifyai.com \
  --env NEXT_PUBLIC_AUTH_URL=https://auth-dev.seemplifyai.com \
  --label "traefik.enable=true" \
  --label "traefik.http.routers.payroll-frontend-dev.rule=Host(\`payroll-dev.seemplifyai.com\`)" \
  --label "traefik.http.routers.payroll-frontend-dev.entrypoints=websecure" \
  --label "traefik.http.routers.payroll-frontend-dev.tls.certresolver=letsencrypt" \
  --label "traefik.http.services.payroll-frontend-dev.loadbalancer.server.port=3000" \
  payroll-frontend-dev-y7z8a9:latest

echo "✅ payroll-frontend-dev created"

echo ""
echo "✅ All 9 dev services created!"
echo ""
echo "Verifying services..."
docker service ls | grep dev

echo ""
echo "Check status at: http://4.180.153.209:3000"
