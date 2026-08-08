param(
  [ValidateSet('status','start','stop','graceful-stop','restart','force-stop','enable-auto-start','disable-auto-start','load','unload','reconcile','logs','bootstrap')]
  [string]$Action = 'status',
  [ValidateSet('runtime','arango','docling','embedding','reranker','all')]
  [string]$Component = 'runtime',
  [ValidateRange(1, 1000)][int]$Lines = 200,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DefaultRuntimeDir = Join-Path $RepoRoot '.local-runtime\knowledge'
$OwnerLabel = 'ai.seemplify.owner=local-knowledge'
$Containers = [ordered]@{
  arango = 'seemplify-knowledge-arango'
  embedding = 'seemplify-knowledge-embedding'
  reranker = 'seemplify-knowledge-reranker'
  docling = 'seemplify-knowledge-docling'
}

function Resolve-KnowledgeRuntimeDir {
  $configured = [string][Environment]::GetEnvironmentVariable('SEEMPLIFY_KNOWLEDGE_RUNTIME_DIR')
  if (-not [string]::IsNullOrWhiteSpace($configured)) { return [IO.Path]::GetFullPath($configured) }
  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    $raw = & docker.exe inspect $Containers.arango 2>$null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exitCode -eq 0 -and $raw) {
      $info = $raw | ConvertFrom-Json | Select-Object -First 1
      $owned = [string]$info.Config.Labels.'ai.seemplify.owner' -eq 'local-knowledge'
      $secretMount = $info.Mounts | Where-Object { [string]$_.Destination -eq '/run/secrets/arango-root' } | Select-Object -First 1
      if ($owned -and $secretMount -and (Test-Path -LiteralPath ([string]$secretMount.Source) -PathType Leaf)) {
        $secretsRoot = Split-Path -Parent ([string]$secretMount.Source)
        $candidate = Split-Path -Parent $secretsRoot
        if ((Split-Path -Leaf $secretsRoot) -eq 'secrets' -and (Split-Path -Leaf $candidate) -eq 'knowledge') {
          return [IO.Path]::GetFullPath($candidate)
        }
      }
    }
  } catch { $ErrorActionPreference = 'Stop' }
  return [IO.Path]::GetFullPath($DefaultRuntimeDir)
}

$RuntimeDir = Resolve-KnowledgeRuntimeDir
$env:SEEMPLIFY_KNOWLEDGE_RUNTIME_DIR = $RuntimeDir
$SecretsDir = Join-Path $RuntimeDir 'secrets'
$StateFile = Join-Path $RuntimeDir 'state.json'
$PidFile = Join-Path $RuntimeDir 'runtime.pid'
$StdoutLog = Join-Path $RuntimeDir 'runtime.stdout.log'
$StderrLog = Join-Path $RuntimeDir 'runtime.stderr.log'
$DataRoot = if ($env:SEEMPLIFY_KNOWLEDGE_DATA_ROOT) { [IO.Path]::GetFullPath($env:SEEMPLIFY_KNOWLEDGE_DATA_ROOT) } else { 'D:\SeemplifyKnowledge' }
$Network = 'seemplify-knowledge'
$Images = [ordered]@{
  arango = [ordered]@{ tag='arangodb:3.12.9.4'; reference='arangodb@sha256:bf5eabc0fb3a16a13d0d4de00cddfbf2209e3d25630e5331832efb206519ff8f' }
  tei = [ordered]@{ tag='ghcr.io/huggingface/text-embeddings-inference:1.8.0'; reference='ghcr.io/huggingface/text-embeddings-inference@sha256:8aeb97215f29e0ed48647384af89661c36cee04120c2d4e86b5a3aead47611fa' }
  docling = [ordered]@{ tag='quay.io/docling-project/docling-serve-cpu:v1.28.0'; reference='quay.io/docling-project/docling-serve-cpu@sha256:cc207e1eb768878456ed98042c5d84fae56af3729a9c03d3e5c8fef393902956' }
}
$EmbeddingProfiles = [ordered]@{
  'qwen-tei' = [ordered]@{
    provider='qwen-tei'; model='Qwen/Qwen3-Embedding-4B'; revision='5cf2132abc99cad020ac570b19d031efec650f2b';
    dtype='float16'; dimensions=2560; vectorIndexVersion='qwen-v1'
  }
  'gte-node' = [ordered]@{
    provider='gte-node'; model='Alibaba-NLP/gte-modernbert-base'; revision='e7f32e3c00f91d699e8c43b53106206bcc72bb22';
    dtype='q8'; dimensions=768; vectorIndexVersion='gte-modernbert-v1'
  }
}
$GtePackageName = '@huggingface/transformers'
$GtePackageVersion = '4.2.0'
$GtePackageManifest = Join-Path $PSScriptRoot 'package.json'
$GtePackageLock = Join-Path $PSScriptRoot 'package-lock.json'
$GteInstalledManifest = Join-Path $PSScriptRoot 'node_modules\@huggingface\transformers\package.json'

function Get-BooleanEnvironment {
  param([string]$Name, [bool]$Default = $false)
  $raw = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  switch ($raw.Trim().ToLowerInvariant()) {
    { $_ -in @('1','true','yes','on') } { return $true }
    { $_ -in @('0','false','no','off') } { return $false }
    default { throw "$Name must be true or false." }
  }
}

