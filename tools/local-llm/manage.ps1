param(
  [ValidateSet(
    'start', 'stop', 'force-stop', 'restart', 'status', 'load', 'unload',
    'pause', 'resume', 'enable-ingress', 'disable-ingress',
    'enable-auto-start', 'disable-auto-start', 'set-concurrency',
    'select-engine', 'select-best', 'set-model', 'set-experience-default', 'set-xplorer-default', 'verify-engine',
    'install-codex', 'login-codex', 'logout-codex', 'switch-codex-account', 'sync-codex-models',
    'install-claude', 'login-claude', 'logout-claude', 'switch-claude-account',
    'install-vllm', 'vllm-start', 'vllm-stop'
  )]
  [string]$Action = 'status',
  [ValidateRange(1, 128)]
  [int]$Concurrency = 1,
  [ValidateSet('ollama', 'vllm', 'codex', 'claude')]
  [string]$Engine = 'ollama',
  [ValidateLength(0, 200)]
  [string]$Model = '',
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$WorkspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$RuntimeDir = Join-Path $WorkspaceRoot '.local-runtime\llm'
$StateFile = Join-Path $RuntimeDir 'state.json'
$ControlSecretFile = Join-Path $RuntimeDir 'control-secret'
$PidFile = Join-Path $RuntimeDir 'gateway.pid'
$StdoutLog = Join-Path $RuntimeDir 'gateway.stdout.log'
$StderrLog = Join-Path $RuntimeDir 'gateway.stderr.log'
$OllamaStdoutLog = Join-Path $RuntimeDir 'ollama.stdout.log'
$OllamaStderrLog = Join-Path $RuntimeDir 'ollama.stderr.log'
$GatewayScript = Join-Path $PSScriptRoot 'gateway.cjs'
$AutoStartScript = Join-Path $PSScriptRoot 'autostart.ps1'
$StartupDir = [Environment]::GetFolderPath('Startup')
$AutoStartShortcut = Join-Path $StartupDir 'Seemplify Local CV LLM.lnk'
$OllamaStartupShortcut = Join-Path $StartupDir 'Ollama.lnk'
$OllamaStartupBackup = Join-Path $RuntimeDir 'Ollama.original-startup.lnk'
$CodexInstallDir = Join-Path $RuntimeDir 'codex-cli'
$CodexScript = Join-Path $CodexInstallDir 'node_modules\@openai\codex\bin\codex.js'
$CodexCatalogFile = Join-Path $RuntimeDir 'codex-models.json'
$ClaudeInstallDir = Join-Path $RuntimeDir 'claude-cli'
$ClaudeExe = Join-Path $ClaudeInstallDir 'node_modules\@anthropic-ai\claude-code\bin\claude.exe'
$ApprovedConcurrencyFile = Join-Path $RuntimeDir 'approved-concurrency.json'
$VerificationFile = Join-Path $RuntimeDir 'verification.json'
$AccountTransitionFile = Join-Path $RuntimeDir 'account-transition.json'
$VerificationScript = Join-Path $PSScriptRoot 'verify-engine.cjs'
$BenchmarkSummaryScript = Join-Path $PSScriptRoot 'benchmark-summary.cjs'
$VllmContainer = 'seemplify-vllm'
$VllmImage = if ($env:SEEMPLIFY_VLLM_IMAGE) { $env:SEEMPLIFY_VLLM_IMAGE } else { 'vllm/vllm-openai:latest' }
$VllmCacheVolume = 'seemplify-vllm-huggingface'
$VllmConfigVersion = '5'
$DefaultModels = [ordered]@{
  ollama = if ($env:LOCAL_LLM_MODEL) { $env:LOCAL_LLM_MODEL } else { 'gemma4:26b-a4b-it-qat' }
  vllm = if ($env:SEEMPLIFY_VLLM_MODEL) { $env:SEEMPLIFY_VLLM_MODEL } else { 'Qwen/Qwen3-14B-AWQ' }
  codex = 'gpt-5.6-terra'
  claude = 'sonnet'
}
$ConfiguredModelsDir = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'User')
if ($ConfiguredModelsDir) { $env:OLLAMA_MODELS = $ConfiguredModelsDir }
$OllamaExe = @(
  (Get-Command ollama.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
  (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
  (Join-Path $RuntimeDir 'bin\ollama.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

function Get-ControlHeaders {
  if (-not (Test-Path -LiteralPath $ControlSecretFile)) {
    throw 'Local LLM control secret is not available.'
  }
  $controlSecret = (Get-Content -LiteralPath $ControlSecretFile -Raw).Trim()
  if (-not $controlSecret) { throw 'Local LLM control secret is empty.' }
  return @{ 'X-Seemplify-Control-Secret' = $controlSecret }
}

function Invoke-GatewayControl(
  [string]$Method = 'Get',
  [string]$Path = '/control/status',
  [string]$Body = '',
  [int]$TimeoutSec = 10
) {
  $arguments = @{
    Method = $Method
    Uri = "http://127.0.0.1:11435$Path"
    Headers = (Get-ControlHeaders)
    TimeoutSec = $TimeoutSec
  }
  if ($Body) {
    $arguments.ContentType = 'application/json'
    $arguments.Body = $Body
  }
  return Invoke-RestMethod @arguments
}

function New-DefaultState {
  return [ordered]@{
    enabled = $true
    ingressEnabled = $true
    paused = $false
    concurrency = 1
    autoStart = $true
    selectionMode = 'automatic'
    selectedEngine = 'codex'
    applicationDefaults = [ordered]@{
      experienceManagement = [ordered]@{ engine='claude'; model=$DefaultModels.claude }
      xplorerCrm = [ordered]@{ engine='claude'; model=$DefaultModels.claude }
    }
    engines = [ordered]@{
      ollama = [ordered]@{ model=$DefaultModels.ollama; baseUrl='http://127.0.0.1:11434' }
      vllm = [ordered]@{ model=$DefaultModels.vllm; baseUrl='http://127.0.0.1:8000' }
      codex = [ordered]@{ model=$DefaultModels.codex }
      claude = [ordered]@{ model=$DefaultModels.claude }
    }
  }
}

function Get-SavedState {
  $defaults = New-DefaultState
  if (Test-Path $StateFile) {
    try {
      $saved = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
      foreach ($property in @('enabled', 'ingressEnabled', 'paused', 'concurrency', 'autoStart', 'selectionMode', 'selectedEngine')) {
        if ($null -ne $saved.$property) { $defaults[$property] = $saved.$property }
      }
      if ($saved.applicationDefaults.experienceManagement) {
        $experienceDefault = $saved.applicationDefaults.experienceManagement
        if ($experienceDefault.engine -in @('ollama', 'vllm', 'codex', 'claude')) {
          $defaults.applicationDefaults.experienceManagement.engine = [string]$experienceDefault.engine
        }
        if ($experienceDefault.model) {
          $defaults.applicationDefaults.experienceManagement.model = [string]$experienceDefault.model
        }
      }
      if ($saved.applicationDefaults.xplorerCrm) {
        $xplorerDefault = $saved.applicationDefaults.xplorerCrm
        if ($xplorerDefault.engine -in @('ollama', 'vllm', 'codex', 'claude')) {
          $defaults.applicationDefaults.xplorerCrm.engine = [string]$xplorerDefault.engine
        }
        if ($xplorerDefault.model) {
          $defaults.applicationDefaults.xplorerCrm.model = [string]$xplorerDefault.model
        }
      }
      foreach ($engineId in @('ollama', 'vllm', 'codex', 'claude')) {
        $savedEngine = $saved.engines.$engineId
        if ($savedEngine -and $savedEngine.model) { $defaults.engines[$engineId].model = [string]$savedEngine.model }
        if ($savedEngine -and $savedEngine.baseUrl) { $defaults.engines[$engineId].baseUrl = [string]$savedEngine.baseUrl }
      }
    } catch {}
  }
  $selectedEngine = if ($defaults.selectedEngine -in @('ollama', 'vllm', 'codex', 'claude')) {
    [string]$defaults.selectedEngine
  } else {
    'codex'
  }
  $selectedModel = [string]$defaults.engines.$selectedEngine.model
  $requestedConcurrency = [Math]::Max(1, [Math]::Min(8, [int]$defaults.concurrency))
  $approvedConcurrency = Get-ApprovedConcurrency $selectedEngine $selectedModel
  $defaults.concurrency = [Math]::Min($requestedConcurrency, $approvedConcurrency)
  $defaults | Add-Member -NotePropertyName requestedConcurrency -NotePropertyValue $requestedConcurrency -Force
  $defaults | Add-Member -NotePropertyName approvedConcurrency -NotePropertyValue $approvedConcurrency -Force
  return ($defaults | ConvertTo-Json -Depth 12 | ConvertFrom-Json)
}

function Get-EngineModel([string]$EngineId) {
  $state = Get-SavedState
  $configured = $state.engines.$EngineId.model
  if ($configured) { return [string]$configured }
  return [string]$DefaultModels[$EngineId]
}

function Get-ApprovedConcurrency([string]$EngineId, [string]$ModelId) {
  if (Test-Path $ApprovedConcurrencyFile) {
    try {
      $approvals = Get-Content -LiteralPath $ApprovedConcurrencyFile -Raw | ConvertFrom-Json
      $key = "${EngineId}:${ModelId}"
      $profile = $approvals.byEngineModel.$key
      $approved = $profile.concurrency
      if ($profile.sustainedValidated -eq $true -and $approved) {
        return 8
      }
    } catch {}
  }
  # CLI-backed providers are isolated child processes. The service owns an
  # explicit eight-worker ceiling instead of inheriting a stale benchmark cap.
  return 8
}

function Assert-ApprovedConcurrency([string]$EngineId, [string]$ModelId, [int]$Requested) {
  $approved = 8
  if ($Requested -lt 1 -or $Requested -gt $approved) {
    throw "Concurrency must be between 1 and $approved."
  }
  return $approved
}

function Set-ActiveApprovedProfile([string]$EngineId, [string]$ModelId) {
  if (-not (Test-Path $ApprovedConcurrencyFile)) { return }
  try {
    $approvals = Get-Content -LiteralPath $ApprovedConcurrencyFile -Raw | ConvertFrom-Json
    $key = "${EngineId}:${ModelId}"
    $profile = $approvals.byEngineModel.$key
    if (-not $profile) { return }
    $approvals | Add-Member -NotePropertyName active -NotePropertyValue $profile -Force
    $temporary = "$ApprovedConcurrencyFile.$PID.tmp"
    [System.IO.File]::WriteAllText(
      $temporary,
      ($approvals | ConvertTo-Json -Depth 20),
      [System.Text.UTF8Encoding]::new($false)
    )
    Move-Item -LiteralPath $temporary -Destination $ApprovedConcurrencyFile -Force
  } catch {
    Write-Warning "Could not update the active approved concurrency profile: $($_.Exception.Message)"
  }
}

function Assert-ModelIdentifier([string]$Value) {
  if ($Value -notmatch '^[A-Za-z0-9._:/-]{2,200}$') { throw 'Model identifier contains unsupported characters.' }
}

function Invoke-NativeCapture(
  [string]$FilePath,
  [string[]]$Arguments,
  [int]$TimeoutMs = 0
) {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = (($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $completed = if ($TimeoutMs -gt 0) {
    $process.WaitForExit($TimeoutMs)
  } else {
    $process.WaitForExit()
    $true
  }
  if (-not $completed) {
    try { $process.Kill() } catch {}
    try { $process.WaitForExit() } catch {}
  }
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  if (-not $completed) {
    return [pscustomobject]@{
      exitCode = 124
      stdout = $stdout
      stderr = if ($stderr) { $stderr } else { "Process timed out after $TimeoutMs ms." }
    }
  }
  return [pscustomobject]@{ exitCode=$process.ExitCode; stdout=$stdout; stderr=$stderr }
}

function Get-GatewayProcess {
  if (-not (Test-Path $PidFile)) { return $null }
  $processId = [int](Get-Content -LiteralPath $PidFile -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if (-not $process -or $process.CommandLine -notlike "*$GatewayScript*") {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    return $null
  }
  return $process
}

function Set-GatewayState([hashtable]$State) {
  $savedBefore = Get-SavedState
  if ($State.ContainsKey('concurrency')) {
    $targetEngine = if ($State.ContainsKey('selectedEngine')) {
      [string]$State.selectedEngine
    } else {
      [string]$savedBefore.selectedEngine
    }
    $targetModel = if ($State.ContainsKey('engines') -and $State.engines.$targetEngine.model) {
      [string]$State.engines.$targetEngine.model
    } else {
      [string]$savedBefore.engines.$targetEngine.model
    }
    Assert-ApprovedConcurrency $targetEngine $targetModel ([int]$State.concurrency) | Out-Null
  }
  $body = $State | ConvertTo-Json -Depth 12 -Compress
  try {
    return Invoke-GatewayControl -Method Put -Path '/control/state' -Body $body -TimeoutSec 10
  } catch {
    if (Get-GatewayProcess) { throw }
    $saved = $savedBefore
    foreach ($key in $State.Keys) { $saved.$key = $State[$key] }
    $saved.PSObject.Properties.Remove('requestedConcurrency')
    $saved.PSObject.Properties.Remove('approvedConcurrency')
    $saved | Add-Member -NotePropertyName updatedAt -NotePropertyValue (Get-Date).ToUniversalTime().ToString('o') -Force
    $saved | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $StateFile -Encoding utf8
    return [pscustomobject]@{ ok=$true; state=$saved }
  }
}

function Set-EngineState([string]$EngineId, [string]$ModelId) {
  Assert-ModelIdentifier $ModelId
  $state = Get-SavedState
  $engines = [ordered]@{
    ollama = [ordered]@{ model=[string]$state.engines.ollama.model; baseUrl=[string]$state.engines.ollama.baseUrl }
    vllm = [ordered]@{ model=[string]$state.engines.vllm.model; baseUrl=[string]$state.engines.vllm.baseUrl }
    codex = [ordered]@{ model=[string]$state.engines.codex.model }
    claude = [ordered]@{ model=[string]$state.engines.claude.model }
  }
  $engines[$EngineId].model = $ModelId
  return Set-GatewayState @{ selectedEngine=$EngineId; engines=$engines }
}

function Start-Gateway {
  if (Get-GatewayProcess) { return }
  # Launch through Win32_Process so the long-lived gateway does not inherit the
  # caller's output pipes. Inherited handles otherwise make scripted restart
  # commands appear to hang even after the gateway is ready.
  $nodeExe = (Get-Command node.exe).Source
  $commandLine = "`"$nodeExe`" `"$GatewayScript`""
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $commandLine
    CurrentDirectory = $WorkspaceRoot
  }
  if ([int]$created.ReturnValue -ne 0) {
    throw "Could not launch the local LLM gateway (Win32 error $($created.ReturnValue))."
  }
  Set-Content -LiteralPath $PidFile -Value $created.ProcessId -Encoding ascii
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      Invoke-GatewayControl -Path '/control/status' -TimeoutSec 2 | Out-Null
      return
    } catch {}
  }
  throw 'Local LLM gateway did not become ready.'
}

function Stop-Gateway([bool]$Force) {
  $process = Get-GatewayProcess
  if (-not $process) { return }
  if (-not $Force) {
    try { Set-GatewayState @{ paused=$true; ingressEnabled=$false } | Out-Null } catch {}
    for ($attempt = 0; $attempt -lt 600; $attempt++) {
      try {
        $status = Invoke-GatewayControl -Path '/control/status' -TimeoutSec 2
        if ([int]$status.active -eq 0) { break }
      } catch { break }
      Start-Sleep -Milliseconds 500
    }
  }
  Stop-Process -Id $process.ProcessId -Force
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Wait-GatewayIdle([int]$TimeoutSeconds = 300) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $status = Invoke-GatewayControl -Path '/control/status' -TimeoutSec 2
      if ([int]$status.active -eq 0) { return }
    } catch { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out after $TimeoutSeconds seconds waiting for active inference to drain."
}

function Start-Ollama {
  if (-not $OllamaExe) { throw 'Ollama is not installed.' }
  for ($launchAttempt = 0; $launchAttempt -lt 3; $launchAttempt++) {
    if (-not (Get-Process ollama -ErrorAction SilentlyContinue)) {
      $parallel = [string](Get-SavedState).concurrency
      $escapeLiteral = { param([string]$Value) $Value.Replace("'", "''") }
      $launchCommands = @(
        "`$env:OLLAMA_NUM_PARALLEL = '$parallel'",
        "& '$(& $escapeLiteral $OllamaExe)' serve 1>> '$(& $escapeLiteral $OllamaStdoutLog)' 2>> '$(& $escapeLiteral $OllamaStderrLog)'"
      )
      if ($ConfiguredModelsDir) {
        $launchCommands = @("`$env:OLLAMA_MODELS = '$(& $escapeLiteral $ConfiguredModelsDir)'") + $launchCommands
      }
      $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(($launchCommands -join '; ')))
      $commandLine = "`"$((Get-Command powershell.exe).Source)`" -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $encoded"
      $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine=$commandLine }
      if ([int]$created.ReturnValue -ne 0) { throw "Could not launch Ollama (Win32 error $($created.ReturnValue))." }
    }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 1 | Out-Null
        return
      } catch { Start-Sleep -Milliseconds 500 }
    }
    Stop-Ollama
    Start-Sleep -Seconds 2
  }
  throw 'Ollama did not become ready after three clean launch attempts.'
}

function Stop-Ollama {
  Get-Process -Name 'ollama app' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 300
  Get-Process -Name 'ollama' -ErrorAction SilentlyContinue | Stop-Process -Force
  Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue | Stop-Process -Force
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $remaining = Get-Process -Name 'ollama', 'llama-server' -ErrorAction SilentlyContinue
    if (-not $remaining) { return }
    Start-Sleep -Milliseconds 250
  }
}

function Load-OllamaModel {
  Start-Ollama
  $modelId = Get-EngineModel 'ollama'
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:11434/api/generate' -ContentType 'application/json' -Body (@{
    model = $modelId
    prompt = ''
    stream = $false
    keep_alive = -1
    options = @{ num_ctx = 16384 }
  } | ConvertTo-Json -Compress) -TimeoutSec 600 | Out-Null
}

function Get-VllmContainer {
  try {
    $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
    if (-not $docker) { return $null }

    # Docker may be installed while its per-user configuration is unavailable
    # (for example, when Local Control Center runs under a restricted process).
    # Capture native stderr instead of allowing that optional inventory probe to
    # become a terminating PowerShell error and hide the healthy Terra gateway.
    $list = Invoke-NativeCapture $docker.Source @(
      'container', 'ls', '--all', '--quiet', '--filter', "name=^/$VllmContainer`$"
    ) 3000
    if ($list.exitCode -ne 0 -or -not $list.stdout.Trim()) { return $null }
    $containerId = ($list.stdout -split '\r?\n' | Select-Object -First 1).Trim()
    if (-not $containerId) { return $null }

    $inspection = Invoke-NativeCapture $docker.Source @('inspect', $containerId) 3000
    if ($inspection.exitCode -ne 0 -or -not $inspection.stdout.Trim()) { return $null }
    return ($inspection.stdout | ConvertFrom-Json | Select-Object -First 1)
  } catch {
    return $null
  }
}

function Stop-Vllm {
  $container = Get-VllmContainer
  if ($container -and $container.State.Running) {
    & docker.exe stop --time 30 $VllmContainer | Out-Null
  }
}

function Install-Vllm {
  if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is not installed.' }
  $dockerInfo = Invoke-NativeCapture (Get-Command docker.exe).Source @('info')
  if ($dockerInfo.exitCode -ne 0) { throw 'Docker Desktop is not running.' }
  $pull = Invoke-NativeCapture (Get-Command docker.exe).Source @('pull', $VllmImage)
  if ($pull.exitCode -ne 0) { throw "Could not pull $VllmImage`: $($pull.stderr)" }
}

function Start-Vllm([string]$ModelId) {
  Assert-ModelIdentifier $ModelId
  $approvedConcurrency = Get-ApprovedConcurrency 'vllm' $ModelId
  Stop-Ollama
  if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is not installed.' }
  $dockerInfo = Invoke-NativeCapture (Get-Command docker.exe).Source @('info')
  if ($dockerInfo.exitCode -ne 0) { throw 'Docker Desktop is not running.' }
  $container = Get-VllmContainer
  $configuredModel = if ($container) { [string]$container.Config.Labels.'ai.seemplify.model' } else { '' }
  $configuredVersion = if ($container) { [string]$container.Config.Labels.'ai.seemplify.config-version' } else { '' }
  $configuredConcurrency = if ($container) { [string]$container.Config.Labels.'ai.seemplify.max-num-seqs' } else { '' }
  $replaceContainer = $container -and (
    $configuredModel -ne $ModelId -or
    $configuredVersion -ne $VllmConfigVersion -or
    $configuredConcurrency -ne [string]$approvedConcurrency
  )
  if ($replaceContainer) {
    if ($container.State.Running) { & docker.exe stop --time 30 $VllmContainer | Out-Null }
    & docker.exe rm $VllmContainer | Out-Null
    $container = $null
  }
  if ($container) {
    if (-not $container.State.Running) { & docker.exe start $VllmContainer | Out-Null }
    return
  }
  & docker.exe run -d `
    --name $VllmContainer `
    --gpus all `
    --ipc host `
    --restart no `
    --env 'VLLM_USE_V2_MODEL_RUNNER=0' `
    --publish '127.0.0.1:8000:8000' `
    --volume "${VllmCacheVolume}:/root/.cache/huggingface" `
    --label "ai.seemplify.model=$ModelId" `
    --label "ai.seemplify.config-version=$VllmConfigVersion" `
    --label "ai.seemplify.max-num-seqs=$approvedConcurrency" `
    $VllmImage `
    $ModelId `
    --served-model-name $ModelId `
    --max-model-len 32768 `
    --gpu-memory-utilization 0.82 `
    --max-num-seqs $approvedConcurrency `
    --max-num-batched-tokens 8192 `
    --enable-prefix-caching | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the Seemplify vLLM container.' }
}

function Install-CodexCli {
  if (Test-Path $CodexScript) { return }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm is required to install Codex CLI.' }
  & npm.cmd install --prefix $CodexInstallDir '@openai/codex@0.145.0' --no-audit --no-fund
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $CodexScript)) { throw 'Codex CLI installation failed.' }
}

function Sync-CodexCatalog {
  Install-CodexCli
  $result = Invoke-NativeCapture (Get-Command node.exe).Source @($CodexScript, 'debug', 'models')
  if ($result.exitCode -ne 0 -or -not $result.stdout) { throw 'Could not load the Codex model catalog.' }
  $catalog = $result.stdout | ConvertFrom-Json
  $models = @($catalog.models | Where-Object { $_.visibility -eq 'list' } | ForEach-Object {
    [ordered]@{
      id = [string]$_.slug
      label = [string]$_.display_name
      defaultReasoning = [string]$_.default_reasoning_level
      reasoningLevels = @($_.supported_reasoning_levels | ForEach-Object { $_.effort })
      supportedInApi = [bool]$_.supported_in_api
      priority = [int]$_.priority
    }
  })
  [ordered]@{ refreshedAt=(Get-Date).ToUniversalTime().ToString('o'); models=$models } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $CodexCatalogFile -Encoding utf8
  return $models
}

function Login-CodexCli {
  Install-CodexCli
  $result = Invoke-NativeCapture (Get-Command node.exe).Source @($CodexScript, 'login')
  if ($result.exitCode -ne 0) {
    throw "Codex login failed: $($result.stderr)"
  }
  if (-not (Get-CodexStatus).authenticated) {
    throw 'Codex login finished without an authenticated ChatGPT session.'
  }
}

function Get-CodexStatus([switch]$SkipAuthenticationProbe) {
  $authenticated = $false
  $authLabel = if (Test-Path $CodexScript) { 'Authentication not checked' } else { 'Not installed' }
  if ((Test-Path $CodexScript) -and -not $SkipAuthenticationProbe) {
    try {
      $node = Get-Command node.exe -ErrorAction Stop
      $result = Invoke-NativeCapture $node.Source @($CodexScript, 'login', 'status') 8000
      $authOutput = "$($result.stdout)`n$($result.stderr)".Trim()
      $authenticated = $result.exitCode -eq 0 -and $authOutput -match 'Logged in'
      $authLabel = if ($authenticated) { $authOutput } else { 'Authentication required' }
    } catch {
      # Status must remain available to the Control Center even when the
      # desktop host cannot inspect the Codex login store. Inference health is
      # reported independently by the already-running gateway.
      $authLabel = 'Authentication status unavailable'
    }
  }
  $catalog = $null
  if (Test-Path $CodexCatalogFile) {
    try { $catalog = Get-Content -LiteralPath $CodexCatalogFile -Raw | ConvertFrom-Json } catch {}
  }
  return [ordered]@{
    installed = Test-Path $CodexScript
    authenticated = $authenticated
    authStatus = $authLabel
    defaultModel = $DefaultModels.codex
    models = @($catalog.models)
    catalogRefreshedAt = $catalog.refreshedAt
  }
}

function Logout-CodexCli {
  if (-not (Test-Path $CodexScript)) { return }
  $result = Invoke-NativeCapture (Get-Command node.exe).Source @($CodexScript, 'logout') 30000
  if ($result.exitCode -ne 0 -and "$($result.stdout)`n$($result.stderr)" -notmatch 'Not logged in') {
    throw "Codex logout failed: $($result.stderr)"
  }
}

function Install-ClaudeCli {
  if (Test-Path $ClaudeExe) { return }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm is required to install Claude Code CLI.' }
  & npm.cmd install --prefix $ClaudeInstallDir '@anthropic-ai/claude-code@2.1.220' --no-audit --no-fund
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ClaudeExe)) { throw 'Claude Code CLI installation failed.' }
}

