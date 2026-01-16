#!/bin/bash
# Final deployment script for all dev applications
# Uses Dokploy API with authentication

# Get API token from GitHub secret (you'll need to paste this)
echo "================================================"
echo "Dev Applications Deployment Script"
echo "================================================"
echo ""
echo "This script will deploy all 9 dev applications to Dokploy."
echo ""
echo "Please get your DOKPLOY_TOKEN from GitHub secrets:"
echo "Run: gh secret list | grep DOKPLOY_TOKEN"
echo "Then get the value with: gh api -H 'Accept: application/vnd.github+json' /repos/michaelegbo/seemplify/actions/secrets/DOKPLOY_TOKEN"
echo "(Note: You cannot retrieve secret values via API, you need to check your GitHub settings)"
echo ""
read -p "Enter your DOKPLOY_TOKEN: " API_TOKEN

if [ -z "$API_TOKEN" ]; then
    echo "❌ API token is required"
    exit 1
fi

DOKPLOY_URL="http://4.180.153.209:3000"

# Dev Application IDs (fixed configuration)
apps=(
    "dev-idp-001-seemplify:identity-provider-dev"
    "dev-rec-be-001-seemp:recruiter-backend-dev"
    "dev-rec-fe-001-seemp:recruiter-frontend-dev"
    "dev-lv-be-001-seemp:leave-backend-dev"
    "dev-lv-fe-001-seemp:leave-frontend-dev"
    "dev-pf-be-001-seemp:performance-backend-dev"
    "dev-pf-fe-001-seemp:performance-frontend-dev"
    "dev-py-be-001-seemp:payroll-backend-dev"
    "dev-py-fe-001-seemp:payroll-frontend-dev"
)

echo ""
echo "🚀 Triggering deployments..."
echo ""

for app in "${apps[@]}"; do
    IFS=':' read -r appId appName <<< "$app"
    
    echo "📦 Deploying $appName ($appId)..."
    
    response=$(curl -s -w "\n%{http_code}" -X POST "$DOKPLOY_URL/api/application.deploy" \
        -H "x-api-key: $API_TOKEN" \
        -H "Content-Type: application/json" \
        -H "accept: application/json" \
        -d "{\"applicationId\": \"$appId\"}")
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" = "200" ]; then
        echo "   ✅ Deployment triggered successfully (HTTP $http_code)"
    else
        echo "   ❌ Failed (HTTP $http_code): $body"
    fi
    
    sleep 1
done

echo ""
echo "✅ All deployment triggers sent!"
echo ""
echo "Monitor deployments at: $DOKPLOY_URL"
echo "It may take 2-5 minutes for builds to complete."
