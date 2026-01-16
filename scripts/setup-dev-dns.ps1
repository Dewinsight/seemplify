# Setup Development Environment DNS Records in Cloudflare
# This script creates all -dev subdomain DNS records for the development environment

param(
    [switch]$DryRun = $false
)

# Cloudflare Configuration
$ZONE_ID = "bbc142d2d661d64011e2e4becae7a5c3"
$API_TOKEN = "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
$AZURE_VM_IP = "4.180.153.209"
$ZONE_NAME = "seemplifyai.com"

# Dev domains to create
$devDomains = @(
    "auth-dev",
    "api-dev",
    "app-dev",
    "api-leave-dev",
    "leave-dev",
    "api-performance-dev",
    "performance-dev",
    "api-payroll-dev",
    "payroll-dev"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Cloudflare Dev DNS Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Zone: $ZONE_NAME" -ForegroundColor Yellow
Write-Host "Target IP: $AZURE_VM_IP" -ForegroundColor Yellow
Write-Host "Records to create: $($devDomains.Count)" -ForegroundColor Yellow
Write-Host ""

if ($DryRun) {
    Write-Host "🔍 DRY RUN MODE - No changes will be made" -ForegroundColor Magenta
    Write-Host ""
}

# Function to create DNS record
function Create-DNSRecord {
    param(
        [string]$subdomain,
        [string]$ip,
        [bool]$isDryRun
    )
    
    $fullDomain = "$subdomain.$ZONE_NAME"
    
    if ($isDryRun) {
        Write-Host "  [DRY RUN] Would create: $fullDomain -> $ip" -ForegroundColor Gray
        return $true
    }
    
    # Cloudflare API endpoint
    $uri = "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"
    
    # Request body
    $body = @{
        type = "A"
        name = $subdomain
        content = $ip
        ttl = 1  # Auto
        proxied = $true  # Enable Cloudflare proxy (orange cloud)
    } | ConvertTo-Json
    
    # Headers
    $headers = @{
        "Authorization" = "Bearer $API_TOKEN"
        "Content-Type" = "application/json"
    }
    
    try {
        $response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body
        
        if ($response.success) {
            Write-Host "  ✅ Created: $fullDomain -> $ip" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  ❌ Failed: $fullDomain" -ForegroundColor Red
            Write-Host "     Error: $($response.errors | ConvertTo-Json)" -ForegroundColor Red
            return $false
        }
    }
    catch {
        # Check if record already exists
        if ($_.Exception.Response.StatusCode -eq 409) {
            Write-Host "  ⚠️  Already exists: $fullDomain" -ForegroundColor Yellow
            return $true
        }
        else {
            Write-Host "  ❌ Error creating $fullDomain" -ForegroundColor Red
            Write-Host "     $($_.Exception.Message)" -ForegroundColor Red
            return $false
        }
    }
}

# Function to check if DNS record exists
function Test-DNSRecord {
    param(
        [string]$subdomain
    )
    
    $uri = "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=$subdomain.$ZONE_NAME"
    $headers = @{
        "Authorization" = "Bearer $API_TOKEN"
        "Content-Type" = "application/json"
    }
    
    try {
        $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
        return ($response.result.Count -gt 0)
    }
    catch {
        return $false
    }
}

# Main execution
Write-Host "Starting DNS record creation..." -ForegroundColor Cyan
Write-Host ""

$successCount = 0
$failCount = 0
$existsCount = 0

foreach ($domain in $devDomains) {
    Write-Host "Processing: $domain.$ZONE_NAME" -ForegroundColor White
    
    # Check if record exists (only if not dry run)
    if (-not $DryRun) {
        if (Test-DNSRecord -subdomain $domain) {
            Write-Host "  ⚠️  Record already exists, skipping" -ForegroundColor Yellow
            $existsCount++
            continue
        }
    }
    
    # Create the record
    $result = Create-DNSRecord -subdomain $domain -ip $AZURE_VM_IP -isDryRun $DryRun
    
    if ($result) {
        $successCount++
    } else {
        $failCount++
    }
    
    # Small delay to avoid rate limiting
    Start-Sleep -Milliseconds 500
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Successfully created: $successCount" -ForegroundColor Green
Write-Host "⚠️  Already existed: $existsCount" -ForegroundColor Yellow
Write-Host "❌ Failed: $failCount" -ForegroundColor Red
Write-Host ""

if ($DryRun) {
    Write-Host "This was a DRY RUN. To actually create the records, run:" -ForegroundColor Magenta
    Write-Host "  .\scripts\setup-dev-dns.ps1" -ForegroundColor White
} else {
    Write-Host "DNS records created. Verifying propagation..." -ForegroundColor Cyan
    Write-Host ""
    
    # Test DNS propagation
    Write-Host "Testing DNS resolution (may take a few minutes to propagate):" -ForegroundColor Yellow
    Write-Host ""
    
    foreach ($domain in $devDomains) {
        $fullDomain = "$domain.$ZONE_NAME"
        try {
            $resolved = Resolve-DnsName -Name $fullDomain -Type A -ErrorAction SilentlyContinue
            if ($resolved) {
                Write-Host "  ✅ $fullDomain resolves to: $($resolved.IPAddress)" -ForegroundColor Green
            } else {
                Write-Host "  ⏳ $fullDomain not yet propagated" -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host "  ⏳ $fullDomain not yet propagated" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "✅ DNS setup complete!" -ForegroundColor Green
    Write-Host "Note: DNS propagation may take up to 5 minutes." -ForegroundColor Gray
}
