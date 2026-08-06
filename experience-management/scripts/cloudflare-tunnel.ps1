param([ValidateSet('ensure','start','stop','status')][string]$Action='status',[switch]$Json)
$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$RepositoryDir = Split-Path -Parent $ProjectDir
$RuntimeDir = Join-Path $RepositoryDir '.local-runtime\experience-management'
$MetadataFile = Join-Path $RuntimeDir 'cloudflare.json'
$TunnelTokenFile = Join-Path $RuntimeDir 'cloudflare-tunnel-token'
$PidFile = Join-Path $RuntimeDir 'cloudflared.pid'
$Cloudflared = Join-Path (Split-Path -Parent $RepositoryDir) 'crm\.local-runtime\bin\cloudflared.exe'
$ApiTokenFile = Join-Path (Split-Path -Parent $RepositoryDir) 'crm\.local-runtime\cloudflare-api-token'
$ApiBase = 'https://api.cloudflare.com/client/v4'
$AccountId = 'c42eadfe7b90361171382976b9c63df1'
$ZoneId = '25e5c8be7e4c31cbc39619cc3f1c223d'
$TunnelName = 'seemplify-experience'
$Hostname = 'experience.aiinnigeria.com'
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

function Get-ApiToken { if (-not (Test-Path $ApiTokenFile)) { throw "Cloudflare API token is missing at $ApiTokenFile." }; return (Get-Content -LiteralPath $ApiTokenFile -Raw).Trim() }
function Invoke-CloudflareApi([string]$Method,[string]$Path,$Body=$null) {
  $arguments = @{ Method=$Method; Uri="$ApiBase/$Path"; Headers=@{Authorization="Bearer $(Get-ApiToken)"}; TimeoutSec=30 }
  if ($null -ne $Body) { $arguments.ContentType='application/json'; $arguments.Body=$Body | ConvertTo-Json -Depth 12 -Compress }
  $response = Invoke-RestMethod @arguments
  if (-not $response.success) { throw (($response.errors | ForEach-Object message) -join '; ') }
  return $response.result
}
function Get-Tunnel {
  $items = Invoke-CloudflareApi Get "accounts/$AccountId/cfd_tunnel?is_deleted=false&name=$([uri]::EscapeDataString($TunnelName))"
  return @($items | Where-Object { $_.name -eq $TunnelName -and -not $_.deleted_at } | Select-Object -First 1)
}
function Ensure-Configuration {
  $tunnel = Get-Tunnel
  if (-not $tunnel) { $tunnel = Invoke-CloudflareApi Post "accounts/$AccountId/cfd_tunnel" ([ordered]@{name=$TunnelName;config_src='cloudflare'}) }
  $configuration = [ordered]@{config=[ordered]@{ingress=@([ordered]@{hostname=$Hostname;service='http://localhost:5410';originRequest=[ordered]@{connectTimeout=10}},[ordered]@{service='http_status:404'})}}
  Invoke-CloudflareApi Put "accounts/$AccountId/cfd_tunnel/$($tunnel.id)/configurations" $configuration | Out-Null
  $records = @(Invoke-CloudflareApi Get "zones/$ZoneId/dns_records?type=CNAME&name=$([uri]::EscapeDataString($Hostname))")
  $dns = [ordered]@{type='CNAME';name=$Hostname;content="$($tunnel.id).cfargotunnel.com";ttl=1;proxied=$true;comment='Seemplify Experience local application'}
  if ($records.Count) { Invoke-CloudflareApi Put "zones/$ZoneId/dns_records/$($records[0].id)" $dns | Out-Null }
  else { Invoke-CloudflareApi Post "zones/$ZoneId/dns_records" $dns | Out-Null }
  $token = [string](Invoke-CloudflareApi Get "accounts/$AccountId/cfd_tunnel/$($tunnel.id)/token")
  Set-Content -LiteralPath $TunnelTokenFile -Value $token -Encoding ascii
  $metadata = [ordered]@{tunnelId=[string]$tunnel.id;tunnelName=$TunnelName;hostname=$Hostname;publicUrl="https://$Hostname";target='http://localhost:5410';updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $metadata | ConvertTo-Json | Set-Content -LiteralPath $MetadataFile -Encoding utf8
  return $metadata
}
function Get-TunnelProcess {
  if (-not (Test-Path $PidFile)) { return $null }
  $processId = [int](Get-Content -LiteralPath $PidFile -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if (-not $process -or $process.Name -ne 'cloudflared.exe') { Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue; return $null }
  return $process
}
function Start-Tunnel {
  if (-not (Test-Path $Cloudflared)) { throw "cloudflared is missing at $Cloudflared." }
  if (-not (Test-Path $TunnelTokenFile)) { Ensure-Configuration | Out-Null }
  if (Get-TunnelProcess) { return }
  $process = Start-Process -FilePath $Cloudflared -ArgumentList @('tunnel','--no-autoupdate','run','--token-file',$TunnelTokenFile) -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii
}
function Stop-Tunnel { $process=Get-TunnelProcess; if($process){Stop-Process -Id $process.ProcessId -Force}; Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue }
function Get-Status {
  $process=Get-TunnelProcess; $public=$false
  try { $public=(Invoke-WebRequest -Uri "https://$Hostname/health" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200 } catch {}
  if (-not $public) {
    try {
      $edgeIp = Resolve-DnsName -Name $Hostname -Type A -Server '1.1.1.1' -ErrorAction Stop | Where-Object IPAddress | Select-Object -ExpandProperty IPAddress -First 1
      if ($edgeIp) { $statusCode = & curl.exe --silent --output NUL --write-out '%{http_code}' --connect-timeout 5 --max-time 10 --resolve "$($Hostname):443:$edgeIp" "https://$Hostname/health"; $public = [string]$statusCode -eq '200' }
    } catch {}
  }
  return [ordered]@{configured=(Test-Path $MetadataFile);running=[bool]$process;pid=if($process){$process.ProcessId}else{$null};hostname=$Hostname;publicUrl="https://$Hostname";publicHealthy=$public;target='http://localhost:5410'}
}
switch($Action){'ensure'{Ensure-Configuration|Out-Null};'start'{Ensure-Configuration|Out-Null;Start-Tunnel};'stop'{Stop-Tunnel};'status'{}}
$status=Get-Status; if($Json){$status|ConvertTo-Json -Compress}else{[pscustomobject]$status|Format-List}
