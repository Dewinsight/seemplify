#!/bin/bash
ZONE_ID="bbc142d2d661d64011e2e4becae7a5c3"
API_TOKEN="s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
DOMAIN="docs"
IP="4.180.153.209"

# Check if record exists
RESPONSE=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=A&name=${DOMAIN}" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json")

RECORD_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$RECORD_ID" ]; then
  echo "Updating existing DNS record: $RECORD_ID"
  curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}" \
    -H "Authorization: Bearer ${API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"${DOMAIN}\",\"content\":\"${IP}\",\"ttl\":300,\"proxied\":true}" | grep -q "\"success\":true" && echo "✅ DNS record updated" || echo "❌ Update failed"
else
  echo "Creating new DNS record"
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"${DOMAIN}\",\"content\":\"${IP}\",\"ttl\":300,\"proxied\":true}" | grep -q "\"success\":true" && echo "✅ DNS record created" || echo "❌ Creation failed"
fi
