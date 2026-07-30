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
$RuntimeDir = Join-Path $RepoRoot '.local-runtime\knowledge'
$SecretsDir = Join-Path $RuntimeDir 'secrets'
$StateFile = Join-Path $RuntimeDir 'state.json'
$PidFile = Join-Path $RuntimeDir 'runtime.pid'
$StdoutLog = Join-Path $RuntimeDir 'runtime.stdout.log'
$StderrLog = Join-Path $RuntimeDir 'runtime.stderr.log'
$DataRoot = if ($env:SEEMPLIFY_KNOWLEDGE_DATA_ROOT) { [IO.Path]::GetFullPath($env:SEEMPLIFY_KNOWLEDGE_DATA_ROOT) } else { 'D:\SeemplifyKnowledge' }
$OwnerLabel = 'ai.seemplify.owner=local-knowledge'
$Network = 'seemplify-knowledge'
$Containers = [ordered]@{
  arango = 'seemplify-knowledge-arango'
  embedding = 'seemplify-knowledge-embedding'
  reranker = 'seemplify-knowledge-reranker'
  docling = 'seemplify-knowledge-docling'
}
$Images = [ordered]@{
  arango = [ordered]@{ tag='arangodb:3.12.9.4'; reference='arangodb@sha256:bf5eabc0fb3a16a13d0d4de00cddfbf2209e3d25630e5331832efb206519ff8f' }
  tei = [ordered]@{ tag='ghcr.io/huggingface/text-embeddings-inference:1.8.0'; reference='ghcr.io/huggingface/text-embeddings-inference@sha256:8aeb97215f29e0ed48647384af89661c36cee04120c2d4e86b5a3aead47611fa' }
  docling = [ordered]@{ tag='quay.io/docling-project/docling-serve-cpu:v1.28.0'; reference='quay.io/docling-project/docling-serve-cpu@sha256:cc207e1eb768878456ed98042c5d84fae56af3729a9c03d3e5c8fef393902956' }
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
  $llmSource = Join-Path $RepoRoot '.local-runtime\llm\service-secret'
  $llmTarget = Join-Path $SecretsDir 'llm-service'
  if (-not (Test-Path $llmSource)) { throw 'The signed Terra gateway secret is missing. Start the Seemplify AI runtime once before starting knowledge indexing.' }
  [IO.File]::WriteAllText($llmTarget, (Get-Content -LiteralPath $llmSource -Raw).Trim(), [Text.UTF8Encoding]::new($false))
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
  if ($pidValue) { Stop-Process -Id $pidValue -Force:$Force -ErrorAction SilentlyContinue }
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

function Get-Status {
  $state = Read-State
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
  return [ordered]@{
    checkedAt=(Get-Date).ToUniversalTime().ToString('o'); available=[bool]$runtimeStatus; desired=$state.desired; autoStart=[bool]$state.autoStart; modelsLoaded=[bool]$state.modelsLoaded;
    runtime=[ordered]@{ running=[bool](Get-RuntimePid); pid=Get-RuntimePid; status=$runtimeStatus };
    containers=$containerRows; resources=[ordered]@{ containers=$resourceRows; gpu=$gpu; dataDrive=if ($drive) { [ordered]@{ root=$drive.Root; usedBytes=[long]$drive.Used; freeBytes=[long]$drive.Free } } else { $null }; modelCache=[ordered]@{ root=$modelRoot; totalBytes=(Get-DirectorySizeBytes $modelRoot); embedding=[ordered]@{ path=$embeddingCache; bytes=(Get-DirectorySizeBytes $embeddingCache); present=(Test-Path -LiteralPath $embeddingCache) }; reranker=[ordered]@{ path=$rerankerCache; bytes=(Get-DirectorySizeBytes $rerankerCache); present=(Test-Path -LiteralPath $rerankerCache) } } };
    data=[ordered]@{ root=$DataRoot; staging=(Join-Path $DataRoot 'staging'); storage=(Join-Path $DataRoot 'storage'); models=(Join-Path $DataRoot 'models'); backups=(Join-Path $DataRoot 'backups') };
    images=$Images; ports=[ordered]@{ runtime=11540; arango=8529; embedding=11541; reranker=11542; docling=11543 }; publicRoute=$false;
    security=[ordered]@{ serviceSecretConfigured=(Test-Path (Join-Path $RuntimeDir 'service-secret')); canonicalSecret='runtime/service-secret'; credentialsExposed=$false };
    controls=[ordered]@{ canStart=$true; canStop=[bool](Get-RuntimePid); canLoad=$true; canUnload=$true; rawModelLogs=$false };
    warning='ArangoDB Community Edition is configured for local development use. Review licensing and deployment architecture before any production use.';
  }
}

function Start-All {
  Ensure-DirectoriesAndSecrets
  if (-not (Test-DockerReady)) { throw 'Docker Desktop is not ready.' }
  Ensure-Network
  Start-Arango
  Start-Docling
  Start-Embedding
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
  'load' { Ensure-DirectoriesAndSecrets; if (-not (Test-DockerReady)) { throw 'Docker Desktop is not ready.' }; Ensure-Network; Start-Embedding; Start-Reranker; $state=Read-State; $state.modelsLoaded=$true; Write-State $state }
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
