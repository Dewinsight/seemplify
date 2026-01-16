# Create Cloudflare DNS Records for Semplify
# Usage: .\create-dns-records.ps1 -VMPublicIP "1.2.3.4"
# Or: .\create-dns-records.ps1 (will read from vm-ip.txt)

param(
    [string]$VMPublicIP
)

# Cloudflare credentials for seemplifyai.com
$CLOUDFLARE_API_TOKEN = "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
$CLOUDFLARE_ZONE_ID = "bbc142d2d661d64011e2e4becae7a5c3"

# If no IP provided, try to read from file
if ([string]::IsNullOrEmpty($VMPublicIP)) {
    $vmIpFile = "$PSScriptRoot\vm-ip.txt"
    if (Test-Path $vmIpFile) {
        $VMPublicIP = Get-Content $vmIpFile -Raw
        $VMPublicIP = $VMPublicIP.Trim()
        Write-Host "Using VM IP from file: $VMPublicIP" -ForegroundColor Gray
    } else {
        Write-Host "Error: No VM IP provided and vm-ip.txt not found" -ForegroundColor Red
        Write-Host "Usage: .\create-dns-records.ps1 -VMPublicIP '1.2.3.4'" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Cloudflare DNS Records Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Domain: seemplifyai.com" -ForegroundColor White
Write-Host "VM IP:  $VMPublicIP" -ForegroundColor White
Write-Host ""

# DNS records to create
$records = @(
    @{ name = "@"; description = "Root domain" },
    @{ name = "app"; description = "Recruiter Frontend" },
    @{ name = "api"; description = "Recruiter Backend" },
    @{ name = "leave"; description = "Leave Management Frontend" },
    @{ name = "api-leave"; description = "Leave Management Backend" },
    @{ name = "performance"; description = "Performance Frontend" },
    @{ name = "api-performance"; description = "Performance Backend" },
    @{ name = "payroll"; description = "Payroll Frontend" },
    @{ name = "api-payroll"; description = "Payroll Backend" },
    @{ name = "auth"; description = "Identity Provider" },
    @{ name = "dokploy"; description = "Dokploy Dashboard" }
)

$headers = @{
    "Authorization" = "Bearer $CLOUDFLARE_API_TOKEN"
    "Content-Type" = "application/json"
}

$successCount = 0
$errorCount = 0

foreach ($record in $records) {
    $subdomain = $record.name
    $description = $record.description
    
    $body = @{
        type = "A"
        name = $subdomain
        content = $VMPublicIP
        ttl = 1
        proxied = $true
    } | ConvertTo-Json

    if ($subdomain -eq "@") {
        $fullDomain = "seemplifyai.com"
    } else {
        $fullDomain = "$subdomain.seemplifyai.com"
    }
    
    Write-Host "Creating: $fullDomain ($description)..." -ForegroundColor Yellow -NoNewline
    
    try {
        $response = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" `
            -Method Post `
            -Headers $headers `
            -Body $body `
            -ContentType "application/json" `
            -ErrorAction Stop
        
        if ($response.success) {
            Write-Host " OK" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host " FAILED" -ForegroundColor Red
            Write-Host "  Error: $($response.errors[0].message)" -ForegroundColor Red
            $errorCount++
        }
    }
    catch {
        $errorMessage = $_.Exception.Message
        if ($errorMessage -like "*already exists*" -or $errorMessage -like "*81057*") {
            Write-Host " EXISTS (skipping)" -ForegroundColor Cyan
        } else {
            Write-Host " ERROR" -ForegroundColor Red
            Write-Host "  $errorMessage" -ForegroundColor Red
            $errorCount++
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  DNS Records Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Created: $successCount records" -ForegroundColor Green
if ($errorCount -gt 0) {
    Write-Host "Errors:  $errorCount records" -ForegroundColor Red
}
Write-Host ""
Write-Host "Domain Mapping:" -ForegroundColor Cyan
Write-Host "  app.seemplifyai.com         -> Recruiter Frontend" -ForegroundColor White
Write-Host "  api.seemplifyai.com         -> Recruiter Backend" -ForegroundColor White
Write-Host "  leave.seemplifyai.com       -> Leave Management Frontend" -ForegroundColor White
Write-Host "  api-leave.seemplifyai.com   -> Leave Management Backend" -ForegroundColor White
Write-Host "  performance.seemplifyai.com -> Performance Frontend" -ForegroundColor White
Write-Host "  api-performance.seemplifyai.com -> Performance Backend" -ForegroundColor White
Write-Host "  payroll.seemplifyai.com     -> Payroll Frontend" -ForegroundColor White
Write-Host "  api-payroll.seemplifyai.com -> Payroll Backend" -ForegroundColor White
Write-Host "  auth.seemplifyai.com        -> Identity Provider" -ForegroundColor White
Write-Host "  dokploy.seemplifyai.com     -> Dokploy Dashboard" -ForegroundColor White
Write-Host ""
Write-Host "Note: DNS propagation may take up to 5 minutes" -ForegroundColor Yellow
