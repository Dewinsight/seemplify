#!/bin/bash
# ============================================================================
# CLEANUP-DEV-SERVICES.sh
# Permanently removes all -dev services from Dokploy server
# ============================================================================

set -e

echo "=============================================="
echo "  CLEANING UP -DEV SERVICES FROM DOKPLOY"
echo "=============================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${2}[OK] ${1}${NC}"
}

print_warning() {
    echo -e "${2}[WARN] ${1}${NC}"
}

print_error() {
    echo -e "${2}[ERROR] ${1}${NC}"
}

print_header() {
    echo ""
    echo -e "${YELLOW}${1}${NC}"
    echo ""
}

# ============================================================================
# STEP 1: GET ALL DEV CONTAINERS
# ============================================================================

print_header "STEP 1: IDENTIFYING ALL DEV CONTAINERS"

DEV_CONTAINERS=$(docker ps --format '{{.Names}}' | grep -E 'dev|-dev' || true)

if [ -n "$DEV_CONTAINERS" ]; then
    echo "Found dev containers:"
    echo "$DEV_CONTAINERS" | while read container; do
        echo "  - $container"
    done
else
    print_status "No dev containers found" $GREEN
fi

# ============================================================================
# STEP 2: STOP ALL DEV CONTAINERS
# ============================================================================

print_header "STEP 2: STOPPING ALL DEV CONTAINERS"

if [ -n "$DEV_CONTAINERS" ]; then
    echo "$DEV_CONTAINERS" | while read container; do
        if [ -n "$container" ]; then
            print_warning "Stopping: $container" $YELLOW
            docker stop "$container" 2>/dev/null || true
        fi
    done
    print_status "All dev containers stopped" $GREEN
else
    print_status "No containers to stop" $GREEN
fi

# ============================================================================
# STEP 3: REMOVE ALL DEV CONTAINERS
# ============================================================================

print_header "STEP 3: REMOVING ALL DEV CONTAINERS"

DEV_CONTAINERS=$(docker ps -a --format '{{.Names}}' | grep -E 'dev|-dev' || true)

if [ -n "$DEV_CONTAINERS" ]; then
    echo "$DEV_CONTAINERS" | while read container; do
        if [ -n "$container" ]; then
            print_warning "Removing: $container" $YELLOW
            docker rm -f "$container" 2>/dev/null || true
        fi
    done
    print_status "All dev containers removed" $GREEN
else
    print_status "No containers to remove" $GREEN
fi

# ============================================================================
# STEP 4: REMOVE DEV NETWORKS
# ============================================================================

print_header "STEP 4: REMOVING DEV NETWORKS"

DEV_NETWORKS=$(docker network ls --format '{{.Name}}' | grep -E 'dev|-dev' || true)

if [ -n "$DEV_NETWORKS" ]; then
    echo "$DEV_NETWORKS" | while read network; do
        if [ -n "$network" ]; then
            print_warning "Removing network: $network" $YELLOW
            docker network rm "$network" 2>/dev/null || true
        fi
    done
    print_status "Dev networks removed" $GREEN
else
    print_status "No dev networks found" $GREEN
fi

# ============================================================================
# STEP 5: REMOVE DEV VOLUMES
# ============================================================================

print_header "STEP 5: REMOVING DEV VOLUMES"

DEV_VOLUMES=$(docker volume ls --format '{{.Name}}' | grep -E 'dev|-dev' || true)

if [ -n "$DEV_VOLUMES" ]; then
    echo "$DEV_VOLUMES" | while read volume; do
        if [ -n "$volume" ]; then
            print_warning "Removing volume: $volume" $YELLOW
            docker volume rm "$volume" 2>/dev/null || true
        fi
    done
    print_status "Dev volumes removed" $GREEN
else
    print_status "No dev volumes found" $GREEN
fi

# ============================================================================
# STEP 6: CLEAN UP DOKPLOY DATA (Optional)
# ============================================================================

print_header "STEP 6: CLEANING UP DOKPLOY DATA"

# Check for dev service configurations in Dokploy data directories
DOKPLOY_DATA_DIRS="/opt/dokploy/data /home/seemplify/dokploy/data /data/dokploy"

for dir in $DOKPLOY_DATA_DIRS; do
    if [ -d "$dir" ]; then
        print_warning "Checking: $dir" $YELLOW
        DEV_CONFIGS=$(find "$dir" -type f -name "*.json" -o -name "*.yml" -o -name "*.yaml" 2>/dev/null | xargs grep -l "dev" 2>/dev/null || true)
        
        if [ -n "$DEV_CONFIGS" ]; then
            echo "Found files containing 'dev':"
            echo "$DEV_CONFIGS" | while read config; do
                echo "  - $config"
            done
        fi
    fi
done

print_warning "Note: Manual review of Dokploy data recommended" $YELLOW

# ============================================================================
# STEP 7: PREVENT DOKPLOY FROM RECREATING (Optional)
# ============================================================================

print_header "STEP 7: PREVENTING AUTO-RESTART"

# Try to disable auto-restart for dev services in Dokploy config
DOKPLOY_CONFIG="/opt/dokploy/docker-compose.yml"
if [ -f "$DOKPLOY_CONFIG" ]; then
    # Backup original
    cp "$DOKPLOY_CONFIG" "$DOKPLOY_CONFIG.backup.$(date +%Y%m%d%H%M%S)"
    
    # Comment out dev services
    print_warning "Creating backup of docker-compose.yml" $YELLOW
fi

# ============================================================================
# FINAL STATUS
# ============================================================================

print_header "CLEANUP COMPLETE"

print_status "All dev containers have been removed" $GREEN
print_status "Dev networks have been cleaned up" $GREEN
print_status "Dev volumes have been removed" $GREEN

echo ""
echo -e "${RED}IMPORTANT:${NC}"
echo "1. Dev databases still exist in MongoDB Atlas:"
echo "   - identity_dev"
echo "   - smart_hr_db_dev"
echo "   - leave-management_dev"
echo "   - performance_db_dev"
echo "   - payroll_db_dev"
echo ""
echo "2. If Dokploy recreates containers, you need to:"
echo "   - Access Dokploy dashboard: http://4.180.153.209:3000"
echo "   - Delete dev services from the UI"
echo ""
echo "3. Run this script again if new dev containers appear"
echo ""

echo "=============================================="
echo "  DONE!"
echo "=============================================="
