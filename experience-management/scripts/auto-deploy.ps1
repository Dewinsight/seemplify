param(
  [ValidateSet('start','stop','status','once','watch')]
  [string]$Action = 'status',
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$RepositoryDir = Split-Path -Parent $ProjectDir
$RuntimeDir = Join-Path $RepositoryDir '.local-runtime\experience-management'
$PidFile = Join-Path $RuntimeDir 'auto-deploy.pid'
$LogFile = Join-Path $RuntimeDir 'auto-deploy.log'
$DeployedFile = Join-Path $RuntimeDir 'deployed-tree'
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

function Write-DeployLog([string]$Message) { Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format o) $Message" }
function Get-Watcher {
  if (-not (Test-Path $PidFile)) { return $null }
  $processId = [int](Get-Content -LiteralPath $PidFile -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if (-not $process -or $process.CommandLine -notlike '*auto-deploy.ps1*watch*') { Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue; return $null }
  return $process
}
function Invoke-Deployment([switch]$ForceDeploy) {
  Push-Location $RepositoryDir
  try {
    $dirty = & git status --porcelain
    if ($dirty -and -not $ForceDeploy) { Write-DeployLog 'Skipped: working tree has local changes.'; return }
    & git fetch origin main --quiet
    if ($LASTEXITCODE -ne 0) { Write-DeployLog 'Fetch failed.'; return }
    $local = & git rev-parse HEAD
    $remote = & git rev-parse origin/main
    if ($local -ne $remote -and -not $dirty) {
      & git merge-base --is-ancestor $local $remote
      if ($LASTEXITCODE -eq 0) { & git pull --ff-only origin main | Out-Null }
      else { Write-DeployLog 'Skipped: local branch diverged from origin/main.'; return }
    }
    $tree = & git rev-parse 'HEAD:experience-management'
    $deployed = if (Test-Path $DeployedFile) { (Get-Content $DeployedFile -Raw).Trim() } else { '' }
    if ($tree -eq $deployed -and -not $ForceDeploy) { return }
    Push-Location $ProjectDir
    try {
      & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
      & npm.cmd run typecheck; if ($LASTEXITCODE -ne 0) { throw 'typecheck failed' }
      & npm.cmd test; if ($LASTEXITCODE -ne 0) { throw 'tests failed' }
      & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'build failed' }
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'manage.ps1') -Action restart | Out-Null
      $tree | Set-Content -LiteralPath $DeployedFile -Encoding ascii
      Write-DeployLog "Deployed $tree."
    } finally { Pop-Location }
  } catch { Write-DeployLog "Deploy failed: $($_.Exception.Message)" }
  finally { Pop-Location }
}
function Watch {
  Set-Content -LiteralPath $PidFile -Value $PID -Encoding ascii
  try { while ($true) { Invoke-Deployment; Start-Sleep -Seconds 60 } }
  finally { Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue }
}
if ($Action -eq 'watch') { Watch; exit }
if ($Action -eq 'once') { Invoke-Deployment -ForceDeploy:$Force; exit }
if ($Action -eq 'start' -and -not (Get-Watcher)) {
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-Action','watch') -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii
}
if ($Action -eq 'stop') { $process = Get-Watcher; if ($process) { Stop-Process -Id $process.ProcessId -Force }; Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue }
$process = Get-Watcher
[pscustomobject]@{ running=[bool]$process; pid=if($process){$process.ProcessId}else{$null}; log=$LogFile; lastDeployed=if(Test-Path $DeployedFile){(Get-Content $DeployedFile -Raw).Trim()}else{$null} } | Format-List
