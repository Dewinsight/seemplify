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
  if ($RequiredVersion -ge 6 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0006_reviewed_social_intelligence_publications.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 7 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0007_assistant_reviewed_replies.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 8 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0008_admin_control_plane.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 9 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0009_managed_subscription_plans.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 10 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0010_deep_corpus_analysis.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 11 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0011_bounded_active_request_indexes.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 12 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0012_journey_map_v2.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 13 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0013_governed_journey_templates.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 14 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0014_journey_evidence_lifecycle.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 15 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0015_subscription_usage_ledger.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 16 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0016_journey_event_control_plane.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 17 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0017_journey_event_data_plane.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 18 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0018_journey_stage_processing.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 19 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0019_journey_research_hub.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 20 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0020_journey_v2_rollout.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 21 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0021_journey_metric_observations.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 22 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0022_journey_ai_suggestions.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 23 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0023_versioned_journey_personas.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 24 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0024_journey_rich_cards.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 25 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0025_journey_metric_alerts.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 26 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0026_journey_saved_views.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 27 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0027_journey_portfolio.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 28 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0028_journey_collaboration.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 29 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0029_journey_hierarchy_blueprints.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 30 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0030_journey_stage_reprojection.sql') -PathType Leaf)) { return $false }
  if ($RequiredVersion -ge 31 -and -not (Test-Path -LiteralPath (Join-Path $ProjectDir 'backend\migrations\postgres\0031_journey_identity_profiles.sql') -PathType Leaf)) { return $false }
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
