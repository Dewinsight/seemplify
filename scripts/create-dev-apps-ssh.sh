#!/bin/bash
# Create Dev Apps in Dokploy via API
# This script runs on the Azure VM via SSH

set -e

DOKPLOY_URL="http://localhost:3000"
PROJECT_ID="jSrhrIiOyn0eH02aRSIFY"

# Login and get session cookie
echo "🔐 Logging into Dokploy..."
curl -s -c /tmp/dokploy_cookies.txt -X POST "${DOKPLOY_URL}/api/trpc/auth.login" \
    -H "Content-Type: application/json" \
    -d '{"json":{"email":"admin@seemplifyai.com","password":"Seemplify2026!"}}' > /tmp/login_response.txt

echo "Login response:"
cat /tmp/login_response.txt
echo ""

# Function to create an application
create_app() {
    local name=$1
    local description=$2
    
    echo "📦 Creating application: $name"
    
    response=$(curl -s -b /tmp/dokploy_cookies.txt -X POST "${DOKPLOY_URL}/api/application.create" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"$name\", \"appName\": \"$name\", \"description\": \"$description\", \"projectId\": \"$PROJECT_ID\"}")
    
    echo "Response for $name: $response"
    echo ""
}

# Create all 9 dev applications
echo "🚀 Creating dev applications..."
echo ""

create_app "identity-provider-dev" "Keycloak Identity Provider - Dev Environment"
create_app "recruiter-backend-dev" "Recruiter Backend API - Dev Environment"
create_app "recruiter-frontend-dev" "Recruiter Frontend - Dev Environment"
create_app "leave-backend-dev" "Leave Management Backend - Dev Environment"
create_app "leave-frontend-dev" "Leave Management Frontend - Dev Environment"
create_app "performance-backend-dev" "Performance Management Backend - Dev Environment"
create_app "performance-frontend-dev" "Performance Management Frontend - Dev Environment"
create_app "payroll-backend-dev" "Payroll Backend - Dev Environment"
create_app "payroll-frontend-dev" "Payroll Frontend - Dev Environment"

echo "✅ Dev applications creation complete!"
