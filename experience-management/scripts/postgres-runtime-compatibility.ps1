function Test-ProjectSupportsPostgresRuntimeVersion([string]$ProjectDir, [int]$RequiredVersion) {
  if (-not $ProjectDir -or $RequiredVersion -lt 1) { return $false }
  $metadataPath = Join-Path $ProjectDir 'backend\migrations\postgres\runtime-compatibility.json'
  if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { return $false }
  try { $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json } catch { return $false }
  $minimum = [int]$metadata.minimumRuntimeSchemaVersion
  $maximum = [int]$metadata.maximumRuntimeSchemaVersion
  if ($minimum -lt 1 -or $maximum -lt $minimum -or $RequiredVersion -lt $minimum -or $RequiredVersion -gt $maximum) { return $false }
  if ($RequiredVersion -ge 2) {
    foreach ($relativePath in @(
      'backend\migrations\postgres\0002_platform_administration.sql',
      'backend\migrations\postgres\runtime_privileges.sql',
      'scripts\upgrade-postgres-schema.mjs',
      'scripts\postgres-runtime-contract.mjs',
      'scripts\verify-postgres-runtime.mjs'
    )) {
      if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir $relativePath) -PathType Leaf)) { return $false }
    }
  }
  if ($RequiredVersion -ge 3 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0003_knowledge_embedding_profiles.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 4 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0004_experience_assistant.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 5 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0005_experience_assistant_phase1.sql') -PathType Leaf)) { return $false }
  return $true
}

function Test-ProjectCanUpgradePostgresRuntimeVersion([string]$ProjectDir, [int]$SourceVersion, [int]$TargetVersion) {
  if (-not $ProjectDir -or $SourceVersion -lt 1 -or $TargetVersion -le $SourceVersion) { return $false }
  $metadataPath = Join-Path $ProjectDir 'backend\migrations\postgres\runtime-compatibility.json'
  if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { return $false }
  try { $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json } catch { return $false }
  $minimumRunnable = [int]$metadata.minimumRuntimeSchemaVersion
  $maximumRunnable = [int]$metadata.maximumRuntimeSchemaVersion
  $minimumUpgradeSource = [int]$metadata.minimumUpgradeSourceRuntimeSchemaVersion
  if ($minimumRunnable -lt 1 -or $maximumRunnable -lt $minimumRunnable -or
      $minimumUpgradeSource -lt 1 -or $SourceVersion -lt $minimumUpgradeSource -or
      $SourceVersion -ge $minimumRunnable -or $TargetVersion -lt $minimumRunnable -or
      $TargetVersion -gt $maximumRunnable) {
    return $false
  }
  for ($version = $SourceVersion + 1; $version -le $TargetVersion; $version += 1) {
    $migration = Join-Path $ProjectDir ("backend\migrations\postgres\{0:D4}_*" -f $version)
    if (-not @(Get-ChildItem -Path $migration -File -ErrorAction SilentlyContinue).Count) { return $false }
  }
  return $true
}
