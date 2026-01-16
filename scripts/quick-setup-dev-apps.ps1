# Quick Setup for Dokploy Dev Applications
# This script orchestrates the complete dev environment setup

param(
    [string]$DokployToken = "",
    [string]$GitHubUsername = ""
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Dokploy Dev Environment Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if token is provided
if ([string]::IsNullOrEmpty($DokployToken)) {
    Write-Host "📋 Dokploy API Token Required" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To get your API token:" -ForegroundColor White
    Write-Host "  1. Open: http://4.180.153.209:3000" -ForegroundColor Gray
    Write-Host "  2. Login: admin@seemplifyai.com / Seemplify2026!" -ForegroundColor Gray
    Write-Host "  3. Go to: Settings → API Keys" -ForegroundColor Gray
    Write-Host "  4. Create new key named: 'Dev Environment Setup'" -ForegroundColor Gray
    Write-Host "  5. Copy the token" -ForegroundColor Gray
    Write-Host ""
    $DokployToken = Read-Host "Enter your Dokploy API token"
    
    if ([string]::IsNullOrEmpty($DokployToken)) {
        Write-Host "❌ Token is required!" -ForegroundColor Red
        exit 1
    }
}

# Check GitHub username
if ([string]::IsNullOrEmpty($GitHubUsername)) {
    Write-Host ""
    Write-Host "📋 GitHub Repository Information" -ForegroundColor Yellow
    $GitHubUsername = Read-Host "Enter your GitHub username"
    
    if ([string]::IsNullOrEmpty($GitHubUsername)) {
        Write-Host "❌ GitHub username is required!" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  GitHub Repo: $GitHubUsername/seemplify" -ForegroundColor White
Write-Host "  Dokploy URL: http://4.180.153.209:3000" -ForegroundColor White
Write-Host ""

$confirm = Read-Host "Proceed with creating 9 dev applications? (y/n)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "Cancelled." -ForegroundColor Gray
    exit 0
}

Write-Host ""
Write-Host "🚀 Starting automated setup..." -ForegroundColor Green
Write-Host ""

# Update Python script with GitHub username
$pythonScript = "scripts/create-dokploy-dev-apps.py"
if (Test-Path $pythonScript) {
    Write-Host "📝 Updating Python script with your GitHub username..." -ForegroundColor Cyan
    $content = Get-Content $pythonScript -Raw
    $content = $content -replace 'GITHUB_REPO_OWNER = "YOUR_GITHUB_USERNAME"', "GITHUB_REPO_OWNER = `"$GitHubUsername`""
    Set-Content $pythonScript $content -NoNewline
    Write-Host "✅ Script updated" -ForegroundColor Green
}

# Set environment variable for Python script
$env:DOKPLOY_TOKEN = $DokployToken

# Check if Python is installed
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Host "❌ Python not found!" -ForegroundColor Red
    Write-Host "Please install Python 3.x and try again." -ForegroundColor Yellow
    exit 1
}

# Check if requests module is installed
Write-Host "📦 Checking Python dependencies..." -ForegroundColor Cyan
python -c "import requests" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "📦 Installing Python requests module..." -ForegroundColor Yellow
    pip install requests
}

Write-Host "✅ Dependencies ready" -ForegroundColor Green
Write-Host ""

# Run Python script with token as input
Write-Host "🏗️  Creating applications in Dokploy..." -ForegroundColor Cyan
Write-Host ""

# Create temporary script input file
$tempInput = New-TemporaryFile
Set-Content $tempInput "$DokployToken`ny"

# Run Python script
$result = Get-Content $tempInput | python $pythonScript 2>&1

# Clean up temp file
Remove-Item $tempInput -Force

# Display result
Write-Host $result

# Check if successful
if ($result -match "Setup complete") {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  ✅ All Applications Created!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "📋 Next Steps:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Copy the Application IDs from above" -ForegroundColor White
    Write-Host ""
    Write-Host "2. Configure GitHub Secrets:" -ForegroundColor White
    Write-Host "   gh secret set IDENTITY_PROVIDER_DEV_APP_ID --body `"YOUR_APP_ID`"" -ForegroundColor Gray
    Write-Host "   (Repeat for all 9 apps)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. Create dev branch:" -ForegroundColor White
    Write-Host "   .\scripts\create-dev-branch.ps1" -ForegroundColor Gray
    Write-Host ""
    Write-Host "4. Update each app in Dokploy to use 'dev' branch" -ForegroundColor White
    Write-Host ""
    Write-Host "5. Test by pushing to dev branch!" -ForegroundColor White
    Write-Host ""
    
} else {
    Write-Host ""
    Write-Host "⚠️  There may have been issues. Check the output above." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "For manual setup, see:" -ForegroundColor White
    Write-Host "  access/DOKPLOY-DEV-APPS-SETUP-GUIDE.md" -ForegroundColor Gray
    Write-Host ""
}
