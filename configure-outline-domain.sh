#!/bin/bash
# Configure Outline domain: docs.seemplifyai.com
# This script updates Traefik labels and Cloudflare DNS

set -e

echo "🔧 Configuring Outline domain: docs.seemplifyai.com"

# Configuration
OUTLINE_DIR="/etc/dokploy/compose/seemplify-outline-mrgajc"
COMPOSE_FILE="$OUTLINE_DIR/code/docker-compose.yml"
DEX_CONFIG="$OUTLINE_DIR/files/etc/dex/config.yaml"
CLOUDFLARE_ZONE="seemplifyai.com"
CLOUDFLARE_ZONE_ID="bbc142d2d661d64011e2e4becae7a5c3"
CLOUDFLARE_API_TOKEN="s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
DOMAIN="docs.seemplifyai.com"
SERVER_IP="4.180.153.209"

echo "📝 Step 1: Updating docker-compose.yml with Traefik labels..."

# Create backup
cp "$COMPOSE_FILE" "$COMPOSE_FILE.backup.$(date +%Y%m%d_%H%M%S)"

# Update Outline service labels
sed -i 's|Host(`seemplify-outline-be18bc-127-0-0-1.traefik.me`)|Host(`docs.seemplifyai.com`)|g' "$COMPOSE_FILE"

# Add HTTPS router for Outline (if not exists)
if ! grep -q "seemplify-outline-mrgajc-13-websecure" "$COMPOSE_FILE"; then
  # Find the line with traefik.enable=true for outline service
  sed -i '/traefik.enable=true/a\      - traefik.http.routers.seemplify-outline-mrgajc-13-websecure.rule=Host(`docs.seemplifyai.com`)\n      - traefik.http.routers.seemplify-outline-mrgajc-13-websecure.entrypoints=websecure\n      - traefik.http.routers.seemplify-outline-mrgajc-13-websecure.tls.certresolver=letsencrypt\n      - traefik.http.services.seemplify-outline-mrgajc-13-websecure.loadbalancer.server.port=3000\n      - traefik.http.routers.seemplify-outline-mrgajc-13-websecure.service=seemplify-outline-mrgajc-13-web' "$COMPOSE_FILE"
fi

# Update Dex service labels
sed -i 's|Host(`seemplify-outline-8cbee1-127-0-0-1.traefik.me`)|Host(`docs.seemplifyai.com`)|g' "$COMPOSE_FILE"

# Add HTTPS router for Dex (if not exists)
if ! grep -q "seemplify-outline-mrgajc-14-websecure" "$COMPOSE_FILE"; then
  # Find the line with traefik.enable=true for dex service
  sed -i '/dex:/,/traefik.enable=true/ {
    /traefik.enable=true/a\
      - traefik.http.routers.seemplify-outline-mrgajc-14-websecure.rule=Host(`docs.seemplifyai.com`)\
      - traefik.http.routers.seemplify-outline-mrgajc-14-websecure.entrypoints=websecure\
      - traefik.http.routers.seemplify-outline-mrgajc-14-websecure.tls.certresolver=letsencrypt\
      - traefik.http.services.seemplify-outline-mrgajc-14-websecure.loadbalancer.server.port=5556\
      - traefik.http.routers.seemplify-outline-mrgajc-14-websecure.service=seemplify-outline-mrgajc-14-web
  }' "$COMPOSE_FILE"
fi

echo "✅ Docker Compose labels updated"

echo "📝 Step 2: Updating Dex OIDC configuration..."
sed -i "s|issuer: http://.*|issuer: https://docs.seemplifyai.com|g" "$DEX_CONFIG"
sed -i "s|redirectURIs:.*|redirectURIs:\n      - https://docs.seemplifyai.com/auth/oidc.callback|g" "$DEX_CONFIG"
echo "✅ Dex configuration updated"

echo "📝 Step 3: Adding Cloudflare DNS record..."

# Check if record already exists
EXISTING_RECORD=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records?type=A&name=$DOMAIN" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$EXISTING_RECORD" ]; then
  echo "⚠️  DNS record already exists. Updating..."
  curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records/$EXISTING_RECORD" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"docs\",\"content\":\"$SERVER_IP\",\"ttl\":300,\"proxied\":true}" > /dev/null
  echo "✅ DNS record updated"
else
  echo "➕ Creating new DNS record..."
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"docs\",\"content\":\"$SERVER_IP\",\"ttl\":300,\"proxied\":true}" > /dev/null
  echo "✅ DNS record created"
fi

echo "📝 Step 4: Redeploying Outline..."
cd "$OUTLINE_DIR/code"
docker compose --project-name seemplify-outline-mrgajc down
docker compose --project-name seemplify-outline-mrgajc up -d

echo "✅ Outline redeployed"
echo ""
echo "🎉 Configuration complete!"
echo "📋 Next steps:"
echo "   1. Wait 2-3 minutes for DNS propagation"
echo "   2. Wait for Let's Encrypt certificate to be issued (automatic)"
echo "   3. Access Outline at: https://docs.seemplifyai.com"
echo ""
echo "🔍 To verify:"
echo "   - Check DNS: nslookup docs.seemplifyai.com"
echo "   - Check Traefik logs: docker logs \$(docker ps | grep traefik | awk '{print \$1}')"
echo "   - Check Outline logs: docker logs seemplify-outline-mrgajc-outline-1"
