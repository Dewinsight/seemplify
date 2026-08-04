param(
  [ValidateSet('start','stop','status','once','watch')]
  [string]$Action = 'status',
  [switch]$Force,
  [string]$DeploymentRef = 'origin/main'
)
$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$RuntimeCompatibilityScript = Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1'
if (-not (Test-Path -LiteralPath $RuntimeCompatibilityScript -PathType Leaf)) { throw 'The PostgreSQL runtime compatibility contract is missing.' }
. $RuntimeCompatibilityScript
$RepositoryDir = Split-Path -Parent $ProjectDir
$RuntimeDir = Join-Path $RepositoryDir '.local-runtime\experience-management'
$PidFile = Join-Path $RuntimeDir 'auto-deploy.pid'
$LogFile = Join-Path $RuntimeDir 'auto-deploy.log'
$WatcherOutputLog = Join-Path $RuntimeDir 'auto-deploy.stdout.log'
$WatcherErrorLog = Join-Path $RuntimeDir 'auto-deploy.stderr.log'
$DeployedFile = Join-Path $RuntimeDir 'deployed-tree'
$ActiveProjectFile = Join-Path $RuntimeDir 'active-project-path'
$PostgresCutoverMarker = Join-Path $RuntimeDir 'postgres-cutover-v1'
$PostgresCutoverState = Join-Path $RuntimeDir 'postgres-cutover-state-v1'
$PostgresRuntime4UpgradeMarker = Join-Path $RuntimeDir 'postgres-runtime-schema-v4-started'
$PostgresRuntime5UpgradeMarker = Join-Path $RuntimeDir 'postgres-runtime-schema-v5-started'
$PostgresRuntime6UpgradeMarker = Join-Path $RuntimeDir 'postgres-runtime-schema-v6-started'
$PostgresRuntime7UpgradeMarker = Join-Path $RuntimeDir 'postgres-runtime-schema-v7-started'
$PostgresRuntime8UpgradeMarker = Join-Path $RuntimeDir 'postgres-runtime-schema-v8-started'
$DeploymentsDir = Join-Path $RuntimeDir 'deployments'
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

