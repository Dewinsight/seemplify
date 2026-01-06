# Publisher Verification Setup for Seemplify Azure App
# This script helps set up publisher verification for multi-tenant apps

$AppId = "695c5999-398d-47c7-b04d-4541519029e4"
$AppObjectId = "1d03e0c9-4c8e-4ad1-9614-e45826f12cf5"
$CustomDomain = "seemplifyai.com"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Publisher Verification Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[INFO] App is now multi-tenant and can accept ANY Microsoft account" -ForegroundColor Green
Write-Host "[INFO] To remove 'Unverified Publisher' warning, we need Publisher Verification" -ForegroundColor Yellow
Write-Host ""

# Step 1: Check if custom domain is added
Write-Host "Step 1: Checking if seemplifyai.com is added to Azure AD..." -ForegroundColor Yellow
$domains = az rest --method GET --uri "https://graph.microsoft.com/v1.0/domains" | ConvertFrom-Json
$customDomainExists = $domains.value | Where-Object { $_.id -eq $CustomDomain }

if ($customDomainExists) {
    if ($customDomainExists.isVerified) {
        Write-Host "[OK] $CustomDomain is already verified in Azure AD!" -ForegroundColor Green
    }
    else {
        Write-Host "[WARNING] $CustomDomain is added but NOT verified" -ForegroundColor Yellow
        Write-Host "You need to add DNS records to verify the domain" -ForegroundColor Yellow
    }
}
else {
    Write-Host "[INFO] $CustomDomain is not added to Azure AD yet" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To add and verify seemplifyai.com:" -ForegroundColor Cyan
    Write-Host "1. Go to Azure Portal: https://portal.azure.com" -ForegroundColor White
    Write-Host "2. Navigate to: Azure Active Directory > Custom domain names" -ForegroundColor White
    Write-Host "3. Click: Add custom domain" -ForegroundColor White
    Write-Host "4. Enter: seemplifyai.com" -ForegroundColor White
    Write-Host "5. Add the DNS TXT record shown to your Cloudflare DNS" -ForegroundColor White
    Write-Host "6. Click: Verify" -ForegroundColor White
    Write-Host ""
    Write-Host "OR add it via CLI:" -ForegroundColor Cyan
    Write-Host "  az rest --method POST --uri 'https://graph.microsoft.com/v1.0/domains' --body '{\"id\": \"seemplifyai.com\"}'" -ForegroundColor Gray
    Write-Host ""
    
    $addDomain = Read-Host "Would you like to add seemplifyai.com now? (y/n)"
    if ($addDomain -eq 'y' -or $addDomain -eq 'Y') {
        Write-Host ""
        Write-Host "Adding domain..." -ForegroundColor Yellow
        
        try {
            $result = az rest --method POST --uri "https://graph.microsoft.com/v1.0/domains" --body "{`"id`": `"$CustomDomain`"}" 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[OK] Domain added! Now you need to verify it." -ForegroundColor Green
                Write-Host ""
                
                # Get verification records
                $verificationRecords = az rest --method GET --uri "https://graph.microsoft.com/v1.0/domains/$CustomDomain/verificationDnsRecords" | ConvertFrom-Json
                
                Write-Host "Add these DNS records to Cloudflare:" -ForegroundColor Cyan
                Write-Host ""
                foreach ($record in $verificationRecords.value) {
                    Write-Host "Record Type: $($record.recordType)" -ForegroundColor Yellow
                    Write-Host "Name: $($record.label)" -ForegroundColor White
                    Write-Host "Value: $($record.text)" -ForegroundColor White
                    Write-Host "TTL: 3600" -ForegroundColor White
                    Write-Host ""
                }
                
                Write-Host "After adding DNS records, verify with:" -ForegroundColor Cyan
                Write-Host "  az rest --method POST --uri 'https://graph.microsoft.com/v1.0/domains/$CustomDomain/verify'" -ForegroundColor Gray
            }
            else {
                Write-Host "[ERROR] Failed to add domain: $result" -ForegroundColor Red
            }
        }
        catch {
            Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Step 2: Apply for Publisher Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Publisher Verification Options:" -ForegroundColor Yellow
Write-Host ""
Write-Host "Option A: Via Azure Portal (Recommended)" -ForegroundColor Cyan
Write-Host "1. Go to: https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Branding/appId/$AppId" -ForegroundColor White
Write-Host "2. Click: Branding & properties" -ForegroundColor White
Write-Host "3. Scroll to: Publisher verification" -ForegroundColor White
Write-Host "4. Click: Add MPN ID to verify publisher" -ForegroundColor White
Write-Host "5. Follow the instructions to complete verification" -ForegroundColor White
Write-Host ""

Write-Host "Option B: Microsoft Partner Network (MPN)" -ForegroundColor Cyan
Write-Host "1. Sign up for Microsoft Partner Network: https://partner.microsoft.com" -ForegroundColor White
Write-Host "2. Get your MPN ID (Partner Location ID)" -ForegroundColor White
Write-Host "3. Link it to your Azure app in the Branding section" -ForegroundColor White
Write-Host ""

Write-Host "Option C: Domain Verification (If seemplifyai.com is verified)" -ForegroundColor Cyan
Write-Host "1. Ensure seemplifyai.com is verified in Azure AD" -ForegroundColor White
Write-Host "2. Set publisher domain: seemplifyai.com" -ForegroundColor White
Write-Host "3. This reduces warnings even without full publisher verification" -ForegroundColor White
Write-Host ""

# Set publisher domain if custom domain is verified
if ($customDomainExists -and $customDomainExists.isVerified) {
    Write-Host "Setting publisher domain to seemplifyai.com..." -ForegroundColor Yellow
    az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$AppObjectId" --body "{`"publisherDomain`": `"$CustomDomain`"}" | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Publisher domain set to $CustomDomain" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Current Status" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "App Configuration:" -ForegroundColor Yellow
Write-Host "  App ID: $AppId" -ForegroundColor White
Write-Host "  Sign-in Audience: AzureADandPersonalMicrosoftAccount (Multi-tenant)" -ForegroundColor White
Write-Host "  Access Token Version: v2" -ForegroundColor White
Write-Host "  Home Page: https://seemplifyai.com" -ForegroundColor White
Write-Host "  Privacy Policy: https://seemplifyai.com/privacy-policy" -ForegroundColor White
Write-Host "  Terms of Service: https://seemplifyai.com/terms" -ForegroundColor White
Write-Host ""

$currentPublisher = az ad app show --id $AppId --query "verifiedPublisher" -o json | ConvertFrom-Json
if ($currentPublisher.verifiedPublisherId) {
    Write-Host "[OK] Publisher Verification: VERIFIED" -ForegroundColor Green
    Write-Host "  Verified Publisher: $($currentPublisher.displayName)" -ForegroundColor White
}
else {
    Write-Host "[WARNING] Publisher Verification: UNVERIFIED" -ForegroundColor Yellow
    Write-Host "  Users will see 'Unverified' warning during consent" -ForegroundColor Yellow
    Write-Host "  Complete steps above to verify publisher" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Next Steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Add and verify seemplifyai.com domain in Azure AD" -ForegroundColor Yellow
Write-Host "2. Apply for Publisher Verification via Azure Portal" -ForegroundColor Yellow
Write-Host "3. Wait 1-7 days for Microsoft to review" -ForegroundColor Yellow
Write-Host "4. Once verified, the 'Unverified' warning will disappear" -ForegroundColor Yellow
Write-Host ""
Write-Host "Your app NOW works for ANY Microsoft user (multi-tenant)" -ForegroundColor Green
Write-Host "Publisher verification just removes the warning banner" -ForegroundColor Green
Write-Host ""

Write-Host "[OK] Multi-tenant configuration complete!" -ForegroundColor Green
