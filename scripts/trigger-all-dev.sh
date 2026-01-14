#!/bin/bash
# Trigger all dev application deployments
# Run this on the server

echo "🚀 Triggering all dev deployments..."

apps=(
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

for appId in "${apps[@]}"; do
    echo "📦 Triggering $appId..."
    curl -s -X POST "http://localhost:3000/api/application.deploy" \
        -H "Content-Type: application/json" \
        -d "{\"applicationId\":\"$appId\"}" > /dev/null
    echo "   ✅ Done"
done

echo "✅ All deployments triggered!"