function Write-DeployLog([string]$Message) { Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format o) $Message" }
function Invoke-IsolatedTests {
  # A watcher can be started by a shell that previously managed the live
  # service. Never let those inherited credentials, database selectors, or
  # integration settings leak into the deployment's isolated unit tests.
  $serviceEnvironmentPattern = '^(DATABASE_PROVIDER|DATABASE_PATH|POSTGRES_.+|SUBSCRIPTION_.+|ADMIN_.+|SESSION_.+|PUBLIC_URL|UPLOAD_DIR|EMAIL_MODE|AI_WORKER_.+|X_.+|NYLAS_.+|TERRA_.+|KNOWLEDGE_.+|ESIGN_.+|BREVO_.+|EXPERIENCE_.+)$'
  $inherited = @{}
  foreach ($variable in @(Get-ChildItem Env:)) {
    if ($variable.Name -notmatch $serviceEnvironmentPattern) { continue }
    $inherited[$variable.Name] = $variable.Value
    Remove-Item -LiteralPath "Env:$($variable.Name)"
  }
  try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'tests failed' }
  } finally {
    foreach ($name in $inherited.Keys) { Set-Item -LiteralPath "Env:$name" -Value $inherited[$name] }
  }
}
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
function Test-CommitSupportsPostgres([string]$Commit) {
  $requiredPaths = @(
    'experience-management/backend/src/databaseAdapter.ts',
    'experience-management/scripts/bootstrap-sqlite-store.mjs',
    'experience-management/scripts/migrate-sqlite-to-postgres.mjs',
    'experience-management/scripts/verify-postgres-runtime.mjs'
  )
  foreach ($requiredPath in $requiredPaths) {
    $entry = (@(& git ls-tree --name-only $Commit -- $requiredPath 2>$null) -join '').Trim()
    if ($LASTEXITCODE -ne 0 -or $entry -ne $requiredPath) { return $false }
  }
  return $true
}
function Test-CommitSupportsPostgresRuntime([string]$Commit, [int]$RequiredVersion) {
  $requiredPaths = @(
    'experience-management/backend/migrations/postgres/runtime-compatibility.json',
    'experience-management/backend/migrations/postgres/0002_platform_administration.sql',
    'experience-management/backend/migrations/postgres/0003_knowledge_embedding_profiles.sql',
    'experience-management/backend/migrations/postgres/0004_experience_assistant.sql',
    'experience-management/backend/migrations/postgres/runtime_privileges.sql',
    'experience-management/scripts/upgrade-postgres-schema.mjs',
    'experience-management/scripts/postgres-runtime-contract.mjs',
    'experience-management/scripts/verify-postgres-runtime.mjs'
  )
  if ($RequiredVersion -ge 5) {
    $requiredPaths += 'experience-management/backend/migrations/postgres/0005_experience_assistant_phase1.sql'
  }
  if ($RequiredVersion -ge 6) {
    $requiredPaths += 'experience-management/backend/migrations/postgres/0006_reviewed_social_intelligence_publications.sql'
  }
  if ($RequiredVersion -ge 7) {
    $requiredPaths += 'experience-management/backend/migrations/postgres/0007_assistant_reviewed_replies.sql'
  }
  if ($RequiredVersion -ge 8) {
    $requiredPaths += 'experience-management/backend/migrations/postgres/0008_admin_control_plane.sql'
  }
  foreach ($requiredPath in $requiredPaths) {
    $entry = (@(& git ls-tree --name-only $Commit -- $requiredPath 2>$null) -join '').Trim()
    if ($LASTEXITCODE -ne 0 -or $entry -ne $requiredPath) { return $false }
  }
  try {
    $metadata = ((@(& git show "${Commit}:experience-management/backend/migrations/postgres/runtime-compatibility.json" 2>$null) -join "`n") | ConvertFrom-Json)
  } catch { return $false }
  return [int]$metadata.minimumRuntimeSchemaVersion -le $RequiredVersion -and
    [int]$metadata.maximumRuntimeSchemaVersion -ge $RequiredVersion
}
function Test-CommitCanUpgradePostgresRuntime([string]$Commit, [int]$SourceVersion, [int]$TargetVersion) {
  if ($SourceVersion -lt 1 -or $TargetVersion -le $SourceVersion) { return $false }
  try {
    $metadata = ((@(& git show "${Commit}:experience-management/backend/migrations/postgres/runtime-compatibility.json" 2>$null) -join "`n") | ConvertFrom-Json)
  } catch { return $false }
  $minimumRunnable = [int]$metadata.minimumRuntimeSchemaVersion
  $maximumRunnable = [int]$metadata.maximumRuntimeSchemaVersion
  $minimumUpgradeSource = [int]$metadata.minimumUpgradeSourceRuntimeSchemaVersion
  if ($minimumUpgradeSource -lt 1 -or $SourceVersion -lt $minimumUpgradeSource -or
      $SourceVersion -ge $minimumRunnable -or $TargetVersion -lt $minimumRunnable -or
      $TargetVersion -gt $maximumRunnable) {
    return $false
  }
  $migrationEntries = @(& git ls-tree -r --name-only $Commit -- experience-management/backend/migrations/postgres 2>$null)
  if ($LASTEXITCODE -ne 0) { return $false }
  for ($version = $SourceVersion + 1; $version -le $TargetVersion; $version += 1) {
    $prefix = "experience-management/backend/migrations/postgres/{0:D4}_" -f $version
    if (-not @($migrationEntries | Where-Object { [string]$_ -like "$prefix*" }).Count) { return $false }
  }
  return $true
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
    $postgresCutoverStarted = (Test-Path -LiteralPath $PostgresCutoverMarker -PathType Leaf) -or
      (Test-Path -LiteralPath $PostgresCutoverState -PathType Leaf)
    if ($postgresCutoverStarted -and -not (Test-CommitSupportsPostgres -Commit $commit)) {
      Write-DeployLog "Skipped incompatible deployment $commit from ${DeploymentRef}: PostgreSQL cutover has started and this release is SQLite-only."
      return
    }
    if (Test-Path -LiteralPath $PostgresRuntime8UpgradeMarker -PathType Leaf) {
      if (-not (Test-CommitSupportsPostgresRuntime -Commit $commit -RequiredVersion 8)) {
        Write-DeployLog "Skipped incompatible deployment $commit from ${DeploymentRef}: PostgreSQL runtime schema 8 has started and this release is not runtime-v8-compatible."
        return
      }
    } elseif (Test-Path -LiteralPath $PostgresRuntime7UpgradeMarker -PathType Leaf) {
      $runsOnVersion7 = Test-CommitSupportsPostgresRuntime -Commit $commit -RequiredVersion 7
      $upgradesVersion7 = Test-CommitCanUpgradePostgresRuntime -Commit $commit -SourceVersion 7 -TargetVersion 8
      if (-not $runsOnVersion7 -and -not $upgradesVersion7) {
        Write-DeployLog "Skipped incompatible deployment $commit from ${DeploymentRef}: PostgreSQL runtime schema 7 has started and this release can neither run on schema 7 nor upgrade it to schema 8."
        return
      }
    } elseif (Test-Path -LiteralPath $PostgresRuntime6UpgradeMarker -PathType Leaf) {
      $runsOnVersion6 = Test-CommitSupportsPostgresRuntime -Commit $commit -RequiredVersion 6
      $upgradesVersion6 = Test-CommitCanUpgradePostgresRuntime -Commit $commit -SourceVersion 6 -TargetVersion 8
      if (-not $runsOnVersion6 -and -not $upgradesVersion6) {
        Write-DeployLog "Skipped incompatible deployment $commit from ${DeploymentRef}: PostgreSQL runtime schema 6 has started and this release can neither run on schema 6 nor upgrade it to schema 8."
        return
      }
    } elseif (Test-Path -LiteralPath $PostgresRuntime5UpgradeMarker -PathType Leaf) {
      $runsOnVersion5 = Test-CommitSupportsPostgresRuntime -Commit $commit -RequiredVersion 5
      $upgradesVersion5 = Test-CommitCanUpgradePostgresRuntime -Commit $commit -SourceVersion 5 -TargetVersion 8
      if (-not $runsOnVersion5 -and -not $upgradesVersion5) {
        Write-DeployLog "Skipped incompatible deployment $commit from ${DeploymentRef}: PostgreSQL runtime schema 5 has started and this release can neither run on schema 5 nor upgrade it to schema 8."
        return
      }
    } elseif (Test-Path -LiteralPath $PostgresRuntime4UpgradeMarker -PathType Leaf) {
      $runsOnVersion4 = Test-CommitSupportsPostgresRuntime -Commit $commit -RequiredVersion 4
      $upgradesVersion4 = Test-CommitCanUpgradePostgresRuntime -Commit $commit -SourceVersion 4 -TargetVersion 8
      if (-not $runsOnVersion4 -and -not $upgradesVersion4) {
        Write-DeployLog "Skipped incompatible deployment $commit from ${DeploymentRef}: PostgreSQL runtime schema 4 has started and this release can neither run on schema 4 nor upgrade it to schema 8."
        return
      }
    }
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
      Invoke-IsolatedTests
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
        $runtimeVersionStarted = if (Test-Path -LiteralPath $PostgresRuntime8UpgradeMarker -PathType Leaf) { 8 }
          elseif (Test-Path -LiteralPath $PostgresRuntime7UpgradeMarker -PathType Leaf) { 7 }
          elseif (Test-Path -LiteralPath $PostgresRuntime6UpgradeMarker -PathType Leaf) { 6 }
          elseif (Test-Path -LiteralPath $PostgresRuntime5UpgradeMarker -PathType Leaf) { 5 }
          elseif (Test-Path -LiteralPath $PostgresRuntime4UpgradeMarker -PathType Leaf) { 4 } else { 0 }
        $previousSupportsStartedRuntime = $previousProject -and $runtimeVersionStarted -gt 0 -and
          (Test-ProjectSupportsPostgresRuntimeVersion $previousProject $runtimeVersionStarted)
        $cutoverCommitted = Test-Path -LiteralPath $PostgresCutoverMarker -PathType Leaf
        $cutoverStaged = Test-Path -LiteralPath $PostgresCutoverState -PathType Leaf
        $runtimeUpgradeStarted = $runtimeVersionStarted -gt 0
        $rollbackCompatible = if ($runtimeUpgradeStarted) { $previousSupportsStartedRuntime } else { $previousSupportsPostgres }
        if ((-not $cutoverCommitted -and -not $cutoverStaged -and -not $runtimeUpgradeStarted) -or
            ($cutoverCommitted -and -not $cutoverStaged -and $rollbackCompatible)) {
          if ($previousProject) { Set-Content -LiteralPath $ActiveProjectFile -Value $previousProject -Encoding utf8 } else { Remove-Item -LiteralPath $ActiveProjectFile -Force -ErrorAction SilentlyContinue }
          & (Join-Path $PSScriptRoot 'manage.ps1') -Action restart | Out-Null
          throw "service restart failed; previous compatible deployment restored: $($_.Exception.Message)"
        }
        # A staged base cutover and any started runtime upgrade are both
        # roll-forward-only. Older binaries cannot enforce the active contracts.
        Set-Content -LiteralPath $ActiveProjectFile -Value $releaseProject -Encoding utf8
        throw "service restart failed after PostgreSQL cutover; an incompatible runtime rollback was refused: $($_.Exception.Message)"
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
