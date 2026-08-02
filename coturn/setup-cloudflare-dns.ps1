# Create Cloudflare DNS A record for turn.seemplifyai.com (DNS only - proxied=false for TURN UDP)
# Requires: access/CLOUDFLARE-CREDENTIALS.md with CLOUDFLARE_API_TOKEN
# Zone ID for seemplifyai.com: bbc142d2d661d64011e2e4becae7a5c3

$ErrorActionPreference = "Stop"
$ZoneId = "bbc142d2d661d64011e2e4becae7a5c3"
$ServerIp = "4.180.153.209"

# Try to read token from access directory (relative to repo root)
$accessPath = Join-Path $PSScriptRoot "..\access\CLOUDFLARE-CREDENTIALS.md"
if (Test-Path $accessPath) {
    $content = Get-Content $accessPath -Raw
    if ($content -match "CLOUDFLARE_API_TOKEN\s*[=:]\s*(\S+)") { $token = $matches[1].Trim() }
    if ($content -match "API_TOKEN\s*[=:]\s*(\S+)") { $token = $matches[1].Trim() }
}
if (-not $token) {
    $token = $env:CLOUDFLARE_API_TOKEN
}
if (-not $token) {
    Write-Host "Set CLOUDFLARE_API_TOKEN or add it to access/CLOUDFLARE-CREDENTIALS.md"
    exit 1
}

$body = @{
    type    = "A"
    name    = "turn"
    content = $ServerIp
    ttl     = 3600
    proxied = $false
} | ConvertTo-Json

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"   = "application/json"
}

$uri = "https://api.cloudflare.com/client/v4/zones/$ZoneId/dns_records"
$response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body

if ($response.success) {
    Write-Host "Created DNS record: turn.seemplifyai.com -> $ServerIp (proxied=false)"
} else {
    Write-Host "Error:" $response.errors
    exit 1
}
