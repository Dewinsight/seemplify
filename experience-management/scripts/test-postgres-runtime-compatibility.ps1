$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1')

if (-not (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 9)) {
  throw 'The current release must advertise and contain PostgreSQL runtime schema 9 support.'
}
if (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 8) {
  throw 'The runtime-9 binary must not claim that it can run on the runtime-8 schema.'
}
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 8 9)) {
  throw 'The runtime-9 release must retain an explicit runtime-8 to runtime-9 upgrade path.'
}
$emptyRelease = Join-Path ([IO.Path]::GetTempPath()) "experience-runtime-v1-$PID-$([Guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Force $emptyRelease | Out-Null
  if (Test-ProjectSupportsPostgresRuntimeVersion $emptyRelease 9) {
    throw 'A release without runtime-9 metadata/artifacts was incorrectly accepted.'
  }
} finally { Remove-Item -LiteralPath $emptyRelease -Recurse -Force -ErrorAction SilentlyContinue }

[pscustomobject]@{ runtimeSchemaVersion=9; currentReleaseCompatible=$true; runtime8Runnable=$false; runtime8UpgradeCompatible=$true; legacyReleaseRejected=$true } | ConvertTo-Json -Compress
