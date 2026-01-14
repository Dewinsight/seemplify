# Trigger all dev deployments via Dokploy API
# This script manually triggers deployments for all 9 dev applications

$dokployUrl = "http://4.180.153.209:3000"
$apiToken = "YOUR_DOKPLOY_TOKEN_HERE" # Get from gh secret

# Dev Application IDs
$apps = @{
    "identity-provider-dev" = "dev-idp-001-seemplify"
    "recruiter-backend-dev" = "dev-rec-be-001-seemp"
    "recruiter-frontend-dev" = "dev-rec-fe-001-seemp"
    "leave-backend-dev" = "dev-lv-be-001-seemp"
    "leave-frontend-dev" = "dev-lv-fe-001-seemp"
    "performance-backend-dev" = "dev-pf-be-001-seemp"
    "performance-frontend-dev" = "dev-pf-fe-001-seemp"
    "payroll-backend-dev" = "dev-py-be-001-seemp"
    "payroll-frontend-dev" = "dev-py-fe-001-seemp"
}

Write-Host "🚀 Triggering deployments for all dev applications..." -ForegroundColor Cyan
Write-Host ""

foreach ($app in $apps.GetEnumerator()) {
    $appName = $app.Key
    $appId = $app.Value
    
    Write-Host "📦 Deploying $appName..." -ForegroundColor Yellow
    
    $body = @{
        applicationId = $appId
    } | ConvertTo-Json
    
    try {
        $response = Invoke-RestMethod -Uri "$dokployUrl/api/application.deploy" `
            -Method Post `
            -Headers @{
                "x-api-key" = $apiToken
                "Content-Type" = "application/json"
                "accept" = "application/json"
            } `
            -Body $body `
            -ErrorAction Stop
        
        Write-Host "   ✅ Deployment triggered successfully" -ForegroundColor Green
    }
    catch {
        Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "✅ All deployments triggered!" -ForegroundColor Green
Write-Host "Check Dokploy dashboard at $dokployUrl for deployment status" -ForegroundColor Cyan
