# Update recruiter Dokploy apps to use recruiter/new/ build path
# Run from repo root. Reads token from access/DOKPLOY-API-CREDENTIALS-COMPLETE.md
# Usage: .\scripts\update-recruiter-dokploy-build-path.ps1

$ErrorActionPreference = 'Stop'
$Base = 'http://4.180.153.209:3000'

# Read token from access
$credFile = "access/DOKPLOY-API-CREDENTIALS-COMPLETE.md"
if (-not (Test-Path $credFile)) { Write-Error "Missing $credFile" }
$content = Get-Content $credFile -Raw
if ($content -match 'github-actions-2026([A-Za-z0-9]+)') { $Token = "github-actions-2026" + $matches[1] }
elseif ($content -match 'DOKPLOY_TOKEN=([^\s`"]+)') { $Token = $matches[1].Trim() }
else { Write-Error "Could not extract token from $credFile" }

$headers = @{
    'Content-Type' = 'application/json'
    'x-api-key'    = $Token
}

function Invoke-Dokploy {
    param([string]$Method, [string]$Path, [object]$Body = $null)
    $url = "$Base/api/$Path"
    $params = @{ Uri = $url; Method = $Method; Headers = $headers }
    if ($Body) { $params.Body = ($Body | ConvertTo-Json -Compress -Depth 10) }
    try {
        $r = Invoke-RestMethod @params
        return $r
    } catch {
        Write-Host "ERROR $Path : $_" -ForegroundColor Red
        return $null
    }
}

$apps = @(
    @{ Id = 'tPMolDg5OEdQUBZ4MKMFh'; Name = 'recruiter-backend'; Path = './recruiter/new/backend'; Dockerfile = './recruiter/new/backend/Dockerfile' }
    @{ Id = 'k_p-9M7ZWEhSSf_0JusGs'; Name = 'recruiter-frontend'; Path = './recruiter/new/frontend'; Dockerfile = './recruiter/new/frontend/Dockerfile' }
    @{ Id = 'dev-rec-be-001-seemp'; Name = 'recruiter-backend-dev'; Path = './recruiter/new/backend'; Dockerfile = './recruiter/new/backend/Dockerfile' }
    @{ Id = 'dev-rec-fe-001-seemp'; Name = 'recruiter-frontend-dev'; Path = './recruiter/new/frontend'; Dockerfile = './recruiter/new/frontend/Dockerfile.dev' }
)

Write-Host "=== Updating recruiter build paths to recruiter/new/ ===" -ForegroundColor Cyan
Write-Host ""

foreach ($app in $apps) {
    Write-Host "Updating $($app.Name) ($($app.Id))..." -ForegroundColor Yellow
    
    # saveBuildType - sets dockerContextPath (build path)
    $buildResult = Invoke-Dokploy -Method POST -Path 'application.saveBuildType' -Body @{
        applicationId = $app.Id
        buildType = 'dockerfile'
        dockerfile = $app.Dockerfile
        dockerContextPath = $app.Path
        dockerBuildStage = $null
    }
    if ($buildResult) { Write-Host "  [OK] Build type updated: $($app.Path)" -ForegroundColor Green }
    else { Write-Host "  [FAIL] saveBuildType" -ForegroundColor Red; continue }
    
    # saveGitProvider - sets customGitBuildPath (for GitHub source)
    $gitResult = Invoke-Dokploy -Method POST -Path 'application.saveGitProvider' -Body @{
        applicationId = $app.Id
        customGitBuildPath = $app.Path
    }
    if ($gitResult) { Write-Host "  [OK] Git build path updated" -ForegroundColor Green }
    else { Write-Host "  [WARN] saveGitProvider may need full params - continuing" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "=== Triggering deploys ===" -ForegroundColor Cyan
foreach ($app in $apps) {
    $r = Invoke-Dokploy -Method POST -Path 'application.deploy' -Body @{ applicationId = $app.Id }
    if ($r) { Write-Host "  [OK] Deploy triggered: $($app.Name)" -ForegroundColor Green }
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
Write-Host "Check Dokploy: $Base"
Write-Host "Prod: https://app.seemplifyai.com | https://api.seemplifyai.com"
Write-Host "Dev: https://app-dev.seemplifyai.com | https://api-dev.seemplifyai.com"
