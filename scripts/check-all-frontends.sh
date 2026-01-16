#!/bin/bash
echo "=============================================="
echo "  CHECKING ALL FRONTEND CONFIGURATIONS"
echo "=============================================="

echo ""
echo "=== RECRUITER FRONTEND ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep recruiter-frontend | head -1)
echo "Container: $CONTAINER"
docker exec $CONTAINER printenv | grep -E "(NEXT_PUBLIC|API_URL|IDP)" 2>/dev/null || echo "No env vars found"
echo "localhost:5001 count: $(docker exec $CONTAINER grep -r 'localhost:5001' .next/static 2>/dev/null | wc -l)"
echo "api.seemplifyai.com count: $(docker exec $CONTAINER grep -r 'api.seemplifyai.com' .next/static 2>/dev/null | wc -l)"

echo ""
echo "=== LEAVE FRONTEND ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep leave-frontend | head -1)
echo "Container: $CONTAINER"
docker exec $CONTAINER printenv | grep -E "(NEXT_PUBLIC|API_URL|IDP)" 2>/dev/null || echo "No env vars found"
echo "localhost:5002 count: $(docker exec $CONTAINER grep -r 'localhost:5002' .next/static 2>/dev/null | wc -l)"
echo "api-leave.seemplifyai.com count: $(docker exec $CONTAINER grep -r 'api-leave.seemplifyai.com' .next/static 2>/dev/null | wc -l)"

echo ""
echo "=== PERFORMANCE FRONTEND ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep performance-frontend | head -1)
echo "Container: $CONTAINER"
docker exec $CONTAINER printenv | grep -E "(NEXT_PUBLIC|API_URL|IDP)" 2>/dev/null || echo "No env vars found"
echo "localhost:5004 count: $(docker exec $CONTAINER grep -r 'localhost:5004' .next/static 2>/dev/null | wc -l)"
echo "api-performance.seemplifyai.com count: $(docker exec $CONTAINER grep -r 'api-performance.seemplifyai.com' .next/static 2>/dev/null | wc -l)"

echo ""
echo "=== PAYROLL FRONTEND ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep payroll-frontend | head -1)
echo "Container: $CONTAINER"
docker exec $CONTAINER printenv | grep -E "(NEXT_PUBLIC|API_URL|IDP)" 2>/dev/null || echo "No env vars found"
echo "localhost:5006 count: $(docker exec $CONTAINER grep -r 'localhost:5006' .next/static 2>/dev/null | wc -l)"
echo "api-payroll.seemplifyai.com count: $(docker exec $CONTAINER grep -r 'api-payroll.seemplifyai.com' .next/static 2>/dev/null | wc -l)"

echo ""
echo "=== IDENTITY PROVIDER ==="
CONTAINER=$(docker ps --format '{{.Names}}' | grep identity-provider | head -1)
echo "Container: $CONTAINER"
docker exec $CONTAINER printenv | grep -E "(ISSUER|SMARTHR|LEAVE|PERFORMANCE|PAYROLL)" 2>/dev/null | head -10 || echo "No env vars found"