function Get-IntegerEnvironment {
  param([string]$Name, [int]$Default, [int]$Minimum, [int]$Maximum)
  $raw = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  $value = 0
  if (-not [int]::TryParse($raw, [ref]$value) -or $value -lt $Minimum -or $value -gt $Maximum) {
    throw "$Name must be an integer between $Minimum and $Maximum."
  }
  return $value
}

function Get-EmbeddingConfiguration {
  $forceQwen = Get-BooleanEnvironment 'EXPERIENCE_EMBEDDING_FORCE_QWEN' $false
  if ($forceQwen) {
    $provider = 'qwen-tei'
    $dualWrite = $false
    $qwenRollbackRetained = $true
    $rolloutPercent = 0
    $shadowPercent = 0
    $concurrency = 8
    $queueDepth = 256
    $timeoutMs = 120000
  } else {
    $provider = [string][Environment]::GetEnvironmentVariable('EXPERIENCE_EMBEDDING_PROVIDER')
    if ([string]::IsNullOrWhiteSpace($provider)) { $provider = 'gte-node' }
    $provider = $provider.Trim().ToLowerInvariant()
    if ($provider -notin @('qwen-tei','gte-node')) { throw 'EXPERIENCE_EMBEDDING_PROVIDER must be qwen-tei or gte-node.' }
    $dualWrite = Get-BooleanEnvironment 'EXPERIENCE_EMBEDDING_DUAL_WRITE' $false
    $qwenRollbackRetained = Get-BooleanEnvironment 'EXPERIENCE_QWEN_ROLLBACK_RETAINED' ($provider -eq 'qwen-tei')
    $defaultRolloutPercent = if ($provider -eq 'gte-node') { 100 } else { 0 }
    $rolloutPercent = Get-IntegerEnvironment 'EXPERIENCE_EMBEDDING_ROLLOUT_PERCENT' $defaultRolloutPercent 0 100
    $shadowPercent = Get-IntegerEnvironment 'EXPERIENCE_EMBEDDING_SHADOW_PERCENT' 0 0 100
    $concurrency = Get-IntegerEnvironment 'EXPERIENCE_EMBEDDING_CONCURRENCY' 8 1 8
    $queueDepth = Get-IntegerEnvironment 'EXPERIENCE_EMBEDDING_QUEUE_DEPTH' 256 8 4096
    $timeoutMs = Get-IntegerEnvironment 'EXPERIENCE_EMBEDDING_TIMEOUT_MS' 120000 1000 1800000
  }
  if ($provider -eq 'gte-node' -and $qwenRollbackRetained -and -not $dualWrite) {
    throw 'gte-node requires EXPERIENCE_EMBEDDING_DUAL_WRITE=true while the Qwen rollback index is retained.'
  }
  if ($provider -eq 'gte-node' -and -not $qwenRollbackRetained -and $dualWrite) {
    throw 'gte-node cannot dual-write to Qwen after the Qwen rollback profile has been retired.'
  }
  $profile = $EmbeddingProfiles[$provider]
  $configuredFields = [ordered]@{
    EXPERIENCE_EMBEDDING_MODEL=$profile.model
    EXPERIENCE_EMBEDDING_MODEL_REVISION=$profile.revision
    EXPERIENCE_EMBEDDING_DTYPE=$profile.dtype
    EXPERIENCE_EMBEDDING_DIMENSIONS=[string]$profile.dimensions
    EXPERIENCE_VECTOR_INDEX_VERSION=$profile.vectorIndexVersion
  }
  if (-not $forceQwen) {
    foreach ($entry in $configuredFields.GetEnumerator()) {
      $configured = [string][Environment]::GetEnvironmentVariable($entry.Key)
      if (-not [string]::IsNullOrWhiteSpace($configured) -and $configured.Trim() -cne [string]$entry.Value) {
        throw "$($entry.Key) must match the pinned $provider profile."
      }
    }
  }
  $gteRequired = $provider -eq 'gte-node' -or $dualWrite -or $rolloutPercent -gt 0 -or $shadowPercent -gt 0
  $qwenRequired = $provider -eq 'qwen-tei' -or $dualWrite -or $qwenRollbackRetained -or $forceQwen
  return [ordered]@{
    provider=$provider; model=$profile.model; revision=$profile.revision; dtype=$profile.dtype;
    dimensions=$profile.dimensions; vectorIndexVersion=$profile.vectorIndexVersion;
    concurrency=$concurrency; queueDepth=$queueDepth; timeoutMs=$timeoutMs;
    dualWrite=$dualWrite; qwenRollbackRetained=$qwenRollbackRetained; rolloutPercent=$rolloutPercent; shadowPercent=$shadowPercent;
    gteRequired=$gteRequired; qwenRequired=$qwenRequired; forceQwenRollback=$forceQwen
  }
}

