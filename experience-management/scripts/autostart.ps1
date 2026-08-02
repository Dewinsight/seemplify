$ErrorActionPreference='Continue'
$scripts=Split-Path -Parent $MyInvocation.MyCommand.Path
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts 'manage.ps1') -Action start | Out-Null
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts 'cloudflare-tunnel.ps1') -Action start | Out-Null
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts 'auto-deploy.ps1') -Action start | Out-Null
