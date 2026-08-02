$ErrorActionPreference = 'SilentlyContinue'

$RuntimeDir = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.local-runtime\llm'
$StateFile = Join-Path $RuntimeDir 'state.json'
$ManageScript = Join-Path $PSScriptRoot 'manage.ps1'
$TunnelScript = Join-Path $PSScriptRoot 'cloudflare-tunnel.ps1'

if (-not (Test-Path $StateFile)) { exit 0 }
$state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
if ($state.autoStart -ne $true) { exit 0 }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ManageScript -Action start | Out-Null
if ($state.ingressEnabled -eq $true) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $TunnelScript -Action start | Out-Null
}
