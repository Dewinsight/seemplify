#!/bin/bash

echo "=== Testing OIDC Flows for All Dev Apps ==="
echo ""

# Test leave
echo "1. Leave Backend Dev:"
REDIRECT=$(curl -s -o /dev/null -w "%{redirect_url}" "https://api-leave-dev.seemplifyai.com/api/auth/oidc/start?returnTo=https://leave-dev.seemplifyai.com")
if echo "$REDIRECT" | grep -q "client_id=leave-management"; then
    echo "   ✅ Using client_id=leave-management"
else
    echo "   ❌ WRONG: $REDIRECT"
fi

# Test recruiter
echo "2. Recruiter Backend Dev:"
REDIRECT=$(curl -s -o /dev/null -w "%{redirect_url}" "https://api-dev.seemplifyai.com/api/auth/oidc/start?returnTo=https://app-dev.seemplifyai.com")
if echo "$REDIRECT" | grep -q "client_id=smarthr-backend"; then
    echo "   ✅ Using client_id=smarthr-backend"
else
    echo "   ❌ WRONG: $REDIRECT"
fi

# Test performance
echo "3. Performance Backend Dev:"
REDIRECT=$(curl -s -o /dev/null -w "%{redirect_url}" "https://api-performance-dev.seemplifyai.com/api/auth/oidc/start?returnTo=https://performance-dev.seemplifyai.com")
if echo "$REDIRECT" | grep -q "client_id=performance-management"; then
    echo "   ✅ Using client_id=performance-management"
else
    echo "   ❌ WRONG: $REDIRECT"
fi

# Test payroll
echo "4. Payroll Backend Dev:"
REDIRECT=$(curl -s -o /dev/null -w "%{redirect_url}" "https://api-payroll-dev.seemplifyai.com/api/auth/oidc/start?returnTo=https://payroll-dev.seemplifyai.com")
if echo "$REDIRECT" | grep -q "client_id=payroll-management"; then
    echo "   ✅ Using client_id=payroll-management"
else
    echo "   ❌ WRONG: $REDIRECT"
fi

echo ""
echo "=== Testing Identity Provider Well-Known Endpoint ==="
curl -s "https://auth-dev.seemplifyai.com/.well-known/openid-configuration" | grep -q "issuer"
if [ $? -eq 0 ]; then
    echo "✅ Identity Provider is responding correctly"
else
    echo "❌ Identity Provider not responding"
fi
