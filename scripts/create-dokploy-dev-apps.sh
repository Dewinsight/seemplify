#!/bin/bash
# Create all 9 dev applications in Dokploy via API
# This script automates the entire dev environment setup in Dokploy

set -e  # Exit on error

# Configuration
DOKPLOY_URL="http://localhost:3000"
API_TOKEN="${DOKPLOY_TOKEN}"  # Will be set from environment or provided

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if API token is provided
if [ -z "$API_TOKEN" ]; then
    log_error "DOKPLOY_TOKEN environment variable not set!"
    echo ""
    echo "Please set the API token first:"
    echo "  export DOKPLOY_TOKEN='your-api-token-here'"
    echo ""
    echo "To get your API token:"
    echo "  1. Log into Dokploy: http://4.180.153.209:3000"
    echo "  2. Go to Settings → API Keys"
    echo "  3. Create a new API key"
    exit 1
fi

log_info "Starting Dokploy dev applications creation..."
echo ""

# Function to create an application
create_application() {
    local app_name="$1"
    local build_path="$2"
    local domain="$3"
    local db_name="$4"
    local port="$5"
    local app_type="$6"  # backend or frontend
    
    log_info "Creating: $app_name"
    
    # Determine if this is a backend or frontend
    local mongo_uri=""
    if [ "$app_type" == "backend" ]; then
        mongo_uri="mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/${db_name}?retryWrites=true&w=majority&appName=Cluster0"
    fi
    
    # Create the application via API
    # Note: This is a placeholder - we'll need to get the actual project ID first
    local response=$(curl -s -X POST "$DOKPLOY_URL/api/application.create" \
        -H "x-api-key: $API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"$app_name\",
            \"appName\": \"$app_name\",
            \"description\": \"Development environment for $app_name\",
            \"projectId\": \"${PROJECT_ID}\",
            \"sourceType\": \"github\",
            \"repository\": \"${GITHUB_REPO}\",
            \"branch\": \"main\",
            \"buildPath\": \"$build_path\",
            \"dockerfile\": \"Dockerfile\"
        }")
    
    # Parse response to get application ID
    local app_id=$(echo "$response" | jq -r '.applicationId // .id // empty')
    
    if [ -z "$app_id" ]; then
        log_error "Failed to create $app_name"
        echo "Response: $response"
        return 1
    fi
    
    log_success "Created $app_name (ID: $app_id)"
    
    # Configure domain
    log_info "  Setting domain: $domain"
    curl -s -X POST "$DOKPLOY_URL/api/domain.create" \
        -H "x-api-key: $API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"applicationId\": \"$app_id\",
            \"domain\": \"$domain\",
            \"https\": true,
            \"certificateType\": \"letsencrypt\"
        }" > /dev/null
    
    # Set environment variables for backends
    if [ "$app_type" == "backend" ]; then
        log_info "  Configuring environment variables..."
        
        # Base environment variables
        local env_vars="NODE_ENV=development
PORT=$port
MONGO_URI=$mongo_uri
JWT_SECRET=dev_jwt_secret_change_in_production
JWT_ACCESS_TTL=10m
OIDC_ISSUER=https://auth-dev.seemplifyai.com
IDP_API_BASE_URL=https://auth-dev.seemplifyai.com
IDP_HUB_URL=https://auth-dev.seemplifyai.com"
        
        curl -s -X POST "$DOKPLOY_URL/api/application.updateEnvironment" \
            -H "x-api-key: $API_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{
                \"applicationId\": \"$app_id\",
                \"environment\": \"$env_vars\"
            }" > /dev/null
    fi
    
    # Set environment variables for frontends
    if [ "$app_type" == "frontend" ]; then
        log_info "  Configuring frontend environment..."
        
        local backend_url=""
        case "$app_name" in
            "recruiter-frontend-dev")
                backend_url="https://api-dev.seemplifyai.com"
                ;;
            "leave-frontend-dev")
                backend_url="https://api-leave-dev.seemplifyai.com"
                ;;
            "performance-frontend-dev")
                backend_url="https://api-performance-dev.seemplifyai.com"
                ;;
            "payroll-frontend-dev")
                backend_url="https://api-payroll-dev.seemplifyai.com"
                ;;
        esac
        
        local frontend_env="NODE_ENV=development
