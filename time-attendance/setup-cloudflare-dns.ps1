# Setup Cloudflare DNS Records for Time Attendance
# This script creates DNS records for time-attendance backend and frontend

$CLOUDFLARE_ZONE_ID = "bbc142d2d661d64011e2e4becae7a5c3"
$SERVER_IP = "4.180.153.209"

# Get Cloudflare API token from environment or prompt
$CLOUDFLARE_API_TOKEN = $env:CLOUDFLARE_API_TOKEN
if (-not $CLOUDFLARE_API_TOKEN) {
    Write-Host "⚠️  CLOUDFLARE_API_TOKEN not found in environment" -ForegroundColor Yellow
    Write-Host "Please set it: `$env:CLOUDFLARE_API_TOKEN = 'your-token-here'" -ForegroundColor Yellow
    Write-Host "Or read from access/CLOUDFLARE-CREDENTIALS.md" -ForegroundColor Yellow
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Time Attendance DNS Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to create DNS record
function Create-DNSRecord {
    param(
        [string]$Name,
        [string]$Type,
        [string]$Content,
        [bool]$Proxied = $true
    )
    
    $url = "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records"
    $headers = @{
        "Authorization" = "Bearer $CLOUDFLARE_API_TOKEN"
        "Content-Type" = "application/json"
    }
    
    $body = @{
        type = $Type
        name = $Name
        content = $Content
        ttl = 1  # Auto TTL
        proxied = $Proxied
    } | ConvertTo-Json
    
    Write-Host "Creating DNS record: $Name -> $Content" -ForegroundColor White
    
    try {
        $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
        if ($response.success) {
            Write-Host "✅ Created: $Name ($($response.result.type)) -> $Content" -ForegroundColor Green
            return $response.result
        } else {
            Write-Host "❌ Failed to create $Name" -ForegroundColor Red
            Write-Host "Errors: $($response.errors | ConvertTo-Json)" -ForegroundColor Red
            return $null
        }
    } catch {
        Write-Host "❌ Error creating $Name : $_" -ForegroundColor Red
        return $null
    }
}

# Check if records already exist
function Check-DNSRecord {
    param([string]$Name)
    
    $url = "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records?name=$Name"
    $headers = @{
        "Authorization" = "Bearer $CLOUDFLARE_API_TOKEN"
    }
    
    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -Headers $headers
        if ($response.success -and $response.result.Count -gt 0) {
            return $response.result[0]
        }
    } catch {
        # Ignore errors, record doesn't exist
    }
    return $null
}

# Create Backend DNS Record
Write-Host "📡 Setting up Backend DNS (api-time.seemplifyai.com)..." -ForegroundColor Cyan
$backendRecord = Check-DNSRecord "api-time.seemplifyai.com"
if ($backendRecord) {
    Write-Host "⚠️  DNS record already exists: api-time.seemplifyai.com -> $($backendRecord.content)" -ForegroundColor Yellow
} else {
    $backendRecord = Create-DNSRecord -Name "api-time" -Type "A" -Content $SERVER_IP -Proxied $true
}

Write-Host ""

# Create Frontend DNS Record
Write-Host "📡 Setting up Frontend DNS (time.seemplifyai.com)..." -ForegroundColor Cyan
$frontendRecord = Check-DNSRecord "time.seemplifyai.com"
if ($frontendRecord) {
    Write-Host "⚠️  DNS record already exists: time.seemplifyai.com -> $($frontendRecord.content)" -ForegroundColor Yellow
} else {
    $frontendRecord = Create-DNSRecord -Name "time" -Type "A" -Content $SERVER_IP -Proxied $true
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DNS Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "✅ Backend API: https://api-time.seemplifyai.com" -ForegroundColor Green
Write-Host "✅ Frontend App: https://time.seemplifyai.com" -ForegroundColor Green
Write-Host ""
Write-Host "Note: DNS propagation may take a few minutes." -ForegroundColor Yellow
Write-Host ""
