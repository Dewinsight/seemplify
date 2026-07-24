param(
  [ValidateRange(4, 50)]
  [int]$SoakRequests = 10,
  [switch]$SkipQuality,
  [switch]$SkipPackage
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$BackendRoot = Join-Path $RepositoryRoot 'recruiter\backend'
$FrontendRoot = Join-Path $RepositoryRoot 'recruiter\frontend'
$AIInterviewBackendRoot = Join-Path $RepositoryRoot 'ai-interview\backend'
$AIInterviewFrontendRoot = Join-Path $RepositoryRoot 'ai-interview\frontend'
$ControlCenterRoot = Join-Path (Split-Path -Parent $RepositoryRoot) 'crm\Xplorer-crm'
$RuntimeDir = Join-Path $RepositoryRoot '.local-runtime\llm'
$ControlSecretFile = Join-Path $RuntimeDir 'control-secret'
$ManageScript = Join-Path $PSScriptRoot 'manage.ps1'
$TunnelScript = Join-Path $PSScriptRoot 'cloudflare-tunnel.ps1'
$RedisContainer = "seemplify-cv-test-redis-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
$script:RedisPort = 0
$ReportFile = Join-Path $RuntimeDir 'full-system-test.json'
$steps = [System.Collections.Generic.List[object]]::new()
$script:redisCreated = $false

New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

function Invoke-GatewayStatus {
  $controlSecret = (Get-Content -LiteralPath $ControlSecretFile -Raw).Trim()
  if (-not $controlSecret) { throw 'Local LLM control secret is unavailable.' }
  return Invoke-RestMethod -Uri 'http://127.0.0.1:11435/control/status' `
    -Headers @{ 'X-Seemplify-Control-Secret' = $controlSecret } -TimeoutSec 10
}

function Invoke-TestStep {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][scriptblock]$Action
  )
  $started = Get-Date
  Write-Host "`n[$Name]"
  try {
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Name exited with code $LASTEXITCODE." }
    $steps.Add([pscustomobject]@{
      name = $Name
      passed = $true
      durationMs = [int]((Get-Date) - $started).TotalMilliseconds
    })
  } catch {
    $steps.Add([pscustomobject]@{
      name = $Name
      passed = $false
      durationMs = [int]((Get-Date) - $started).TotalMilliseconds
      error = $_.Exception.Message
    })
    throw
  }
}

function Invoke-InDirectory {
  param([string]$Directory, [scriptblock]$Action)
  Push-Location $Directory
  try { & $Action } finally { Pop-Location }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath exited with code $LASTEXITCODE."
  }
}

function Test-LocalTcpListener {
  param([Parameter(Mandatory=$true)][int]$Port)
  $client = [System.Net.Sockets.TcpClient]::new()
  $pending = $null
  try {
    $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(1500)) { return $false }
    try { $client.EndConnect($pending) } catch { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    if ($pending -and $pending.AsyncWaitHandle) { $pending.AsyncWaitHandle.Dispose() }
    $client.Dispose()
  }
}

function Get-FreeLocalTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    0
  )
  try {
    $listener.Start()
    return [int]$listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

function Wait-RuntimeHealthy {
  param([int]$TimeoutSeconds = 300)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:11435/health' -TimeoutSec 5
      if ($health.ok -and $health.engine.ok -and $health.engine.modelInstalled) { return $health }
    } catch {}
    Start-Sleep -Seconds 2
  }
  throw "The selected local CV runtime did not become healthy within $TimeoutSeconds seconds."
}

function Invoke-ControlScript {
  param(
    [Parameter(Mandatory=$true)][string]$ScriptPath,
    [Parameter(Mandatory=$true)][string[]]$Arguments
  )
  $invocationId = [guid]::NewGuid().ToString('N')
  $stdout = Join-Path $RuntimeDir "test-control-$invocationId.stdout.log"
  $stderr = Join-Path $RuntimeDir "test-control-$invocationId.stderr.log"
  $argumentText = ($Arguments | ForEach-Object { '"' + $_.Replace('"', '""') + '"' }) -join ' '
  $command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`" $argumentText > `"$stdout`" 2> `"$stderr`""
  $process = Start-Process -FilePath (Get-Command cmd.exe).Source `
    -ArgumentList @('/d', '/s', '/c', "`"$command`"") `
    -WindowStyle Hidden -PassThru
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    $details = if (Test-Path $stderr) { (Get-Content -LiteralPath $stderr -Raw).Trim() } else { '' }
    throw "$ScriptPath exited with code $($process.ExitCode). $details"
  }
}

