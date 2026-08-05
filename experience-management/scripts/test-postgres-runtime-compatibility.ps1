$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1')

if (-not (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 29)) {
  throw 'The current release must advertise and contain PostgreSQL runtime schema 29 support.'
}
if (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 28) {
  throw 'The runtime-29 binary must not claim that it can run on the runtime-28 schema.'
}
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 28 29)) {
  throw 'The runtime-29 release must retain an explicit runtime-28 to runtime-29 upgrade path.'
}
# The whole 26 -> 29 chain must be walkable in one release, not just its last
# step: an operator on the previously shipped window upgrades straight through
# 27 and 28, and a missing intermediate migration would only surface at cutover.
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 26 29)) {
  throw 'The runtime-29 release must retain the full runtime-26 to runtime-29 upgrade chain.'
}
$emptyRelease = Join-Path ([IO.Path]::GetTempPath()) "experience-runtime-v1-$PID-$([Guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Force $emptyRelease | Out-Null
  if (Test-ProjectSupportsPostgresRuntimeVersion $emptyRelease 29) {
    throw 'A release without runtime-29 metadata/artifacts was incorrectly accepted.'
  }
} finally { Remove-Item -LiteralPath $emptyRelease -Recurse -Force -ErrorAction SilentlyContinue }

[pscustomobject]@{ runtimeSchemaVersion=29; currentReleaseCompatible=$true; runtime28Runnable=$false; runtime28UpgradeCompatible=$true; runtime26UpgradeChainCompatible=$true; legacyReleaseRejected=$true } | ConvertTo-Json -Compress
