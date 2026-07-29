param(
  [ValidateSet('initialize','start','stop','restart','status','enable-auto-start','disable-auto-start')]
  [string]$Action = 'status',
  [switch]$Json
)
$ErrorActionPreference = 'Stop'
$SourceProjectDir = Split-Path -Parent $PSScriptRoot
$RepositoryDir = Split-Path -Parent $SourceProjectDir
$RuntimeDir = Join-Path $RepositoryDir '.local-runtime\experience-management'
$DeploymentsDir = Join-Path $RuntimeDir 'deployments'
$ActiveProjectFile = Join-Path $RuntimeDir 'active-project-path'
$PidFile = Join-Path $RuntimeDir 'server.pid'
$PasswordFile = Join-Path $RuntimeDir 'admin-password'
$SessionSecretFile = Join-Path $RuntimeDir 'session-secret'
$BrevoWebhookSecretFile = Join-Path $RuntimeDir 'brevo-webhook-secret'
$StdoutLog = Join-Path $RuntimeDir 'server.stdout.log'
$StderrLog = Join-Path $RuntimeDir 'server.stderr.log'
$StartupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Seemplify Experience.lnk'
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

function Get-ProjectDir {
  if (-not (Test-Path -LiteralPath $ActiveProjectFile)) { return $SourceProjectDir }
  $candidate = (Get-Content -LiteralPath $ActiveProjectFile -Raw).Trim()
  if (-not $candidate) { return $SourceProjectDir }
  $fullCandidate = [IO.Path]::GetFullPath($candidate)
  $fullDeployments = [IO.Path]::GetFullPath($DeploymentsDir).TrimEnd('\') + '\'
  if (-not $fullCandidate.StartsWith($fullDeployments, [StringComparison]::OrdinalIgnoreCase)) { return $SourceProjectDir }
  if (-not (Test-Path -LiteralPath (Join-Path $fullCandidate 'backend\dist\server.js'))) { return $SourceProjectDir }
  return $fullCandidate
}

function New-RandomSecret([int]$Bytes = 32) { $value = New-Object byte[] $Bytes; $generator = [Security.Cryptography.RandomNumberGenerator]::Create(); try { $generator.GetBytes($value) } finally { $generator.Dispose() }; return [Convert]::ToBase64String($value).TrimEnd('=').Replace('+','-').Replace('/','_') }
function Initialize-Runtime {
  if (-not (Test-Path -LiteralPath $PasswordFile)) { Set-Content -LiteralPath $PasswordFile -Value (New-RandomSecret 24) -Encoding ascii }
  if (-not (Test-Path -LiteralPath $SessionSecretFile)) { Set-Content -LiteralPath $SessionSecretFile -Value (New-RandomSecret 48) -Encoding ascii }
  if (-not (Test-Path -LiteralPath $BrevoWebhookSecretFile)) { Set-Content -LiteralPath $BrevoWebhookSecretFile -Value (New-RandomSecret 48) -Encoding ascii }
  $envFile = Join-Path $SourceProjectDir 'backend\.env'
  if (-not (Test-Path -LiteralPath $envFile)) { Copy-Item -LiteralPath (Join-Path $SourceProjectDir 'backend\.env.example') -Destination $envFile }
}
function Get-ServerProcess {
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  $processId = [int](Get-Content -LiteralPath $PidFile -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if (-not $process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notlike '*backend/dist/server.js*') { Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue; return $null }
  return $process
}
function Start-Server {
  Initialize-Runtime
  if (Get-ServerProcess) { return }
  $ProjectDir = Get-ProjectDir
  if (-not (Test-Path (Join-Path $ProjectDir 'backend\dist\server.js'))) { & npm.cmd run build --prefix $ProjectDir; if ($LASTEXITCODE -ne 0) { throw 'Experience build failed.' } }
  $env:HOST='127.0.0.1'; $env:PORT='5410'; $env:PUBLIC_URL='https://experience.aiinnigeria.com'
  $env:ADMIN_PASSWORD_FILE=$PasswordFile; $env:SESSION_SECRET_FILE=$SessionSecretFile
  $env:BREVO_WEBHOOK_SECRET_FILE=$BrevoWebhookSecretFile
  $env:DATABASE_PATH=(Join-Path $RuntimeDir 'experience.sqlite'); $env:UPLOAD_DIR=(Join-Path $RuntimeDir 'uploads')
  $env:TERRA_GATEWAY_BASE_URL='http://127.0.0.1:11435'; $env:TERRA_GATEWAY_SHARED_SECRET_FILE=(Join-Path $RepositoryDir '.local-runtime\llm\service-secret')
  $sharedBrevo = Join-Path (Split-Path -Parent $RepositoryDir) 'crm\Xplorer-Full-backend\.env'
  if (Test-Path -LiteralPath $sharedBrevo) { $env:BREVO_ENV_FILE=$sharedBrevo }
  $process = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('backend/dist/server.js') -WorkingDirectory $ProjectDir -WindowStyle Hidden -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru
  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii
  $deadline = (Get-Date).AddSeconds(20); do { Start-Sleep -Milliseconds 400; try { if ((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5410/health' -TimeoutSec 2).StatusCode -eq 200) { return } } catch {} } while ((Get-Date) -lt $deadline)
  throw "Experience server did not become healthy. See $StderrLog."
}
function Stop-Server { $process = Get-ServerProcess; if ($process) { Stop-Process -Id $process.ProcessId -Force; Start-Sleep -Milliseconds 500 }; Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue }
function Set-AutoStart([bool]$Enabled) {
  if (-not $Enabled) { Remove-Item -LiteralPath $StartupShortcut -Force -ErrorAction SilentlyContinue; return }
  $shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut($StartupShortcut); $shortcut.TargetPath = 'powershell.exe'; $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'autostart.ps1')`""; $shortcut.WorkingDirectory = $ProjectDir; $shortcut.Save()
}
function Get-Status {
  $process = Get-ServerProcess; $healthy = $false; try { $healthy = (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5410/health' -TimeoutSec 3).StatusCode -eq 200 } catch {}
  $project = Get-ProjectDir
  return [ordered]@{ installed=$true; running=[bool]$process; pid=if($process){$process.ProcessId}else{$null}; healthy=$healthy; url='http://127.0.0.1:5410'; publicUrl='https://experience.aiinnigeria.com'; projectDir=$project; isolatedDeployment=($project -ne $SourceProjectDir); authConfigured=((Test-Path $PasswordFile) -and (Test-Path $SessionSecretFile)); brevoWebhookSecretConfigured=(Test-Path $BrevoWebhookSecretFile); adminEmail='admin@seemplify.local'; passwordFile=$PasswordFile; autoStart=(Test-Path $StartupShortcut); stdoutLog=$StdoutLog; stderrLog=$StderrLog }
}
switch ($Action) { 'initialize' { Initialize-Runtime }; 'start' { Start-Server }; 'stop' { Stop-Server }; 'restart' { Stop-Server; Start-Server }; 'enable-auto-start' { Initialize-Runtime; Set-AutoStart $true }; 'disable-auto-start' { Set-AutoStart $false }; 'status' {} }
$status = Get-Status; if ($Json) { $status | ConvertTo-Json -Compress } else { [pscustomobject]$status | Format-List }
