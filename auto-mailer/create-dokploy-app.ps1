# Create auto-mailer application in Dokploy via API
# Run from repo root. Requires: $env:DOKPLOY_TOKEN (from access/DOKPLOY-API-CREDENTIALS-COMPLETE.md)
# Example: $env:DOKPLOY_TOKEN='github-actions-2026...'; .\auto-mailer\create-dokploy-app.ps1

$ErrorActionPreference = 'Stop'
$Base = if ($env:DOKPLOY_URL) { $env:DOKPLOY_URL } else { 'http://4.180.153.209:3000' }
$Token = $env:DOKPLOY_TOKEN

if (-not $Token) {
    Write-Error 'Set DOKPLOY_TOKEN (read from access/DOKPLOY-API-CREDENTIALS-COMPLETE.md)'
}

$headers = @{
    'Content-Type' = 'application/json'
    'x-api-key'    = $Token
}

function Invoke-Dokploy {
    param([string]$Method, [string]$Path, [object]$Body = $null)
    $url = "$Base/api/$Path"
    $params = @{ Uri = $url; Method = $Method; Headers = $headers }
    if ($Body) { $params.Body = ($Body | ConvertTo-Json -Compress -Depth 10) }
    $r = Invoke-RestMethod @params
    return $r
}

$projectId = 'jSrhrIiOyn0eH02aRSIFY'
$environmentId = 'LRloZifVPbZcVc-D9jUd4'

Write-Host '=== Create auto-mailer in Dokploy ===' -ForegroundColor Cyan
Write-Host "  projectId: $projectId, environmentId: $environmentId"
Write-Host ''

# 1. Check if app exists
$appsByEnv = @()
try { $appsByEnv = Invoke-Dokploy -Method GET -Path "application.byEnvironmentId?environmentId=$environmentId" } catch { }
$appList = if ($appsByEnv -is [array]) { $appsByEnv } elseif ($appsByEnv) { @($appsByEnv) } else { @() }
$existingApp = $appList | Where-Object { $_.name -eq 'auto-mailer' } | Select-Object -First 1

if ($existingApp) {
    $applicationId = $existingApp.applicationId; if (-not $applicationId) { $applicationId = $existingApp.id }
    Write-Host "Application 'auto-mailer' already exists: $applicationId" -ForegroundColor Green
} else {
    Write-Host 'Creating application "auto-mailer"...'
    $ar = Invoke-Dokploy -Method POST -Path 'application.create' -Body @{
        name = 'auto-mailer'
        appName = 'auto-mailer-app'
        description = 'Auto-mailer service for Seemplify'
        environmentId = $environmentId
    }
    $applicationId = $ar.applicationId; if (-not $applicationId) { $applicationId = $ar.id }
    if (-not $applicationId) { Write-Error "Could not get applicationId from: $($ar | ConvertTo-Json)" }
    Write-Host "Created application: $applicationId" -ForegroundColor Green

    Write-Host ''
    Write-Host 'Setting Git source...'
    Invoke-Dokploy -Method POST -Path 'application.saveGitProvider' -Body @{
        applicationId = $applicationId
        customGitUrl = 'https://github.com/michaelegbo/seemplify.git'
        customGitBranch = 'main'
        customGitBuildPath = './auto-mailer'
        enableSubmodules = $false
    } | Out-Null
    Write-Host 'Git provider set.' -ForegroundColor Green

    Write-Host ''
    Write-Host 'Setting build type (Dockerfile)...'
    Invoke-Dokploy -Method POST -Path 'application.saveBuildType' -Body @{
        applicationId = $applicationId
        buildType = 'dockerfile'
        dockerfile = './auto-mailer/Dockerfile'
        dockerContextPath = './auto-mailer'
        dockerBuildStage = $null
    } | Out-Null
    Write-Host 'Build type set.' -ForegroundColor Green
}

# 2. Add domain auto-mailer.seemplifyai.com
Write-Host ''
$domains = @()
try { $domains = Invoke-Dokploy -Method GET -Path "domain.byApplicationId?applicationId=$applicationId" } catch { }
$domList = if ($domains -is [array]) { $domains } elseif ($domains) { @($domains) } else { @() }
$existingDomain = $domList | Where-Object { $_.host -eq 'auto-mailer.seemplifyai.com' -or $_.domain -eq 'auto-mailer.seemplifyai.com' } | Select-Object -First 1

if ($existingDomain) {
    Write-Host 'Domain auto-mailer.seemplifyai.com already exists.' -ForegroundColor Green
} else {
    try {
        Invoke-Dokploy -Method POST -Path 'domain.create' -Body @{
            host = 'auto-mailer.seemplifyai.com'
            applicationId = $applicationId
            https = $true
            certificateType = 'letsencrypt'
        } | Out-Null
        Write-Host 'Domain auto-mailer.seemplifyai.com created.' -ForegroundColor Green
    } catch {
        Write-Host "Domain create failed (may need 'domain' key): $_" -ForegroundColor Yellow
        try {
            Invoke-Dokploy -Method POST -Path 'domain.create' -Body @{
                domain = 'auto-mailer.seemplifyai.com'
                applicationId = $applicationId
                https = $true
                certificateType = 'letsencrypt'
            } | Out-Null
            Write-Host 'Domain created (alternate API).' -ForegroundColor Green
        } catch {
            Write-Host "Domain create failed: $_" -ForegroundColor Red
        }
    }
}

Write-Host ''
Write-Host '=== Done ===' -ForegroundColor Cyan
Write-Host "Application ID: $applicationId"
Write-Host ''
Write-Host 'Set GitHub secret:' -ForegroundColor Yellow
Write-Host "  gh secret set AUTO_MAILER_APP_ID --body `"$applicationId`"" -ForegroundColor White
Write-Host ''
Write-Host 'Then trigger deploy:' -ForegroundColor Yellow
Write-Host "  gh workflow run deploy-auto-mailer.yml" -ForegroundColor White
