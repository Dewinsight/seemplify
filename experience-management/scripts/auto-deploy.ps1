param(
  [ValidateSet('start','stop','status','once','watch')]
  [string]$Action = 'status',
  [switch]$Force,
  [string]$DeploymentRef = 'origin/main'
)
$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$RepositoryDir = Split-Path -Parent $ProjectDir
$RuntimeDir = Join-Path $RepositoryDir '.local-runtime\experience-management'
$PidFile = Join-Path $RuntimeDir 'auto-deploy.pid'
$LogFile = Join-Path $RuntimeDir 'auto-deploy.log'
$WatcherOutputLog = Join-Path $RuntimeDir 'auto-deploy.stdout.log'
$WatcherErrorLog = Join-Path $RuntimeDir 'auto-deploy.stderr.log'
$DeployedFile = Join-Path $RuntimeDir 'deployed-tree'
$ActiveProjectFile = Join-Path $RuntimeDir 'active-project-path'
$PostgresCutoverMarker = Join-Path $RuntimeDir 'postgres-cutover-v1'
$DeploymentsDir = Join-Path $RuntimeDir 'deployments'
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

function Write-DeployLog([string]$Message) { Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format o) $Message" }
function Merge-RetainedFrontendAssets([string]$ReleaseProject) {
  $destinationAssets = Join-Path $ReleaseProject 'frontend\dist\assets'
  if (-not (Test-Path -LiteralPath $destinationAssets -PathType Container)) { throw "Frontend asset directory was not produced: $destinationAssets" }
  $destinationRoot = [IO.Path]::GetFullPath($destinationAssets).TrimEnd([char[]]'\/')
  $copied = 0
  $deployments = @(Get-ChildItem -LiteralPath $DeploymentsDir -Directory -Force | Sort-Object LastWriteTimeUtc -Descending)
  foreach ($deployment in $deployments) {
    $sourceAssets = Join-Path $deployment.FullName 'frontend\dist\assets'
    if (-not (Test-Path -LiteralPath $sourceAssets -PathType Container)) { continue }
    $sourceRoot = [IO.Path]::GetFullPath($sourceAssets).TrimEnd([char[]]'\/')
    if ([string]::Equals($sourceRoot, $destinationRoot, [StringComparison]::OrdinalIgnoreCase)) { continue }
    foreach ($file in @(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force)) {
      $relativePath = $file.FullName.Substring($sourceRoot.Length + 1)
      $destinationFile = Join-Path $destinationRoot $relativePath
      if (Test-Path -LiteralPath $destinationFile) { continue }
      $destinationDirectory = Split-Path -Parent $destinationFile
      New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
      Copy-Item -LiteralPath $file.FullName -Destination $destinationFile
      $copied += 1
    }
  }
  return $copied
}
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
    & git fetch origin main --quiet
    if ($LASTEXITCODE -ne 0) { Write-DeployLog 'Fetch failed.'; return }
    $commit = (@(& git rev-parse --verify --quiet $DeploymentRef 2>$null) -join '').Trim()
    if ($LASTEXITCODE -ne 0 -or -not $commit) { Write-DeployLog "Skipped: $DeploymentRef could not be inspected."; return }
    $manifestPath = (@(& git ls-tree --name-only $commit -- experience-management/package.json 2>$null) -join '').Trim()
    if ($LASTEXITCODE -ne 0) { Write-DeployLog "Skipped: $DeploymentRef could not be inspected."; return }
    if ($manifestPath -ne 'experience-management/package.json') { Write-DeployLog "Skipped: $DeploymentRef does not contain Experience Management yet."; return }
    $tree = (& git rev-parse "${commit}:experience-management").Trim()
    $deployed = if (Test-Path $DeployedFile) { (Get-Content $DeployedFile -Raw).Trim() } else { '' }
    if ($tree -eq $deployed -and -not $ForceDeploy) { return }
    New-Item -ItemType Directory -Force $DeploymentsDir | Out-Null
    $releaseName = "$($commit.Substring(0, 12))-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
    $releaseDir = Join-Path $DeploymentsDir $releaseName
    $releaseProject = $releaseDir
    New-Item -ItemType Directory -Force $releaseDir | Out-Null
    $archive = Join-Path $RuntimeDir "$releaseName.tar"
    try {
      & git archive --format=tar --output=$archive "${commit}:experience-management"
      if ($LASTEXITCODE -ne 0) { throw "Could not export Experience Management at $commit." }
      & tar.exe -xf $archive -C $releaseDir
      if ($LASTEXITCODE -ne 0) { throw "Could not extract deployment archive for $commit." }
    } finally { Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue }
    Push-Location $releaseProject
    try {
      & npm.cmd ci --prefer-offline --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
      & npm.cmd run typecheck; if ($LASTEXITCODE -ne 0) { throw 'typecheck failed' }
      & npm.cmd test; if ($LASTEXITCODE -ne 0) { throw 'tests failed' }
      & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'build failed' }
      $retainedAssetCount = Merge-RetainedFrontendAssets -ReleaseProject $releaseProject
      Write-DeployLog "Retained $retainedAssetCount versioned frontend asset(s) from earlier releases."
      $previousProject = if (Test-Path $ActiveProjectFile) { (Get-Content $ActiveProjectFile -Raw).Trim() } else { '' }
      Set-Content -LiteralPath $ActiveProjectFile -Value $releaseProject -Encoding utf8
      try {
        & (Join-Path $PSScriptRoot 'manage.ps1') -Action restart | Out-Null
      } catch {
        $previousSupportsPostgres = $previousProject -and
          (Test-Path -LiteralPath (Join-Path $previousProject 'backend\dist\databaseAdapter.js') -PathType Leaf) -and
          (Test-Path -LiteralPath (Join-Path $previousProject 'scripts\verify-postgres-runtime.mjs') -PathType Leaf)
        if (-not (Test-Path -LiteralPath $PostgresCutoverMarker -PathType Leaf) -or $previousSupportsPostgres) {
          if ($previousProject) { Set-Content -LiteralPath $ActiveProjectFile -Value $previousProject -Encoding utf8 } else { Remove-Item -LiteralPath $ActiveProjectFile -Force -ErrorAction SilentlyContinue }
          & (Join-Path $PSScriptRoot 'manage.ps1') -Action restart | Out-Null
          throw "service restart failed; previous compatible deployment restored: $($_.Exception.Message)"
        }
        # Once PostgreSQL has accepted writes, an older SQLite-only release is
        # not a valid rollback target. Keep the new release selected for a
        # repair/retry instead of silently forking production data.
        Set-Content -LiteralPath $ActiveProjectFile -Value $releaseProject -Encoding utf8
        throw "service restart failed after PostgreSQL cutover; SQLite rollback was refused: $($_.Exception.Message)"
      }
      $tree | Set-Content -LiteralPath $DeployedFile -Encoding ascii
      Write-DeployLog "Deployed $tree from $DeploymentRef at $commit into isolated release $releaseDir."
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
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-Action','watch') -WindowStyle Hidden -RedirectStandardOutput $WatcherOutputLog -RedirectStandardError $WatcherErrorLog -PassThru
  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii
}
if ($Action -eq 'stop') { $process = Get-Watcher; if ($process) { Stop-Process -Id $process.ProcessId -Force }; Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue }
$process = Get-Watcher
[pscustomobject]@{ running=[bool]$process; pid=if($process){$process.ProcessId}else{$null}; sourceRef=$DeploymentRef; log=$LogFile; lastDeployed=if(Test-Path $DeployedFile){(Get-Content $DeployedFile -Raw).Trim()}else{$null}; activeProject=if(Test-Path $ActiveProjectFile){(Get-Content $ActiveProjectFile -Raw).Trim()}else{$ProjectDir} } | Format-List
