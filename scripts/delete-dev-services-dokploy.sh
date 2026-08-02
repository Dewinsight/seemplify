#!/bin/bash
# Permanently delete all -dev services from Dokploy via API
# Run from anywhere that can reach DOKPLOY_URL (or on server: DOKPLOY_URL=http://localhost:3000)

set -e

DOKPLOY_URL="${DOKPLOY_URL:-http://4.180.153.209:3000}"
DOKPLOY_TOKEN="${DOKPLOY_TOKEN:-github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh}"

# Dev application IDs (from deploy-dev-apps.sh / Dokploy)
DEV_APP_IDS=(
    "dev-idp-001-seemplify"
    "dev-rec-be-001-seemp"
    "dev-rec-fe-001-seemp"
    "dev-lv-be-001-seemp"
    "dev-lv-fe-001-seemp"
    "dev-pf-be-001-seemp"
    "dev-pf-fe-001-seemp"
    "dev-py-be-001-seemp"
    "dev-py-fe-001-seemp"
)

DEV_APP_NAMES=(
    "identity-provider-dev"
    "recruiter-backend-dev"
    "recruiter-frontend-dev"
    "leave-backend-dev"
    "leave-frontend-dev"
    "performance-backend-dev"
    "performance-frontend-dev"
    "payroll-backend-dev"
    "payroll-frontend-dev"
)

echo "=============================================="
echo "  DELETE ALL -DEV SERVICES FROM DOKPLOY"
echo "=============================================="
echo ""
echo "DOKPLOY_URL: $DOKPLOY_URL"
echo "Token: ${DOKPLOY_TOKEN:0:20}..."
echo ""

for i in "${!DEV_APP_IDS[@]}"; do
    APP_ID="${DEV_APP_IDS[$i]}"
    APP_NAME="${DEV_APP_NAMES[$i]}"
    
    echo "Deleting: $APP_NAME ($APP_ID)..."
    
    HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$DOKPLOY_URL/api/application.delete" \
        -H "x-api-key: $DOKPLOY_TOKEN" \
        -H "Content-Type: application/json" \
        -H "accept: application/json" \
        -d "{\"applicationId\": \"$APP_ID\"}")
    
    HTTP_BODY=$(echo "$HTTP_RESPONSE" | head -n -1)
    HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n 1)
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        echo "  OK (HTTP $HTTP_CODE)"
    else
        echo "  Response (HTTP $HTTP_CODE): $HTTP_BODY"
    fi
    echo ""
done

echo "=============================================="
echo "  DONE"
echo "=============================================="
