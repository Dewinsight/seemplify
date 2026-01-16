# Azure Nylas App Registration Setup for Seemplify
# This script creates an Azure AD app registration with proper permissions for Nylas integration

# Configuration variables
$AppName = "seemplify"
$RedirectUris = @(
    "https://api.us.nylas.com/oauth/callback",
    "https://api.eu.nylas.com/oauth/callback",
    "https://seemplifyai.com",
    "https://seemplifyai.com/privacy-policy",
    "https://seemplifyai.com/terms"
)
$LogoutUrl = "https://seemplifyai.com"

# Required Microsoft Graph permission scopes
$PermissionScopes = @(
    "offline_access",
    "openid",
    "profile",
    "User.Read",
    "Calendars.ReadWrite",
    "Mail.Send",
    "Mail.ReadWrite"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Seemplify Nylas Azure App Registration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Azure CLI is installed
try {
    $azVersion = az version --output json | ConvertFrom-Json
    Write-Host "[OK] Azure CLI version detected" -ForegroundColor Green
}
catch {
    Write-Host "[ERROR] Azure CLI not found. Please install from: https://aka.ms/azure-cli" -ForegroundColor Red
    exit 1
}

# Check if user is logged in
Write-Host ""
Write-Host "Checking Azure login status..." -ForegroundColor Yellow
$account = az account show 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "You are not logged in to Azure. Logging in..." -ForegroundColor Yellow
    az login
}

# Get current subscription
$subscription = az account show --output json | ConvertFrom-Json
$subscriptionName = $subscription.name
$subscriptionId = $subscription.id
$tenantId = $subscription.tenantId

Write-Host "[OK] Logged in to: $subscriptionName" -ForegroundColor Green
Write-Host "[OK] Tenant ID: $tenantId" -ForegroundColor Green
Write-Host ""

# Create the app registration
Write-Host "Creating app registration..." -ForegroundColor Yellow
$appId = az ad app create --display-name $AppName --sign-in-audience "AzureADMyOrg" --web-redirect-uris $RedirectUris --enable-id-token-issuance true --enable-access-token-issuance true --query appId -o tsv

if ([string]::IsNullOrEmpty($appId)) {
    Write-Host "[ERROR] Failed to create app registration" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] App created with ID: $appId" -ForegroundColor Green

# Set identifier URI with app ID
Write-Host "Setting identifier URI..." -ForegroundColor Yellow
$identifierUri = "api://$appId"
az ad app update --id $appId --identifier-uris $identifierUri | Out-Null
Write-Host "[OK] Identifier URI set to: $identifierUri" -ForegroundColor Green
Write-Host ""

# Create service principal for the app
Write-Host "Creating service principal..." -ForegroundColor Yellow
az ad sp create --id $appId | Out-Null
Write-Host "[OK] Service principal created" -ForegroundColor Green
Write-Host ""

# Update app with logout URL
Write-Host "Configuring logout URL..." -ForegroundColor Yellow
az ad app update --id $appId --set logoutUrl=$LogoutUrl | Out-Null
Write-Host "[OK] Logout URL configured" -ForegroundColor Green
Write-Host ""

# Add Microsoft Graph permissions
Write-Host "Configuring Microsoft Graph permissions..." -ForegroundColor Yellow
$graphAppId = "00000003-0000-0000-c000-000000000000"

Write-Host "  Adding delegated permissions:" -ForegroundColor Cyan
foreach ($scope in $PermissionScopes) {
    Write-Host "    - $scope" -ForegroundColor Gray
}

# Microsoft Graph well-known permission IDs
$permissionIds = @{
    "offline_access" = "7427e0e9-2fba-42fe-b0c0-848c9e6a8182"
    "openid" = "37f7f235-527c-4136-accd-4a02d197296e"
    "profile" = "14dad69e-099b-42c9-810b-d002981feec1"
    "User.Read" = "e1fe6dd8-ba31-4d61-89e7-88639da4683d"
    "Calendars.ReadWrite" = "1ec239c2-d7c9-4623-a91a-a9775856bb36"
    "Mail.Send" = "e383f46e-2787-4529-855e-0e479a3ffac0"
    "Mail.ReadWrite" = "024d486e-b451-40bb-833d-3e66d98c5c73"
}

