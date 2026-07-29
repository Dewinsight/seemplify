param(
  [string]$PublicUrl = 'https://experience.aiinnigeria.com',
  [string]$BrevoEnvFile = '',
  [switch]$Json
)
$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$RepositoryDir = Split-Path -Parent $ProjectDir
$RuntimeDir = Join-Path $RepositoryDir '.local-runtime\experience-management'
$WebhookSecretFile = Join-Path $RuntimeDir 'brevo-webhook-secret'

function Read-DotEnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch "^\s*(?:export\s+)?$([regex]::Escape($Name))\s*=\s*(.*)\s*$") { continue }
    $value = $Matches[1].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    return $value
  }
  return $null
}

& (Join-Path $PSScriptRoot 'manage.ps1') -Action initialize | Out-Null
$secret = (Get-Content -LiteralPath $WebhookSecretFile -Raw).Trim()
if ($secret.Length -lt 32) { throw 'The Brevo webhook secret must contain at least 32 characters.' }

$candidateFiles = @(
  $BrevoEnvFile,
  (Join-Path $RepositoryDir 'Identityprovider\.env'),
  (Join-Path $RepositoryDir 'recruiter\backend\.env'),
  (Join-Path $RepositoryDir 'digilog-recruiter\backend\.env'),
  (Join-Path (Split-Path -Parent $RepositoryDir) 'crm\Xplorer-Full-backend\.env')
) | Where-Object { $_ }
$apiKey = $env:BREVO_API_KEY
$apiKeySource = if ($apiKey) { 'environment' } else { $null }
foreach ($candidate in $candidateFiles) {
  if ($apiKey) { break }
  $apiKey = Read-DotEnvValue -Path ([IO.Path]::GetFullPath($candidate)) -Name 'BREVO_API_KEY'
  if ($apiKey) { $apiKeySource = [IO.Path]::GetFullPath($candidate) }
}
if (-not $apiKey) { throw 'BREVO_API_KEY was not found in the configured shared environment.' }

$endpoint = "$($PublicUrl.TrimEnd('/'))/api/webhooks/brevo/transactional"
$description = 'Seemplify Experience transactional delivery'
$headers = @{ 'api-key' = $apiKey; 'accept' = 'application/json'; 'content-type' = 'application/json' }
$definition = @{
  url = $endpoint
  description = $description
  type = 'transactional'
  batched = $false
  events = @('request','delivered','hardBounce','softBounce','blocked','spam','invalid','deferred','click','opened','uniqueOpened','unsubscribed')
  auth = @{ type = 'bearer'; token = $secret }
}
$payload = $definition | ConvertTo-Json -Depth 5 -Compress
$existingResponse = Invoke-RestMethod -Method Get -Uri 'https://api.brevo.com/v3/webhooks?type=transactional&sort=desc' -Headers $headers -TimeoutSec 30
$existing = @($existingResponse.webhooks) | Where-Object { $_.url -eq $endpoint -or $_.description -eq $description } | Select-Object -First 1
if ($existing) {
  Invoke-RestMethod -Method Put -Uri "https://api.brevo.com/v3/webhooks/$($existing.id)" -Headers $headers -Body $payload -TimeoutSec 30 | Out-Null
  $webhookId = $existing.id; $operation = 'updated'
} else {
  $created = Invoke-RestMethod -Method Post -Uri 'https://api.brevo.com/v3/webhooks' -Headers $headers -Body $payload -TimeoutSec 30
  $webhookId = $created.id; $operation = 'created'
}
$result = [ordered]@{ configured=$true; operation=$operation; webhookId=$webhookId; endpoint=$endpoint; authentication='bearer'; batched=$false; apiKeySource=$apiKeySource }
if ($Json) { $result | ConvertTo-Json -Compress } else { [pscustomobject]$result | Format-List }
