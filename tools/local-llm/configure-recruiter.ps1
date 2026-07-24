param(
  [ValidateSet('local', 'public')]
  [string]$Target = 'local',
  [ValidateRange(1, 128)]
  [int]$Concurrency = 1,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$WorkspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$RuntimeDir = Join-Path $WorkspaceRoot '.local-runtime\llm'
$SecretFile = Join-Path $RuntimeDir 'service-secret'
$BackendEnv = Join-Path $WorkspaceRoot 'recruiter\backend\.env'

if (-not (Test-Path $SecretFile)) { throw 'Start the local LLM gateway once so a service secret can be generated.' }
$ServiceSecret = (Get-Content -LiteralPath $SecretFile -Raw).Trim()
$StatusSecretFile = Join-Path $RuntimeDir 'cv-status-secret'
if (-not (Test-Path $StatusSecretFile)) {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  [IO.File]::WriteAllText($StatusSecretFile, [Convert]::ToBase64String($bytes), [Text.Encoding]::ASCII)
}
$StatusSecret = (Get-Content -LiteralPath $StatusSecretFile -Raw).Trim()
$BaseUrl = if ($Target -eq 'public') { 'https://cv-llm.aiinnigeria.com' } else { 'http://127.0.0.1:11435' }

$lines = [Collections.Generic.List[string]]::new()
if (Test-Path $BackendEnv) {
  foreach ($line in Get-Content -LiteralPath $BackendEnv) { $lines.Add([string]$line) }
}
function Set-EnvValue([string]$Name, [string]$Value) {
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match "^$([regex]::Escape($Name))=") {
      $lines[$index] = "$Name=$Value"
      return
    }
  }
  $lines.Add("$Name=$Value")
}

Set-EnvValue 'LOCAL_LLM_BASE_URL' $BaseUrl
Set-EnvValue 'LOCAL_LLM_SHARED_SECRET' $ServiceSecret
Set-EnvValue 'LOCAL_LLM_MODEL' 'gemma4:26b-a4b-it-qat'
Set-EnvValue 'CV_ANALYSIS_QUEUE_CONCURRENCY' ([string]$Concurrency)
Set-EnvValue 'CV_STATUS_TOKEN_SECRET' $StatusSecret
[IO.File]::WriteAllLines($BackendEnv, $lines, (New-Object Text.UTF8Encoding($false)))

$sha = [Security.Cryptography.SHA256]::Create()
try { $fingerprintBytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($ServiceSecret)) } finally { $sha.Dispose() }
$fingerprint = -join ($fingerprintBytes | ForEach-Object { $_.ToString('x2') })
$result = [ordered]@{
  configured = $true
  target = $Target
  baseUrl = $BaseUrl
  concurrency = $Concurrency
  envFile = $BackendEnv
  secretFingerprint = $fingerprint.Substring(0, 12)
}
if ($Json) { $result | ConvertTo-Json -Compress } else { [pscustomobject]$result | Format-List }