PORT=$port
NEXT_PUBLIC_API_URL=$backend_url
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com"
        
        curl -s -X POST "$DOKPLOY_URL/api/application.updateEnvironment" \
            -H "x-api-key: $API_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{
                \"applicationId\": \"$app_id\",
                \"environment\": \"$frontend_env\"
            }" > /dev/null
    fi
    
    # Deploy the application
    log_info "  Deploying $app_name..."
    curl -s -X POST "$DOKPLOY_URL/api/application.deploy" \
        -H "x-api-key: $API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"applicationId\": \"$app_id\"}" > /dev/null
    
    log_success "  $app_name setup complete!"
    echo "  Application ID: $app_id"
    echo ""
    
    # Store the app ID for GitHub secrets
    echo "${app_name}=${app_id}" >> /tmp/dokploy_dev_app_ids.txt
}

# Get project ID (assuming default project)
log_info "Getting project information..."
PROJECT_RESPONSE=$(curl -s -X GET "$DOKPLOY_URL/api/project.all" \
    -H "x-api-key: $API_TOKEN")

PROJECT_ID=$(echo "$PROJECT_RESPONSE" | jq -r '.[0].projectId // .[0].id // empty')

if [ -z "$PROJECT_ID" ]; then
    log_error "Could not get project ID. Please create a project first or provide PROJECT_ID."
    exit 1
fi

log_success "Using project ID: $PROJECT_ID"
echo ""

# Get GitHub repository info (you may need to update this)
GITHUB_REPO="YOUR_GITHUB_USERNAME/seemplify"
log_warning "Using GitHub repository: $GITHUB_REPO"
log_warning "Update GITHUB_REPO variable if this is incorrect!"
echo ""

# Clear previous app IDs file
rm -f /tmp/dokploy_dev_app_ids.txt

# Create all 9 applications
echo "=========================================="
echo "Creating Dev Applications"
echo "=========================================="
echo ""

# 1. Identity Provider Dev
create_application \
    "identity-provider-dev" \
    "Identityprovider" \
    "auth-dev.seemplifyai.com" \
    "identity-dev" \
    "5008" \
    "backend"

# 2. Recruiter Backend Dev
create_application \
    "recruiter-backend-dev" \
    "recruiter/backend" \
    "api-dev.seemplifyai.com" \
    "smart_hr_db-dev" \
    "5001" \
    "backend"

# 3. Recruiter Frontend Dev
create_application \
    "recruiter-frontend-dev" \
    "recruiter/frontend" \
    "app-dev.seemplifyai.com" \
    "" \
    "5000" \
    "frontend"

# 4. Leave Backend Dev
create_application \
    "leave-backend-dev" \
    "leave-management/backend" \
    "api-leave-dev.seemplifyai.com" \
    "leave-management-dev" \
    "5002" \
    "backend"

# 5. Leave Frontend Dev
create_application \
    "leave-frontend-dev" \
    "leave-management/frontend" \
    "leave-dev.seemplifyai.com" \
    "" \
    "5003" \
    "frontend"

# 6. Performance Backend Dev
create_application \
    "performance-backend-dev" \
    "performance/backend" \
    "api-performance-dev.seemplifyai.com" \
    "performance_db-dev" \
    "5004" \
    "backend"

# 7. Performance Frontend Dev
create_application \
    "performance-frontend-dev" \
    "performance/frontend" \
    "performance-dev.seemplifyai.com" \
    "" \
    "5005" \
    "frontend"

# 8. Payroll Backend Dev
create_application \
    "payroll-backend-dev" \
    "payroll/backend" \
    "api-payroll-dev.seemplifyai.com" \
    "payroll_db-dev" \
    "5006" \
    "backend"

# 9. Payroll Frontend Dev
create_application \
    "payroll-frontend-dev" \
    "payroll/frontend" \
    "payroll-dev.seemplifyai.com" \
    "" \
    "5007" \
    "frontend"

echo ""
echo "=========================================="
echo "✅ All Dev Applications Created!"
echo "=========================================="
echo ""

log_success "Application IDs saved to: /tmp/dokploy_dev_app_ids.txt"
echo ""
echo "Application IDs for GitHub Secrets:"
echo "-----------------------------------"
cat /tmp/dokploy_dev_app_ids.txt
echo ""

log_info "Next steps:"
echo "1. Copy the Application IDs above"
echo "2. Configure GitHub secrets using these IDs"
echo "3. Create dev branch in GitHub"
echo "4. Push code to test deployments"
echo ""

log_success "Setup complete! 🎉"
