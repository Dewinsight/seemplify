$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1')

if (-not (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 7)) {
  throw 'The current release must advertise and contain PostgreSQL runtime schema 7 support.'
}
if (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 6) {
  throw 'The runtime-7 binary must not claim that it can run on the runtime-6 schema.'
}
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 6 7)) {
  throw 'The runtime-7 release must retain an explicit runtime-6 to runtime-7 upgrade path.'
}
$emptyRelease = Join-Path ([IO.Path]::GetTempPath()) "experience-runtime-v1-$PID-$([Guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Force $emptyRelease | Out-Null
  if (Test-ProjectSupportsPostgresRuntimeVersion $emptyRelease 7) {
    throw 'A release without runtime-7 metadata/artifacts was incorrectly accepted.'
  }
} finally { Remove-Item -LiteralPath $emptyRelease -Recurse -Force -ErrorAction SilentlyContinue }

[pscustomobject]@{ runtimeSchemaVersion=7; currentReleaseCompatible=$true; runtime6Runnable=$false; runtime6UpgradeCompatible=$true; legacyReleaseRejected=$true } | ConvertTo-Json -Compress
