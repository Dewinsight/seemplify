#!/bin/bash
echo "=== BACKEND APP HEALTH CHECK ==="

echo ""
echo "--- recruiter-backend ---"
CONTAINER=$(docker ps --format '{{.Names}}' | grep recruiter-backend | head -1)
docker logs "$CONTAINER" 2>&1 | grep -E "(MongoDB Connected|listening|error|Error)" | tail -5

echo ""
echo "--- leave-backend ---"
CONTAINER=$(docker ps --format '{{.Names}}' | grep leave-backend | head -1)
docker logs "$CONTAINER" 2>&1 | grep -E "(MongoDB|listening|connected|error|Error|running)" | tail -5

echo ""
echo "--- performance-backend ---"
CONTAINER=$(docker ps --format '{{.Names}}' | grep performance-backend | head -1)
docker logs "$CONTAINER" 2>&1 | grep -E "(MongoDB|listening|connected|error|Error|running)" | tail -5

echo ""
echo "--- payroll-backend ---"
CONTAINER=$(docker ps --format '{{.Names}}' | grep payroll-backend | head -1)
docker logs "$CONTAINER" 2>&1 | grep -E "(MongoDB|listening|connected|error|Error|running)" | tail -5

echo ""
echo "--- identity-provider ---"
CONTAINER=$(docker ps --format '{{.Names}}' | grep identity-provider | head -1)
docker logs "$CONTAINER" 2>&1 | grep -E "(MongoDB|listening|connected|running|PRODUCTION)" | tail -5