function Restore-OnlineRuntime {
  try { Invoke-ControlScript $ManageScript @('-Action', 'start') } catch {}
  try { Invoke-ControlScript $ManageScript @('-Action', 'load') } catch {}
  try { Invoke-ControlScript $TunnelScript @('-Action', 'start') } catch {}
  try { Invoke-ControlScript $ManageScript @('-Action', 'enable-ingress') } catch {}
  try { Invoke-ControlScript $ManageScript @('-Action', 'enable-auto-start') } catch {}
}

try {
  Invoke-TestStep 'Start the selected approved runtime profile' {
    Invoke-ControlScript $ManageScript @('-Action', 'start')
    $health = Wait-RuntimeHealthy
  }

  Invoke-TestStep 'Preflight runtime health' {
    $health = Wait-RuntimeHealthy
  }

  Invoke-TestStep 'Start disposable Redis' {
    $script:RedisPort = Get-FreeLocalTcpPort
    $existing = & docker.exe ps -a --filter "name=^/$RedisContainer$" --format '{{.Names}}'
    if ($existing) { throw "Refusing to overwrite pre-existing test container $RedisContainer." }
    & docker.exe run -d --name $RedisContainer -p "127.0.0.1:$($script:RedisPort):6379" 'redis:7-alpine' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not start disposable Redis.' }
    $script:redisCreated = $true
    $ping = & docker.exe exec $RedisContainer redis-cli ping
    if ($ping -ne 'PONG') { throw 'Disposable Redis did not answer PING.' }
  }

  Invoke-TestStep 'All recruiter backend tests' {
    $previousPort = $env:CV_TEST_REDIS_PORT
    try {
      $env:CV_TEST_REDIS_PORT = [string]$script:RedisPort
      Invoke-InDirectory $BackendRoot { Invoke-Checked node.exe --test 'tests/*.test.js' }
    } finally {
      $env:CV_TEST_REDIS_PORT = $previousPort
    }
  }

  Invoke-TestStep 'AI Interview backend and durable queue tests' {
    Invoke-InDirectory $AIInterviewBackendRoot {
      $previousEnabled = $env:AI_INTERVIEW_CV_QUEUE_INTEGRATION
      $previousHost = $env:AI_INTERVIEW_REDIS_HOST
      $previousPort = $env:AI_INTERVIEW_REDIS_PORT
      try {
        $env:AI_INTERVIEW_CV_QUEUE_INTEGRATION = 'true'
        $env:AI_INTERVIEW_REDIS_HOST = '127.0.0.1'
        $env:AI_INTERVIEW_REDIS_PORT = [string]$script:RedisPort
        Invoke-Checked npm.cmd run check
        Invoke-Checked npm.cmd test
      } finally {
        $env:AI_INTERVIEW_CV_QUEUE_INTEGRATION = $previousEnabled
        $env:AI_INTERVIEW_REDIS_HOST = $previousHost
        $env:AI_INTERVIEW_REDIS_PORT = $previousPort
      }
    }
  }

  Invoke-TestStep 'Restore approved selected-engine profile after isolation tests' {
    $runtime = Invoke-GatewayStatus
    Invoke-ControlScript $ManageScript @(
      '-Action', 'select-engine',
      '-Engine', [string]$runtime.engine,
      '-Model', [string]$runtime.model
    )
    $health = Wait-RuntimeHealthy
  }

  Invoke-TestStep 'Recruiter production frontend build' {
    Invoke-InDirectory $FrontendRoot { Invoke-Checked npm.cmd run build }
  }

  Invoke-TestStep 'AI Interview production frontend build' {
    Invoke-InDirectory $AIInterviewFrontendRoot {
      Invoke-Checked pnpm.cmd typecheck
      Invoke-Checked pnpm.cmd build
    }
  }

  Invoke-TestStep 'Control Center service tests' {
    Invoke-InDirectory $ControlCenterRoot { Invoke-Checked npm.cmd run crm:test }
  }

  if (-not $SkipPackage) {
    Invoke-TestStep 'Control Center Windows package' {
      Invoke-InDirectory $ControlCenterRoot { Invoke-Checked npm.cmd run crm:app:package }
    }
  }

  if (-not $SkipQuality) {
    Invoke-TestStep 'Sequential local model capability matrix' {
      Invoke-InDirectory $RepositoryRoot { Invoke-Checked node.exe 'tools/local-llm/evaluate-runtime-models.cjs' }
    }

    Invoke-TestStep 'Synthetic PDF, DOCX, and image quality harness' {
      Invoke-InDirectory $BackendRoot { Invoke-Checked npm.cmd run evaluate:local-cv }
    }
  }

  Invoke-TestStep 'Sustained gateway concurrency soak' {
    Invoke-InDirectory $RepositoryRoot { Invoke-Checked node.exe 'tools/local-llm/soak.cjs' "--requests=$SoakRequests" }
  }

  Invoke-TestStep 'Graceful shutdown drains and releases the GPU' {
    Invoke-ControlScript $ManageScript @('-Action', 'stop')
    Start-Sleep -Seconds 1
    $processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(ollama|ollama app|llama-server)\.exe$' })
    $listeners = @(11434, 11435, 8000 | Where-Object { Test-LocalTcpListener -Port $_ })
    $vllmRunning = & docker.exe ps --quiet --filter "name=^/seemplify-vllm$"
    $usedMiB = [int]((& nvidia-smi.exe --query-gpu=memory.used --format=csv,noheader,nounits).Trim())
    if ($processes.Count -ne 0 -or $listeners.Count -ne 0 -or $vllmRunning) {
      throw 'Graceful stop left a GPU runtime, gateway process, or listener running.'
    }
    if ($usedMiB -gt 4096) { throw "Graceful stop did not release model VRAM ($usedMiB MiB still used)." }
  }

  Invoke-TestStep 'Force stop remains available while runtime is unloaded' {
    Invoke-ControlScript $ManageScript @('-Action', 'start')
    Invoke-ControlScript $ManageScript @('-Action', 'force-stop')
    $listeners = @(11434, 11435, 8000 | Where-Object { Test-LocalTcpListener -Port $_ })
    if ($listeners.Count -ne 0) { throw 'Force stop left a local inference listener running.' }
  }

  Invoke-TestStep 'Restore model, ingress, tunnel, and managed auto-start' {
    Restore-OnlineRuntime
    $health = Wait-RuntimeHealthy
    $startup = [Environment]::GetFolderPath('Startup')
    if (-not (Test-Path (Join-Path $startup 'Seemplify Local CV LLM.lnk'))) {
      throw 'Managed auto-start shortcut is missing.'
    }
  }

  Invoke-TestStep 'Authenticated public Cloudflare edge' {
    Invoke-InDirectory $RepositoryRoot { Invoke-Checked node.exe 'tools/local-llm/external-smoke.cjs' }
  }

  Invoke-TestStep 'Installed Control Center Electron smoke' {
    Invoke-InDirectory $ControlCenterRoot { Invoke-Checked npm.cmd run crm:app:test }
  }
} finally {
  if ($script:redisCreated) {
    try { & docker.exe rm -f $RedisContainer | Out-Null } catch {}
  }
  Restore-OnlineRuntime
  $report = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    passed = @($steps | Where-Object { -not $_.passed }).Count -eq 0
    soakRequests = $SoakRequests
    disposableRedisPort = $script:RedisPort
    steps = $steps
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportFile -Encoding utf8
  Write-Host "`nFull-system report: $ReportFile"
}
