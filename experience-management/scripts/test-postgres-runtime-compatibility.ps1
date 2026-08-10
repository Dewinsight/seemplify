$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1')

if (-not (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 55)) {
  throw 'The current release must advertise and contain PostgreSQL runtime schema 55 support.'
}
if (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 54) {
  throw 'The runtime-55 binary must not claim that it can run on the runtime-54 schema.'
}
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 54 55)) {
  throw 'The runtime-55 release must retain an explicit runtime-54 to runtime-55 upgrade path.'
}
# The whole 26 -> 32 chain must be walkable in one release, not just its last
# step: an operator on the previously shipped window upgrades straight through
# 27, 28 and 29, and a missing intermediate migration would only surface at cutover.
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 26 55)) {
  throw 'The runtime-55 release must retain the full runtime-26 to runtime-55 upgrade chain.'
}
$emptyRelease = Join-Path ([IO.Path]::GetTempPath()) "experience-runtime-v1-$PID-$([Guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Force $emptyRelease | Out-Null
  if (Test-ProjectSupportsPostgresRuntimeVersion $emptyRelease 55) {
    throw 'A release without runtime-55 metadata/artifacts was incorrectly accepted.'
  }
} finally { Remove-Item -LiteralPath $emptyRelease -Recurse -Force -ErrorAction SilentlyContinue }

[pscustomobject]@{ runtimeSchemaVersion=55; currentReleaseCompatible=$true; runtime54Runnable=$false; runtime54UpgradeCompatible=$true; runtime26UpgradeChainCompatible=$true; legacyReleaseRejected=$true } | ConvertTo-Json -Compress
