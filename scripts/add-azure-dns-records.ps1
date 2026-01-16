# Add Azure Domain Verification DNS Records to Cloudflare
# For Azure AD Publisher Verification

$CloudflareToken = "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
$Domain = "seemplifyai.com"
$TxtValue = "MS=ms18526375"
$MxValue = "ms18526375.msv1.invalid"
$MxPriority = 32767

$headers = @{
    "Authorization" = "Bearer $CloudflareToken"
    "Content-Type" = "application/json"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Azure DNS Verification Record Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Get Zone ID for seemplifyai.com
Write-Host "Step 1: Getting Zone ID for $Domain..." -ForegroundColor Yellow

try {
    $zonesResponse = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones?name=$Domain" `
        -Headers $headers `
        -Method GET
    
    if ($zonesResponse.result.Count -eq 0) {
        Write-Host "[ERROR] Domain $Domain not found in Cloudflare" -ForegroundColor Red
        exit 1
    }
    
    $zoneId = $zonesResponse.result[0].id
    Write-Host "[OK] Zone ID: $zoneId" -ForegroundColor Green
    Write-Host ""
}
catch {
    Write-Host "[ERROR] Failed to get zone ID: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 2: Check existing DNS records
Write-Host "Step 2: Checking existing DNS records..." -ForegroundColor Yellow

try {
    $existingRecords = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" `
        -Headers $headers `
        -Method GET
    
    # Check for existing TXT record with MS= value
    $existingTxt = $existingRecords.result | Where-Object { 
        $_.type -eq "TXT" -and $_.content -like "MS=*" 
    }
    
    # Check for existing MX record with .msv1.invalid value
    $existingMx = $existingRecords.result | Where-Object { 
        $_.type -eq "MX" -and $_.content -like "*.msv1.invalid" 
    }
    
    if ($existingTxt) {
        Write-Host "[INFO] Found existing Azure verification TXT record: $($existingTxt.content)" -ForegroundColor Yellow
        Write-Host "       Will delete and recreate..." -ForegroundColor Yellow
        
        Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records/$($existingTxt.id)" `
            -Headers $headers `
            -Method DELETE | Out-Null
        Write-Host "[OK] Old TXT record deleted" -ForegroundColor Green
    }
    
    if ($existingMx) {
        Write-Host "[INFO] Found existing Azure verification MX record: $($existingMx.content)" -ForegroundColor Yellow
        Write-Host "       Will delete and recreate..." -ForegroundColor Yellow
        
        Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records/$($existingMx.id)" `
            -Headers $headers `
            -Method DELETE | Out-Null
        Write-Host "[OK] Old MX record deleted" -ForegroundColor Green
    }
    
    Write-Host ""
}
catch {
    Write-Host "[WARNING] Could not check existing records: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host ""
}

# Step 3: Add TXT record
Write-Host "Step 3: Adding TXT record..." -ForegroundColor Yellow
Write-Host "  Type: TXT" -ForegroundColor Gray
Write-Host "  Name: @ (root)" -ForegroundColor Gray
Write-Host "  Value: $TxtValue" -ForegroundColor Gray

try {
    $txtBody = @{
        type = "TXT"
        name = "@"
        content = $TxtValue
        ttl = 3600
        proxied = $false
    } | ConvertTo-Json
    
    $txtResponse = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" `
        -Headers $headers `
        -Method POST `
        -Body $txtBody
    
    if ($txtResponse.success) {
        Write-Host "[OK] TXT record added successfully!" -ForegroundColor Green
        Write-Host "  Record ID: $($txtResponse.result.id)" -ForegroundColor White
    }
    else {
        Write-Host "[ERROR] Failed to add TXT record" -ForegroundColor Red
        Write-Host "  Errors: $($txtResponse.errors | ConvertTo-Json)" -ForegroundColor Red
    }
    Write-Host ""
}
catch {
    Write-Host "[ERROR] Failed to add TXT record: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
}

# Step 4: Add MX record
Write-Host "Step 4: Adding MX record..." -ForegroundColor Yellow
Write-Host "  Type: MX" -ForegroundColor Gray
Write-Host "  Name: @ (root)" -ForegroundColor Gray
Write-Host "  Value: $MxValue" -ForegroundColor Gray
Write-Host "  Priority: $MxPriority" -ForegroundColor Gray

try {
    $mxBody = @{
        type = "MX"
        name = "@"
        content = $MxValue
        priority = $MxPriority
        ttl = 3600
    } | ConvertTo-Json
    
    $mxResponse = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" `
        -Headers $headers `
        -Method POST `
        -Body $mxBody
    
    if ($mxResponse.success) {
        Write-Host "[OK] MX record added successfully!" -ForegroundColor Green
        Write-Host "  Record ID: $($mxResponse.result.id)" -ForegroundColor White
    }
    else {
        Write-Host "[ERROR] Failed to add MX record" -ForegroundColor Red
        Write-Host "  Errors: $($mxResponse.errors | ConvertTo-Json)" -ForegroundColor Red
    }
    Write-Host ""
}
catch {
    Write-Host "[ERROR] Failed to add MX record: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
}

# Step 5: Verify records were added
Write-Host "Step 5: Verifying DNS records..." -ForegroundColor Yellow

try {
    $verifyRecords = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" `
        -Headers $headers `
        -Method GET
    
    $txtRecord = $verifyRecords.result | Where-Object { 
        $_.type -eq "TXT" -and $_.content -eq $TxtValue 
    }
    
    $mxRecord = $verifyRecords.result | Where-Object { 
        $_.type -eq "MX" -and $_.content -eq $MxValue 
    }
    
    Write-Host ""
    Write-Host "DNS Records Status:" -ForegroundColor Cyan
    
    if ($txtRecord) {
        Write-Host "[OK] TXT Record Found:" -ForegroundColor Green
        Write-Host "  Name: $($txtRecord.name)" -ForegroundColor White
        Write-Host "  Content: $($txtRecord.content)" -ForegroundColor White
        Write-Host "  TTL: $($txtRecord.ttl)" -ForegroundColor White
    }
    else {
        Write-Host "[ERROR] TXT record not found!" -ForegroundColor Red
    }
    
    Write-Host ""
    
    if ($mxRecord) {
        Write-Host "[OK] MX Record Found:" -ForegroundColor Green
        Write-Host "  Name: $($mxRecord.name)" -ForegroundColor White
        Write-Host "  Content: $($mxRecord.content)" -ForegroundColor White
        Write-Host "  Priority: $($mxRecord.priority)" -ForegroundColor White
        Write-Host "  TTL: $($mxRecord.ttl)" -ForegroundColor White
    }
    else {
        Write-Host "[ERROR] MX record not found!" -ForegroundColor Red
    }
}
catch {
    Write-Host "[WARNING] Could not verify records: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Next Steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Wait 5-60 minutes for DNS propagation" -ForegroundColor Yellow
Write-Host ""
Write-Host "2. Check DNS propagation status:" -ForegroundColor Yellow
Write-Host "   https://dnschecker.org/#TXT/seemplifyai.com" -ForegroundColor White
Write-Host ""
Write-Host "3. Verify domain in Azure AD:" -ForegroundColor Yellow
Write-Host "   az rest --method POST --uri 'https://graph.microsoft.com/v1.0/domains/seemplifyai.com/verify'" -ForegroundColor White
Write-Host ""
Write-Host "4. Apply for Publisher Verification:" -ForegroundColor Yellow
Write-Host "   https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Branding/appId/695c5999-398d-47c7-b04d-4541519029e4" -ForegroundColor White
Write-Host ""
Write-Host "[OK] DNS records setup complete!" -ForegroundColor Green
