#!/bin/bash
# Test Dokploy API Key
# Usage: ./test-dokploy-api-key.sh [API_KEY] [APP_ID]

API_KEY="${1:-github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh}"
APP_ID="${2:-k_p-9M7ZWEhSSf_0JusGs}"
DOKPLOY_URL="http://4.180.153.209:3000"

echo "🔑 Testing Dokploy API Key..."
echo "Key: ${API_KEY:0:30}..."
echo "App ID: $APP_ID"
echo "URL: $DOKPLOY_URL/api/application.deploy"
echo ""

response=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$DOKPLOY_URL/api/application.deploy" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "accept: application/json" \
  -d "{\"applicationId\": \"$APP_ID\"}")

http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d: -f2)
body=$(echo "$response" | sed '/HTTP_CODE/d')

echo "Response Body: $body"
echo "HTTP Status Code: $http_code"
echo ""

if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
  echo "✅ SUCCESS: API key is working!"
  exit 0
else
  echo "❌ FAILED: API key authentication failed (HTTP $http_code)"
  exit 1
fi
