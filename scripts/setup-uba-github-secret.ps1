# Set UBA_FASTLANE_APP_ID GitHub secret for auto-deploy
# Run from repo root. Requires: gh auth login

$ErrorActionPreference = 'Stop'
$UBA_APP_ID = '_3NtFvqF3tUk2gEiRVIzE'

Write-Host "🔐 Setting UBA_FASTLANE_APP_ID GitHub secret..." -ForegroundColor Cyan

# Use full path in case gh isn't in PATH
$gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) {
    Write-Host "❌ GitHub CLI not found. Install: winget install GitHub.cli" -ForegroundColor Red
    exit 1
}

$auth = & $gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Not authenticated. Run: gh auth login" -ForegroundColor Red
    exit 1
}

& $gh secret set UBA_FASTLANE_APP_ID --body $UBA_APP_ID
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ UBA_FASTLANE_APP_ID set successfully" -ForegroundColor Green
    Write-Host ""
    Write-Host "Auto-deploy is ready. Pushes to uba_branch_optimsation/ will trigger deployment." -ForegroundColor Cyan
    Write-Host "Or run manually: gh workflow run deploy-uba.yml" -ForegroundColor Cyan
} else {
    Write-Host "❌ Failed to set secret" -ForegroundColor Red
    exit 1
}
