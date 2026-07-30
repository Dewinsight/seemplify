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
  return $true
}
