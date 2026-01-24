# Add DNS Record for api.approver.aiinigeria.com - PowerShell Script

# Configuration - UPDATE THESE VALUES
$CLOUDFLARE_API_TOKEN = "YOUR_API_TOKEN_HERE"  # Get from Cloudflare Dashboard → My Profile → API Tokens
$ZONE_ID = "YOUR_ZONE_ID_HERE"  # Get from Cloudflare Dashboard → Zone Overview → Zone ID
$SUBDOMAIN = "api.approver"
$IP_ADDRESS = "4.180.153.209"
$ZONE_NAME = "aiinigeria.com"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Add DNS Record: api.approver.aiinigeria.com" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Validate configuration
if ($CLOUDFLARE_API_TOKEN -eq "YOUR_API_TOKEN_HERE" -or $ZONE_ID -eq "YOUR_ZONE_ID_HERE") {
    Write-Host "❌ ERROR: Please update CLOUDFLARE_API_TOKEN and ZONE_ID in the script!" -ForegroundColor Red
    Write-Host ""
    Write-Host "How to get API Token:" -ForegroundColor Yellow
    Write-Host "  1. Go to: https://dash.cloudflare.com/profile/api-tokens" -ForegroundColor Gray
    Write-Host "  2. Click 'Create Token' → Use 'Edit zone DNS' template" -ForegroundColor Gray
    Write-Host "  3. Select zone: aiinigeria.com" -ForegroundColor Gray
    Write-Host ""
    Write-Host "How to get Zone ID:" -ForegroundColor Yellow
    Write-Host "  1. Go to Cloudflare Dashboard → Select aiinigeria.com zone" -ForegroundColor Gray
    Write-Host "  2. Scroll down on Overview page → Find 'Zone ID' in right sidebar" -ForegroundColor Gray
    exit 1
}

# Headers
$headers = @{
    "Authorization" = "Bearer $CLOUDFLARE_API_TOKEN"
    "Content-Type" = "application/json"
}

$fullDomain = "$SUBDOMAIN.$ZONE_NAME"
Write-Host "Target: $fullDomain -> $IP_ADDRESS" -ForegroundColor Yellow
Write-Host ""

# Check if record exists
Write-Host "Checking for existing record..." -ForegroundColor Gray
$checkUri = "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=A&name=$fullDomain"
try {
    $existing = Invoke-RestMethod -Uri $checkUri -Headers $headers -Method Get
    
    if ($existing.result.Count -gt 0) {
        Write-Host "⚠️  Record already exists: $fullDomain" -ForegroundColor Yellow
        $recordId = $existing.result[0].id
        $currentIp = $existing.result[0].content
        Write-Host "   Current IP: $currentIp" -ForegroundColor Gray
        Write-Host "   Record ID: $recordId" -ForegroundColor Gray
        Write-Host ""
        
        if ($currentIp -eq $IP_ADDRESS) {
            Write-Host "✅ Record already points to correct IP. No update needed." -ForegroundColor Green
            exit 0
        }
        
        # Update existing record
        Write-Host "Updating record..." -ForegroundColor Gray
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
            Write-Host "✅ Updated DNS record: $fullDomain -> $IP_ADDRESS" -ForegroundColor Green
            Write-Host "   Proxy: Enabled (Orange Cloud)" -ForegroundColor Gray
        } else {
            Write-Host "❌ Failed to update record" -ForegroundColor Red
            $updateResponse.errors | ConvertTo-Json | Write-Host
            exit 1
        }
    } else {
        # Create new record
        Write-Host "Creating new DNS record..." -ForegroundColor Gray
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
            Write-Host "✅ Created DNS record: $fullDomain -> $IP_ADDRESS" -ForegroundColor Green
            Write-Host "   Proxy: Enabled (Orange Cloud)" -ForegroundColor Gray
            Write-Host "   Record ID: $($createResponse.result.id)" -ForegroundColor Gray
        } else {
            Write-Host "❌ Failed to create record" -ForegroundColor Red
            $createResponse.errors | ConvertTo-Json | Write-Host
            exit 1
        }
    }
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DNS Record Added Successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Wait 1-5 minutes for DNS propagation" -ForegroundColor Gray
Write-Host "  2. Test: ping api.approver.aiinigeria.com" -ForegroundColor Gray
Write-Host "  3. Verify SSL certificate is generated in Dokploy" -ForegroundColor Gray
Write-Host ""
