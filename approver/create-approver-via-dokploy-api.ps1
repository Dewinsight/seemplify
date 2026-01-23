# Create "approver" project in Dokploy via HTTP API so it appears in the UI
# Run from repo root. Requires: $env:DOKPLOY_URL and $env:DOKPLOY_TOKEN
# Example: $env:DOKPLOY_URL='http://4.180.153.209:3000'; $env:DOKPLOY_TOKEN='sk_dokploy_...'; .\approver\create-approver-via-dokploy-api.ps1

$ErrorActionPreference = 'Stop'
$Base = $env:DOKPLOY_URL
$Token = $env:DOKPLOY_TOKEN

if (-not $Base) { $Base = 'http://4.180.153.209:3000' }
if (-not $Token) {
    Write-Error 'Set DOKPLOY_TOKEN (e.g. $env:DOKPLOY_TOKEN="sk_dokploy_...")'
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

# project.all / project.create require user session (401 with x-api-key).
# We add the approver APPLICATION under the existing seemplify "production" environment
# so it appears in the UI under: seemplify > production > approver.
$projectId = 'jSrhrIiOyn0eH02aRSIFY'
$environmentId = 'LRloZifVPbZcVc-D9jUd4'
Write-Host 'Using existing seemplify project and production environment.'
Write-Host "  projectId: $projectId, environmentId: $environmentId"
Write-Host ''
Write-Host '=== 1. Create application "approver" (or reuse if already exists) ==='
$appsByEnv = @()
try { $appsByEnv = Invoke-Dokploy -Method GET -Path "application.byEnvironmentId?environmentId=$environmentId" } catch { }
$appList = if ($appsByEnv -is [array]) { $appsByEnv } elseif ($appsByEnv) { @($appsByEnv) } else { @() }
$approverApp = $appList | Where-Object { $_.name -eq 'approver' } | Select-Object -First 1

if ($approverApp) {
    $applicationId = $approverApp.applicationId; if (-not $applicationId) { $applicationId = $approverApp.id }
    Write-Host "Application 'approver' exists: $applicationId"
} else {
    Write-Host 'Creating application "approver"...'
    $ar = Invoke-Dokploy -Method POST -Path 'application.create' -Body @{
        name = 'approver'
        appName = 'approver-app'
        description = 'Approver Application'
        environmentId = $environmentId
    }
    $applicationId = $ar.applicationId; if (-not $applicationId) { $applicationId = $ar.id }
    if (-not $applicationId) { Write-Error "Could not get applicationId from: $($ar | ConvertTo-Json)" }
    Write-Host "Created application: $applicationId"

    Write-Host ''
    Write-Host '=== 2. Set Git source (custom Git URL) ==='
    Invoke-Dokploy -Method POST -Path 'application.saveGitProvider' -Body @{
        applicationId = $applicationId
        customGitUrl = 'https://github.com/michaelegbo/seemplify.git'
        customGitBranch = 'main'
        customGitBuildPath = './approver/backend'
        enableSubmodules = $false
    } | Out-Null
    Write-Host 'Git provider set.'

    Write-Host ''
    Write-Host '=== 3. Set build type (Dockerfile) ==='
    Invoke-Dokploy -Method POST -Path 'application.saveBuildType' -Body @{
        applicationId = $applicationId
        buildType = 'dockerfile'
        dockerfile = './approver/backend/Dockerfile'
        dockerContextPath = './approver/backend'
        dockerBuildStage = $null
    } | Out-Null
    Write-Host 'Build type set.'
}

Write-Host ''
Write-Host '=== 4. Domain: approver.aiinigeria.com ==='
$domains = @()
try { $domains = Invoke-Dokploy -Method GET -Path "domain.byApplicationId?applicationId=$applicationId" } catch { }
$domList = if ($domains -is [array]) { $domains } elseif ($domains) { @($domains) } else { @() }
$existing = $domList | Where-Object { $_.host -eq 'approver.aiinigeria.com' -or $_.domain -eq 'approver.aiinigeria.com' } | Select-Object -First 1

if ($existing) {
    Write-Host 'Domain approver.aiinigeria.com already exists for this app.'
} else {
    Invoke-Dokploy -Method POST -Path 'domain.create' -Body @{
        host = 'approver.aiinigeria.com'
        applicationId = $applicationId
        https = $true
        certificateType = 'letsencrypt'
    } | Out-Null
    Write-Host 'Domain created.'
}

Write-Host ''
Write-Host '=== Done ==='
Write-Host "Project ID:    $projectId"
Write-Host "Environment:   $environmentId"
Write-Host "Application:   $applicationId"
Write-Host ''
Write-Host 'Refresh the Dokploy UI (http://4.180.153.209:3000) – you should see app "approver" under seemplify > production.'
Write-Host 'Set APPROVER_APP_ID in GitHub secrets to: ' + $applicationId
