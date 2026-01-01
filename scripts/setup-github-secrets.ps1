# Setup GitHub Secrets for Dokploy CI/CD
# Usage: .\setup-github-secrets.ps1
# 
# This script helps you configure GitHub Actions secrets for automatic deployments

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GitHub Secrets Setup for Dokploy" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if gh cli is available
if (!(Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "Error: GitHub CLI (gh) is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Install from: https://cli.github.com/" -ForegroundColor Yellow
    exit 1
}

# Check if authenticated
$authStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Not authenticated to GitHub CLI" -ForegroundColor Red
    Write-Host "Run: gh auth login" -ForegroundColor Yellow
    exit 1
}

Write-Host "GitHub CLI authenticated" -ForegroundColor Green
Write-Host ""

# Collect information
Write-Host "Enter Dokploy Information:" -ForegroundColor Yellow
Write-Host "--------------------------" -ForegroundColor Yellow
Write-Host ""

$dokployUrl = Read-Host "Dokploy URL (e.g., https://dokploy.seemplifyai.com)"
if ([string]::IsNullOrEmpty($dokployUrl)) {
    $dokployUrl = "https://dokploy.seemplifyai.com"
}

$dokployToken = Read-Host "Dokploy API Token (from Dokploy Settings -> API -> Tokens)" -AsSecureString
$dokployTokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($dokployToken))

Write-Host ""
Write-Host "Enter Application IDs from Dokploy:" -ForegroundColor Yellow
Write-Host "-----------------------------------" -ForegroundColor Yellow
Write-Host "(Find in Dokploy URL: /project/.../services/application/<APP_ID>)" -ForegroundColor Gray
Write-Host ""

$recruiterBackendId = Read-Host "Recruiter Backend App ID"
$recruiterFrontendId = Read-Host "Recruiter Frontend App ID"
$leaveBackendId = Read-Host "Leave Backend App ID"
$leaveFrontendId = Read-Host "Leave Frontend App ID"
$performanceBackendId = Read-Host "Performance Backend App ID"
$performanceFrontendId = Read-Host "Performance Frontend App ID"
$payrollBackendId = Read-Host "Payroll Backend App ID"
$payrollFrontendId = Read-Host "Payroll Frontend App ID"
$identityProviderId = Read-Host "Identity Provider App ID"

Write-Host ""
Write-Host "Setting GitHub Secrets..." -ForegroundColor Yellow
Write-Host ""

# Set secrets
$secrets = @{
    "DOKPLOY_URL" = $dokployUrl
    "DOKPLOY_TOKEN" = $dokployTokenPlain
    "RECRUITER_BACKEND_APP_ID" = $recruiterBackendId
    "RECRUITER_FRONTEND_APP_ID" = $recruiterFrontendId
    "LEAVE_BACKEND_APP_ID" = $leaveBackendId
    "LEAVE_FRONTEND_APP_ID" = $leaveFrontendId
    "PERFORMANCE_BACKEND_APP_ID" = $performanceBackendId
    "PERFORMANCE_FRONTEND_APP_ID" = $performanceFrontendId
    "PAYROLL_BACKEND_APP_ID" = $payrollBackendId
    "PAYROLL_FRONTEND_APP_ID" = $payrollFrontendId
    "IDENTITY_PROVIDER_APP_ID" = $identityProviderId
}

$successCount = 0
$errorCount = 0

foreach ($secret in $secrets.GetEnumerator()) {
    if ([string]::IsNullOrEmpty($secret.Value)) {
        Write-Host "  Skipping $($secret.Key) (empty)" -ForegroundColor Gray
        continue
    }
    
    Write-Host "  Setting $($secret.Key)..." -ForegroundColor White -NoNewline
    
    try {
        $secret.Value | gh secret set $secret.Key 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host " OK" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host " FAILED" -ForegroundColor Red
            $errorCount++
        }
    }
    catch {
        Write-Host " ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $errorCount++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Secrets Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Set: $successCount secrets" -ForegroundColor Green
if ($errorCount -gt 0) {
    Write-Host "Failed: $errorCount secrets" -ForegroundColor Red
}
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Push a change to test the CI/CD pipeline" -ForegroundColor White
Write-Host "  2. Check GitHub Actions tab for workflow runs" -ForegroundColor White
Write-Host "  3. Verify deployment in Dokploy dashboard" -ForegroundColor White
Write-Host ""
Write-Host "To view secrets:" -ForegroundColor Gray
Write-Host "  gh secret list" -ForegroundColor Gray
Write-Host ""
