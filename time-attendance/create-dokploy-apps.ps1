# Create Time Attendance Applications in Dokploy via API
# This script automates the creation of time-attendance backend and frontend apps

$ErrorActionPreference = 'Stop'

# Configuration
$DOKPLOY_URL = if ($env:DOKPLOY_URL) { $env:DOKPLOY_URL } else { 'http://4.180.153.209:3000' }
$DOKPLOY_TOKEN = $env:DOKPLOY_TOKEN
$GITHUB_REPO = 'michaelegbo/seemplify'
$PROJECT_ID = 'jSrhrIiOyn0eH02aRSIFY'  # seemplify project ID (from existing apps)

# Colors
function Write-Info { param($msg) Write-Host "ℹ️  $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "✅ $msg" -ForegroundColor Green }
function Write-Warning { param($msg) Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Write-Error { param($msg) Write-Host "❌ $msg" -ForegroundColor Red }

# Check for API token
if (-not $DOKPLOY_TOKEN) {
    Write-Error "DOKPLOY_TOKEN environment variable not set!"
    Write-Host ""
    Write-Host "Please set the API token first:" -ForegroundColor Yellow
    Write-Host "  `$env:DOKPLOY_TOKEN = 'your-api-token-here'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To get your API token:" -ForegroundColor Yellow
    Write-Host "  1. Log into Dokploy: http://4.180.153.209:3000" -ForegroundColor White
    Write-Host "  2. Go to Settings → API Keys" -ForegroundColor White
    Write-Host "  3. Create a new API key" -ForegroundColor White
    exit 1
}

# Headers for API requests
$headers = @{
    'Content-Type' = 'application/json'
    'x-api-key' = $DOKPLOY_TOKEN
    'accept' = 'application/json'
}

# Function to make API requests
function Invoke-DokployAPI {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body = $null
    )
    
    $url = "$DOKPLOY_URL/api/$Endpoint"
    $params = @{
        Uri = $url
        Method = $Method
        Headers = $headers
    }
    
    if ($Body) {
        $params.Body = ($Body | ConvertTo-Json -Compress -Depth 10)
    }
    
    try {
        $response = Invoke-RestMethod @params
        return $response
    } catch {
        Write-Error "API Error: $_"
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Error "Response: $responseBody"
        }
        return $null
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Time Attendance Dokploy Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Info "Using Dokploy URL: $DOKPLOY_URL"
Write-Info "Using Project ID: $PROJECT_ID"
Write-Host ""

# Function to create application
function Create-Application {
    param(
        [string]$Name,
        [string]$BuildPath,
        [string]$Domain,
        [string]$Type,  # 'backend' or 'frontend'
        [int]$Port
    )
    
    Write-Info "Creating: $Name"
    
    # Prepare application data
    $appData = @{
        name = $Name
        appName = $Name
        description = "Time Attendance $Type - Production"
        projectId = $PROJECT_ID
        sourceType = "github"
        repository = $GITHUB_REPO
        branch = "main"
        buildPath = $BuildPath
        dockerfile = "Dockerfile"
    }
    
    # Create application
    $result = Invoke-DokployAPI -Method POST -Endpoint "application.create" -Body $appData
    
    if (-not $result) {
        Write-Error "Failed to create $Name"
        return $null
    }
    
    $appId = $result.applicationId
    if (-not $appId) {
        $appId = $result.id
    }
    
    if (-not $appId) {
        Write-Error "No application ID returned for $Name"
        Write-Host "Response: $($result | ConvertTo-Json)" -ForegroundColor Yellow
        return $null
    }
    
    Write-Success "Created $Name (ID: $appId)"
    
    # Configure domain
    Write-Info "  Setting domain: $Domain"
    $domainData = @{
        applicationId = $appId
        domain = $Domain
        https = $true
        certificateType = "letsencrypt"
    }
    
    $domainResult = Invoke-DokployAPI -Method POST -Endpoint "domain.create" -Body $domainData
    if ($domainResult) {
        Write-Success "  Domain configured: $Domain"
    } else {
        Write-Warning "  Could not configure domain (may need manual setup)"
    }
    
    # Configure environment variables for backend
    if ($Type -eq 'backend') {
        Write-Info "  Configuring environment variables..."
        Write-Warning "  ⚠️  You need to manually set these environment variables in Dokploy:"
        Write-Host ""
        Write-Host "  NODE_ENV=production" -ForegroundColor White
        Write-Host "  PORT=$Port" -ForegroundColor White
        Write-Host "  MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/time_attendance?retryWrites=true&w=majority" -ForegroundColor White
        Write-Host "  SESSION_SECRET=<generate-strong-secret>" -ForegroundColor White
        Write-Host "  IDP_ISSUER_URL=https://auth.seemplifyai.com" -ForegroundColor White
        Write-Host "  OIDC_CLIENT_ID=time-attendance" -ForegroundColor White
        Write-Host "  OIDC_CLIENT_SECRET=<get-from-idp>" -ForegroundColor White
        Write-Host "  OIDC_REDIRECT_URI=https://api-time.seemplifyai.com/api/auth/oidc/callback" -ForegroundColor White
        Write-Host "  FRONTEND_URL=https://time.seemplifyai.com" -ForegroundColor White
        Write-Host "  CORS_ORIGIN=https://time.seemplifyai.com" -ForegroundColor White
        Write-Host ""
    }
    
    # Configure build arguments for frontend
    if ($Type -eq 'frontend') {
        Write-Info "  Configuring build arguments..."
        Write-Warning "  ⚠️  You need to manually set these build arguments in Dokploy:"
        Write-Host ""
        Write-Host "  NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api" -ForegroundColor White
        Write-Host "  NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com" -ForegroundColor White
        Write-Host ""
    }
    
    return @{
        AppId = $appId
        Name = $Name
        Domain = $Domain
    }
}

# Create backend application
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Creating Backend Application" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$backendApp = Create-Application `
    -Name "time-attendance-backend" `
    -BuildPath "time-attendance/backend" `
    -Domain "api-time.seemplifyai.com" `
    -Type "backend" `
    -Port 5010

Write-Host ""

# Create frontend application
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Creating Frontend Application" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$frontendApp = Create-Application `
    -Name "time-attendance-frontend" `
    -BuildPath "time-attendance/frontend" `
    -Domain "time.seemplifyai.com" `
    -Type "frontend" `
    -Port 5011

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($backendApp -and $frontendApp) {
    Write-Success "Applications created successfully!"
    Write-Host ""
    Write-Host "Application IDs (for GitHub secrets):" -ForegroundColor Yellow
    Write-Host "  TIME_ATTENDANCE_BACKEND_APP_ID=$($backendApp.AppId)" -ForegroundColor White
    Write-Host "  TIME_ATTENDANCE_FRONTEND_APP_ID=$($frontendApp.AppId)" -ForegroundColor White
    Write-Host ""
    Write-Host "Set GitHub secrets:" -ForegroundColor Yellow
    Write-Host "  gh secret set TIME_ATTENDANCE_BACKEND_APP_ID --body `"$($backendApp.AppId)`"" -ForegroundColor White
    Write-Host "  gh secret set TIME_ATTENDANCE_FRONTEND_APP_ID --body `"$($frontendApp.AppId)`"" -ForegroundColor White
    Write-Host ""
    Write-Warning "⚠️  Next Steps:"
    Write-Host "  1. Configure environment variables in Dokploy UI" -ForegroundColor White
    Write-Host "  2. Configure build arguments for frontend in Dokploy UI" -ForegroundColor White
    Write-Host "  3. Set GitHub secrets (commands above)" -ForegroundColor White
    Write-Host "  4. Deploy applications in Dokploy UI" -ForegroundColor White
    Write-Host "  5. Configure OIDC client in Identity Provider" -ForegroundColor White
} else {
    Write-Error "Some applications failed to create. Please check the errors above."
    exit 1
}