# Build permission array
$permissions = @()
foreach ($scope in $PermissionScopes) {
    if ($permissionIds.ContainsKey($scope)) {
        $permissions += @{
            id = $permissionIds[$scope]
            type = "Scope"
        }
    }
}

# Create permission object
$permissionGrants = @{
    requiredResourceAccess = @(
        @{
            resourceAppId = $graphAppId
            resourceAccess = $permissions
        }
    )
}

# Update the app with permissions
$permissionJson = $permissionGrants | ConvertTo-Json -Depth 10 -Compress
az ad app update --id $appId --set "requiredResourceAccess=$permissionJson" | Out-Null
Write-Host "[OK] Permissions configured (requires admin consent)" -ForegroundColor Green
Write-Host ""

# Get object ID
$objectId = az ad app show --id $appId --query id -o tsv

# Generate client secret
Write-Host "Creating client secret..." -ForegroundColor Yellow
$secretName = "seemplify-nylas-$(Get-Date -Format 'yyyyMMdd')"
$secretResponse = az ad app credential reset --id $appId --append --display-name $secretName --years 2 --query "password" -o tsv

Write-Host "[OK] Client secret created (valid for 2 years)" -ForegroundColor Green
Write-Host "  [!] SAVE THIS SECRET NOW - you won't see it again!" -ForegroundColor Red
Write-Host ""

# Display summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "App Registration Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "App Configuration:" -ForegroundColor Yellow
Write-Host "  App Name:           $AppName" -ForegroundColor White
Write-Host "  Client ID (App ID): $appId" -ForegroundColor White
Write-Host "  Client Secret:      $secretResponse" -ForegroundColor Red
Write-Host "  Tenant ID:          $tenantId" -ForegroundColor White
Write-Host "  Object ID:          $objectId" -ForegroundColor White
Write-Host ""
Write-Host "Redirect URIs:" -ForegroundColor Yellow
foreach ($uri in $RedirectUris) {
    Write-Host "  - $uri" -ForegroundColor White
}
Write-Host ""
Write-Host "Permission Scopes:" -ForegroundColor Yellow
foreach ($scope in $PermissionScopes) {
    Write-Host "  - $scope" -ForegroundColor White
}
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Admin Consent Required:" -ForegroundColor Yellow
Write-Host "   Run this command to grant admin consent:" -ForegroundColor White
Write-Host ""
Write-Host "   az ad app permission admin-consent --id $appId" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Configure Nylas:" -ForegroundColor Yellow
Write-Host "   Add a Microsoft connector in Nylas dashboard with:" -ForegroundColor White
Write-Host "   - Client ID: $appId" -ForegroundColor White
Write-Host "   - Client Secret: [the secret above]" -ForegroundColor White
Write-Host "   - Tenant ID: $tenantId" -ForegroundColor White
Write-Host ""
Write-Host "3. Verify in Azure Portal:" -ForegroundColor Yellow
Write-Host "   https://portal.azure.com" -ForegroundColor White
Write-Host ""
Write-Host "Save this information securely!" -ForegroundColor Red
Write-Host ""

# Grant admin consent automatically
Write-Host "Granting admin consent..." -ForegroundColor Yellow
az ad app permission admin-consent --id $appId 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Admin consent granted successfully" -ForegroundColor Green
}
else {
    Write-Host "[WARNING] Could not automatically grant admin consent." -ForegroundColor Yellow
    Write-Host "You may need to run this command manually:" -ForegroundColor Yellow
    Write-Host "  az ad app permission admin-consent --id $appId" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "[OK] Setup complete!" -ForegroundColor Green
Write-Host ""

# Save credentials to file for reference
$credFile = "azure-nylas-credentials.txt"
$credPath = Join-Path $PSScriptRoot $credFile
@"
Seemplify Azure Nylas App Configuration
========================================
Created: $(Get-Date)

Client ID:     $appId
Tenant ID:     $tenantId
Client Secret: $secretResponse

Redirect URIs:
$(foreach ($uri in $RedirectUris) { "  - $uri`n" })

Permission Scopes:
$(foreach ($scope in $PermissionScopes) { "  - $scope`n" })

Admin Consent Command:
  az ad app permission admin-consent --id $appId

Azure Portal:
  https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/$appId
"@ | Out-File -FilePath $credPath -Encoding UTF8

Write-Host "[OK] Credentials saved to: $credPath" -ForegroundColor Green
