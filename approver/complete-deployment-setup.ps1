# Complete Approver Deployment Setup
# Updates GitHub secrets, sets env vars, verifies domain, and triggers deployment

$ErrorActionPreference = 'Stop'

# Configuration
$APP_ID = '9e7b7b2a-e8ba-4eac-8e2e-28216ee621cf'
$DOKPLOY_URL = 'http://4.180.153.209:3000'
$DOKPLOY_TOKEN = 'sk_dokploy_b6178e414ec737424c7d0ecf20cddd51'
$DOMAIN = 'approver.aiinigeria.com'

# MongoDB connection string (from access/SERVER-ACCESS.md)
$MONGO_URI = 'mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/approver?retryWrites=true&w=majority&appName=Cluster0'

Write-Host '=== Complete Approver Deployment Setup ===' -ForegroundColor Cyan
Write-Host ''

# Step 1: Update GitHub Secret
Write-Host 'Step 1: Updating GitHub secret APPROVER_APP_ID...' -ForegroundColor Yellow
try {
    $ghResult = gh secret set APPROVER_APP_ID --body $APP_ID 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ GitHub secret APPROVER_APP_ID updated to: $APP_ID" -ForegroundColor Green
    } else {
        Write-Host "⚠️  GitHub CLI not available or not authenticated. Please run manually:" -ForegroundColor Yellow
        Write-Host "   gh secret set APPROVER_APP_ID --body `"$APP_ID`"" -ForegroundColor Gray
    }
} catch {
    Write-Host "⚠️  GitHub CLI error. Please update manually:" -ForegroundColor Yellow
    Write-Host "   gh secret set APPROVER_APP_ID --body `"$APP_ID`"" -ForegroundColor Gray
}
Write-Host ''

# Step 2: Set Environment Variables via Dokploy API
Write-Host 'Step 2: Setting environment variables in Dokploy...' -ForegroundColor Yellow

$envVars = @{
    NODE_ENV = 'production'
    PORT = '80'
    MONGO_URI = $MONGO_URI
    FRONTEND_URL = "https://$DOMAIN"
}

# Convert to Dokploy format (key=value\nkey=value)
$envString = ($envVars.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"

$headers = @{
    'x-api-key' = $DOKPLOY_TOKEN
    'Content-Type' = 'application/json'
}

try {
    $body = @{
        applicationId = $APP_ID
        env = $envString
    } | ConvertTo-Json -Compress

    $response = Invoke-RestMethod -Uri "$DOKPLOY_URL/api/application.saveEnvironment" `
        -Method POST -Headers $headers -Body $body -ErrorAction Stop
    
    Write-Host '✅ Environment variables set successfully' -ForegroundColor Green
    Write-Host "   NODE_ENV=production" -ForegroundColor Gray
    Write-Host "   PORT=80" -ForegroundColor Gray
    Write-Host "   MONGO_URI=***" -ForegroundColor Gray
    Write-Host "   FRONTEND_URL=https://$DOMAIN" -ForegroundColor Gray
} catch {
    Write-Host "❌ Failed to set environment variables: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Please set them manually in Dokploy UI:" -ForegroundColor Yellow
    Write-Host "   - Go to: $DOKPLOY_URL" -ForegroundColor Gray
    Write-Host "   - Navigate to: approver project → approver app → Settings → Environment" -ForegroundColor Gray
    foreach ($key in $envVars.Keys) {
        Write-Host "   - $key = $($envVars[$key])" -ForegroundColor Gray
    }
}
Write-Host ''

# Step 3: Verify Domain Configuration
Write-Host 'Step 3: Verifying domain configuration...' -ForegroundColor Yellow
try {
    $domainResponse = Invoke-RestMethod -Uri "$DOKPLOY_URL/api/domain.byApplicationId?applicationId=$APP_ID" `
        -Method GET -Headers $headers -ErrorAction Stop
    
    $domainList = if ($domainResponse -is [array]) { $domainResponse } else { @($domainResponse) }
    $ourDomain = $domainList | Where-Object { $_.host -eq $DOMAIN -or $_.domain -eq $DOMAIN } | Select-Object -First 1
    
    if ($ourDomain) {
        Write-Host "✅ Domain configured: $DOMAIN" -ForegroundColor Green
        Write-Host "   HTTPS: $($ourDomain.https)" -ForegroundColor Gray
        Write-Host "   Certificate: $($ourDomain.certificateType)" -ForegroundColor Gray
    } else {
        Write-Host "⚠️  Domain not found in API response. It may still be configured in database." -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  Could not verify domain via API: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "   Domain should be configured: $DOMAIN" -ForegroundColor Gray
}
Write-Host ''

# Step 4: Trigger Deployment
Write-Host 'Step 4: Triggering deployment...' -ForegroundColor Yellow
try {
    $deployBody = @{
        applicationId = $APP_ID
    } | ConvertTo-Json -Compress

    $deployResponse = Invoke-RestMethod -Uri "$DOKPLOY_URL/api/application.deploy" `
        -Method POST -Headers $headers -Body $deployBody -ErrorAction Stop
    
    Write-Host '✅ Deployment triggered successfully!' -ForegroundColor Green
    Write-Host "   Monitor deployment at: $DOKPLOY_URL" -ForegroundColor Gray
    Write-Host "   Application will be available at: https://$DOMAIN" -ForegroundColor Gray
} catch {
    Write-Host "❌ Failed to trigger deployment: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   You can trigger manually:" -ForegroundColor Yellow
    Write-Host "   - Via Dokploy UI: Go to app → Click 'Deploy'" -ForegroundColor Gray
    Write-Host "   - Via API: curl -X POST `"$DOKPLOY_URL/api/application.deploy`" -H `"x-api-key: $DOKPLOY_TOKEN`" -d `'{\"applicationId\": \"$APP_ID\"}`'" -ForegroundColor Gray
}
Write-Host ''

# Summary
Write-Host '=== Setup Summary ===' -ForegroundColor Cyan
Write-Host "Application ID: $APP_ID" -ForegroundColor White
Write-Host "Domain: https://$DOMAIN" -ForegroundColor White
Write-Host "Dokploy URL: $DOKPLOY_URL" -ForegroundColor White
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Yellow
Write-Host '1. Monitor deployment in Dokploy dashboard' -ForegroundColor Gray
Write-Host '2. Verify health endpoint: https://approver.aiinigeria.com/api/health' -ForegroundColor Gray
Write-Host '3. Check frontend: https://approver.aiinigeria.com' -ForegroundColor Gray
Write-Host '4. Verify GitHub Actions workflow is working (push to main to test)' -ForegroundColor Gray
Write-Host ''