function Get-ClaudeStatus([switch]$SkipAuthenticationProbe) {
  $authenticated = $false
  $authLabel = if (Test-Path $ClaudeExe) { 'Authentication not checked' } else { 'Not installed' }
  $subscriptionType = $null
  $authMethod = $null
  if ((Test-Path $ClaudeExe) -and -not $SkipAuthenticationProbe) {
    try {
      $result = Invoke-NativeCapture $ClaudeExe @('auth', 'status', '--json') 8000
      if ($result.exitCode -eq 0 -and $result.stdout) {
        $status = $result.stdout | ConvertFrom-Json
        $authenticated = [bool]$status.loggedIn
        $subscriptionType = [string]$status.subscriptionType
        $authMethod = [string]$status.authMethod
        $authLabel = if ($authenticated) {
          (@('Claude.ai signed in', $subscriptionType) | Where-Object { $_ } | Select-Object -Unique) -join ' / '
        } else { 'Authentication required' }
      } else {
        $authLabel = 'Authentication required'
      }
    } catch {
      $authLabel = 'Authentication status unavailable'
    }
  }
  return [ordered]@{
    installed = Test-Path $ClaudeExe
    authenticated = $authenticated
    authStatus = $authLabel
    authMethod = $authMethod
    subscriptionType = $subscriptionType
    defaultModel = $DefaultModels.claude
    models = @(
      [ordered]@{ id='sonnet'; label='Claude Sonnet'; recommended=$true }
      [ordered]@{ id='opus'; label='Claude Opus'; recommended=$false }
      [ordered]@{ id='haiku'; label='Claude Haiku'; recommended=$false }
    )
  }
}

