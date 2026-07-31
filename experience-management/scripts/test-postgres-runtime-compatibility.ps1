$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1')

if (-not (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 5)) {
  throw 'The current release must advertise and contain PostgreSQL runtime schema 5 support.'
}
if (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 4) {
  throw 'The runtime-5 binary must not claim that it can run on the runtime-4 schema.'
}
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 4 5)) {
  throw 'The runtime-5 release must retain an explicit runtime-4 to runtime-5 upgrade path.'
}
$emptyRelease = Join-Path ([IO.Path]::GetTempPath()) "experience-runtime-v1-$PID-$([Guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Force $emptyRelease | Out-Null
  if (Test-ProjectSupportsPostgresRuntimeVersion $emptyRelease 5) {
    throw 'A release without runtime-5 metadata/artifacts was incorrectly accepted.'
  }
} finally { Remove-Item -LiteralPath $emptyRelease -Recurse -Force -ErrorAction SilentlyContinue }

[pscustomobject]@{ runtimeSchemaVersion=5; currentReleaseCompatible=$true; runtime4Runnable=$false; runtime4UpgradeCompatible=$true; legacyReleaseRejected=$true } | ConvertTo-Json -Compress