function Set-EmbeddingEnvironment {
  param([Collections.IDictionary]$Configuration)
  $env:EXPERIENCE_EMBEDDING_PROVIDER = [string]$Configuration.provider
  $env:EXPERIENCE_EMBEDDING_MODEL = [string]$Configuration.model
  $env:EXPERIENCE_EMBEDDING_MODEL_REVISION = [string]$Configuration.revision
  $env:EXPERIENCE_EMBEDDING_DTYPE = [string]$Configuration.dtype
  $env:EXPERIENCE_EMBEDDING_DIMENSIONS = [string]$Configuration.dimensions
  $env:EXPERIENCE_VECTOR_INDEX_VERSION = [string]$Configuration.vectorIndexVersion
  $env:EXPERIENCE_EMBEDDING_CONCURRENCY = [string]$Configuration.concurrency
  $env:EXPERIENCE_EMBEDDING_QUEUE_DEPTH = [string]$Configuration.queueDepth
  $env:EXPERIENCE_EMBEDDING_TIMEOUT_MS = [string]$Configuration.timeoutMs
  $env:EXPERIENCE_EMBEDDING_DUAL_WRITE = if ($Configuration.dualWrite) { 'true' } else { 'false' }
  $env:EXPERIENCE_QWEN_ROLLBACK_RETAINED = if ($Configuration.qwenRollbackRetained) { 'true' } else { 'false' }
  $env:EXPERIENCE_EMBEDDING_ROLLOUT_PERCENT = [string]$Configuration.rolloutPercent
  $env:EXPERIENCE_EMBEDDING_SHADOW_PERCENT = [string]$Configuration.shadowPercent
}

function ConvertTo-Hashtable {
  param($Value)
  if ($null -eq $Value) { return $null }
  if ($Value -is [Collections.IDictionary]) {
    $result = [ordered]@{}
    foreach ($key in $Value.Keys) { $result[$key] = ConvertTo-Hashtable $Value[$key] }
    return $result
  }
  if ($Value -is [Management.Automation.PSCustomObject]) {
    $result = [ordered]@{}
    foreach ($property in $Value.PSObject.Properties) { $result[$property.Name] = ConvertTo-Hashtable $property.Value }
    return $result
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) { return @($Value | ForEach-Object { ConvertTo-Hashtable $_ }) }
  return $Value
}

function Read-State {
  $state = [ordered]@{ schemaVersion=1; autoStart=$false; desired='stopped'; modelsLoaded=$false; updatedAt=$null }
  if (Test-Path $StateFile) {
    try {
      $saved = ConvertTo-Hashtable (Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json)
      # Updating an OrderedDictionary while enumerating its live Keys view
      # throws on Windows PowerShell 5.1. Iterate a stable key snapshot.
      foreach ($key in @($state.Keys)) { if ($null -ne $saved[$key]) { $state[$key] = $saved[$key] } }
    } catch {}
  }
  return $state
}