function Login-ClaudeCli {
  Install-ClaudeCli
  $result = Invoke-NativeCapture $ClaudeExe @('auth', 'login', '--claudeai') 900000
  if ($result.exitCode -ne 0) { throw "Claude login failed: $($result.stderr)" }
  if (-not (Get-ClaudeStatus).authenticated) {
    throw 'Claude login finished without an authenticated Claude.ai session.'
  }
}

function Logout-ClaudeCli {
  if (-not (Test-Path $ClaudeExe)) { return }
  $result = Invoke-NativeCapture $ClaudeExe @('auth', 'logout') 30000
  if ($result.exitCode -ne 0 -and "$($result.stdout)`n$($result.stderr)" -notmatch 'logged out|not logged') {
    throw "Claude logout failed: $($result.stderr)"
  }
}

function Invoke-SafeAccountTransition([string]$Provider, [switch]$SwitchAccount, [switch]$LogoutOnly) {
  $state = Get-SavedState
  $gatewayControlled = $false
  [ordered]@{
    provider = $Provider
    paused = [bool]$state.paused
    ingressEnabled = [bool]$state.ingressEnabled
    startedAt = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $AccountTransitionFile -Encoding utf8
  try {
    Set-GatewayState @{ paused=$true; ingressEnabled=$false } | Out-Null
    $gatewayControlled = $true
    Wait-GatewayIdle
  } catch {}
  try {
    if ($Provider -eq 'codex') {
      Logout-CodexCli
      if ($SwitchAccount) { Login-CodexCli; Sync-CodexCatalog | Out-Null }
    } elseif ($Provider -eq 'claude') {
      Logout-ClaudeCli
      if ($SwitchAccount) { Login-ClaudeCli }
    } else {
      throw 'Unsupported account provider.'
    }
    $selectedProvider = [string]$state.selectedEngine
    $canRestore = $SwitchAccount -or $selectedProvider -ne $Provider
    if ($gatewayControlled -and $canRestore) {
      Set-GatewayState @{ paused=[bool]$state.paused; ingressEnabled=[bool]$state.ingressEnabled } | Out-Null
      Remove-Item -LiteralPath $AccountTransitionFile -Force -ErrorAction SilentlyContinue
    }
  } catch {
    # A failed or cancelled sign-in remains fail-closed: ingress is disabled
    # and queued work stays durable until an authenticated operator resumes it.
    throw
  }
}

function Restore-InterruptedAccountTransition([string]$Provider) {
  if (-not (Test-Path -LiteralPath $AccountTransitionFile)) { return $false }
  try {
    $transition = Get-Content -LiteralPath $AccountTransitionFile -Raw | ConvertFrom-Json
    if ([string]$transition.provider -ne $Provider) { return $false }
    $model = Get-EngineModel $Provider
    if (-not (Test-EngineProfileAvailable $Provider $model)) { return $false }
    Set-GatewayState @{
      paused = [bool]$transition.paused
      ingressEnabled = [bool]$transition.ingressEnabled
    } | Out-Null
    Remove-Item -LiteralPath $AccountTransitionFile -Force -ErrorAction SilentlyContinue
    return $true
  } catch {
    return $false
  }
}

function Test-EngineProfileAvailable([string]$EngineId, [string]$ModelId) {
  if ($EngineId -eq 'codex') {
    $status = Get-CodexStatus
    if (-not $status.installed -or -not $status.authenticated) { return $false }
    $catalogIds = @($status.models | ForEach-Object { [string]$_.id })
    return $catalogIds.Count -eq 0 -or $catalogIds -contains $ModelId
  }
  if ($EngineId -eq 'claude') {
    $status = Get-ClaudeStatus
    return $status.installed -and $status.authenticated -and @($status.models.id) -contains $ModelId
  }
  if ($EngineId -eq 'ollama') {
    if (-not $OllamaExe) { return $false }
    $result = Invoke-NativeCapture $OllamaExe @('list')
    return $result.exitCode -eq 0 -and $result.stdout -match "(?m)^$([regex]::Escape($ModelId))\s"
  }
  if ($EngineId -eq 'vllm') {
    if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { return $false }
    $result = Invoke-NativeCapture (Get-Command docker.exe).Source @('image', 'inspect', $VllmImage)
    return $result.exitCode -eq 0
  }
  return $false
}

function Get-BestAvailableProfile {
  $candidates = @()
  if (Test-Path $BenchmarkSummaryScript) {
    try {
      $result = Invoke-NativeCapture (Get-Command node.exe).Source @($BenchmarkSummaryScript)
      if ($result.exitCode -eq 0 -and $result.stdout) {
        $summary = $result.stdout | ConvertFrom-Json
        $candidates = @($summary.profiles |
          Where-Object {
            $_.sustainedValidated -eq $true -and
            $_.approvedRun.acceptable -and
            [double]$_.approvedRun.qualityPassRate -ge 0.95 -and
            [int]$_.approvedConcurrency -gt 0
          } |
          Sort-Object `
            @{ Expression={ [double]$_.approvedRun.throughputPerMinute }; Descending=$true }, `
            @{ Expression={ if ($null -eq $_.approvedRun.p95LatencyMs) { [double]::PositiveInfinity } else { [double]$_.approvedRun.p95LatencyMs } }; Descending=$false })
      }
    } catch {}
  }
  foreach ($candidate in $candidates) {
    if (Test-EngineProfileAvailable ([string]$candidate.engine) ([string]$candidate.model)) {
      return [pscustomobject]@{
        engine = [string]$candidate.engine
        model = [string]$candidate.model
        concurrency = [int]$candidate.approvedConcurrency
        throughputPerMinute = [double]$candidate.approvedRun.throughputPerMinute
        p95LatencyMs = $candidate.approvedRun.p95LatencyMs
        qualityPassRate = [double]$candidate.approvedRun.qualityPassRate
      }
    }
  }
  foreach ($fallback in @(
    [pscustomobject]@{ engine='codex'; model=$DefaultModels.codex },
    [pscustomobject]@{ engine='ollama'; model=$DefaultModels.ollama },
    [pscustomobject]@{ engine='vllm'; model=$DefaultModels.vllm }
  )) {
    if (Test-EngineProfileAvailable $fallback.engine $fallback.model) {
      return [pscustomobject]@{
        engine = $fallback.engine
        model = $fallback.model
        concurrency = Get-ApprovedConcurrency $fallback.engine $fallback.model
        throughputPerMinute = $null
        p95LatencyMs = $null
        qualityPassRate = $null
      }
    }
  }
  throw 'No verified local or local-cloud inference profile is currently available.'
}

function Select-BestAvailableEngine {
  $best = Get-BestAvailableProfile
  Select-InferenceEngine $best.engine $best.model
  $approvedConcurrency = Get-ApprovedConcurrency $best.engine $best.model
  $best.concurrency = $approvedConcurrency
  Set-GatewayState @{ selectionMode='automatic'; concurrency=$approvedConcurrency } | Out-Null
  return $best
}

function Set-ManagedAutoStart([bool]$Enabled) {
  if ($Enabled) {
    if (Test-Path $OllamaStartupShortcut) {
      Move-Item -LiteralPath $OllamaStartupShortcut -Destination $OllamaStartupBackup -Force
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($AutoStartShortcut)
    $shortcut.TargetPath = (Get-Command powershell.exe).Source
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AutoStartScript`""
    $shortcut.WorkingDirectory = $WorkspaceRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Start the Seemplify CV inference gateway when enabled.'
    $shortcut.Save()
  } else {
    Remove-Item -LiteralPath $AutoStartShortcut -Force -ErrorAction SilentlyContinue
  }
}

function Start-SelectedEngine {
  $state = Get-SavedState
  $engineId = [string]$state.selectedEngine
  $modelId = [string]$state.engines.$engineId.model
  if ($engineId -eq 'ollama') {
    Stop-Vllm
    Start-Ollama
  } elseif ($engineId -eq 'vllm') {
    Start-Vllm $modelId
  } elseif ($engineId -eq 'codex') {
    Stop-Vllm
    Stop-Ollama
    Install-CodexCli
    $codex = Get-CodexStatus
    if (-not $codex.authenticated) { throw 'Codex CLI is installed but not authenticated.' }
  } elseif ($engineId -eq 'claude') {
    Stop-Vllm
    Stop-Ollama
    Install-ClaudeCli
    $claude = Get-ClaudeStatus
    if (-not $claude.authenticated) { throw 'Claude Code CLI is installed but not authenticated.' }
  }
}

function Select-InferenceEngine([string]$EngineId, [string]$ModelId) {
  $state = Get-SavedState
  $currentEngine = [string]$state.selectedEngine
  $currentModel = [string]$state.engines.$currentEngine.model
  $restoreIngress = [bool]$state.ingressEnabled
  if (-not $ModelId) { $ModelId = [string]$state.engines.$EngineId.model }
  Assert-ModelIdentifier $ModelId
  $approvedConcurrency = Get-ApprovedConcurrency $EngineId $ModelId
  Set-GatewayState @{ paused=$true; ingressEnabled=$false } | Out-Null
  Wait-GatewayIdle
  Set-EngineState $EngineId $ModelId | Out-Null
  Set-GatewayState @{ concurrency=$approvedConcurrency } | Out-Null
  if ($EngineId -eq 'ollama') {
    Stop-Vllm
    # Ollama can otherwise retain the previous model in VRAM while loading the
    # replacement. Restart the local server for a true one-model-at-a-time
    # transition and to avoid transient CUDA exhaustion.
    if ($currentEngine -eq 'ollama' -and $currentModel -ne $ModelId) {
      Stop-Ollama
    }
    Start-Ollama
  } elseif ($EngineId -eq 'vllm') {
    Start-Vllm $ModelId
  } elseif ($EngineId -eq 'codex') {
    Stop-Vllm
    Stop-Ollama
    Install-CodexCli
    if (-not (Get-CodexStatus).authenticated) { throw 'Codex CLI authentication is required before selecting it.' }
  } elseif ($EngineId -eq 'claude') {
    Stop-Vllm
    Stop-Ollama
    Install-ClaudeCli
    if (-not (Get-ClaudeStatus).authenticated) { throw 'Claude Code authentication is required before selecting it.' }
  } else {
    throw "Unsupported inference engine $EngineId."
  }
  Set-ActiveApprovedProfile $EngineId $ModelId
  Set-GatewayState @{ enabled=$true; paused=$false; ingressEnabled=$restoreIngress } | Out-Null
  Restore-InterruptedAccountTransition $EngineId | Out-Null
}

function Verify-InferenceEngine([string]$EngineId, [string]$ModelId) {
  Select-InferenceEngine $EngineId $ModelId
  $result = Invoke-NativeCapture (Get-Command node.exe).Source @($VerificationScript, '--timeout-ms=2700000')
  if ($result.exitCode -ne 0) { throw "Engine verification failed: $($result.stderr)" }
}

function Get-Status {
  $gateway = $null
  try { $gateway = Invoke-GatewayControl -Path '/control/status' -TimeoutSec 3 } catch {}
  $state = Get-SavedState
  if ($gateway.state) {
    foreach ($property in @('enabled', 'ingressEnabled', 'paused', 'concurrency', 'autoStart', 'selectionMode', 'selectedEngine')) {
      if ($null -ne $gateway.state.$property) { $state.$property = $gateway.state.$property }
    }
    if ($gateway.state.engines) { $state.engines = $gateway.state.engines }
  }
  $selectedEngine = if ($gateway.engine) { [string]$gateway.engine } else { [string]$state.selectedEngine }
  $selectedModel = if ($gateway.model) { [string]$gateway.model } else { [string]$state.engines.$selectedEngine.model }

  $ollama = $null
  $ollamaTags = @()
  if ($selectedEngine -eq 'ollama') {
    try { $ollama = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -TimeoutSec 3 } catch {}
    try { $ollamaTags = @((Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3).models | ForEach-Object { $_.name }) } catch {}
  }
  $vllm = [ordered]@{ installed=$false; running=$false; healthy=$false; container=$VllmContainer; image=$VllmImage }
  if ($selectedEngine -eq 'vllm') {
    try {
      $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
      if ($docker) {
        $imageStatus = Invoke-NativeCapture $docker.Source @('image', 'inspect', $VllmImage) 3000
        $vllm.installed = $imageStatus.exitCode -eq 0
      }
    } catch {}
    $container = Get-VllmContainer
    if ($container) {
      $vllm.installed = $true
      $vllm.running = [bool]$container.State.Running
      $vllm.model = [string]$container.Config.Labels.'ai.seemplify.model'
      $vllm.status = [string]$container.State.Status
      if ($container.State.Running) {
        try {
          $served = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/v1/models' -TimeoutSec 3
          $vllm.healthy = $true
          $vllm.models = @($served.data)
        } catch {}
      }
    }
  }
  $gpu = $null
  try {
    $gpuLine = & nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits 2>$null | Select-Object -First 1
    if ($gpuLine) {
      $parts = $gpuLine -split ',' | ForEach-Object { $_.Trim() }
      $gpu = [ordered]@{ name=$parts[0]; memoryTotalMiB=[int]$parts[1]; memoryUsedMiB=[int]$parts[2]; utilizationPercent=[int]$parts[3] }
    }
  } catch {}
  $verification = [ordered]@{ byEngineModel=[ordered]@{} }
  if (Test-Path $VerificationFile) {
    try { $verification = Get-Content -LiteralPath $VerificationFile -Raw | ConvertFrom-Json } catch {}
  }
  $benchmarks = [ordered]@{ profiles=@(); recommendation=$null }
  if (Test-Path $BenchmarkSummaryScript) {
    try {
      $benchmarkResult = Invoke-NativeCapture (Get-Command node.exe).Source @($BenchmarkSummaryScript) 5000
      if ($benchmarkResult.exitCode -eq 0 -and $benchmarkResult.stdout) {
        $benchmarks = $benchmarkResult.stdout | ConvertFrom-Json
      }
    } catch {}
  }
  $codex = Get-CodexStatus
  if ($selectedEngine -eq 'codex' -and $gateway.pid -and $codex.authStatus -eq 'Authentication status unavailable') {
    $codex.authenticated = $true
    $codex.authStatus = 'Active gateway session'
  }
  $claude = Get-ClaudeStatus
  if ($selectedEngine -eq 'claude' -and $gateway.pid -and $claude.authStatus -eq 'Authentication status unavailable') {
    $claude.authenticated = $true
    $claude.authStatus = 'Active gateway session'
  }
  return [ordered]@{
    installed = [bool]$OllamaExe
    engine = $selectedEngine
    model = $selectedModel
    gateway = $gateway
    engines = [ordered]@{
      ollama = [ordered]@{ installed=[bool]$OllamaExe; executable=$OllamaExe; running=[bool](Get-Process ollama -ErrorAction SilentlyContinue); model=[string]$state.engines.ollama.model; availableModels=$ollamaTags; runtime=$ollama }
      vllm = $vllm
      codex = $codex
      claude = $claude
    }
    gpu = $gpu
    verification = $verification
    benchmarks = $benchmarks
  }
}

switch ($Action) {
  'start' {
    if ((Get-SavedState).selectionMode -ne 'manual') { Select-BestAvailableEngine | Out-Null }
    Start-SelectedEngine
    Start-Gateway
    Set-GatewayState @{ enabled=$true; paused=$false } | Out-Null
  }
  'stop' {
    try { Set-GatewayState @{ ingressEnabled=$false; paused=$true; enabled=$false } | Out-Null } catch {}
    Stop-Gateway $false
    Stop-Vllm
    Stop-Ollama
  }
  'force-stop' {
    Stop-Gateway $true
    Stop-Vllm
    Stop-Ollama
  }
  'restart' {
    $restoreIngress = [bool](Get-SavedState).ingressEnabled
    Stop-Gateway $false
    if ((Get-SavedState).selectionMode -ne 'manual') { Select-BestAvailableEngine | Out-Null }
    Start-SelectedEngine
    Start-Gateway
    Set-GatewayState @{ enabled=$true; paused=$false; ingressEnabled=$restoreIngress } | Out-Null
  }
  'load' {
    $engineId = [string](Get-SavedState).selectedEngine
    if ($engineId -eq 'ollama') { Load-OllamaModel }
    elseif ($engineId -eq 'vllm') { Start-Vllm (Get-EngineModel 'vllm') }
  }
  'unload' {
    $engineId = [string](Get-SavedState).selectedEngine
    if ($engineId -eq 'ollama' -and $OllamaExe) { & $OllamaExe stop (Get-EngineModel 'ollama') | Out-Null }
    elseif ($engineId -eq 'vllm') { Stop-Vllm }
  }
  'pause' { Set-GatewayState @{ paused=$true } | Out-Null }
  'resume' { Set-GatewayState @{ paused=$false; enabled=$true } | Out-Null }
  'enable-ingress' { Set-GatewayState @{ ingressEnabled=$true } | Out-Null }
  'disable-ingress' { Set-GatewayState @{ ingressEnabled=$false } | Out-Null }
  'enable-auto-start' { Set-GatewayState @{ autoStart=$true } | Out-Null; Set-ManagedAutoStart $true }
  'disable-auto-start' { Set-GatewayState @{ autoStart=$false } | Out-Null; Set-ManagedAutoStart $false }
  'set-concurrency' {
    $stateBefore = Get-SavedState
    $selectedEngine = [string]$stateBefore.selectedEngine
    $selectedModel = [string]$stateBefore.engines.$selectedEngine.model
    Assert-ApprovedConcurrency $selectedEngine $selectedModel $Concurrency | Out-Null
    $restorePaused = [bool]$stateBefore.paused
    Set-GatewayState @{ concurrency=$Concurrency; paused=$true } | Out-Null
    if ($stateBefore.selectedEngine -eq 'ollama' -and (Get-Process ollama -ErrorAction SilentlyContinue)) {
      Wait-GatewayIdle
      Stop-Ollama
      Start-Ollama
      Load-OllamaModel
    }
    Set-GatewayState @{ paused=$restorePaused } | Out-Null
  }
  'select-engine' {
    $selectedModel = if ($Model) { $Model } else { Get-EngineModel $Engine }
    Select-InferenceEngine $Engine $selectedModel
    Set-GatewayState @{ selectionMode='manual' } | Out-Null
  }
  'select-best' {
    Select-BestAvailableEngine | Out-Null
  }
  'set-model' {
    if (-not $Model) { throw '-Model is required for set-model.' }
    Select-InferenceEngine $Engine $Model
    Set-GatewayState @{ selectionMode='manual' } | Out-Null
  }
  'set-experience-default' {
    if (-not $Model) { throw '-Model is required for set-experience-default.' }
    Assert-ModelIdentifier $Model
    Set-GatewayState @{
      applicationDefaults = [ordered]@{
        experienceManagement = [ordered]@{ engine=$Engine; model=$Model }
      }
    } | Out-Null
    Restore-InterruptedAccountTransition $Engine | Out-Null
  }
  'set-xplorer-default' {
    if (-not $Model) { throw '-Model is required for set-xplorer-default.' }
    Assert-ModelIdentifier $Model
    Set-GatewayState @{
      applicationDefaults = [ordered]@{
        xplorerCrm = [ordered]@{ engine=$Engine; model=$Model }
      }
    } | Out-Null
    Restore-InterruptedAccountTransition $Engine | Out-Null
  }
  'verify-engine' {
    $verificationModel = if ($Model) { $Model } else { Get-EngineModel $Engine }
    Verify-InferenceEngine $Engine $verificationModel
  }
  'install-codex' { Install-CodexCli; Sync-CodexCatalog | Out-Null }
  'login-codex' { Login-CodexCli; Sync-CodexCatalog | Out-Null }
  'logout-codex' { Invoke-SafeAccountTransition 'codex' -LogoutOnly }
  'switch-codex-account' { Invoke-SafeAccountTransition 'codex' -SwitchAccount }
  'sync-codex-models' { Sync-CodexCatalog | Out-Null }
  'install-claude' { Install-ClaudeCli }
  'login-claude' { Login-ClaudeCli }
  'logout-claude' { Invoke-SafeAccountTransition 'claude' -LogoutOnly }
  'switch-claude-account' { Invoke-SafeAccountTransition 'claude' -SwitchAccount }
  'install-vllm' { Install-Vllm }
  'vllm-start' {
    $vllmModel = if ($Model) { $Model } else { Get-EngineModel 'vllm' }
    Start-Vllm $vllmModel
  }
  'vllm-stop' { Stop-Vllm }
  'status' {}
}

$status = $null
try {
  $status = Get-Status
} catch {
  $statusError = [string]$_.Exception.Message
  $savedState = Get-SavedState
  $gateway = $null
  try { $gateway = Invoke-GatewayControl -Path '/control/status' -TimeoutSec 3 } catch {}
  $selectedEngine = if ($gateway.engine) { [string]$gateway.engine } else { [string]$savedState.selectedEngine }
  $selectedModel = if ($gateway.model) { [string]$gateway.model } else { [string]$savedState.engines.$selectedEngine.model }
  $status = [ordered]@{
    installed = [bool]$OllamaExe
    engine = $selectedEngine
    model = $selectedModel
    gateway = $gateway
    engines = [ordered]@{
      ollama = [ordered]@{
        installed=[bool]$OllamaExe
        executable=$OllamaExe
        running=[bool](Get-Process ollama -ErrorAction SilentlyContinue)
        model=[string]$savedState.engines.ollama.model
        availableModels=@()
        runtime=$null
      }
      vllm = [ordered]@{
        installed=$false
        running=$false
        healthy=$false
        container=$VllmContainer
        image=$VllmImage
      }
      codex = [ordered]@{
        installed=(Test-Path $CodexScript)
        authenticated=$false
        authStatus='Authentication status unavailable'
        defaultModel=$DefaultModels.codex
        models=@()
        catalogRefreshedAt=$null
      }
    }
    gpu = $null
    verification = [ordered]@{ byEngineModel=[ordered]@{} }
    benchmarks = [ordered]@{ profiles=@(); recommendation=$null }
    statusWarning = "Optional engine inventory unavailable: $statusError"
  }
}
if ($Json) { $status | ConvertTo-Json -Depth 20 -Compress } else { [pscustomobject]$status | Format-List }
