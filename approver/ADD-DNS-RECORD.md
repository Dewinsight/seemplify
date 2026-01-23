# Add DNS Record for api.approver.aiinigeria.com

## Option 1: Manual via Cloudflare Dashboard (Easiest)

1. **Go to Cloudflare Dashboard**
   - Visit: https://dash.cloudflare.com
   - Login to your account

2. **Select the Zone**
   - Click on **"aiinigeria.com"** zone (or search for it)

3. **Go to DNS Settings**
   - Click **"DNS"** in the left sidebar
   - Click **"Records"** tab

4. **Add A Record**
   - Click **"Add record"** button
   - Fill in:
     - **Type:** `A`
     - **Name:** `api.approver` (or just `api.approver` if it's a subdomain)
     - **IPv4 address:** `4.180.153.209`
     - **Proxy status:** 
       - ✅ **Proxied** (orange cloud) - Recommended for HTTPS/SSL
       - OR ⚪ **DNS only** (gray cloud) - Direct to server
     - **TTL:** `Auto`
   - Click **"Save"**

5. **Verify**
   - Wait 1-2 minutes for DNS propagation
   - Test: `ping api.approver.aiinigeria.com` (should resolve to `4.180.153.209`)

---

## Option 2: Via Cloudflare API (Automated)

### PowerShell Script

```powershell
# Cloudflare API Configuration
$CLOUDFLARE_API_TOKEN = "YOUR_API_TOKEN_HERE"  # Get from Cloudflare Dashboard → My Profile → API Tokens
$ZONE_ID = "YOUR_ZONE_ID_HERE"  # Get from Cloudflare Dashboard → Zone Overview → Zone ID
$SUBDOMAIN = "api.approver"
$IP_ADDRESS = "4.180.153.209"
$ZONE_NAME = "aiinigeria.com"

# Headers
$headers = @{
    "Authorization" = "Bearer $CLOUDFLARE_API_TOKEN"
    "Content-Type" = "application/json"
}

# Check if record exists
$checkUri = "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=A&name=$SUBDOMAIN.$ZONE_NAME"
$existing = Invoke-RestMethod -Uri $checkUri -Headers $headers -Method Get

if ($existing.result.Count -gt 0) {
    Write-Host "⚠️  Record already exists: $SUBDOMAIN.$ZONE_NAME" -ForegroundColor Yellow
    $recordId = $existing.result[0].id
    Write-Host "   Record ID: $recordId" -ForegroundColor Gray
    
    # Update existing record
    $updateUri = "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$recordId"
    $updateBody = @{
        type = "A"
        name = "$SUBDOMAIN"
        content = $IP_ADDRESS
        ttl = 1  # Auto
        proxied = $true  # Enable Cloudflare proxy (orange cloud)
    } | ConvertTo-Json
    
    $updateResponse = Invoke-RestMethod -Uri $updateUri -Headers $headers -Method Put -Body $updateBody
    if ($updateResponse.success) {
        Write-Host "✅ Updated DNS record: $SUBDOMAIN.$ZONE_NAME -> $IP_ADDRESS" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to update record" -ForegroundColor Red
        $updateResponse.errors | ConvertTo-Json
    }
} else {
    # Create new record
    $createUri = "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"
    $createBody = @{
        type = "A"
        name = "$SUBDOMAIN"
        content = $IP_ADDRESS
        ttl = 1  # Auto
        proxied = $true  # Enable Cloudflare proxy (orange cloud)
    } | ConvertTo-Json
    
    $createResponse = Invoke-RestMethod -Uri $createUri -Headers $headers -Method Post -Body $createBody
    if ($createResponse.success) {
        Write-Host "✅ Created DNS record: $SUBDOMAIN.$ZONE_NAME -> $IP_ADDRESS" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to create record" -ForegroundColor Red
        $createResponse.errors | ConvertTo-Json
    }
}
```

### Bash/curl Script

```bash
#!/bin/bash

# Configuration
CLOUDFLARE_API_TOKEN="YOUR_API_TOKEN_HERE"
ZONE_ID="YOUR_ZONE_ID_HERE"
SUBDOMAIN="api.approver"
IP_ADDRESS="4.180.153.209"
ZONE_NAME="aiinigeria.com"

# Check if record exists
EXISTING=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=A&name=${SUBDOMAIN}.${ZONE_NAME}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json")

RECORD_ID=$(echo "$EXISTING" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$RECORD_ID" ]; then
  echo "⚠️  Record already exists, updating..."
  curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"${SUBDOMAIN}\",\"content\":\"${IP_ADDRESS}\",\"ttl\":1,\"proxied\":true}" | \
    grep -q "\"success\":true" && echo "✅ DNS record updated" || echo "❌ Update failed"
else
  echo "Creating new DNS record..."
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"${SUBDOMAIN}\",\"content\":\"${IP_ADDRESS}\",\"ttl\":1,\"proxied\":true}" | \
    grep -q "\"success\":true" && echo "✅ DNS record created" || echo "❌ Creation failed"
fi
```

---

## How to Get Cloudflare API Token

1. Go to: https://dash.cloudflare.com/profile/api-tokens
2. Click **"Create Token"**
3. Use **"Edit zone DNS"** template
4. Select zone: **aiinigeria.com**
5. Click **"Continue to summary"** → **"Create Token"**
6. Copy the token (you'll only see it once!)

## How to Get Zone ID

1. Go to Cloudflare Dashboard
2. Select **"aiinigeria.com"** zone
3. Scroll down on the **Overview** page
4. Find **"Zone ID"** in the right sidebar
5. Copy it

---

## Verify DNS Record

After adding, verify it works:

```bash
# Check DNS resolution
nslookup api.approver.aiinigeria.com

# Or use dig
dig api.approver.aiinigeria.com +short

# Should return: 4.180.153.209
```

---

## Important Notes

- **Proxied (Orange Cloud):** Recommended - Cloudflare provides SSL, DDoS protection, caching
- **DNS Only (Gray Cloud):** Direct connection - No Cloudflare features, but faster for API endpoints
- **TTL:** Set to `Auto` (1) - Cloudflare manages it automatically
- **Propagation:** Usually takes 1-5 minutes, can take up to 24 hours globally

---

**Recommended:** Use **Option 1 (Manual)** if you're not familiar with APIs. It's faster and easier!
