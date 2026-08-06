$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1')

if (-not (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 30)) {
  throw 'The current release must advertise and contain PostgreSQL runtime schema 30 support.'
}
if (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 29) {
  throw 'The runtime-30 binary must not claim that it can run on the runtime-29 schema.'
}
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 29 30)) {
  throw 'The runtime-30 release must retain an explicit runtime-29 to runtime-30 upgrade path.'
}
# The whole 26 -> 30 chain must be walkable in one release, not just its last
# step: an operator on the previously shipped window upgrades straight through
# 27, 28 and 29, and a missing intermediate migration would only surface at cutover.
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 26 30)) {
  throw 'The runtime-30 release must retain the full runtime-26 to runtime-30 upgrade chain.'
}
$emptyRelease = Join-Path ([IO.Path]::GetTempPath()) "experience-runtime-v1-$PID-$([Guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Force $emptyRelease | Out-Null
  if (Test-ProjectSupportsPostgresRuntimeVersion $emptyRelease 30) {
    throw 'A release without runtime-30 metadata/artifacts was incorrectly accepted.'
  }
} finally { Remove-Item -LiteralPath $emptyRelease -Recurse -Force -ErrorAction SilentlyContinue }

[pscustomobject]@{ runtimeSchemaVersion=30; currentReleaseCompatible=$true; runtime29Runnable=$false; runtime29UpgradeCompatible=$true; runtime26UpgradeChainCompatible=$true; legacyReleaseRejected=$true } | ConvertTo-Json -Compress
