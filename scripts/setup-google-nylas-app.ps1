# Google Cloud OAuth Setup for Nylas Integration
# This script helps set up Google OAuth credentials for Nylas

$ProjectId = "decoded-effect-474117-r1"
$AppName = "seemplify"
$RedirectUris = @(
    "https://api.us.nylas.com/callback",
    "https://api.eu.nylas.com/callback",
    "https://seemplifyai.com",
    "https://seemplifyai.com/privacy-policy",
    "https://seemplifyai.com/terms"
)

# Required scopes for Nylas
$RequiredScopes = @(
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Google OAuth Setup for Seemplify Nylas" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if logged in
Write-Host "Checking Google Cloud authentication..." -ForegroundColor Yellow
$account = gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrEmpty($account)) {
    Write-Host "[ERROR] Not logged in to Google Cloud" -ForegroundColor Red
    Write-Host "Please run: gcloud auth login" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Logged in as: $account" -ForegroundColor Green
Write-Host "[OK] Project: $ProjectId" -ForegroundColor Green
Write-Host ""

# Check if APIs are enabled
Write-Host "Verifying required APIs are enabled..." -ForegroundColor Yellow
$apisToCheck = @("gmail.googleapis.com", "calendar-json.googleapis.com", "people.googleapis.com")
$allEnabled = $true

foreach ($api in $apisToCheck) {
    $status = gcloud services list --enabled --filter="name:$api" --format="value(name)" --project=$ProjectId 2>$null
    if ([string]::IsNullOrEmpty($status)) {
        Write-Host "[WARNING] API not enabled: $api" -ForegroundColor Yellow
        $allEnabled = $false
    } else {
        Write-Host "[OK] $api enabled" -ForegroundColor Green
    }
}

if (-not $allEnabled) {
    Write-Host ""
    Write-Host "Enabling required APIs..." -ForegroundColor Yellow
    gcloud services enable gmail.googleapis.com calendar-json.googleapis.com people.googleapis.com --project=$ProjectId
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] APIs enabled successfully" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "OAuth Consent Screen Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Google requires manual setup of OAuth Consent Screen via Console." -ForegroundColor Yellow
Write-Host ""
Write-Host "Please follow these steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Open Google Cloud Console:" -ForegroundColor Yellow
Write-Host "   https://console.cloud.google.com/apis/credentials/consent?project=$ProjectId" -ForegroundColor White
Write-Host ""
Write-Host "2. Configure OAuth Consent Screen:" -ForegroundColor Yellow
Write-Host "   - User Type: External" -ForegroundColor White
Write-Host "   - Click: CREATE" -ForegroundColor White
Write-Host ""
Write-Host "3. Fill in App Information:" -ForegroundColor Yellow
Write-Host "   App name: $AppName" -ForegroundColor White
Write-Host "   User support email: info@seemplifyai.com" -ForegroundColor White
Write-Host "   App logo: (optional)" -ForegroundColor White
Write-Host "   Application home page: https://seemplifyai.com" -ForegroundColor White
Write-Host "   Application privacy policy: https://seemplifyai.com/privacy-policy" -ForegroundColor White
Write-Host "   Application terms of service: https://seemplifyai.com/terms" -ForegroundColor White
Write-Host "   Developer contact: info@seemplifyai.com" -ForegroundColor White
Write-Host ""
Write-Host "4. Add Scopes:" -ForegroundColor Yellow
Write-Host "   Click: ADD OR REMOVE SCOPES" -ForegroundColor White
Write-Host "   Select these scopes:" -ForegroundColor White
Write-Host "   - .../auth/userinfo.email (See your email address)" -ForegroundColor Gray
Write-Host "   - .../auth/userinfo.profile (See your personal info)" -ForegroundColor Gray
Write-Host "   - .../auth/gmail.send (Send email on your behalf)" -ForegroundColor Gray
Write-Host "   - .../auth/gmail.readonly (Read email)" -ForegroundColor Gray
Write-Host "   - .../auth/gmail.modify (Manage email)" -ForegroundColor Gray
Write-Host "   - .../auth/calendar (Manage calendars)" -ForegroundColor Gray
Write-Host "   - .../auth/calendar.events (View and edit events)" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Test Users (Optional for testing):" -ForegroundColor Yellow
Write-Host "   Add: info@seemplifyai.com" -ForegroundColor White
Write-Host ""
Write-Host "6. Click SAVE AND CONTINUE through remaining screens" -ForegroundColor Yellow
Write-Host ""
Write-Host "7. Once completed, return here and press Enter to continue..." -ForegroundColor Cyan

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Creating OAuth Client ID" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "After OAuth consent screen is set up, create OAuth credentials:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Go to Credentials page:" -ForegroundColor Yellow
Write-Host "   https://console.cloud.google.com/apis/credentials?project=$ProjectId" -ForegroundColor White
Write-Host ""
Write-Host "2. Click: CREATE CREDENTIALS → OAuth client ID" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. Configure OAuth Client:" -ForegroundColor Yellow
Write-Host "   Application type: Web application" -ForegroundColor White
Write-Host "   Name: $AppName-nylas" -ForegroundColor White
Write-Host ""
Write-Host "4. Add Authorized redirect URIs:" -ForegroundColor Yellow
foreach ($uri in $RedirectUris) {
    Write-Host "   - $uri" -ForegroundColor White
}
Write-Host ""
Write-Host "5. Click: CREATE" -ForegroundColor Yellow
Write-Host ""
Write-Host "6. Copy the Client ID and Client Secret" -ForegroundColor Yellow
Write-Host ""

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Required Scopes for Nylas" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "When configuring Nylas, use these scopes:" -ForegroundColor Yellow
Write-Host ""
foreach ($scope in $RequiredScopes) {
    Write-Host "  $scope" -ForegroundColor White
}

Write-Host ""
Write-Host "Or as space-separated string:" -ForegroundColor Yellow
Write-Host "  $($RequiredScopes -join ' ')" -ForegroundColor White

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Next Steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Complete OAuth consent screen setup (link above)" -ForegroundColor Yellow
Write-Host "2. Create OAuth client ID credentials (link above)" -ForegroundColor Yellow
Write-Host "3. Save Client ID and Client Secret" -ForegroundColor Yellow
Write-Host "4. Configure in Nylas dashboard" -ForegroundColor Yellow
Write-Host "5. Test with a Google account" -ForegroundColor Yellow
Write-Host ""
Write-Host "Documentation will be created in access/ folder once you have credentials." -ForegroundColor Cyan
Write-Host ""
Write-Host "[OK] Setup guide complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Quick Links:" -ForegroundColor Cyan
Write-Host "- OAuth Consent: https://console.cloud.google.com/apis/credentials/consent?project=$ProjectId" -ForegroundColor White
Write-Host "- Credentials: https://console.cloud.google.com/apis/credentials?project=$ProjectId" -ForegroundColor White
Write-Host "- Nylas Dashboard: https://dashboard.nylas.com" -ForegroundColor White
