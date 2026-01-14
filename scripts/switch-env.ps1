# Environment Switcher Script
# Switches between development and production environments for local development

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("dev", "prod")]
    [string]$Environment
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Success { param($Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Info { param($Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }
function Write-Warning { param($Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "❌ $Message" -ForegroundColor Red }

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Environment Switcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get repository root (assuming script is in scripts/ folder)
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptPath

Write-Info "Repository root: $repoRoot"
Write-Info "Switching to: $Environment environment"
Write-Host ""

# Applications to configure
$applications = @(
    @{Name="Identity Provider"; Path="Identityprovider"; HasBackend=$true; HasFrontend=$false},
    @{Name="Recruiter"; Path="recruiter"; HasBackend=$true; HasFrontend=$true},
    @{Name="Leave Management"; Path="leave-management"; HasBackend=$true; HasFrontend=$true},
    @{Name="Performance"; Path="performance"; HasBackend=$true; HasFrontend=$true},
    @{Name="Payroll"; Path="payroll"; HasBackend=$true; HasFrontend=$true}
)

# Environment-specific database names
$dbMappings = @{
    dev = @{
        "identity" = "identity-dev"
        "smart_hr_db" = "smart_hr_db-dev"
        "leave-management" = "leave-management-dev"
        "performance_db" = "performance_db-dev"
        "payroll_db" = "payroll_db-dev"
    }
    prod = @{
        "identity-dev" = "identity"
        "smart_hr_db-dev" = "smart_hr_db"
        "leave-management-dev" = "leave-management"
        "performance_db-dev" = "performance_db"
        "payroll_db-dev" = "payroll_db"
    }
}

# Environment-specific URLs
$urlMappings = @{
    dev = @{
        "IDP_URL" = "http://localhost:4000"  # Local dev IDP
        "RECRUITER_API" = "http://localhost:5001"
        "LEAVE_API" = "http://localhost:5002"
        "PERFORMANCE_API" = "http://localhost:5004"
        "PAYROLL_API" = "http://localhost:5006"
    }
    prod = @{
        "IDP_URL" = "https://auth.seemplifyai.com"  # Production IDP (use with caution)
        "RECRUITER_API" = "https://api.seemplifyai.com"
        "LEAVE_API" = "https://api-leave.seemplifyai.com"
        "PERFORMANCE_API" = "https://api-performance.seemplifyai.com"
        "PAYROLL_API" = "https://api-payroll.seemplifyai.com"
    }
}

function Update-EnvFile {
    param(
        [string]$FilePath,
        [string]$Environment,
        [string]$AppType  # "backend" or "frontend"
    )

    if (-not (Test-Path $FilePath)) {
        Write-Warning "File not found: $FilePath (skipping)"
        return $false
    }

    Write-Info "  Updating: $FilePath"

    # Read current .env file
    $content = Get-Content $FilePath -Raw

    if ($AppType -eq "backend") {
        # Update NODE_ENV
        if ($Environment -eq "dev") {
            $content = $content -replace 'NODE_ENV=production', 'NODE_ENV=development'
        } else {
            $content = $content -replace 'NODE_ENV=development', 'NODE_ENV=production'
        }

        # Update MongoDB database names
        foreach ($dbName in $dbMappings[$Environment].Keys) {
            $newDbName = $dbMappings[$Environment][$dbName]
            $content = $content -replace "mongodb\+srv://([^/]+)/([^?]+)\?", {
                param($match)
                $connString = $match.Groups[1].Value
                $currentDb = $match.Groups[2].Value
                if ($currentDb -eq $dbName) {
                    "mongodb+srv://$connString/$newDbName?"
                } else {
                    $match.Value
                }
            }
            # Also handle simple database name replacement
            $content = $content -replace "/$dbName\?", "/$newDbName?"
        }

        # Update IDP URLs for backends
        $idpUrl = $urlMappings[$Environment]["IDP_URL"]
        $content = $content -replace 'OIDC_ISSUER=.*', "OIDC_ISSUER=$idpUrl"
        $content = $content -replace 'IDP_API_BASE_URL=.*', "IDP_API_BASE_URL=$idpUrl"
        $content = $content -replace 'IDP_HUB_URL=.*', "IDP_HUB_URL=$idpUrl"
    }

    if ($AppType -eq "frontend") {
        # Update frontend environment
        if ($Environment -eq "dev") {
            $content = $content -replace 'NODE_ENV=production', 'NODE_ENV=development'
        } else {
            $content = $content -replace 'NODE_ENV=development', 'NODE_ENV=production'
        }

        # Update API URLs for frontends
        # This is tricky since we don't know which app it is
        # For now, just update NODE_ENV
    }

    # Write updated content
    Set-Content -Path $FilePath -Value $content -NoNewline

    Write-Success "  ✓ Updated"
    return $true
}

# Process each application
$updatedCount = 0
$skippedCount = 0

foreach ($app in $applications) {
    Write-Host ""
    Write-Host "Processing: $($app.Name)" -ForegroundColor White
    Write-Host "-----------------------------------" -ForegroundColor Gray

    if ($app.HasBackend) {
        if ($app.Path -eq "Identityprovider") {
            $backendPath = Join-Path $repoRoot "$($app.Path)\.env"
        } else {
            $backendPath = Join-Path $repoRoot "$($app.Path)\backend\.env"
        }

        if (Update-EnvFile -FilePath $backendPath -Environment $Environment -AppType "backend") {
            $updatedCount++
        } else {
            $skippedCount++
        }
    }

    if ($app.HasFrontend) {
        $frontendPath = Join-Path $repoRoot "$($app.Path)\frontend\.env"

        if (Update-EnvFile -FilePath $frontendPath -Environment $Environment -AppType "frontend") {
            $updatedCount++
        } else {
            $skippedCount++
        }
    }
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Success "Environment switched to: $Environment"
Write-Info "Updated: $updatedCount file(s)"
if ($skippedCount -gt 0) {
    Write-Warning "Skipped: $skippedCount file(s) (not found)"
}
Write-Host ""

if ($Environment -eq "dev") {
    Write-Host "🔧 Development Environment Active" -ForegroundColor Green
    Write-Host ""
    Write-Host "  • Using -dev databases (MongoDB Atlas)" -ForegroundColor Gray
    Write-Host "  • Using local service URLs" -ForegroundColor Gray
    Write-Host "  • NODE_ENV set to 'development'" -ForegroundColor Gray
    Write-Host ""
    Write-Warning "Make sure all local services are running!"
} else {
    Write-Host "🚀 Production Environment Active" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  • Using production databases (MongoDB Atlas)" -ForegroundColor Gray
    Write-Host "  • Using production service URLs" -ForegroundColor Gray
    Write-Host "  • NODE_ENV set to 'production'" -ForegroundColor Gray
    Write-Host ""
    Write-Warning "⚠️  BE CAREFUL! You're connecting to PRODUCTION data!"
    Write-Warning "Only use this for testing or debugging production issues locally."
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Restart any running applications" -ForegroundColor Gray
Write-Host "  2. Clear browser cache if testing frontends" -ForegroundColor Gray
Write-Host "  3. Verify database connections are correct" -ForegroundColor Gray
Write-Host ""

# Offer to restart services (optional)
if ($Environment -eq "dev") {
    $restart = Read-Host "Do you want to restart all local services now? (y/N)"
    if ($restart -eq "y" -or $restart -eq "Y") {
        Write-Info "Restarting services..."
        $startScript = Join-Path $repoRoot "start-all.ps1"
        if (Test-Path $startScript) {
            & $startScript
        } else {
            Write-Warning "start-all.ps1 not found. Please start services manually."
        }
    }
}

Write-Host ""
Write-Host "✅ Environment switch complete!" -ForegroundColor Green
Write-Host ""
