param(
  [ValidateSet('development', 'staging', 'all')]
  [string]$Environment = 'all',
  [string]$GatewayUrl = 'https://cv-llm.aiinnigeria.com',
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$WorkspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$SharedSecretFile = Join-Path $WorkspaceRoot '.local-runtime\llm\service-secret'
$CrmRoot = Join-Path (Split-Path -Parent $WorkspaceRoot) 'crm'
$SecretsRoot = Join-Path $CrmRoot '.local-runtime\secrets'

if (-not (Test-Path -LiteralPath $SharedSecretFile -PathType Leaf)) {
  throw 'The managed AI gateway shared-secret file is missing.'
}
$SharedSecret = (Get-Content -LiteralPath $SharedSecretFile -Raw).Trim()
if (-not $SharedSecret) { throw 'The managed AI gateway shared-secret file is empty.' }

$targets = if ($Environment -eq 'all') { @('development', 'staging') } else { @($Environment) }
$results = foreach ($target in $targets) {
  $environmentFile = Join-Path $SecretsRoot "xplorer-backend-$target.env"
  if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
    throw "The isolated CRM $target environment file is missing."
  }

  $lines = [Collections.Generic.List[string]]::new()
  foreach ($line in Get-Content -LiteralPath $environmentFile) { $lines.Add([string]$line) }
  function Set-EnvironmentValue([string]$Name, [string]$Value) {
    for ($index = 0; $index -lt $lines.Count; $index += 1) {
      if ($lines[$index] -match "^$([regex]::Escape($Name))=") {
        $lines[$index] = "$Name=$Value"
        return
      }
    }
    $lines.Add("$Name=$Value")
  }

  Set-EnvironmentValue 'M20_AI_RUNTIME_URL' $GatewayUrl.TrimEnd('/')
  Set-EnvironmentValue 'M20_INTERNAL_TOKEN' $SharedSecret
  [IO.File]::WriteAllLines($environmentFile, $lines, (New-Object Text.UTF8Encoding($false)))

  [pscustomobject]@{
    environment = $target
    configured = $true
    gatewayUrl = $GatewayUrl.TrimEnd('/')
    secretConfigured = $true
  }
}

if ($Json) { $results | ConvertTo-Json -Compress } else { $results | Format-Table -AutoSize }