function Write-State {
  param([Collections.IDictionary]$State)
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  $State.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  [IO.File]::WriteAllText($StateFile, ($State | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
}

function New-StrongSecret {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Ensure-Secret {
  param([string]$Name)
  $file = Join-Path $SecretsDir $Name
  if (-not (Test-Path $file) -or -not (Get-Content -LiteralPath $file -Raw).Trim()) {
    [IO.File]::WriteAllText($file, (New-StrongSecret), [Text.UTF8Encoding]::new($false))
  }
  return $file
}

function Ensure-DirectoriesAndSecrets {
  foreach ($directory in @($RuntimeDir, $SecretsDir, (Join-Path $DataRoot 'storage\arangodb'), (Join-Path $DataRoot 'models'), (Join-Path $DataRoot 'backups'), (Join-Path $DataRoot 'staging'), (Join-Path $DataRoot 'logs'))) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
  foreach ($name in @('arango-root','arango-app','arango-provisioner','tei-api','docling-api','control-secret')) { [void](Ensure-Secret $name) }
  $serviceSecret = Join-Path $RuntimeDir 'service-secret'
  if (-not (Test-Path $serviceSecret) -or -not (Get-Content -LiteralPath $serviceSecret -Raw).Trim()) {
    $legacySecret = Join-Path $SecretsDir 'hmac-service'
    $value = if (Test-Path $legacySecret) { (Get-Content -LiteralPath $legacySecret -Raw).Trim() } else { New-StrongSecret }
    [IO.File]::WriteAllText($serviceSecret, $value, [Text.UTF8Encoding]::new($false))
  }
  $gatewaySource = Join-Path (Split-Path -Parent $RuntimeDir) 'chatgpt-gateway\service-secret'
  $gatewayTarget = Join-Path $SecretsDir 'chatgpt-gateway'
  if (-not (Test-Path $gatewaySource)) { throw 'The signed ChatGPT gateway secret is missing. Configure the hosted gateway before starting knowledge indexing.' }
  [IO.File]::WriteAllText($gatewayTarget, (Get-Content -LiteralPath $gatewaySource -Raw).Trim(), [Text.UTF8Encoding]::new($false))
}

function Get-GteDependencyStatus {
  $manifestVersion = $null
  $lockDeclaredVersion = $null
  $lockVersion = $null
  $installedVersion = $null
  try {
    if (Test-Path -LiteralPath $GtePackageManifest -PathType Leaf) {
      $manifest = Get-Content -LiteralPath $GtePackageManifest -Raw | ConvertFrom-Json
      $manifestVersion = [string]$manifest.dependencies.$GtePackageName
    }
  } catch {}
  try {
    if (Test-Path -LiteralPath $GtePackageLock -PathType Leaf) {
      $node = Get-Command node.exe -ErrorAction SilentlyContinue
      if ($node) {
        $readLockVersion = "const fs=require('node:fs');const value=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(value.packages['']?.dependencies?.['@huggingface/transformers']||'')+'\n'+String(value.packages['node_modules/@huggingface/transformers']?.version||''));"
        $lockOutput = @(& $node.Source -e $readLockVersion $GtePackageLock 2>$null)
        if ($LASTEXITCODE -eq 0 -and $lockOutput.Count -ge 2) {
          $lockDeclaredVersion = [string]$lockOutput[0]
          $lockVersion = [string]$lockOutput[1]
        }
      }
    }
  } catch {}
  try {
    if (Test-Path -LiteralPath $GteInstalledManifest -PathType Leaf) {
      $installed = Get-Content -LiteralPath $GteInstalledManifest -Raw | ConvertFrom-Json
      $installedVersion = [string]$installed.version
    }
  } catch {}
  $manifestExact = $manifestVersion -ceq $GtePackageVersion
  $lockExact = $lockDeclaredVersion -ceq $GtePackageVersion -and $lockVersion -ceq $GtePackageVersion
  $installedExact = $installedVersion -ceq $GtePackageVersion
  return [ordered]@{
    package=$GtePackageName; requiredVersion=$GtePackageVersion;
    manifestVersion=$manifestVersion; lockDeclaredVersion=$lockDeclaredVersion; lockVersion=$lockVersion; installedVersion=$installedVersion;
    manifestExact=$manifestExact; lockExact=$lockExact; installedExact=$installedExact;
    ready=($manifestExact -and $lockExact -and $installedExact)
  }
}

function Ensure-GteDependencies {
  $status = Get-GteDependencyStatus
  if (-not $status.manifestExact -or -not $status.lockExact) {
    throw "The GTE npm dependency contract must pin $GtePackageName exactly to $GtePackageVersion in package.json and package-lock.json."
  }
  $node = Get-Command node.exe -ErrorAction Stop
  $nodeVersionOutput = & $node.Source --version
  if ($LASTEXITCODE -ne 0 -or [string]$nodeVersionOutput -notmatch '^v(?<major>\d+)\.') { throw 'Node.js version detection failed.' }
  if ([int]$Matches.major -lt 22) { throw 'The GTE embedding runtime requires Node.js 22 or newer.' }
  if ($status.installedExact) { return $status }
  $npm = Get-Command npm.cmd -ErrorAction Stop
  Push-Location $PSScriptRoot
  try {
    # npm writes non-fatal warnings to stderr. Under this script's strict
    # ErrorActionPreference, PowerShell otherwise turns those warnings into a
    # terminating NativeCommandError before the process exit code is checked.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $output = & $npm.Source ci --omit=dev --no-audit --no-fund 2>&1
      $npmExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($npmExitCode -ne 0) { throw "Exact GTE dependency installation failed: $($output -join [Environment]::NewLine)" }
  } finally { Pop-Location }
  $status = Get-GteDependencyStatus
  if (-not $status.ready) { throw "npm ci completed without installing exact $GtePackageName $GtePackageVersion." }
  return $status
}

function Invoke-Docker {
  param([string[]]$Arguments, [switch]$AllowFailure)
  $output = & docker.exe @Arguments 2>&1
  if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) { throw "Docker command failed: $($output -join [Environment]::NewLine)" }
  return @($output)
}

function Test-DockerReady {
  & docker.exe info --format '{{.ServerVersion}}' 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

function Ensure-Network {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  & docker.exe network inspect $Network *> $null
  $networkExists = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $previousPreference
  if (-not $networkExists) { [void](Invoke-Docker @('network','create','--label',$OwnerLabel,$Network)) }
}

function Get-ContainerInfo {
  param([string]$Name)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $raw = & docker.exe inspect $Name 2>$null
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($exitCode -ne 0 -or -not $raw) { return $null }
  return $raw | ConvertFrom-Json | Select-Object -First 1
}

function Assert-OwnedContainer {
  param([string]$Name)
  $info = Get-ContainerInfo $Name
  if ($info -and [string]$info.Config.Labels.'ai.seemplify.owner' -ne 'local-knowledge') {
    throw "Container '$Name' exists but is not owned by Seemplify local knowledge. It will not be changed."
  }
  return $info
}

function Ensure-Container {
  param([string]$Name, [string[]]$RunArguments)
  $info = Assert-OwnedContainer $Name
  if (-not $info) { [void](Invoke-Docker (@('run','-d','--name',$Name) + $RunArguments)); return }
  if (-not [bool]$info.State.Running) { [void](Invoke-Docker @('start',$Name)) }
}

function Start-Arango {
  # Avoid embedded double-quotes here: Windows PowerShell 5.1 otherwise splits
  # the `sh -c` payload at the command-substitution whitespace.
  $command = 'export ARANGO_ROOT_PASSWORD=$(cat /run/secrets/arango-root); exec /entrypoint.sh arangod --vector-index'
  Ensure-Container $Containers.arango @(
    '--label',$OwnerLabel,'--label','ai.seemplify.component=arangodb','--restart','no','--network',$Network,
    '--publish','127.0.0.1:8529:8529','--mount',"type=bind,source=$(Join-Path $DataRoot 'storage\arangodb'),target=/var/lib/arangodb3",
    '--mount',"type=bind,source=$(Join-Path $SecretsDir 'arango-root'),target=/run/secrets/arango-root,readonly",'--memory','8g','--cpus','4','--entrypoint','/bin/sh',
    $Images.arango.reference,'-c',$command
  )
}

function Start-Embedding {
  $command = 'exec text-embeddings-router --model-id Qwen/Qwen3-Embedding-4B --revision 5cf2132abc99cad020ac570b19d031efec650f2b --huggingface-hub-cache /data --api-key $(cat /run/secrets/tei-api) --port 80 --json-output'
  Ensure-Container $Containers.embedding @(
    '--label',$OwnerLabel,'--label','ai.seemplify.component=embedding','--restart','no','--network',$Network,'--gpus','all','--log-driver','none',
    '--publish','127.0.0.1:11541:80','--mount',"type=bind,source=$(Join-Path $DataRoot 'models'),target=/data",
    '--mount',"type=bind,source=$(Join-Path $SecretsDir 'tei-api'),target=/run/secrets/tei-api,readonly",'--memory','20g','--cpus','8','--entrypoint','/bin/sh',
    $Images.tei.reference,'-c',$command
  )
}

function Start-Reranker {
  $command = 'exec text-embeddings-router --model-id BAAI/bge-reranker-v2-m3 --revision 953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e --huggingface-hub-cache /data --api-key $(cat /run/secrets/tei-api) --port 80 --json-output'
  Ensure-Container $Containers.reranker @(
    '--label',$OwnerLabel,'--label','ai.seemplify.component=reranker','--restart','no','--network',$Network,'--gpus','all','--log-driver','none',
    '--publish','127.0.0.1:11542:80','--mount',"type=bind,source=$(Join-Path $DataRoot 'models'),target=/data",
    '--mount',"type=bind,source=$(Join-Path $SecretsDir 'tei-api'),target=/run/secrets/tei-api,readonly",'--memory','10g','--cpus','6','--entrypoint','/bin/sh',
    $Images.tei.reference,'-c',$command
  )
}

function Start-Docling {
  $command = 'export DOCLING_SERVE_API_KEY=$(cat /run/secrets/docling-api) DOCLING_DEVICE=cpu; exec container-entrypoint docling-serve run --host 0.0.0.0 --port 5001'
  Ensure-Container $Containers.docling @(
    '--label',$OwnerLabel,'--label','ai.seemplify.component=docling','--restart','no','--network',$Network,
    '--publish','127.0.0.1:11543:5001','--mount',"type=bind,source=$(Join-Path $SecretsDir 'docling-api'),target=/run/secrets/docling-api,readonly",'--memory','8g','--cpus','4','--entrypoint','/bin/sh',
    $Images.docling.reference,'-c',$command
  )
}

function Wait-Http {
  param([string]$Url, [int]$Seconds = 120, [hashtable]$Headers = @{})
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try { $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers $Headers -TimeoutSec 3; if ([int]$response.StatusCode -lt 500) { return } } catch {}
    Start-Sleep -Milliseconds 1000
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Url"
}

function Invoke-Bootstrap {
  $rootSecret = (Get-Content -LiteralPath (Join-Path $SecretsDir 'arango-root') -Raw).Trim()
  $basicToken = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("root:$rootSecret"))
  Wait-Http 'http://127.0.0.1:8529/_api/version' 90 @{ Authorization = "Basic $basicToken" }
  $output = & node.exe (Join-Path $PSScriptRoot 'bootstrap-arango.cjs') 2>&1
  if ($LASTEXITCODE -ne 0) { throw "ArangoDB bootstrap failed: $($output -join [Environment]::NewLine)" }
  return @($output)[-1] | ConvertFrom-Json
}

function Get-RuntimePid {
  if (-not (Test-Path $PidFile)) { return $null }
  $value = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  if ($value -notmatch '^\d+$') { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$value" -ErrorAction SilentlyContinue
  if (-not $process -or [string]$process.CommandLine -notlike '*tools\local-knowledge\server.cjs*') { return $null }
  return [int]$value
}

function Get-SignedRuntimeStatus {
  try {
    $output = & node.exe (Join-Path $PSScriptRoot 'client.cjs') status 2>$null
    if ($LASTEXITCODE -eq 0 -and $output) { return ($output | Select-Object -Last 1) | ConvertFrom-Json }
  } catch {}
  return $null
}

function Wait-RuntimeReady {
  param([int]$ProcessId, [int]$ProcessStartupSeconds = 30, [int]$DependencyReadySeconds = 1200)
  $processDeadline = (Get-Date).AddSeconds($ProcessStartupSeconds)
  $status = $null
  do {
    Start-Sleep -Milliseconds 500
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { throw 'Knowledge runtime process exited before exposing its signed status endpoint.' }
    $status = Get-SignedRuntimeStatus
  } while (-not $status -and (Get-Date) -lt $processDeadline)
  if (-not $status) { throw 'Knowledge runtime process started, but its signed status endpoint did not become available.' }
  if ([bool]$status.ready) { return $status }
  $readyDeadline = (Get-Date).AddSeconds($DependencyReadySeconds)
  do {
    Start-Sleep -Seconds 2
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { throw 'Knowledge runtime process exited while its dependencies were loading.' }
    $next = Get-SignedRuntimeStatus
    if ($next) { $status = $next }
    if ([bool]$status.ready) { return $status }
  } while ((Get-Date) -lt $readyDeadline)
  $services = if ($status.services) { $status.services | ConvertTo-Json -Depth 5 -Compress } else { '{}' }
  throw "Knowledge runtime process is running, but dependencies did not become ready within $DependencyReadySeconds seconds. Services: $services"
}

function Start-Runtime {
  $embeddingConfiguration = Get-EmbeddingConfiguration
  Set-EmbeddingEnvironment $embeddingConfiguration
  if ($embeddingConfiguration.gteRequired) { [void](Ensure-GteDependencies) }
  $current = Get-RuntimePid
  if ($current) { [void](Wait-RuntimeReady -ProcessId $current); return $current }
  foreach ($file in @($StdoutLog,$StderrLog)) { if (-not (Test-Path $file)) { [IO.File]::WriteAllText($file, '', [Text.UTF8Encoding]::new($false)) } }
  $process = Start-Process -FilePath 'node.exe' -ArgumentList @((Join-Path $PSScriptRoot 'server.cjs')) -WorkingDirectory $RepoRoot -WindowStyle Hidden -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru
  [IO.File]::WriteAllText($PidFile, [string]$process.Id, [Text.UTF8Encoding]::new($false))
  [void](Wait-RuntimeReady -ProcessId $process.Id)
  return $process.Id
}

function Stop-Runtime {
  param([switch]$Force)
  $pidValue = Get-RuntimePid
  if ($pidValue -and -not $Force) {
    try {
      $output = & node.exe (Join-Path $PSScriptRoot 'client.cjs') shutdown 2>&1
      if ($LASTEXITCODE -ne 0) { throw "Signed graceful shutdown failed: $($output -join [Environment]::NewLine)" }
      $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
      if ($process) {
        if (-not $process.WaitForExit(35000)) {
          Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
          Write-Warning 'Knowledge runtime did not drain within 35 seconds and was force-stopped.'
        }
      }
    } catch {
      if (Get-Process -Id $pidValue -ErrorAction SilentlyContinue) { Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue }
      Write-Warning "Knowledge runtime graceful shutdown failed and force-stop fallback was used: $($_.Exception.Message)"
    }
  } elseif ($pidValue) {
    Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Stop-Containers {
  param([string[]]$Names, [switch]$Force)
  foreach ($name in $Names) {
    if (-not (Assert-OwnedContainer $name)) { continue }
    if ($Force) { [void](Invoke-Docker @('kill',$name) -AllowFailure) }
    else { [void](Invoke-Docker @('stop','--time','30',$name) -AllowFailure) }
  }
}

function Sanitize-LogText {
  param([string]$Text)
  return [regex]::Replace([string]$Text, '(?i)(api[_-]?key|authorization|token|secret|password)(["'']?\s*[:=]\s*["'']?)(?:Some\()?[^"'',;\s\)]+\)?', '$1$2[redacted]')
}

function Read-Logs {
  $names = if ($Component -eq 'all') { @('runtime','arango','docling','embedding','reranker') } else { @($Component) }
  $result = [ordered]@{}
  foreach ($name in $names) {
    if ($name -eq 'runtime') {
      $content = @()
      foreach ($file in @($StdoutLog,$StderrLog)) { if (Test-Path $file) { $content += Get-Content -LiteralPath $file -Tail $Lines } }
      $result[$name] = Sanitize-LogText ($content -join [Environment]::NewLine)
    } elseif ($name -in @('embedding','reranker')) {
      $result[$name] = 'Raw TEI logs are disabled (--log-driver=none) because TEI includes its API key in startup Args. Health and resource telemetry remain available.'
    } else {
      $content = & docker.exe logs --tail $Lines $Containers[$name] 2>&1
      $result[$name] = Sanitize-LogText ($content -join [Environment]::NewLine)
    }
  }
  return $result
}

function Get-DirectorySizeBytes {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return [long]0 }
  $measurement = Get-ChildItem -LiteralPath $Path -File -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
  return [long]($measurement.Sum -as [long])
}

function Get-EmbeddingOperationalStatus {
  param($RuntimeStatus, [Collections.IDictionary]$Configuration)
  $runtimeQueue = if ($RuntimeStatus) { $RuntimeStatus.queue } else { $null }
  $queuedBackfills = @()
  if ($runtimeQueue -and $runtimeQueue.jobs) { $queuedBackfills = @($runtimeQueue.jobs | Where-Object { $_.type -eq 'backfill' }) }
  $activeBackfills = 0
  $backfillLimit = 0
  if ($runtimeQueue -and $runtimeQueue.active -and $null -ne $runtimeQueue.active.backfill) { $activeBackfills = [int]$runtimeQueue.active.backfill }
  if ($runtimeQueue -and $runtimeQueue.limits -and $null -ne $runtimeQueue.limits.backfill) { $backfillLimit = [int]$runtimeQueue.limits.backfill }
  $gteQueueBackfills = 0
  if ($RuntimeStatus -and $RuntimeStatus.gte -and $RuntimeStatus.gte.queue -and $RuntimeStatus.gte.queue.byPriority) {
    $value = $RuntimeStatus.gte.queue.byPriority.backfill
    if ($null -ne $value) { $gteQueueBackfills = [int]$value }
  }
  $runtimeWaitingTotal = if ($runtimeQueue -and $null -ne $runtimeQueue.waiting) { [int]$runtimeQueue.waiting } else { 0 }
  return [ordered]@{
    configured=[ordered]@{
      provider=$Configuration.provider; model=$Configuration.model; revision=$Configuration.revision;
      dtype=$Configuration.dtype; dimensions=$Configuration.dimensions; vectorIndexVersion=$Configuration.vectorIndexVersion;
      dualWrite=$Configuration.dualWrite; qwenRollbackRetained=$Configuration.qwenRollbackRetained; rolloutPercent=$Configuration.rolloutPercent;
      shadowPercent=$Configuration.shadowPercent; gteRequired=$Configuration.gteRequired;
      forceQwenRollback=$Configuration.forceQwenRollback
    };
    signedRuntimeStatusAvailable=[bool]$RuntimeStatus;
    activeProvider=if ($RuntimeStatus) { $RuntimeStatus.activeEmbeddingProvider } else { $null };
    gte=if ($RuntimeStatus) { $RuntimeStatus.gte } else { [ordered]@{ state='stopped'; ready=$false; accepting=$false; queue=[ordered]@{ waiting=0; oldestWaitMs=0; byPriority=[ordered]@{ query=0; 'live-index'=0; backfill=0 } } } };
    migration=if ($RuntimeStatus) { $RuntimeStatus.migration } else { $null };
    backfill=[ordered]@{ active=$activeBackfills; runtimeQueuedVisible=$queuedBackfills.Count; runtimeWaitingTotal=$runtimeWaitingTotal; embeddingQueued=$gteQueueBackfills; limit=$backfillLimit; queuedJobs=$queuedBackfills };
    queue=$runtimeQueue;
    providers=if ($RuntimeStatus) { $RuntimeStatus.providers } else { $null };
    resources=if ($RuntimeStatus) { $RuntimeStatus.resources } else { $null };
  }
}

function Get-Status {
  $state = Read-State
  $embeddingConfiguration = Get-EmbeddingConfiguration
  $dependencyStatus = Get-GteDependencyStatus
  $dockerReady = Test-DockerReady
  $containerRows = @()
  foreach ($entry in $Containers.GetEnumerator()) {
    $info = if ($dockerReady) { Get-ContainerInfo $entry.Value } else { $null }
    $containerRows += [ordered]@{
      component=$entry.Key; name=$entry.Value; exists=[bool]$info; running=if ($info) { [bool]$info.State.Running } else { $false };
      healthy=if ($info -and $info.State.Health) { [string]$info.State.Health.Status -eq 'healthy' } else { $null };
      status=if ($info) { [string]$info.State.Status } else { 'not-created' }; image=if ($info) { [string]$info.Config.Image } else { $null };
    }
  }
  $resourceRows = @()
  if ($dockerReady) {
    $names = @($containerRows | Where-Object exists | ForEach-Object name)
    if ($names.Count) {
      $stats = & docker.exe stats --no-stream --format '{{json .}}' @names 2>$null
      foreach ($line in @($stats)) { try { $resourceRows += $line | ConvertFrom-Json } catch {} }
    }
  }
  $runtimeStatus = $null
  if (Get-RuntimePid) { $runtimeStatus = Get-SignedRuntimeStatus }
  $gpu = $null
  try {
    $rawGpu = & nvidia-smi.exe --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits 2>$null | Select-Object -First 1
    if ($rawGpu) { $parts = $rawGpu -split ',\s*'; $gpu = [ordered]@{ name=$parts[0]; utilizationPercent=[double]$parts[1]; memoryUsedMiB=[double]$parts[2]; memoryTotalMiB=[double]$parts[3]; temperatureC=[double]$parts[4]; powerWatts=[double]$parts[5] } }
  } catch {}
  $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($DataRoot).Substring(0,1)) -ErrorAction SilentlyContinue
  $modelRoot = Join-Path $DataRoot 'models'
  $embeddingCache = Join-Path $modelRoot 'models--Qwen--Qwen3-Embedding-4B'
  $rerankerCache = Join-Path $modelRoot 'models--BAAI--bge-reranker-v2-m3'
  $gteCache = Join-Path $modelRoot 'transformers'
  return [ordered]@{
    checkedAt=(Get-Date).ToUniversalTime().ToString('o'); available=[bool]$runtimeStatus; desired=$state.desired; autoStart=[bool]$state.autoStart; modelsLoaded=[bool]$state.modelsLoaded;
    runtime=[ordered]@{ running=[bool](Get-RuntimePid); pid=Get-RuntimePid; status=$runtimeStatus };
    containers=$containerRows; resources=[ordered]@{ containers=$resourceRows; gpu=$gpu; dataDrive=if ($drive) { [ordered]@{ root=$drive.Root; usedBytes=[long]$drive.Used; freeBytes=[long]$drive.Free } } else { $null }; modelCache=[ordered]@{ root=$modelRoot; totalBytes=(Get-DirectorySizeBytes $modelRoot); embedding=[ordered]@{ path=$embeddingCache; bytes=(Get-DirectorySizeBytes $embeddingCache); present=(Test-Path -LiteralPath $embeddingCache) }; gte=[ordered]@{ path=$gteCache; bytes=(Get-DirectorySizeBytes $gteCache); present=(Test-Path -LiteralPath $gteCache) }; reranker=[ordered]@{ path=$rerankerCache; bytes=(Get-DirectorySizeBytes $rerankerCache); present=(Test-Path -LiteralPath $rerankerCache) } } };
    embedding=(Get-EmbeddingOperationalStatus $runtimeStatus $embeddingConfiguration); dependencies=[ordered]@{ gte=$dependencyStatus };
    data=[ordered]@{ runtimeRoot=$RuntimeDir; root=$DataRoot; staging=(Join-Path $DataRoot 'staging'); storage=(Join-Path $DataRoot 'storage'); models=(Join-Path $DataRoot 'models'); backups=(Join-Path $DataRoot 'backups') };
    images=$Images; ports=[ordered]@{ runtime=11540; arango=8529; embedding=11541; reranker=11542; docling=11543 }; publicRoute=$false;
    security=[ordered]@{ serviceSecretConfigured=(Test-Path (Join-Path $RuntimeDir 'service-secret')); canonicalSecret='runtime/service-secret'; credentialsExposed=$false };
    controls=[ordered]@{ canStart=$true; canStop=[bool](Get-RuntimePid); canLoad=$true; canUnload=$true; canLoadGte=[bool]$dependencyStatus.manifestExact; gteConfigured=[bool]$embeddingConfiguration.gteRequired; rawModelLogs=$false };
    warning='ArangoDB Community Edition is configured for local development use. Review licensing and deployment architecture before any production use.';
  }
}

function Start-All {
  $embeddingConfiguration = Get-EmbeddingConfiguration
  Ensure-DirectoriesAndSecrets
  if (-not (Test-DockerReady)) { throw 'Docker Desktop is not ready.' }
  Ensure-Network
  Start-Arango
  Start-Docling
  if ($embeddingConfiguration.qwenRequired) { Start-Embedding }
  else { Stop-Containers @($Containers.embedding) }
  Start-Reranker
  [void](Invoke-Bootstrap)
  [void](Start-Runtime)
  $state = Read-State; $state.desired='running'; $state.modelsLoaded=$true; Write-State $state
}

switch ($Action) {
  'start' { Start-All }
  'stop' { Stop-Runtime; Stop-Containers @($Containers.reranker,$Containers.embedding,$Containers.docling,$Containers.arango); $state=Read-State; $state.desired='stopped'; $state.modelsLoaded=$false; Write-State $state }
  'graceful-stop' { Stop-Runtime; Stop-Containers @($Containers.reranker,$Containers.embedding,$Containers.docling,$Containers.arango); $state=Read-State; $state.desired='stopped'; $state.modelsLoaded=$false; Write-State $state }
  'force-stop' { Stop-Runtime -Force; Stop-Containers @($Containers.reranker,$Containers.embedding,$Containers.docling,$Containers.arango) -Force; $state=Read-State; $state.desired='stopped'; $state.modelsLoaded=$false; Write-State $state }
  'restart' { Stop-Runtime; Stop-Containers @($Containers.reranker,$Containers.embedding,$Containers.docling,$Containers.arango); Start-All }
  'load' { $embeddingConfiguration=Get-EmbeddingConfiguration; Ensure-DirectoriesAndSecrets; if (-not (Test-DockerReady)) { throw 'Docker Desktop is not ready.' }; Ensure-Network; if ($embeddingConfiguration.qwenRequired) { Start-Embedding } else { Stop-Containers @($Containers.embedding) }; Start-Reranker; $state=Read-State; $state.modelsLoaded=$true; Write-State $state }
  'unload' { Stop-Containers @($Containers.reranker,$Containers.embedding); $state=Read-State; $state.modelsLoaded=$false; Write-State $state }
  'enable-auto-start' { $state=Read-State; $state.autoStart=$true; Write-State $state }
  'disable-auto-start' { $state=Read-State; $state.autoStart=$false; Write-State $state }
  'reconcile' { $state=Read-State; if ($state.autoStart -and $state.desired -eq 'running') { Start-All } }
  'bootstrap' { Ensure-DirectoriesAndSecrets; [void](Invoke-Bootstrap) }
  'logs' { $output = Read-Logs; if ($Json) { $output | ConvertTo-Json -Depth 8 -Compress } else { $output | ConvertTo-Json -Depth 8 }; exit 0 }
  'status' {}
}

$status = Get-Status
if ($Json) { $status | ConvertTo-Json -Depth 16 -Compress } else { $status | ConvertTo-Json -Depth 16 }
